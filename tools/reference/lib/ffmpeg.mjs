/**
 * ffmpeg discovery + helpers for the reference tools.
 *
 * Search order: $FFMPEG / $FFMPEG_PATH, `import('@ffmpeg-installer/ffmpeg')` (when it is
 * resolvable from here), the pnpm store copy of @ffmpeg-installer/ffmpeg (a transitive dep in
 * this repo — resolves the right platform binary on macOS/Windows/Linux), the pnpm store
 * platform package directly, then `ffmpeg` on PATH. Only builds with libx264 are accepted for MP4.
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const EXE = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

const probe = (bin) => {
  try {
    const enc = execFileSync(bin, ['-hide_banner', '-encoders'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 8 << 20 });
    return { path: bin, x264: /libx264/.test(enc) };
  } catch {
    return null;
  }
};

let cached;
export async function findFfmpeg() {
  if (cached !== undefined) return cached;
  const cands = [];
  for (const k of ['FFMPEG', 'FFMPEG_PATH']) if (process.env[k]) cands.push(process.env[k]);
  try {
    const m = await import('@ffmpeg-installer/ffmpeg');
    if (m?.default?.path) cands.push(m.default.path);
  } catch {}
  const store = path.join(REPO, 'node_modules/.pnpm');
  if (fs.existsSync(store)) {
    const dirs = fs.readdirSync(store);
    for (const d of dirs.filter((n) => n.startsWith('@ffmpeg-installer+ffmpeg@'))) {
      try {
        const req = createRequire(path.join(store, d, 'node_modules/@ffmpeg-installer/ffmpeg/package.json'));
        cands.push(req('@ffmpeg-installer/ffmpeg').path);
      } catch {}
    }
    const plat = `@ffmpeg-installer+${process.platform}-${process.arch}@`;
    for (const d of dirs.filter((n) => n.startsWith(plat))) {
      cands.push(path.join(store, d, 'node_modules/@ffmpeg-installer', `${process.platform}-${process.arch}`, EXE));
    }
  }
  const hoisted = path.join(REPO, 'node_modules/@ffmpeg-installer', `${process.platform}-${process.arch}`, EXE);
  cands.push(hoisted);
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) if (dir) cands.push(path.join(dir, EXE));
  let fallback = null;
  for (const c of cands) {
    if (!c || !fs.existsSync(c)) continue;
    const info = probe(c);
    if (info?.x264) return (cached = info);
    if (info && !fallback) fallback = info;
  }
  return (cached = fallback);
}

export function run(bin, args, { quiet = true } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => {
      err += d;
      if (err.length > 64_000) err = err.slice(-32_000);
      if (!quiet) process.stderr.write(d);
    });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(err) : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-1500)}`))));
  });
}

/**
 * Encode captured frames to a constant-60fps MP4 in real time: each image is held for its frame
 * gap (a frame captured every 3rd frame lasts 3/60 s), so playback speed matches the game.
 * @param {{file:string, frame:number}[]} frames absolute paths, ascending frame numbers
 */
export async function framesToMp4(ff, frames, outFile, { fps = 60, crf = 18, maxGap = 30 } = {}) {
  if (!frames.length) return null;
  const list = [];
  let total = 0;
  for (let i = 0; i < frames.length; i++) {
    const gap = i + 1 < frames.length ? Math.min(maxGap, Math.max(1, frames[i + 1].frame - frames[i].frame)) : 1;
    total += gap;
    list.push(`file '${frames[i].file.replace(/'/g, "'\\''")}'`, `duration ${(gap / fps).toFixed(6)}`);
  }
  list.push(`file '${frames.at(-1).file.replace(/'/g, "'\\''")}'`);
  const listFile = `${outFile}.txt`;
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(listFile, list.join('\n') + '\n');
  try {
    await run(ff.path, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'concat', '-safe', '0', '-i', listFile,
      '-vf', `fps=${fps},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`,
      '-frames:v', String(total), // the repeated last entry (concat quirk) would add frames
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-movflags', '+faststart',
      outFile,
    ]);
  } finally {
    fs.rmSync(listFile, { force: true });
  }
  return outFile;
}
