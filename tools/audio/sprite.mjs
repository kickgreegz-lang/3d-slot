#!/usr/bin/env node
// SFX sprite packer: mastered one-shots -> one sprite per format + a JSON map (Howler 'sprite',
// audiosprite-style 'spritemap', exact sample offsets). Clips start on AAC frame boundaries
// (1024 samples @ 48 kHz) so AAC/Opus priming never smears a neighbour into a clip.
import fs from 'node:fs';
import path from 'node:path';
import { GenError, parseArgs } from '../gen/lib/genlib.mjs';
import { MANIFEST, makeRow, record, rel, safeId, sha256File, digestFiles } from '../gen/lib/provenance.mjs';
import { decodePcm, encodeWeb, wavBuffer } from './lib/ff.mjs';

const TOOL = 'tools/audio/sprite.mjs';
const HELP = `Usage: node ${TOOL} --out OUT_BASE [options] clip.wav [clip.wav ...]
  Writes OUT_BASE.{webm,m4a}[.ogg] + OUT_BASE.json. The sprite key is each file's stem
  (e.g. land_heavy_01 from land_heavy_01.wav); inputs should already be mastered (master.sh --mode sfx).
Options:
  --out BASE            output path without extension (required)
  --formats LIST        webm,m4a (default) [,ogg]
  --gap-ms N            silence after each clip before alignment (default 250)
  --align N             clip starts are multiples of N samples (default 1024 = one AAC frame)
  --channels 1|2        sprite channel count (default 2)
  --loop KEY            mark a sprite entry as looping (repeatable)
  --qa-dir DIR          default build/qa/audio/<basename>   --manifest FILE   also append rows (default none)
  --parent-id ID        input row id(s) (repeatable)          --license-id ID   default ffmpeg
  --shipped             mark rows shipped
Exit: 0 ok, 1 QA failed (clip bleed or length mismatch after encoding), 2 usage.`;

const SPEC = {
  help: { type: 'boolean', alias: 'h' }, out: { type: 'string' }, formats: { type: 'string', default: 'webm,m4a' },
  'gap-ms': { type: 'number', default: 250 }, align: { type: 'number', default: 1024 }, channels: { type: 'number', default: 2 },
  loop: { type: 'string', multi: true }, 'qa-dir': { type: 'string' }, manifest: { type: 'string', default: 'none' },
  'parent-id': { type: 'string', multi: true }, 'license-id': { type: 'string', default: 'ffmpeg' }, shipped: { type: 'boolean' },
};

const RATE = 48000;

function peakDb(pcm, from, to, ch) {
  let p = 0;
  for (let i = from * ch; i < Math.min(to * ch, pcm.length / 2); i++) p = Math.max(p, Math.abs(pcm.readInt16LE(i * 2)));
  return p ? 20 * Math.log10(p / 32768) : -Infinity;
}

async function main(argv) {
  const a = parseArgs(argv, SPEC);
  if (a.help) { console.log(HELP); return 0; }
  if (!a.out) throw new GenError('--out is required (see --help)');
  const files = a._;
  if (!files.length) throw new GenError('no input clips');
  const ch = a.channels;
  if (![1, 2].includes(ch)) throw new GenError('--channels 1|2');
  const formats = a.formats.split(',').map((s) => s.trim()).filter(Boolean);
  const keys = new Set();
  const parts = [];
  const map = { version: 1, sampleRate: RATE, channels: ch, alignSamples: a.align, src: [], sprite: {}, spritemap: {}, samples: {}, sources: {} };
  let cursor = 0;
  const gap = Math.round((a['gap-ms'] / 1000) * RATE);
  for (const f of files) {
    if (!fs.existsSync(f)) throw new GenError(`clip not found: ${f}`);
    const key = path.basename(f).replace(/\.[^.]+$/, '');
    if (keys.has(key)) throw new GenError(`duplicate sprite key ${key}`);
    keys.add(key);
    const pcm = decodePcm(f, { rate: RATE, channels: ch });
    const n = pcm.length / (2 * ch);
    if (!n) throw new GenError(`empty clip: ${f}`);
    const start = cursor;
    parts.push(pcm);
    const end = start + n;
    let next = end + gap;
    next = Math.ceil(next / a.align) * a.align;
    parts.push(Buffer.alloc((next - end) * 2 * ch));
    cursor = next;
    const loop = a.loop.includes(key);
    map.sprite[key] = loop ? [+(start / RATE * 1000).toFixed(3), +(n / RATE * 1000).toFixed(3), true] : [+(start / RATE * 1000).toFixed(3), +(n / RATE * 1000).toFixed(3)];
    map.spritemap[key] = { start: +(start / RATE).toFixed(6), end: +(end / RATE).toFixed(6), loop };
    map.samples[key] = [start, n];
    map.sources[key] = { path: rel(f), sha256: sha256File(f) };
  }
  for (const k of a.loop) if (!keys.has(k)) throw new GenError(`--loop ${k}: no such clip`);
  const pcm = Buffer.concat(parts);
  const total = pcm.length / (2 * ch);
  const outBase = a.out;
  fs.mkdirSync(path.dirname(outBase), { recursive: true });
  const qaDir = a['qa-dir'] ?? path.join('build', 'qa', 'audio', path.basename(outBase));
  fs.mkdirSync(qaDir, { recursive: true });
  const wav = path.join(qaDir, `${path.basename(outBase)}.sprite.wav`);
  fs.writeFileSync(wav, wavBuffer(pcm, { rate: RATE, channels: ch }));
  const outs = encodeWeb(wav, outBase, formats);
  map.src = outs.map((o) => path.basename(o));
  map.totalSamples = total;
  const jsonPath = `${outBase}.json`;
  fs.writeFileSync(jsonPath, `${JSON.stringify(map, null, 2)}\n`);

  // QA: decode every encode, check length, energy inside each clip, silence in every gap
  const qa = { tool: TOOL, clips: Object.keys(map.samples).length, totalSamples: total, outputs: [] };
  let ok = true;
  for (const o of outs) {
    const d = decodePcm(o, { rate: RATE, channels: ch });
    const n = d.length / (2 * ch);
    const res = { file: rel(o), samples: n, lengthOk: Math.abs(n - total) <= a.align, clips: {} };
    ok &&= res.lengthOk;
    const entries = Object.entries(map.samples);
    entries.forEach(([k, [s, len]], i) => {
      const next = i + 1 < entries.length ? entries[i + 1][1][0] : total;
      const inside = peakDb(d, s, s + len, ch);
      // the gap between clips, minus 20 ms at each side (codec ringing / pre-echo of the next attack):
      // anything louder there means a clip bled into its neighbour's window
      const gapPk = peakDb(d, s + len + 960, next - 960, ch);
      res.clips[k] = { peakDb: +inside.toFixed(2), gapPeakDb: Number.isFinite(gapPk) ? +gapPk.toFixed(2) : null };
      if (!(inside > -40) || (Number.isFinite(gapPk) && gapPk > -50)) ok = false;
    });
    qa.outputs.push(res);
  }
  qa.passed = ok;
  fs.writeFileSync(path.join(qaDir, 'qa.json'), `${JSON.stringify(qa, null, 2)}\n`);
  const rows = [...outs, jsonPath].map((o) => {
    const digest = sha256File(o);
    return makeRow({
      id: safeId(path.basename(outBase), 'sprite', path.extname(o).slice(1), digest.slice(0, 8)), path: rel(o), stage: 'audio-post',
      route: 'ffmpeg', vendor: 'self', model: TOOL, version: digestFiles([new URL(import.meta.url).pathname]).slice(0, 12),
      licenseId: a['license-id'], refHashes: files.map((f) => sha256File(f)), parents: a['parent-id'], sha256: digest,
      shipped: a.shipped, qa: { passed: ok, report: rel(path.join(qaDir, 'qa.json')) },
      notes: `${Object.keys(map.samples).length} clips, ${(total / RATE).toFixed(3)} s`,
    });
  });
  record(rows, { sidecar: path.join(qaDir, 'manifest.json'), manifest: a.manifest === 'none' ? null : a.manifest ?? MANIFEST, generatedBy: TOOL });
  console.log(JSON.stringify({ outputs: [...outs, jsonPath].map(rel), clips: map.samples, qa: rel(path.join(qaDir, 'qa.json')), passed: ok }, null, 2));
  return ok ? 0 : 1;
}

main(process.argv.slice(2)).then((c) => process.exit(c), (e) => {
  console.error(`error: ${e.message}`);
  process.exit(e instanceof GenError ? e.code : 2);
});
