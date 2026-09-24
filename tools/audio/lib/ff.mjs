// ffmpeg resolution for the Node audio tools (same order as tools/video/ffenv.sh):
// $FFMPEG, then imageio-ffmpeg's static binary via $PIPELINE_PY / tools/.venv / python3, then PATH.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from '../../gen/lib/provenance.mjs';

let cached = null;

export function ffmpegPath() {
  if (cached) return cached;
  if (process.env.FFMPEG) return (cached = process.env.FFMPEG);
  for (const py of [process.env.PIPELINE_PY, path.join(REPO, 'tools/.venv/bin/python'), 'python3'].filter(Boolean)) {
    const r = spawnSync(py, ['-c', 'import imageio_ffmpeg as m; print(m.get_ffmpeg_exe())'], { encoding: 'utf8' });
    const p = r.status === 0 ? r.stdout.trim() : '';
    if (p && fs.existsSync(p)) return (cached = p);
  }
  const w = spawnSync('sh', ['-c', 'command -v ffmpeg'], { encoding: 'utf8' });
  if (w.status === 0 && w.stdout.trim()) return (cached = w.stdout.trim());
  throw new Error('no ffmpeg found: set FFMPEG=/path/to/ffmpeg (full build) or pip install -r tools/requirements.txt into tools/.venv');
}

/** Run ffmpeg; returns {stdout: Buffer, stderr: string}. Throws with stderr on failure. */
export function ff(args, { input } = {}) {
  const r = spawnSync(ffmpegPath(), ['-hide_banner', '-nostdin', ...args], { input, maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(' ')} failed:\n${r.stderr?.toString().slice(-2000)}`);
  return { stdout: r.stdout, stderr: r.stderr.toString() };
}

/** Decode any audio file to interleaved s16le at `rate` Hz with `channels` channels. */
export function decodePcm(file, { rate = 48000, channels = 2 } = {}) {
  return ff(['-loglevel', 'error', '-i', file, '-vn', '-f', 's16le', '-acodec', 'pcm_s16le', '-ar', String(rate), '-ac', String(channels), '-']).stdout;
}

/** RIFF/WAVE header + s16le PCM. */
export function wavBuffer(pcm, { rate = 48000, channels = 2 } = {}) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * channels * 2, 28); h.writeUInt16LE(channels * 2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** Encode a WAV to the web formats with bit-exact containers. Returns written paths. */
export function encodeWeb(wav, outBase, formats, { opusKbps = 96, aacKbps = 128, vorbisQ = 5 } = {}) {
  const bx = ['-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact'];
  const out = [];
  for (const f of formats) {
    const dst = `${outBase}.${f}`;
    const codec = {
      webm: ['-c:a', 'libopus', '-b:a', `${opusKbps}k`, '-vbr', 'on', '-application', 'audio'],
      m4a: ['-c:a', 'aac', '-b:a', `${aacKbps}k`, '-movflags', '+faststart'],
      ogg: ['-c:a', 'libvorbis', '-q:a', String(vorbisQ)],
    }[f];
    if (!codec) throw new Error(`unknown format ${f} (webm, m4a, ogg)`);
    ff(['-loglevel', 'error', '-y', '-i', wav, ...codec, '-ar', '48000', ...bx, dst]);
    out.push(dst);
  }
  return out;
}
