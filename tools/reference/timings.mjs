#!/usr/bin/env node
/**
 * Frame-difference timing analysis for reference captures (or any PNG/JPEG sequence or video).
 *
 *   node tools/reference/timings.mjs <runDir | framesDir | video.mp4> [options]
 *
 *   --regions <json|file>  analysis rects in normalised coords (0..1 of the game canvas; of the
 *                          image for plain folders/videos). Either {"grid":[x,y,w,h], ...} or
 *                          [{"name":"grid","rect":[x,y,w,h],"split":5}, ...]. Default: run.json's
 *                          script regions, else whole frame only.
 *   --columns N            split the "grid" region (or --columns-of <name>) into N equal columns
 *                          -> series grid.c1..grid.cN (reel stops!)
 *   --segment a,b          only these segments (names or indexes)
 *   --width 320            analysis width (frames are area-averaged down to this)
 *   --fps 60               for plain folders / videos (run dirs carry their own timeline)
 *   --frac 0.15            activity threshold = floor + frac*(p98 - floor)   --threshold X (absolute)
 *   --min-spin 150         ms a column must move continuously to count as a spin (for stop detection)
 *   --out <dir>            default <runDir>/timings
 *
 * Energy = mean |ΔR|+|ΔG|+|ΔB| / 3 (0..255) between consecutive CAPTURED frames of a segment
 * (every-3rd segments therefore span 3 frames per sample; the `gap` column says so).
 * Writes timings.csv (one row per frame, one column per series), events.json (bursts, peaks,
 * per-segment summary: spin start, per-column stop times + gaps, flash cadence) and timings.svg.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { parseArgs } from './lib/args.mjs';
import { decodePng, downsample } from './lib/png.mjs';

/* ----------------------------------------------------------------- worker */
function workerMain() {
  parentPort.on('message', ({ id, file, width, ffmpeg }) => {
    try {
      let buf = fs.readFileSync(file);
      if (!(buf[0] === 0x89 && buf[1] === 0x50)) {
        if (!ffmpeg) throw new Error(`${path.basename(file)} is not a PNG and no ffmpeg was found to decode it`);
        const r = spawnSync(ffmpeg, ['-v', 'error', '-i', file, '-f', 'image2pipe', '-vcodec', 'png', '-'], { maxBuffer: 1 << 28 });
        if (r.status !== 0) throw new Error(`ffmpeg could not decode ${file}: ${r.stderr}`);
        buf = r.stdout;
      }
      const img = decodePng(buf);
      const ds = downsample(img, width);
      parentPort.postMessage({ id, width: ds.width, height: ds.height, factor: ds.factor, srcW: img.width, srcH: img.height, data: ds.data }, [ds.data.buffer]);
    } catch (e) {
      parentPort.postMessage({ id, error: String(e.message ?? e) });
    }
  });
}

/* ------------------------------------------------------------------- main */
async function main() {
  const args = parseArgs(process.argv.slice(2), { booleans: ['help'] });
  const input = args._[0];
  if (!input || args.help) {
    const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
    console.log(src.slice(src.indexOf('/**') + 3, src.indexOf('*/')).replace(/^ \* ?/gm, ''));
    process.exit(input ? 0 : 2);
  }
  const width = Number(args.width ?? 320);
  const { findFfmpeg } = await import('./lib/ffmpeg.mjs');
  const ff = await findFfmpeg();

  // ---- input -> { frames:[{file,frame,t,seg}], segments:[{index,name,every}], run, outDir }
  let src;
  if (fs.statSync(input).isFile()) src = await fromVideo(input, args, ff, width);
  else src = fromFolder(input, args);
  const { run } = src;
  const outDir = path.resolve(args.out ?? path.join(src.baseDir, 'timings'));
  fs.mkdirSync(outDir, { recursive: true });

  // ---- regions
  let regions = null;
  if (args.regions) {
    const raw = fs.existsSync(args.regions) ? fs.readFileSync(args.regions, 'utf8') : args.regions;
    try {
      regions = JSON.parse(raw);
    } catch (e) {
      console.error(`--regions: not JSON or a file: ${e.message}`);
      process.exit(2);
    }
  } else if (run?.analysis?.regions) regions = run.analysis.regions;
  const columns = Number(args.columns ?? run?.analysis?.columns ?? 0);
  const series = buildSeries(regions, columns, String(args['columns-of'] ?? 'grid'));

  // ---- energies for video input first (its frame list is only known after streaming)
  const streamed = src.stream ? await streamEnergies(src, series, width) : null;

  // ---- segments filter
  let segments = src.segments;
  if (args.segment) {
    const want = String(args.segment).split(',');
    segments = segments.filter((s) => want.includes(s.name) || want.includes(String(s.index)));
  }
  const segIds = new Set(segments.map((s) => s.index));
  const frames = src.frames.filter((f) => segIds.has(f.seg));
  console.log(`timings: ${frames.length} frames in ${segments.length} segment(s) · series: ${series.map((s) => s.name).join(', ')} · width ${width}`);

  // ---- energies
  const energies = streamed ?? (await fileEnergies(frames, series, width, ff?.path, src.canvasPx));

  // ---- per-segment rows + events. Thresholds are per series over the WHOLE input: a segment
  // where a reel spins 90% of the time has no quiet floor of its own.
  const rows = [];
  const results = [];
  const opts = { frac: Number(args.frac ?? 0.15), threshold: args.threshold != null ? Number(args.threshold) : null, minQuietMs: Number(args['min-quiet'] ?? 50), minSpinMs: Number(args['min-spin'] ?? 150) };
  const all = Object.fromEntries(series.map((s) => [s.name, []]));
  for (const f of frames) {
    const e = energies.get(f.file ?? f.frame);
    if (e) for (const s of series) all[s.name].push(e[s.name]);
  }
  const levels = Object.fromEntries(series.map((s) => [s.name, { floor: pct(all[s.name], 10), p98: pct(all[s.name], 98) }]));
  for (const seg of segments) {
    const fr = frames.filter((f) => f.seg === seg.index).sort((a, b) => a.frame - b.frame);
    if (fr.length < 2) continue;
    const ts = [], per = Object.fromEntries(series.map((s) => [s.name, []]));
    fr.forEach((f, i) => {
      const e = energies.get(f.file ?? f.frame) ?? null;
      const gap = i ? f.frame - fr[i - 1].frame : '';
      rows.push([seg.index, seg.name, f.frame, f.t, f.t - fr[0].t, gap, ...series.map((s) => (i && e ? e[s.name].toFixed(3) : ''))]);
      if (i) {
        ts.push(f.t);
        for (const s of series) per[s.name].push(e ? e[s.name] : 0);
      }
    });
    const an = {};
    for (const s of series) an[s.name] = analyze(ts, per[s.name], { ...opts, ...levels[s.name] });
    results.push({ seg, t0: fr[0].t, ts, per, an, summary: summarize(seg, fr[0].t, ts, per, an, series, opts, src.actions) });
  }

  // ---- write
  const header = ['segment', 'seg_name', 'frame', 't_ms', 't_seg_ms', 'gap_frames', ...series.map((s) => s.name)];
  fs.writeFileSync(path.join(outDir, 'timings.csv'), [header, ...rows].map((r) => r.join(',')).join('\n') + '\n');
  const events = {
    input: path.resolve(input),
    note: 'times in ms on the capture timeline (t) and relative to the segment\'s first captured frame (tSeg). energy = mean abs RGB diff vs previous captured frame (0..255).',
    width,
    series: series.map(({ name, rect }) => ({ name, rect })),
    segments: results.map((r) => ({ index: r.seg.index, name: r.seg.name, every: r.seg.every, summary: r.summary, series: r.an })),
  };
  fs.writeFileSync(path.join(outDir, 'events.json'), JSON.stringify(events, null, 2));
  fs.writeFileSync(path.join(outDir, 'timings.svg'), svgPlot(results, series, { title: run ? `${run.game} / ${run.run}` : path.basename(path.resolve(input)), actions: src.actions }));
  for (const r of results) {
    const s = r.summary;
    const bits = [];
    if (s.firstMotionMs != null) bits.push(`motion +${s.firstMotionMs}`);
    if (s.columnStops?.length) bits.push(`stops ${s.columnStops.map((c) => `+${c.tSeg}`).join(' ')} (gaps ${s.stopGapsMs.join('/')}; tails ${s.columnStops.map((c) => c.tailMs).join('/')} ms)`);
    if (s.flashPeakSpacingMs) bits.push(`flash peaks every ~${s.flashPeakSpacingMs} ms`);
    if (s.lastMotionMs != null) bits.push(`last motion +${s.lastMotionMs}`);
    console.log(`  ${String(r.seg.index).padStart(2)} ${r.seg.name.padEnd(18)} ${bits.join(' · ')}`);
  }
  console.log(`wrote ${path.relative(process.cwd(), outDir) || outDir}/{timings.csv,events.json,timings.svg}`);
}

/* ------------------------------------------------------------------ input */
function fromFolder(dir, args) {
  dir = path.resolve(dir);
  let runDir = null;
  if (fs.existsSync(path.join(dir, 'frames.json'))) runDir = dir;
  else if (fs.existsSync(path.join(dir, '..', 'frames.json'))) runDir = path.resolve(dir, '..');
  if (runDir) {
    const fj = JSON.parse(fs.readFileSync(path.join(runDir, 'frames.json'), 'utf8'));
    const sj = JSON.parse(fs.readFileSync(path.join(runDir, 'segments.json'), 'utf8'));
    const run = fs.existsSync(path.join(runDir, 'run.json')) ? JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8')) : null;
    const frames = fj.frames.map((f) => ({ ...f, abs: path.join(runDir, f.file) }));
    const used = new Set(frames.map((f) => f.seg));
    let canvasPx = null;
    if (run?.canvas && run.clip !== 'canvas') {
      const d = run.dpr ?? 1;
      canvasPx = { x: run.canvas.x * d, y: run.canvas.y * d, width: run.canvas.width * d, height: run.canvas.height * d };
    }
    return { baseDir: runDir, run, frames, segments: sj.segments.filter((s) => used.has(s.index)), actions: sj.actions ?? [], canvasPx };
  }
  const fps = Number(args.fps ?? 60);
  const files = fs.readdirSync(dir).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort();
  if (!files.length) throw new Error(`no frames.json and no .png/.jpg files in ${dir}`);
  const frames = files.map((f, i) => {
    const m = /(\d+)\.[a-z]+$/i.exec(f);
    const frame = m && !args['by-order'] ? Number(m[1]) : i;
    return { file: f, abs: path.join(dir, f), frame, t: Math.round((frame * 1000) / fps), seg: 1 };
  });
  return { baseDir: dir, run: null, frames, segments: [{ index: 1, name: path.basename(dir), every: 1 }], actions: [], canvasPx: null };
}

async function fromVideo(file, args, ff, width) {
  if (!ff) throw new Error('video input needs ffmpeg (set $FFMPEG)');
  const probe = spawnSync(ff.path, ['-hide_banner', '-i', file], { encoding: 'utf8' }).stderr;
  const dim = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(probe);
  if (!dim) throw new Error(`could not read video size from ffmpeg: ${probe.slice(-400)}`);
  const fps = Number(args.fps ?? /([\d.]+) fps/.exec(probe)?.[1] ?? 60);
  const w = Math.min(width, Number(dim[1]));
  const h = Math.max(2, Math.round((w * Number(dim[2])) / Number(dim[1]) / 2) * 2);
  return {
    baseDir: path.dirname(path.resolve(file)),
    run: null,
    stream: { file, ff: ff.path, w, h, fps },
    frames: [],
    segments: [{ index: 1, name: path.basename(file).replace(/\.\w+$/, ''), every: 1 }],
    actions: [],
    canvasPx: null,
  };
}

/* ----------------------------------------------------------------- series */
function buildSeries(regions, columns, columnsOf) {
  const out = [{ name: 'full', rect: [0, 0, 1, 1], canvas: false }];
  let list = [];
  if (Array.isArray(regions)) list = regions.map((r) => ({ name: r.name, rect: r.rect, split: r.split }));
  else if (regions && typeof regions === 'object') list = Object.entries(regions).map(([name, rect]) => (Array.isArray(rect) ? { name, rect } : { name, ...rect }));
  if (columns > 0) {
    const target = list.find((r) => r.name === columnsOf);
    if (target) target.split = columns;
    else list.push({ name: columnsOf, rect: [0, 0, 1, 1], split: columns });
  }
  for (const r of list) {
    if (!Array.isArray(r.rect) || r.rect.length !== 4) throw new Error(`region ${r.name}: rect must be [x,y,w,h] (0..1)`);
    out.push({ name: r.name, rect: r.rect.map(Number), canvas: true });
    const n = Number(r.split ?? 0);
    for (let k = 0; k < n; k++) {
      const [x, y, w, h] = r.rect.map(Number);
      out.push({ name: `${r.name}.c${k + 1}`, rect: [x + (k * w) / n, y, w / n, h], canvas: true });
    }
  }
  return out;
}

/** Pixel boxes in the downsampled image for each series. */
function boxesFor(series, ds, canvasPx) {
  const f = ds.factor ?? 1;
  const ref = canvasPx ?? { x: 0, y: 0, width: ds.width * f, height: ds.height * f };
  return series.map((s) => {
    const base = s.canvas ? ref : { x: 0, y: 0, width: ds.width * f, height: ds.height * f };
    const [x, y, w, h] = s.rect;
    const x0 = Math.max(0, Math.floor((base.x + x * base.width) / f)), y0 = Math.max(0, Math.floor((base.y + y * base.height) / f));
    const x1 = Math.min(ds.width, Math.ceil((base.x + (x + w) * base.width) / f)), y1 = Math.min(ds.height, Math.ceil((base.y + (y + h) * base.height) / f));
    return { name: s.name, x0, y0, x1: Math.max(x0 + 1, x1), y1: Math.max(y0 + 1, y1) };
  });
}

function energy(a, b, boxes, w) {
  const out = {};
  for (const bx of boxes) {
    let s = 0, n = 0;
    for (let y = bx.y0; y < bx.y1; y++) {
      let i = (y * w + bx.x0) * 3;
      for (let x = bx.x0; x < bx.x1; x++, i += 3) {
        s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
        n += 3;
      }
    }
    out[bx.name] = n ? s / n : 0;
  }
  return out;
}

/** Decode frames with a worker pool (ordered consumption, bounded memory); energy vs previous frame in the same segment. */
async function fileEnergies(frames, series, width, ffPath, canvasPx) {
  const N = Math.max(1, Math.min(os.cpus().length, 8));
  const workers = Array.from({ length: N }, () => new Worker(fileURLToPath(import.meta.url)));
  const waiting = new Map();
  for (const w of workers) w.on('message', (m) => waiting.get(m.id)?.(m));
  const decode = (f, k) =>
    new Promise((resolve) => {
      waiting.set(k, resolve);
      workers[k % N].postMessage({ id: k, file: f.abs, width, ffmpeg: ffPath });
    });
  const out = new Map();
  const window = N * 3;
  const inflight = new Map();
  let prev = null, prevSeg = null, boxes = null;
  const t0 = Date.now();
  for (let k = 0; k < frames.length; k++) {
    for (let j = k; j < Math.min(frames.length, k + window); j++) if (!inflight.has(j)) inflight.set(j, decode(frames[j], j));
    const m = await inflight.get(k);
    inflight.delete(k);
    waiting.delete(k);
    if (m.error) throw new Error(m.error);
    boxes ??= boxesFor(series, m, canvasPx);
    const f = frames[k];
    if (prev && prevSeg === f.seg) out.set(f.file, energy(m.data, prev, boxes, m.width));
    prev = m.data;
    prevSeg = f.seg;
    if (k && k % 200 === 0) process.stdout.write(`  ${k}/${frames.length} frames (${((Date.now() - t0) / 1000).toFixed(0)} s)\n`);
  }
  await Promise.all(workers.map((w) => w.terminate()));
  return out;
}

/** Video input: one ffmpeg process streams downscaled raw RGB. */
async function streamEnergies(src, series, width) {
  const { file, ff, w, h, fps } = src.stream;
  const p = spawn(ff, ['-v', 'error', '-i', file, '-vf', `scale=${w}:${h}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { stdio: ['ignore', 'pipe', 'inherit'] });
  const size = w * h * 3;
  const boxes = boxesFor(series, { width: w, height: h, factor: 1 }, null);
  const out = new Map();
  let pending = Buffer.alloc(0), prev = null, i = 0;
  for await (const chunk of p.stdout) {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= size) {
      const cur = Float32Array.from(pending.subarray(0, size));
      pending = pending.subarray(size);
      src.frames.push({ file: i, frame: i, t: Math.round((i * 1000) / fps), seg: 1 });
      if (prev) out.set(i, energy(cur, prev, boxes, w));
      prev = cur;
      i++;
    }
  }
  return out;
}

/* ---------------------------------------------------------------- analyse */
const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))];
};
const r1 = (x) => Math.round(x * 100) / 100;

function analyze(ts, es, { frac, threshold, minQuietMs, floor, p98: peak }) {
  const flat = peak - floor < 1;
  const thr = threshold ?? floor + Math.max(0.5, frac * (peak - floor));
  const bursts = [];
  const peaks = [];
  if (!flat || threshold != null) {
    let cur = null;
    for (let i = 0; i < es.length; i++) {
      if (es[i] > thr) {
        if (cur && ts[i] - cur.lastT > minQuietMs + 1 && cur.quiet) {
          bursts.push(cur);
          cur = null;
        }
        if (!cur) cur = { startT: ts[i], lastT: ts[i], peakT: ts[i], peakE: es[i], sum: 0, n: 0, quiet: false };
        cur.lastT = ts[i];
        cur.quiet = false;
        cur.sum += es[i];
        cur.n++;
        if (es[i] > cur.peakE) Object.assign(cur, { peakT: ts[i], peakE: es[i] });
      } else if (cur) {
        cur.quiet = true;
        if (ts[i] - cur.lastT >= minQuietMs) {
          bursts.push(cur);
          cur = null;
        }
      }
      if (es[i] > thr && (i === 0 || es[i] >= es[i - 1]) && (i === es.length - 1 || es[i] > es[i + 1])) {
        if (!peaks.length || ts[i] - peaks.at(-1).t > 1.5 * (ts[1] - ts[0] || 16)) peaks.push({ t: ts[i], e: r1(es[i]) });
      }
    }
    if (cur) bursts.push(cur);
  }
  return {
    floor: r1(floor),
    p98: r1(peak),
    threshold: r1(thr),
    flat,
    bursts: bursts.map((b) => ({ startT: b.startT, lastMotionT: b.lastT, durationMs: b.lastT - b.startT, peakT: b.peakT, peakE: r1(b.peakE), meanE: r1(b.sum / b.n) })),
    peaks,
  };
}

function summarize(seg, t0, ts, per, an, series, { minSpinMs, minQuietMs }, actions) {
  const s = { segmentStartT: t0 };
  // inputs belonging to this segment: from the frame just before it up to (not incl.) its last frame
  const inSeg = (actions ?? []).filter((a) => a.t != null && a.frame != null && seg.frameStart != null && a.frame >= seg.frameStart - 1 && a.frame < seg.frameEnd && ['key', 'click', 'wheel'].includes(a.type));
  if (inSeg.length) s.actions = inSeg.map((a) => ({ type: a.type, key: a.key, note: a.note, t: a.t, tSeg: a.t - t0 }));
  const cols = series.filter((x) => /\.c\d+$/.test(x.name));
  const focus = cols.length ? cols.map((c) => c.name) : series.filter((x) => x.name !== 'full').map((x) => x.name);
  const pool = focus.length ? focus : ['full'];
  const starts = pool.map((n) => an[n].bursts[0]?.startT).filter((v) => v != null);
  if (starts.length) s.firstMotionMs = Math.min(...starts) - t0;
  if (cols.length) {
    const press = inSeg.find((a) => a.type === 'key' || a.type === 'click');
    const after = press ? press.t : -Infinity;
    s.columnStops = cols
      .map((c) => {
        const b = an[c.name].bursts.find((x) => x.durationMs >= minSpinMs && x.startT >= after);
        if (!b) return null;
        // landing tail (bounce/settle): low-energy motion right after the stop, ended by a quiet gap
        const e = per[c.name], k = ts.indexOf(b.lastMotionT), lv = an[c.name];
        const low = lv.floor + Math.max(0.3, 0.02 * (lv.p98 - lv.floor));
        let last = k;
        for (let i = k + 1; i < ts.length; i++) {
          if (e[i] > low) last = i;
          else if (ts[i] - ts[last] >= minQuietMs) break;
        }
        return { series: c.name, spinStartT: b.startT, t: b.lastMotionT, tSeg: b.lastMotionT - t0, spinMs: b.durationMs, settleT: ts[last], tailMs: ts[last] - b.lastMotionT };
      })
      .filter(Boolean);
    s.stopGapsMs = s.columnStops.slice(1).map((c, i) => c.t - s.columnStops[i].t);
    if (s.columnStops.length) {
      const lastStop = Math.max(...s.columnStops.map((c) => c.t));
      const flashSeries = series.find((x) => x.name === 'grid') ? 'grid' : cols[0].name;
      const pk = an[flashSeries].peaks.filter((p) => p.t > lastStop + 20).map((p) => p.t);
      if (pk.length >= 3) {
        const d = pk.slice(1).map((t, i) => t - pk[i]);
        // mean of the spacings near the median: robust to a missed peak, and exact when the
        // cadence is not a whole number of frames (125 ms toggles sample as 117/133/117/…)
        const med = pct(d, 50), near = d.filter((x) => x >= 0.5 * med && x <= 1.5 * med);
        s.flashPeakSpacingMs = Math.round(near.reduce((a, b) => a + b, 0) / near.length);
        s.flashPeaks = pk.length;
        s.flashNote = 'diff peaks fire on every visual toggle: a blink (on+off) cycle is ~2x this spacing';
      }
    }
  }
  const lasts = pool.map((n) => an[n].bursts.at(-1)?.lastMotionT).filter((v) => v != null);
  if (lasts.length) s.lastMotionMs = Math.max(...lasts) - t0;
  return s;
}

/* -------------------------------------------------------------------- svg */
// Reference categorical palette (dataviz skill, validated adjacent-pair order) — light / dark.
const LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

const niceMax = (v) => {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
};
const niceStep = (span) => {
  for (const s of [50, 100, 200, 250, 500, 1000, 2000, 5000, 10000]) if (span / s <= 12) return s;
  return 20000;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function svgPlot(results, series, { title, actions }) {
  // "full" is context (neutral ink); regions/columns take categorical slots in fixed order (max 8).
  const plotted = [series[0], ...series.slice(1, 9)];
  const dropped = series.length - plotted.length;
  const W = 1200, L = 58, R = 18, PH = 150, PT = 30, PB = 30, GAP = 14;
  const legendH = 58;
  const H = legendH + results.length * (PT + PH + PB + GAP) + 10;
  const cssVars = (pal, mode) =>
    `--surface:${mode === 'dark' ? '#1a1a19' : '#fcfcfb'};--grid:${mode === 'dark' ? '#383835' : '#e7e6e2'};--ink:${mode === 'dark' ? '#ffffff' : '#0b0b0b'};--ink2:${mode === 'dark' ? '#c3c2b7' : '#52514e'};--muted:${mode === 'dark' ? '#8f8e87' : '#8a8983'};` +
    plotted.map((s, i) => `--s${i}:${i === 0 ? (mode === 'dark' ? '#8f8e87' : '#8a8983') : pal[i - 1]};`).join('');
  let body = '';
  // legend
  let lx = L;
  body += `<text x="${L}" y="20" class="t">Frame-difference energy · ${esc(title)}</text>`;
  body += `<text x="${L}" y="37" class="sub">mean |ΔRGB| (0–255) vs previous captured frame · x = ms since segment start · ▼ = input · ● = detected column stop${dropped ? ` · ${dropped} more series in timings.csv` : ''}</text>`;
  plotted.forEach((s, i) => {
    body += `<line x1="${lx}" y1="50" x2="${lx + 18}" y2="50" stroke="var(--s${i})" stroke-width="2" stroke-linecap="round"/><text x="${lx + 23}" y="54" class="lg">${esc(s.name)}</text>`;
    lx += 23 + s.name.length * 7.2 + 18;
  });
  const data = [];
  results.forEach((r, pi) => {
    const y0 = legendH + pi * (PT + PH + PB + GAP) + PT;
    const tEnd = Math.max(r.ts.at(-1) - r.t0, 1);
    const vmax = niceMax(Math.max(...plotted.map((s) => Math.max(0, ...r.per[s.name]))));
    const X = (t) => L + ((t - r.t0) / tEnd) * (W - L - R);
    const Y = (v) => y0 + PH - (v / vmax) * PH;
    const s = r.summary;
    body += `<text x="${L}" y="${y0 - 10}" class="pt">${esc(`${r.seg.index} · ${r.seg.name}`)}</text><text x="${W - R}" y="${y0 - 10}" class="sub" text-anchor="end">${esc(
      [s.columnStops?.length ? `stops +${s.columnStops.map((c) => c.tSeg).join(', +')} ms` : '', s.flashPeakSpacingMs ? `flash peaks ~${s.flashPeakSpacingMs} ms` : '', `every ${r.seg.every || 1}`].filter(Boolean).join(' · '),
    )}</text>`;
    for (const v of [0, vmax / 2, vmax]) body += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="gl"/><text x="${L - 6}" y="${Y(v) + 4}" class="ax" text-anchor="end">${v >= 10 ? Math.round(v) : +v.toPrecision(3)}</text>`;
    const step = niceStep(tEnd);
    for (let t = 0; t <= tEnd; t += step) body += `<text x="${X(r.t0 + t)}" y="${y0 + PH + 16}" class="ax" text-anchor="middle">${t}</text>`;
    body += `<text x="${W - R}" y="${y0 + PH + 28}" class="ax" text-anchor="end">ms</text>`;
    plotted.forEach((ser, i) => {
      const pts = r.ts.map((t, k) => `${X(t).toFixed(1)},${Y(r.per[ser.name][k]).toFixed(1)}`).join(' ');
      body += `<polyline points="${pts}" fill="none" stroke="var(--s${i})" stroke-width="${i === 0 ? 1.5 : 2}" stroke-linejoin="round" stroke-linecap="round"><title>${esc(ser.name)}</title></polyline>`;
    });
    for (const a of s.actions ?? []) {
      const x = Math.max(L, X(a.t)); // the triggering input is usually 1 frame before the first sample
      body += `<path d="M${x - 5},${y0 - 2} L${x + 5},${y0 - 2} L${x},${y0 + 6} Z" class="act"><title>${esc(`${a.type} ${a.key ?? a.note ?? ''} @ +${a.tSeg} ms`)}</title></path>`;
    }
    for (const c of s.columnStops ?? []) {
      const i = plotted.findIndex((p) => p.name === c.series);
      if (i < 0) continue;
      const k = r.ts.indexOf(c.t);
      body += `<circle cx="${X(c.t)}" cy="${Y(r.per[c.series][k] ?? 0)}" r="4.5" fill="var(--s${i})" stroke="var(--surface)" stroke-width="2"><title>${esc(`${c.series} last motion +${c.tSeg} ms (spun ${c.spinMs} ms)`)}</title></circle>`;
    }
    body += `<rect x="${L}" y="${y0}" width="${W - L - R}" height="${PH}" fill="transparent" class="hit" data-p="${pi}"/>`;
    data.push({ y0, t0: r.t0, tEnd, ts: r.ts, v: plotted.map((p) => r.per[p.name].map((x) => +x.toFixed(2))) });
  });
  const script = `(()=>{const D=${JSON.stringify(data)},N=${JSON.stringify(plotted.map((p) => p.name))},L=${L},R=${R},W=${W},PH=${PH};
const svg=document.currentScript.ownerSVGElement||document.querySelector('svg');const ns='http://www.w3.org/2000/svg';
const g=document.createElementNS(ns,'g');g.setAttribute('pointer-events','none');g.style.display='none';svg.appendChild(g);
const ln=document.createElementNS(ns,'line');ln.setAttribute('class','xh');g.appendChild(ln);
const box=document.createElementNS(ns,'rect');box.setAttribute('class','tip');box.setAttribute('rx','6');g.appendChild(box);
const tx=document.createElementNS(ns,'text');tx.setAttribute('class','tt');g.appendChild(tx);
svg.querySelectorAll('.hit').forEach(h=>{h.addEventListener('mouseleave',()=>g.style.display='none');h.addEventListener('mousemove',ev=>{
const d=D[+h.dataset.p],pt=svg.createSVGPoint();pt.x=ev.clientX;pt.y=ev.clientY;const p=pt.matrixTransform(svg.getScreenCTM().inverse());
const t=d.t0+(p.x-L)/(W-L-R)*d.tEnd;let k=0,b=1e9;d.ts.forEach((v,i)=>{const e=Math.abs(v-t);if(e<b){b=e;k=i}});
const x=L+(d.ts[k]-d.t0)/d.tEnd*(W-L-R);g.style.display='';ln.setAttribute('x1',x);ln.setAttribute('x2',x);ln.setAttribute('y1',d.y0);ln.setAttribute('y2',d.y0+PH);
while(tx.firstChild)tx.removeChild(tx.firstChild);const lines=['+'+(d.ts[k]-d.t0)+' ms (t '+d.ts[k]+')',...N.map((n,i)=>'\\u25AC '+n+'  '+d.v[i][k])];
lines.forEach((s,i)=>{const sp=document.createElementNS(ns,'tspan');sp.setAttribute('x',0);sp.setAttribute('dy',i?15:0);if(i){const k2=document.createElementNS(ns,'tspan');k2.setAttribute('style','fill:var(--s'+(i-1)+')');k2.textContent='\\u25AC ';sp.appendChild(k2);sp.appendChild(document.createTextNode(s.slice(2)))}else sp.textContent=s;tx.appendChild(sp)});
const bb=tx.getBBox();const bx=x+12+bb.width+16>W?x-bb.width-28:x+12;tx.setAttribute('transform','translate('+(bx+8)+','+(d.y0+18)+')');
[...tx.childNodes].forEach(c=>c.setAttribute('x',0));box.setAttribute('x',bx);box.setAttribute('y',d.y0+4);box.setAttribute('width',bb.width+16);box.setAttribute('height',bb.height+10);})});})();`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>
svg{${cssVars(LIGHT, 'light')}font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
@media (prefers-color-scheme: dark){svg{${cssVars(DARK, 'dark')}}}
.bg{fill:var(--surface)}.t{font-size:15px;font-weight:600;fill:var(--ink)}.sub{font-size:11.5px;fill:var(--ink2)}.pt{font-size:13px;font-weight:600;fill:var(--ink)}
.lg{font-size:12px;fill:var(--ink)}.ax{font-size:11px;fill:var(--muted);font-variant-numeric:tabular-nums}.gl{stroke:var(--grid);stroke-width:1}
.act{fill:var(--ink2)}.xh{stroke:var(--ink2);stroke-width:1}.tip{fill:var(--surface);stroke:var(--grid)}.tt{font-size:12px;fill:var(--ink);font-variant-numeric:tabular-nums}
</style>
<rect class="bg" width="100%" height="100%"/>
${body}
<script><![CDATA[${script}]]></script>
</svg>
`;
}

/* ------------------------------------------------------------------ entry */
if (isMainThread) await main();
else workerMain();
