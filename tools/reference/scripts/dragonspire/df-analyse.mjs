#!/usr/bin/env node
// Dragonspire Frostfall study: analysis stage (STUDY ONLY). Reads capture runs made by df-*.mjs
// (art/_reference/dragonspire/<run>/), runs tools/reference/timings.mjs on each with the grid,
// per-column, meter, mini-panel and HUD regions, tracks static UI patches frame by frame to
// measure screen-shake offsets, groups segments by speed profile and writes a numbers-only JSON
// (default docs/games/bass-drop/reference-timings.json). No pixels are copied anywhere.
//
//   node df-analyse.mjs [runDir ...] [--root art/_reference/dragonspire] [--out file.json]
//        [--grid x,y,w,h] [--regions '{"meter":[..]}'] [--shake '{"logo":[..],"hud":[..]}']
//        [--shake-seg regex] [--no-timings] [--no-shake] [--label text] [--allow-foreign-out]
//   node df-analyse.mjs --shake-selftest <frame.png|jpg>   (verifies the tracker on synthetic shifts)
//
// Rects are fractions of the game canvas. The defaults are READ OFF THE USER'S STILLS, not a
// live probe: confirm them on shots/*.grid.png of the df-a run and pass --grid / --regions / --shake.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const REPO = process.env.DF_REPO ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');
const TIMINGS = path.join(REPO, 'tools/reference/timings.mjs');
const { decodePng } = await import(pathToFileURL(path.join(REPO, 'tools/reference/lib/png.mjs')).href);
const { findFfmpeg } = await import(pathToFileURL(path.join(REPO, 'tools/reference/lib/ffmpeg.mjs')).href);
const FF = (await findFfmpeg())?.path;

/* ------------------------------------------------------------------ args */
const argv = process.argv.slice(2);
const A = { _: [] };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) A._.push(a);
  else if (['--no-timings', '--no-shake', '--allow-foreign-out'].includes(a)) A[a.slice(2)] = true;
  else A[a.slice(2)] = argv[++i];
}
const rect = (s) => s.split(',').map(Number);
const REGIONS = {
  grid: [0.302, 0.123, 0.402, 0.733], // 5x5 reels (DESIGN.md s.22 ROI)
  meter: [0.095, 0.17, 0.14, 0.27], // ring counter
  mini: [0.105, 0.5, 0.125, 0.3], // 5-column panel under the crest
  hud: [0.24, 0.84, 0.62, 0.16],
  ...(A.regions ? JSON.parse(A.regions) : {}),
  ...(A.grid ? { grid: rect(A.grid) } : {}),
};
// Static patches for shake tracking. GUESSES until the grid shots are read: something textured
// that does not animate at idle. Two patches: one on the stage (frame/logo), one on the HUD, so
// "camera shake moves the whole stage but not the HUD" is visible in the numbers.
const SHAKE = A.shake ? JSON.parse(A.shake) : { stage: [0.255, 0.3, 0.04, 0.3], logo: [0.76, 0.1, 0.18, 0.2], hud: [0.3, 0.87, 0.28, 0.09] };
const SHAKE_R = Number(A['shake-r'] ?? 20); // search radius, capture px
const OURS_1080 = 1920; // our design space width, for px conversion

/* --------------------------------------------------------------- helpers */
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const med = (a) => {
  const s = a.filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const stat = (a) => {
  const v = a.filter((x) => Number.isFinite(x));
  if (!v.length) return null;
  return { median: Math.round(med(v)), min: Math.round(Math.min(...v)), max: Math.round(Math.max(...v)), n: v.length };
};
const ratio = (a, b) => (a && b && b.median ? Math.round((a.median / b.median) * 100) / 100 : null);
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

/* ------------------------------------------------------ gray patch decode */
function decodeGray(file, crop) {
  // crop = {x,y,w,h} in frame px -> Float32Array(w*h) luma
  const buf = fs.readFileSync(file);
  let img;
  if (buf[0] === 0x89 && buf[1] === 0x50) img = decodePng(buf);
  else {
    if (!FF) throw new Error('JPEG frames need ffmpeg');
    const r = spawnSync(FF, ['-v', 'error', '-i', file, '-vf', `format=rgb24,crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}:exact=1`, '-f', 'image2pipe', '-vcodec', 'png', '-'], { maxBuffer: 1 << 26 });
    if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
    img = decodePng(r.stdout);
    crop = { x: 0, y: 0, w: img.width, h: img.height };
  }
  const ch = img.data.length / (img.width * img.height);
  const out = new Float32Array(crop.w * crop.h);
  for (let y = 0; y < crop.h; y++)
    for (let x = 0; x < crop.w; x++) {
      const i = ((crop.y + y) * img.width + crop.x + x) * ch;
      out[y * crop.w + x] = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
    }
  return out;
}
function frameSize(file) {
  const buf = fs.readFileSync(file);
  if (buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  const r = spawnSync(FF, ['-hide_banner', '-i', file], { encoding: 'utf8' }).stderr;
  const m = /, (\d{2,5})x(\d{2,5})/.exec(r);
  return { w: Number(m[1]), h: Number(m[2]) };
}
/** Best integer offset (dx,dy) of `tpl` (tw x th, taken at (R,R) of the reference crop) inside `cur` ((tw+2R) x (th+2R)), plus parabolic sub-pixel refinement. */
function matchOffset(tpl, tw, th, cur, R) {
  const cw = tw + 2 * R;
  const sad = new Float64Array((2 * R + 1) ** 2).fill(Infinity);
  let best = Infinity, bx = 0, by = 0;
  const order = [];
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) order.push([dx, dy]);
  order.sort((a, b) => Math.hypot(...a) - Math.hypot(...b)); // near-zero first: early-out works best
  for (const [dx, dy] of order) {
    let s = 0;
    for (let y = 0; y < th && s < best; y++) {
      const row = (y + R + dy) * cw + R + dx;
      const trow = y * tw;
      for (let x = 0; x < tw; x++) s += Math.abs(cur[row + x] - tpl[trow + x]);
    }
    sad[(dy + R) * (2 * R + 1) + dx + R] = s;
    if (s < best) (best = s), (bx = dx), (by = dy);
  }
  const para = (m, c, p) => (Number.isFinite(m) && Number.isFinite(p) && m + p - 2 * c > 0 ? (0.5 * (m - p)) / (m + p - 2 * c) : 0);
  // neighbours may have been early-outed (value is a lower bound, not exact): recompute them exactly
  const exact = (dx, dy) => {
    if (Math.abs(dx) > R || Math.abs(dy) > R) return Infinity;
    let s = 0;
    for (let y = 0; y < th; y++) {
      const row = (y + R + dy) * cw + R + dx;
      for (let x = 0; x < tw; x++) s += Math.abs(cur[row + x] - tpl[y * tw + x]);
    }
    return s;
  };
  const xm = exact(bx - 1, by), xp = exact(bx + 1, by), ym = exact(bx, by - 1), yp = exact(bx, by + 1);
  const sx = para(xm, best, xp);
  const sy = para(ym, best, yp);
  // sharpness: how much worse (mean grey levels) the best 1-px neighbour is; < 0.5 = ambiguous match (flat patch)
  const sharp = (Math.min(xm, xp, ym, yp) - best) / (tw * th);
  return { dx: bx + sx, dy: by + sy, residual: best / (tw * th), sharp };
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let k = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (k < items.length) {
      const i = k++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}
const decodeAsync = (file, crop) =>
  new Promise((resolve, reject) => {
    const buf = fs.readFileSync(file);
    if (buf[0] === 0x89 && buf[1] === 0x50) return resolve(decodeGray(file, crop));
    const p = spawn(FF, ['-v', 'error', '-i', file, '-vf', `format=rgb24,crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}:exact=1`, '-f', 'image2pipe', '-vcodec', 'png', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    p.stdout.on('data', (c) => chunks.push(c));
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg crop failed on ${file}`));
      const img = decodePng(Buffer.concat(chunks));
      const ch = img.data.length / (img.width * img.height);
      const out = new Float32Array(img.width * img.height);
      for (let i = 0, j = 0; j < out.length; i += ch, j++) out[j] = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
      resolve(out);
    });
  });

/** Shake track for one segment: offset of each static patch vs the segment's first frame. */
async function shakeTrack(frames, frameW, frameH, canvasPx, rects) {
  const res = {};
  for (const [name, [rx, ry, rw, rh]] of Object.entries(rects)) {
    const tw = Math.round(rw * canvasPx.width), th = Math.round(rh * canvasPx.height);
    const x = Math.round(canvasPx.x + rx * canvasPx.width) - SHAKE_R, y = Math.round(canvasPx.y + ry * canvasPx.height) - SHAKE_R;
    const crop = { x: Math.max(0, x), y: Math.max(0, y), w: tw + 2 * SHAKE_R, h: th + 2 * SHAKE_R };
    if (crop.x + crop.w > frameW || crop.y + crop.h > frameH || x < 0 || y < 0) {
      res[name] = { error: 'patch + search radius leaves the frame' };
      continue;
    }
    const ref = await decodeAsync(frames[0].abs, crop);
    const tpl = new Float32Array(tw * th);
    for (let yy = 0; yy < th; yy++) for (let xx = 0; xx < tw; xx++) tpl[yy * tw + xx] = ref[(yy + SHAKE_R) * crop.w + xx + SHAKE_R];
    // texture check: a flat patch cannot be tracked
    let mean = 0;
    for (const v of tpl) mean += v;
    mean /= tpl.length;
    let sd = 0;
    for (const v of tpl) sd += (v - mean) ** 2;
    sd = Math.sqrt(sd / tpl.length);
    const offs = await pool(frames, 3, async (f) => ({ t: f.t, ...matchOffset(tpl, tw, th, await decodeAsync(f.abs, crop), SHAKE_R) }));
    res[name] = { rect: [rx, ry, rw, rh], texture: r1(sd), sharpMedian: r1(med(offs.map((o) => o.sharp))), offsets: offs.map((o) => ({ t: o.t, dx: r1(o.dx), dy: r1(o.dy), res: r1(o.residual), sharp: r1(o.sharp) })) };
  }
  return res;
}
/** Episodes of non-zero offset (|d| >= 0.75 px) separated by >= 100 ms of rest. */
function shakeEpisodes(offs, t0, scale, resLimit) {
  // an offset counts as motion only when the shifted patch still matches (residual <= resLimit
  // grey levels, sharp minimum); otherwise the patch's own pixels changed (button state, glow)
  const eps = [];
  let cur = null;
  for (const o of offs) {
    const m = Math.hypot(o.dx, o.dy);
    if (m >= 0.75 && o.res <= resLimit && o.sharp >= 0.5) {
      if (!cur || o.t - cur.lastT > 100) {
        if (cur) eps.push(cur);
        cur = { startT: o.t, lastT: o.t, peak: m, peakT: o.t, signX: [], n: 0 };
      }
      cur.lastT = o.t;
      cur.n++;
      cur.signX.push(Math.sign(Math.abs(o.dx) >= Math.abs(o.dy) ? o.dx : o.dy));
      if (m > cur.peak) (cur.peak = m), (cur.peakT = o.t);
    }
  }
  if (cur) eps.push(cur);
  return eps.map((e) => ({
    startMs: e.startT - t0,
    durationMs: e.lastT - e.startT,
    peakPx: r1(e.peak),
    peakPx1920: r1(e.peak * scale),
    peakAtMs: e.peakT - t0,
    reversals: e.signX.slice(1).filter((s, i) => s && e.signX[i] && s !== e.signX[i]).length,
  }));
}

/* ---------------------------------------------------------------- runs */
function discover() {
  const dirs = A._.length ? A._ : (() => {
    const root = path.resolve(REPO, A.root ?? 'art/_reference/dragonspire');
    return fs.existsSync(root) ? fs.readdirSync(root).map((d) => path.join(root, d)).filter((d) => fs.existsSync(path.join(d, 'run.json'))) : [];
  })();
  const ok = [], skipped = [];
  for (const d of dirs.map((x) => path.resolve(x))) {
    const run = readJson(path.join(d, 'run.json'));
    const n = fs.existsSync(path.join(d, 'frames.json')) ? readJson(path.join(d, 'frames.json')).frames.length : 0;
    const auth = fs.existsSync(path.join(d, 'rgs')) ? fs.readdirSync(path.join(d, 'rgs')).find((f) => /wallet-authenticate/.test(f)) : null;
    const authStatus = auth ? readJson(path.join(d, 'rgs', auth)).status : null;
    if (!n) skipped.push({ run: path.basename(d), reason: `0 frames (status ${run.status}${authStatus ? `, authenticate HTTP ${authStatus}` : ''})` });
    else ok.push({ dir: d, run, frames: n });
  }
  return { ok, skipped };
}

function loadCsv(file) {
  const [head, ...lines] = fs.readFileSync(file, 'utf8').trim().split('\n');
  const cols = head.split(',');
  const bySeg = {};
  for (const l of lines) {
    const v = l.split(',');
    const s = (bySeg[v[1]] ??= { t: [], every: [], e: Object.fromEntries(cols.slice(6).map((c) => [c, []])) });
    s.t.push(Number(v[3]));
    s.every.push(v[5] === '' ? null : Number(v[5]));
    cols.slice(6).forEach((c, k) => s.e[c].push(v[6 + k] === '' ? null : Number(v[6 + k])));
  }
  return bySeg;
}

const RX = {
  win: /^(?!.*(total|final|set)).*(wininfo|cluster|payline|^wins?$)/i, // not setTotalWin / finalWin
  tumble: /tumble|cascade|explode|remove|refill|drop/i,
  wild: /wild|dragon|summon|spawn|multiplier/i,
  meter: /meter|progress|charge|collect|counter/i,
  free: /free|bonus|trigger|feature|scatter/i,
};
function bookOf(dir, seq) {
  if (seq == null) return null;
  const f = fs.readdirSync(path.join(dir, 'rgs')).find((x) => x.startsWith(String(seq).padStart(4, '0') + '-'));
  if (!f) return null;
  const res = readJson(path.join(dir, 'rgs', f)).response;
  const r = res?.round ?? res;
  const evs = Array.isArray(r?.state) ? r.state : Array.isArray(r?.events) ? r.events : [];
  const types = evs.map((e) => e?.type ?? '?');
  const count = (rx) => types.filter((t) => rx.test(t)).length;
  const wins = evs.filter((e) => RX.win.test(e?.type ?? '')).flatMap((e) => e.wins ?? e.clusters ?? []);
  return {
    pm: Number(r?.payoutMultiplier ?? 0),
    mode: r?.mode ?? null,
    events: types.length,
    typeCounts: Object.fromEntries([...new Set(types)].map((t) => [t, types.filter((x) => x === t).length])),
    winEvents: count(RX.win),
    tumbleEvents: count(RX.tumble),
    wildEvents: count(RX.wild),
    meterEvents: count(RX.meter),
    freeEvents: count(RX.free),
    clusters: wins.length,
    winSymbols: wins.reduce((a, w) => a + (w.positions?.length ?? 0), 0),
  };
}

function category(name, seg) {
  if (seg.feature === 'bonus') return 'bonus';
  if (seg.feature === 'bigwin') return 'bigwin';
  if (/^spin-\d+/.test(name)) return 'normal';
  if (/^turboA-/.test(name)) return 'turboA';
  if (/^turboB-/.test(name)) return 'turboB';
  if (/^quick-/.test(name)) return 'quick';
  if (/^intro-dismiss/.test(name)) return 'introOut';
  if (/^intro-idle/.test(name)) return 'introIdle';
  if (/^idle-/.test(name)) return 'idle';
  if (/^turbo-toggle/.test(name)) return 'turboToggle';
  if (/^tour-/.test(name)) return 'tour';
  return 'other';
}

/** Local maxima above `low` in e[] between index a..b (landing-tail "bounce" peaks). */
function tailPeaks(e, a, b, low) {
  let n = 0;
  for (let i = Math.max(1, a); i < Math.min(e.length - 1, b + 1); i++) if (e[i] != null && e[i] > low && e[i] >= e[i - 1] && e[i] > e[i + 1]) n++;
  return n;
}

function extract(r, ev, csvSeg, segMeta) {
  const s = ev.summary;
  const ser = (n) => ev.series[n] ?? { bursts: [], floor: 0, p98: 0 };
  const presses = (s.actions ?? []).filter((a) => a.type !== 'wheel' && /press|spin/i.test(a.note ?? ''));
  const pressT = presses[0]?.t ?? s.segmentStartT;
  const rel = (t) => (t == null ? null : t - pressT);
  const cols = [1, 2, 3, 4, 5].map((k) => ser(`grid.c${k}`));
  const colBursts = cols.map((c) => c.bursts.filter((b) => b.lastMotionT >= pressT).map((b) => ({ start: rel(b.startT), end: rel(b.lastMotionT), peakE: b.peakE })));
  const stops = (s.columnStops ?? []).map((c) => ({ col: Number(c.series.split('.c')[1]), start: rel(c.spinStartT), stop: rel(c.t), settle: rel(c.settleT), tail: c.tailMs }));
  const firstStarts = colBursts.map((b) => b[0]?.start).filter((v) => v != null);
  const out = {
    run: r.run.run,
    seg: ev.name,
    every: ev.every,
    cat: category(ev.name, segMeta),
    durationMs: segMeta.durationMs,
    secondPressMs: presses[1] ? presses[1].t - pressT : null,
    book: bookOf(r.dir, segMeta.round?.seq),
    firstMotionMs: firstStarts.length ? Math.min(...firstStarts) : null,
    // exit stagger: gaps between consecutive columns' first motion
    exitStaggerMs: firstStarts.length === 5 ? med(firstStarts.slice(1).map((t, i) => t - firstStarts[i])) : null,
    stops,
    stopGapMs: s.stopGapsMs?.length ? med(s.stopGapsMs) : null,
    firstStopMs: stops.length ? Math.min(...stops.map((c) => c.stop)) : null,
    boardSettleMs: stops.length === 5 ? Math.max(...stops.map((c) => c.settle)) : null,
    tailMs: stops.length ? med(stops.map((c) => c.tail)) : null,
    // tumble games: on LOSS rounds (no win flash to confuse), every column showing a first burst
    // (old symbols leaving) and a second >= 100 ms burst 17..400 ms later (new symbols dropping)
    splitExitDrop:
      segMeta.round?.pm === 0 &&
      colBursts.every((b) => b.length >= 2 && b[1].start - b[0].end >= 17 && b[1].start - b[0].end <= 400 && b[1].end - b[1].start >= 100),
    colBursts,
    lastMotionMs: s.lastMotionMs != null ? s.lastMotionMs + s.segmentStartT - pressT : null,
    flashPeakSpacingMs: s.flashPeakSpacingMs ?? null,
  };
  const settle = out.boardSettleMs ?? -Infinity;
  const burstsOf = (n) => ser(n).bursts.map((b) => ({ start: rel(b.startT), end: rel(b.lastMotionT), peakT: rel(b.peakT), peakE: b.peakE }));
  out.gridAfterLand = burstsOf('grid').filter((b) => b.start > settle + 30);
  out.meter = burstsOf('meter');
  out.mini = burstsOf('mini');
  out.hud = burstsOf('hud');
  out.full = burstsOf('full');
  // landing-tail peaks per column, every-frame segments only
  if (ev.every === 1 && csvSeg && stops.length) {
    out.tailPeaks = stops.map((c) => {
      const e = csvSeg.e[`grid.c${c.col}`];
      const lv = ser(`grid.c${c.col}`);
      const low = lv.floor + Math.max(0.3, 0.02 * (lv.p98 - lv.floor));
      const a = csvSeg.t.indexOf(c.stop + pressT), b = csvSeg.t.indexOf(c.settle + pressT);
      return a >= 0 && b >= a ? tailPeaks(e, a, b, low) : null;
    });
  }
  // post-land step structure for win rounds
  if (out.splitExitDrop) {
    out.fallOutMs = Math.max(...colBursts.map((b) => b[0].end)) - Math.min(...colBursts.map((b) => b[0].start));
    out.dropInMs = Math.max(...colBursts.map((b) => b[1].end)) - Math.min(...colBursts.map((b) => b[1].start));
  }
  if (out.book?.winEvents && out.lastMotionMs != null && out.boardSettleMs != null && out.lastMotionMs > out.boardSettleMs) {
    out.afterLandMs = out.lastMotionMs - out.boardSettleMs;
    out.perWinStepMs = Math.round(out.afterLandMs / out.book.winEvents);
  }
  // meter reaction: first meter burst after the first post-land grid burst
  const g0 = out.gridAfterLand[0];
  const m0 = g0 ? out.meter.find((m) => m.start >= g0.start) : null;
  if (m0) {
    out.meterLagMs = m0.start - g0.start;
    out.meterBurstMs = med(out.meter.filter((m) => m.start >= g0.start).map((m) => m.end - m.start));
    out.meterBursts = out.meter.filter((m) => m.start >= g0.start).length;
    if (out.book?.clusters) {
      out.meterPerCluster = Math.round((out.meterBursts / out.book.clusters) * 100) / 100;
      out.meterPerSymbol = out.book.winSymbols ? Math.round((out.meterBursts / out.book.winSymbols) * 100) / 100 : null;
    }
  }
  // mini panel: does it react to spins, wins or the meter? bursts after the press, lag after the first post-land grid burst
  out.miniBurstsAfterPress = out.mini.filter((m) => m.start >= 0).length;
  const mi0 = g0 ? out.mini.find((m) => m.start >= g0.start) : null;
  if (mi0) out.miniLagMs = mi0.start - g0.start;
  // longest full-canvas burst after land: candidate for a wild/dragon summon when the book has wild events
  const fullAfter = out.full.filter((b) => b.start > settle);
  if (fullAfter.length) out.longestFullBurstAfterLandMs = Math.max(...fullAfter.map((b) => b.end - b.start));
  return out;
}

/* --------------------------------------------------------------- selftest */
if (A['shake-selftest']) {
  const src = path.resolve(A['shake-selftest']);
  const tmp = fs.mkdtempSync(path.join(path.dirname(src), '.shaketest-'));
  const { w, h } = frameSize(src);
  // isolated shifts, then a damped horizontal shake (0 5 -4 3 -2 1 0 0) for the episode detector
  const cases = [[0, 0], [3, 0], [-2, 4], [7, -5], [-12, -9], [1, 1], [0, 0], [5, 0], [-4, 0], [3, 0], [-2, 0], [1, 0], [0, 0], [0, 0]];
  const frames = cases.map(([dx, dy], i) => {
    const f = path.join(tmp, `s${i}.png`);
    // shift the whole image by (dx,dy): pad by 32, crop back with the offset
    const P = 32;
    const r = spawnSync(FF, ['-v', 'error', '-y', '-i', src, '-vf', `format=rgb24,pad=${w + 2 * P}:${h + 2 * P}:${P}:${P},crop=${w}:${h}:${P - dx}:${P - dy}`, f]);
    if (r.status !== 0) throw new Error(String(r.stderr));
    return { abs: f, t: i * 17 };
  });
  const rects = A.shake ? SHAKE : { spinBtn: [0.45, 0.82, 0.1, 0.12], tileA: [0.21, 0.16, 0.1, 0.18] };
  const res = await shakeTrack(frames, w, h, { x: 0, y: 0, width: w, height: h }, rects);
  let bad = 0;
  for (const [name, r] of Object.entries(res)) {
    if (r.error) { console.log(name, r.error); bad++; continue; }
    r.offsets.forEach((o, i) => {
      const [dx, dy] = cases[i];
      const ok = Math.abs(o.dx - dx) <= 0.5 && Math.abs(o.dy - dy) <= 0.5;
      if (!ok) bad++;
      console.log(`${name} case ${i}: true (${dx},${dy}) got (${o.dx},${o.dy}) residual ${o.res} sharpness ${o.sharp} ${ok ? 'OK' : 'FAIL'}`);
    });
  }
  for (const [name, r] of Object.entries(res)) {
    if (r.error) continue;
    const eps = shakeEpisodes(r.offsets.slice(6), r.offsets[6].t, 1, 3);
    const ok = eps.length === 1 && eps[0].peakPx === 5 && eps[0].reversals === 4 && eps[0].durationMs === 4 * 17;
    if (!ok) bad++;
    console.log(`${name} damped shake: ${JSON.stringify(eps)} ${ok ? 'OK' : 'FAIL (want 1 episode, peak 5, 4 reversals, 68 ms)'}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(bad ? `shake selftest: ${bad} failures` : 'shake selftest: all cases recovered within 0.5 px');
  process.exit(bad ? 1 : 0);
}

/* ------------------------------------------------------------------ main */
const OUT = A.out ? path.resolve(A.out) : path.join(REPO, 'docs/games/bass-drop/reference-timings.json');
if (OUT.startsWith(path.join(REPO, 'docs')) && A._.length && !A['allow-foreign-out'] && A._.some((d) => !path.resolve(d).startsWith(path.join(REPO, 'art/_reference/dragonspire')))) {
  console.error('refusing to write docs/ from runs outside art/_reference/dragonspire (mock/test input?): pass --out elsewhere');
  process.exit(2);
}
const { ok, skipped } = discover();
console.log(`runs: ${ok.map((r) => `${r.run.run} (${r.frames} frames)`).join(', ') || 'none'}${skipped.length ? ` · skipped: ${skipped.map((s) => `${s.run}: ${s.reason}`).join('; ')}` : ''}`);
const segs = [];
const shakes = [];
for (const r of ok) {
  if (!A['no-timings'] || !fs.existsSync(path.join(r.dir, 'timings/events.json'))) {
    const t = spawnSync('nice', ['-n', '10', process.execPath, TIMINGS, r.dir, '--regions', JSON.stringify(REGIONS), '--columns', '5', '--columns-of', 'grid'], { stdio: 'inherit' });
    if (t.status !== 0) throw new Error(`timings.mjs failed on ${r.dir}`);
  }
  const events = readJson(path.join(r.dir, 'timings/events.json'));
  const csv = loadCsv(path.join(r.dir, 'timings/timings.csv'));
  const sj = readJson(path.join(r.dir, 'segments.json'));
  const fj = readJson(path.join(r.dir, 'frames.json'));
  const segByName = Object.fromEntries(sj.segments.map((s) => [s.name, s]));
  for (const ev of events.segments) {
    const meta = segByName[ev.name] ?? {};
    const x = extract(r, ev, csv[ev.name], meta);
    segs.push(x);
    const wantShake = !A['no-shake'] && (x.cat === 'bonus' || x.cat === 'bigwin' || x.book?.wildEvents > 0 || (ev.every === 1 && ['normal', 'turboA', 'quick'].includes(x.cat)) || (A['shake-seg'] && new RegExp(A['shake-seg']).test(ev.name)));
    if (wantShake) {
      const frames = fj.frames.filter((f) => f.seg === meta.index).map((f) => ({ ...f, abs: path.join(r.dir, f.file) }));
      if (frames.length < 2) continue;
      const { w, h } = frameSize(frames[0].abs);
      const c = r.run.clip === 'canvas' ? { x: 0, y: 0, width: w, height: h } : { x: r.run.canvas.x * (r.run.dpr ?? 1), y: r.run.canvas.y * (r.run.dpr ?? 1), width: r.run.canvas.width * (r.run.dpr ?? 1), height: r.run.canvas.height * (r.run.dpr ?? 1) };
      const scale = OURS_1080 / c.width;
      process.stdout.write(`  shake ${r.run.run}/${ev.name}: ${frames.length} frames ... `);
      const tr = await shakeTrack(frames, w, h, c, SHAKE);
      const pressT = (ev.summary.actions ?? []).find((a) => /press|spin/i.test(a.note ?? ''))?.t ?? frames[0].t;
      const rec = { run: r.run.run, seg: ev.name, cat: x.cat, patches: {} };
      for (const [name, p] of Object.entries(tr)) {
        if (p.error) { rec.patches[name] = p; continue; }
        const resLimit = Math.max(3, 3 * (med(p.offsets.map((o) => o.res)) ?? 0));
        const good = p.offsets.filter((o) => o.res <= resLimit && o.sharp >= 0.5);
        const changed = p.offsets.filter((o) => !(o.res <= resLimit && o.sharp >= 0.5));
        const mags = good.length ? good.map((o) => Math.hypot(o.dx, o.dy)) : [0];
        rec.patches[name] = {
          texture: p.texture,
          sharpMedian: p.sharpMedian,
          trackable: p.sharpMedian >= 0.5,
          residualMedian: r1(med(p.offsets.map((o) => o.res))),
          maxPx: r1(Math.max(...mags)),
          maxPx1920: r1(Math.max(...mags) * scale),
          episodes: shakeEpisodes(p.offsets, pressT, scale, resLimit),
          resLimit: r1(resLimit),
          appearanceChangedFrames: changed.length,
          appearanceChangedFromMs: changed.length ? changed[0].t - pressT : null,
        };
      }
      shakes.push(rec);
      console.log(Object.entries(rec.patches).map(([n, p]) => `${n} max ${p.maxPx ?? '-'} px (tex ${p.texture ?? '-'})`).join(', '));
    }
  }
}

/* ------------------------------------------------------------- aggregate */
const by = (cat) => segs.filter((s) => s.cat === cat);
const prof = (cat) => {
  const L = by(cat);
  if (!L.length) return null;
  const loss = L.filter((s) => s.book && s.book.pm === 0);
  return {
    n: L.length,
    firstMotionMs: stat(L.map((s) => s.firstMotionMs)),
    exitStaggerMs: stat(L.map((s) => s.exitStaggerMs)),
    firstStopMs: stat(L.map((s) => s.firstStopMs)),
    stopGapMs: stat(L.map((s) => s.stopGapMs)),
    tailMs: stat(L.map((s) => s.tailMs)),
    boardSettleMs: stat(L.map((s) => s.boardSettleMs)),
    lossRoundMs: stat(loss.map((s) => s.lastMotionMs)),
    perWinStepMs: stat(L.map((s) => s.perWinStepMs)),
    meterLagMs: stat(L.map((s) => s.meterLagMs)),
    meterBurstMs: stat(L.map((s) => s.meterBurstMs)),
    tailPeaks: stat(L.flatMap((s) => s.tailPeaks ?? [])),
    splitExitDropShare: Math.round((L.filter((s) => s.splitExitDrop).length / Math.max(1, L.filter((s) => s.book?.pm === 0).length)) * 100) / 100,
    fallOutMs: stat(L.map((s) => s.fallOutMs)),
    dropInSplitMs: stat(L.map((s) => s.dropInMs)),
    flashPeakSpacingMs: stat(L.map((s) => s.flashPeakSpacingMs)),
  };
};
const P = { normal: prof('normal'), turboA: prof('turboA'), turboB: prof('turboB'), quick: prof('quick') };
const ratios = (a, b) =>
  a && b ? Object.fromEntries(['firstMotionMs', 'firstStopMs', 'stopGapMs', 'tailMs', 'boardSettleMs', 'lossRoundMs', 'perWinStepMs'].map((k) => [k, ratio(a[k], b[k])])) : null;

const ms = (v, unit = 'ms') => ({ value: v ?? null, unit });
const M = {};
const add = (key, o) => {
  const ref = o.ref && typeof o.ref === 'object' && !Array.isArray(o.ref) ? Object.fromEntries(Object.entries(o.ref).map(([k, v]) => [k, v ?? null])) : o.ref ?? null;
  const measured = ref != null && !(typeof ref === 'object' && Object.values(ref).every((v) => v == null));
  M[key] = { status: measured ? 'measured' : 'not_measured', ...o, ref, confidence: measured ? o.confidence : 'none', plannedConfidence: o.confidence === 'none' ? 'medium' : o.confidence };
};
add('spin.pressToFirstMotion', {
  row: null, ours: null, ref: { normal: P.normal?.firstMotionMs, turbo: P.turboA?.firstMotionMs, quick: P.quick?.firstMotionMs }, unit: 'ms',
  method: 'first burst start over grid.c1..c5 energy after the spin input (timings.mjs bursts, capture timeline); RGS answers within 1-2 frames (net-sync), so this is the game\'s own start latency',
  confidence: P.normal ? 'medium' : 'none',
});
add('fallOut.wholeBoard', {
  row: 'Fall-out (whole board)', ours: { normal: 510, turbo: 130, super: 87 }, ref: { normal: P.normal?.fallOutMs, turbo: P.turboA?.fallOutMs }, unit: 'ms',
  method: 'loss rounds where every column shows two bursts 17..400 ms apart: first burst = old symbols leaving (first start -> last end over the 5 columns); if the game drops without a gap this stays null and must be read off the every-frame sheets', confidence: P.normal?.fallOutMs ? 'medium' : 'none',
  note: P.normal ? `loss rounds with separate exit and drop bursts: ${Math.round((P.normal.splitExitDropShare ?? 0) * 100)}%` : null,
});
add('column.stagger', {
  row: 'Drop-in stagger (column)', ours: { normal: 60, turbo: 0, super: 0 }, ref: { normal: P.normal?.stopGapMs, turbo: P.turboA?.stopGapMs, turboB: P.turboB?.stopGapMs, quick: P.quick?.stopGapMs }, unit: 'ms',
  method: 'median gap between consecutive columnStops (end of each column\'s first >=150 ms burst), every-frame spins +-1 frame, every-2nd/3rd +-2/3 frames', confidence: P.normal ? 'medium' : 'none',
});
add('dropIn.firstMoveToLastSettle', {
  row: 'Drop-in: first move -> last settle', ours: { normal: 950, turbo: 265, super: 175 },
  ref: {
    normal: P.normal?.dropInSplitMs ?? (P.normal?.boardSettleMs && P.normal?.firstMotionMs ? { median: P.normal.boardSettleMs.median - P.normal.firstMotionMs.median, includesFallOut: true } : null),
    turbo: P.turboA?.dropInSplitMs ?? (P.turboA?.boardSettleMs && P.turboA?.firstMotionMs ? { median: P.turboA.boardSettleMs.median - P.turboA.firstMotionMs.median, includesFallOut: true } : null),
  },
  unit: 'ms', method: 'split loss rounds: second burst first start -> last end over the 5 columns; otherwise median(last column settleT) - median(first motion), flagged includesFallOut', confidence: 'low',
});
add('land.settleTail', {
  row: 'Land settle (per symbol)', ours: { normal: 150, turbo: 75, super: 50 }, ref: { normal: P.normal?.tailMs, turbo: P.turboA?.tailMs }, unit: 'ms',
  method: 'timings.mjs landing tail: low-energy motion after the column stop until a >=50 ms quiet gap', confidence: P.normal ? 'medium' : 'none',
});
add('land.bouncePeaks', {
  row: null, ours: { normal: 1 }, ref: { normal: P.normal?.tailPeaks }, unit: 'count',
  method: 'local energy maxima inside the landing tail, every-frame spins only; a bounce shows as 1-2 peaks (down and back): confirm on frames', confidence: 'low',
});
add('tumble.stepAfterLand', {
  row: 'Tumble step (explode + refill)', ours: { normal: 1250, turbo: 410, super: 275 }, ref: { normal: P.normal?.perWinStepMs, turbo: P.turboA?.perWinStepMs }, unit: 'ms',
  method: '(last grid motion - board settle) / number of win events in the round\'s book; includes win present, explode and refill, so compare with present + explode + refill, not the step row alone', confidence: 'low',
});
add('meter.reaction', {
  row: 'Orb flight (meter lag after the first post-land grid burst)', ours: { normal: 610, turbo: 305, super: 203 }, ref: { normal: P.normal?.meterLagMs, turbo: P.turboA?.meterLagMs }, unit: 'ms',
  method: 'start of the first meter-region burst after the first post-land grid burst (ours = pop-out 90 + flight 520)', confidence: 'low',
});
add('meter.counterBurst', {
  row: 'Meter tick (LED in / settle / punch)', ours: { normal: 270, turbo: 135, super: 90 }, ref: { normal: P.normal?.meterBurstMs, turbo: P.turboA?.meterBurstMs }, unit: 'ms',
  method: 'median duration of meter-region bursts after the first post-land grid burst; per-symbol vs per-cluster from burst count vs book clusters/winSymbols (see segments[].meterBursts)', confidence: 'low',
});
add('winFlash.peakSpacing', {
  row: null, ours: null, ref: { normal: P.normal?.flashPeakSpacingMs }, unit: 'ms', method: 'timings.mjs flashPeakSpacingMs (a blink cycle is 2x)', confidence: 'low',
});
add('speed.turboOverNormal', { row: 'turbo ratio per phase', ours: { factor: 0.5 }, ref: ratios(P.turboA, P.normal), unit: 'ratio', method: 'median(turbo state A) / median(normal) per metric', confidence: P.turboA && P.normal ? 'medium' : 'none' });
add('speed.turboBOverNormal', { row: 'second turbo state ratio (super turbo if the button cycles)', ours: { factor: 0.333 }, ref: ratios(P.turboB, P.normal), unit: 'ratio', method: 'median(turbo state B) / median(normal); state B is super turbo only if the df-c turbo-A/B/C shots show 3 states', confidence: 'low' });
add('speed.quickStopOverNormal', { row: 'quick stop (second press at +150 ms)', ours: null, ref: ratios(P.quick, P.normal), unit: 'ratio', method: 'median(quick) / median(normal); boardSettle ratio < 0.8 means a slam stop exists', confidence: P.quick && P.normal ? 'medium' : 'none' });

const winRounds = segs.filter((s) => ['normal', 'turboA', 'quick'].includes(s.cat) && s.book?.clusters);
add('meter.perSymbolOrCluster', {
  row: 'Meter increment granularity (s.6.3 check)', ours: { model: 'one orb per winning symbol, counter +1 per orb' },
  ref: winRounds.length ? { meterBurstsPerCluster: stat(winRounds.map((s) => s.meterPerCluster * 100)), meterBurstsPerSymbol: stat(winRounds.map((s) => s.meterPerSymbol * 100)) } : null,
  unit: 'bursts per cluster / per symbol, x100', method: 'meter-region bursts after the first post-land grid burst divided by clusters and winning symbols in the book; ~100 per cluster = per-cluster increments, ~100 per symbol = per-symbol; rolls merge bursts, so confirm on frames', confidence: 'low',
});
const wildRounds = segs.filter((s) => s.book?.wildEvents > 0);
add('wild.summon', {
  row: 'Dragon / wild summon (duration, shake)', ours: { oneWildMs: 1580, threeWildsMs: 1880, boomPx: 4.5 },
  ref: wildRounds.length ? { longestFullBurstMs: stat(wildRounds.map((s) => s.longestFullBurstAfterLandMs)), rounds: wildRounds.map((s) => ({ run: s.run, seg: s.seg, wildEvents: s.book.wildEvents, longestFullBurstMs: s.longestFullBurstAfterLandMs ?? null, shake: shakes.find((x) => x.run === s.run && x.seg === s.seg)?.patches ?? null })) } : null,
  unit: 'ms / px at 1920', method: 'rounds whose book has wild/dragon/multiplier events: longest full-canvas burst after the board settles, plus shake episodes of the static patches; beat-by-beat split read off the frames', confidence: 'low',
});
const miniRounds = segs.filter((s) => ['normal', 'turboA', 'quick'].includes(s.cat));
add('miniPanel.activity', {
  row: 'Mini 5-column panel under the meter (function unknown)', ours: null,
  ref: miniRounds.length ? { burstsPerRound: stat(miniRounds.map((s) => s.miniBurstsAfterPress)), lagAfterFirstWinMs: stat(miniRounds.map((s) => s.miniLagMs)), activeInLossRounds: miniRounds.filter((s) => s.book?.pm === 0 && s.miniBurstsAfterPress > 0).length, lossRounds: miniRounds.filter((s) => s.book?.pm === 0).length } : null,
  unit: 'count / ms', method: 'mini-region bursts per spin; activity in loss rounds = reacts to every spin (reel/column display), only after wins = win/meter linked; the function itself is read off the frames', confidence: 'low',
});
const intro = by('introOut').map((s) => ({ run: s.run, outMs: s.full.length ? s.full.at(-1).end - (s.full[0]?.start ?? 0) : null, firstMotionMs: s.full[0]?.start ?? null, lastMotionMs: s.full.at(-1)?.end ?? null }));
add('intro.cardsOut', { row: 'Intro cards in / out', ours: { out: 400, in: 900 }, ref: { out: stat(intro.map((i) => i.lastMotionMs)) }, unit: 'ms', method: 'intro-dismiss segment (every frame): click -> last full-canvas motion; "in" happens during boot in real time and is not measurable frame-exact', confidence: intro.length ? 'medium' : 'none' });
const idle = by('idle').map((s) => {
  const spacing = (b) => med(b.slice(1).map((x, i) => x.start - b[i].start));
  return { run: s.run, meterPeriodMs: spacing(s.meter), miniPeriodMs: spacing(s.mini), gridPeriodMs: spacing(s.gridAfterLand.length ? s.gridAfterLand : []), fullBursts: s.full.length };
});
add('idle.loops', { row: null, ours: null, ref: idle.length ? { meterPeriodMs: stat(idle.map((i) => i.meterPeriodMs)), miniPeriodMs: stat(idle.map((i) => i.miniPeriodMs)) } : null, unit: 'ms', method: 'median spacing of burst starts per region during 30 s of idle', confidence: 'low' });
const big = by('bigwin').map((s) => ({ run: s.run, seg: s.seg, pm: s.book?.pm ?? null, durationMs: s.durationMs, lastMotionMs: s.lastMotionMs }));
add('bigWin.tiers', { row: 'Big win tiers', ours: { tiersS: [5, 7, 9, 13, 18] }, ref: big.length ? { rounds: big } : null, unit: 'ms / x bet', method: 'segments whose play payout >= DF_BIGWIN x bet: payout multiplier from the RGS body, duration = press -> last full-canvas motion (continue taps after 4 s of stillness). Tier names and thresholds must be read off the frames', confidence: 'low' });
const bonus = by('bonus').map((s) => ({ run: s.run, seg: s.seg, pm: s.book?.pm ?? null, durationMs: s.durationMs, freeEvents: s.book?.freeEvents ?? null, typeCounts: s.book?.typeCounts ?? null }));
add('bonus.flow', { row: 'Feature trigger / intro / outro', ours: { triggerMs: 1800, introMs: 2600, outroMs: 4000 }, ref: bonus.length ? { rounds: bonus } : null, unit: 'ms', method: 'whole bought/hunted bonus segment; trigger -> intro -> first spin -> outro split must be read off the every-2nd-frame sheets', confidence: 'low' });
const shakeBy = (pred) => shakes.filter(pred).flatMap((s) => Object.values(s.patches).filter((p) => !p.error).map((p) => p.maxPx1920));
add('shake.peak', {
  row: 'Shake peaks (s.19)', ours: { boomPx: 4.5, chainMaxPx: 9.3, triggerPx: 7.9, bigWinGatePx: [6, 14] },
  ref: shakes.length ? { normalSpins: stat(shakeBy((s) => s.cat === 'normal')), wildRounds: stat(shakeBy((s) => segs.find((x) => x.run === s.run && x.seg === s.seg)?.book?.wildEvents > 0)), bonus: stat(shakeBy((s) => s.cat === 'bonus')), bigWin: stat(shakeBy((s) => s.cat === 'bigwin')) } : null,
  unit: 'px at 1920 wide', method: 'SAD block match (+-20 px, parabolic sub-pixel) of static patches (stage frame, logo, HUD) against the segment\'s first frame; episodes = runs of |offset| >= 0.75 px; validated on synthetic shifts (--shake-selftest)', confidence: shakes.length ? 'medium' : 'none',
});

// Like-for-like values of ours (DESIGN.md s.22.1 row map): what ours measures on the same instrument.
const CMP = {
  'fallOut.wholeBoard': { normal: 460, turbo: 130, super: 87, why: 'ours re-derived for a 5x5 board (4 column and 4 row gaps): 260 + 35x4 + 15x4; adopt per gap, then re-derive our 6x6 total (DESIGN.md s.22.1 rule 1)' },
  'dropIn.firstMoveToLastSettle': { normal: 865, turbo: 265, super: 175, why: 'ours re-derived for a 5x5 board: 950 - one column gap (60) - one row gap (25); staggers are 0 in turbo' },
  'tumble.stepAfterLand': { normal: 2250, turbo: 910, super: 608, build: { normal: [2000, 2133], turbo: [900, 966], super: [617, 650] }, why: 'the measurement spans win present + explode + refill: cluster present 1000/500/333 + tumble step 1250/410/275; build = docs/games/bass-drop/README.md measured round timings' },
  'meter.reaction': { normal: 1790, turbo: 845, super: 563, why: 'our first orb arrival counted from the start of the win presentation: cluster present + explode squeeze 80 + pop-out 90 + flight 520 (+ the 100 ms explode hit-stop in normal only). The "ours" 610 (pop-out + flight) applies only if the frames show the reference has no separate present phase' },
};
for (const [k, v] of Object.entries(CMP)) if (M[k]) M[k].compareAgainst = v;

const anyMeasured = Object.values(M).some((m) => m.status === 'measured');
const doc = {
  $comment: 'Dragonspire Frostfall (Paperclip Gaming) demo, re-measure protocol of DESIGN.md s.22. Numbers only: no frames, pixels, assets or text of the reference. Captures stay in the gitignored art/_reference/. "ours" = DESIGN.md s.18.1/s.19 values for comparison; adopt a measured value only if it differs by > 15% and passes ANIMATION_CONTRACT s.9 feel gates.',
  schema: 1,
  status: anyMeasured ? 'partial' : 'not_measured',
  statusNote: anyMeasured ? null : 'No Dragonspire frames exist yet. The only capture attempt (probe1) got HTTP 400 "session not found" from the RGS authenticate call: the demo sessionID had expired, so the game never left its loading screen. Every reference value is null until a run with a fresh demo URL is analysed.',
  label: A.label ?? null,
  generatedAt: new Date().toISOString(),
  generator: 'df-analyse.mjs (study scripts kept outside the repo) on top of tools/reference/timings.mjs',
  capture: {
    runs: ok.map((r) => ({ run: r.run.run, frames: r.frames, clock: r.run.clock, fps: r.run.fps, viewport: r.run.viewport, clip: r.run.clip, renderer: r.run.renderer })),
    skipped,
    regions: REGIONS,
    shakePatches: SHAKE,
    regionSource: 'fractions of the game canvas read off the user\'s two stills (ref_dragon_2.png base game, ref_dragon_1.png intro), not verified on a live probe',
  },
  units: 'ms of virtual game time (60 fps, frame-exact) unless noted; px converted to a 1920-wide canvas',
  confidenceScale: { none: 'no data', low: 'heuristic on motion energy: confirm on the contact sheets', medium: 'direct energy measurement, +-1 frame on every-frame segments', high: 'confirmed frame by frame' },
  measurements: M,
  profiles: P,
  segments: segs.map((s) => ({ ...s, colBursts: undefined, full: s.full?.length, hud: s.hud?.length, mini: s.mini?.length, meter: s.meter?.map((m) => [m.start, m.end]) })),
  shake: shakes,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n');
console.log(`wrote ${OUT} (${doc.status}; ${segs.length} segments, ${shakes.length} shake tracks)`);
