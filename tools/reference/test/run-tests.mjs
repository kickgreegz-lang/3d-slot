#!/usr/bin/env node
/**
 * End-to-end tests for tools/reference (runs the real CLIs against local fixture pages).
 *
 *   node tools/reference/test/run-tests.mjs [--out <dir>] [--only clock,mock,...] [--keep]
 *
 * clock-virtual     anim.html (2D, 120 ms of real render time per frame): every captured frame's
 *                   barcoded performance.now / rAF timestamp / rAF count / cached Date.now match
 *                   base + round(n*1000/60) exactly, one rAF per virtual frame, box pixels agree.
 * clock-webgl       same with WebGL (preserveDrawingBuffer:false, like Pixi).
 * clock-after-boot  same checks with the clock installed after boot (+ cached Date.now tracking).
 * clock-realtime    realtime fallback runs (and is measurably NOT frame-exact).
 * mock              mock-slot.html + scripts/stake-default.json (full length, 640x360, --save-assets
 *                   --video): RGS bodies, redaction, assets, segments, sheets, MP4 frame counts,
 *                   then timings.mjs vs the mock's ground-truth reel-stop/flash timeline.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, stamp } from '../lib/args.mjs';
import { findFfmpeg } from '../lib/ffmpeg.mjs';
import { decodePng, encodePng } from '../lib/png.mjs';
import { startServer } from './serve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = path.resolve(HERE, '..');
const args = parseArgs(process.argv.slice(2), { booleans: ['keep'] });
const OUT = path.resolve(args.out ?? path.join(os.tmpdir(), `ref-capture-test-${stamp()}`));
const only = args.only ? String(args.only).split(',') : null;
const SECRET = 'test-secret-5f1c9a';
const results = [];
let failed = 0;

const want = (name) => !only || only.some((o) => name.startsWith(o));
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
/** Async on purpose: the fixture server lives in this process, so spawnSync would deadlock it. */
function capture(extra) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(TOOLS, 'capture.mjs'), '--out', OUT, ...extra], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (status) => {
      if (status !== 0) console.log(out.split('\n').slice(-12).join('\n'));
      resolve({ status, out });
    });
  });
}
const J = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

/* anim.html barcodes: 24 squares of 12 px at x=8, rows at y=8+16*row; box A lane y 100..140, box B y 160..200 */
const readBar = (img, row) => {
  let v = 0;
  for (let i = 0; i < 24; i++) {
    const x = 8 + i * 12 + 6, y = 8 + row * 16 + 6;
    v = (v << 1) | (img.data[(y * img.width + x) * 4] > 128 ? 1 : 0);
  }
  return v;
};
const boxX = (img, y, [r, g, b]) => {
  for (let x = 0; x < img.width; x++) {
    const k = (y * img.width + x) * 4;
    if (Math.abs(img.data[k] - r) < 30 && Math.abs(img.data[k + 1] - g) < 30 && Math.abs(img.data[k + 2] - b) < 30) return x;
  }
  return -1;
};

function verifyClock(label, runDir, { exact = true, datePath = true } = {}) {
  const run = J(path.join(runDir, 'run.json'));
  const fr = J(path.join(runDir, 'frames.json')).frames;
  check(`${label}: run ok`, run.status === 'ok' && fr.length > 0, `${fr.length} frames, ${run.pageErrors.length} page errors`);
  const lane = run.viewport.width - 40;
  let prev = null;
  const bad = { perf: 0, ts: 0, count: 0, date: 0, sched: 0, boxA: 0, boxB: 0 };
  const deltas = [];
  let firstBad = '';
  for (const f of fr) {
    const img = decodePng(fs.readFileSync(path.join(runDir, f.file)));
    const [perf, ts, count, dd] = [0, 1, 2, 3].map((r) => readBar(img, r));
    const note = (k, msg) => {
      bad[k]++;
      firstBad ||= `${f.file}: ${msg}`;
    };
    if (exact) {
      if (perf !== run.baseTicks + f.t) note('perf', `performance.now ${perf} != base ${run.baseTicks} + t ${f.t}`);
      if (f.t !== Math.round((f.frame * 1000) / 60)) note('sched', `t ${f.t} != round(${f.frame}*1000/60)`);
    }
    if (ts !== perf) note('ts', `rAF ts ${ts} != performance.now ${perf}`);
    if (boxX(img, 120, [230, 60, 60]) !== perf % lane) note('boxA', `red box at x=${boxX(img, 120, [230, 60, 60])}, expected ${perf % lane}`);
    if (datePath && boxX(img, 180, [60, 160, 230]) !== dd % lane) note('boxB', `blue box at ${boxX(img, 180, [60, 160, 230])}, expected ${dd % lane}`);
    if (prev) {
      deltas.push(perf - prev.perf);
      if (exact && count - prev.count !== f.frame - prev.frame) note('count', `rAF count +${count - prev.count} over ${f.frame - prev.frame} frames`);
      if (exact && datePath && dd - prev.dd !== perf - prev.perf) note('date', `cached Date.now advanced ${dd - prev.dd} vs performance.now ${perf - prev.perf}`);
    }
    prev = { perf, count, dd, frame: f.frame };
  }
  if (exact) {
    check(`${label}: performance.now == base + round(n*1000/60) on every frame`, !bad.perf && !bad.sched, firstBad);
    check(`${label}: exactly one rAF callback per virtual frame`, !bad.count, bad.count ? firstBad : `${fr.length} frames`);
    if (datePath) check(`${label}: cached Date.now (GSAP-style) advances in lockstep`, !bad.date, bad.date ? firstBad : '');
    const byFrame = new Map(fr.map((f) => [f.frame, f.t]));
    const sixty = fr.filter((f) => byFrame.has(f.frame + 60)).map((f) => byFrame.get(f.frame + 60) - f.t);
    check(`${label}: every 60-frame window is exactly 1000 ms`, sixty.length > 0 && sixty.every((d) => d === 1000), `${sixty.length} windows`);
    const steps = deltas.filter((d, i) => fr[i + 1].frame - fr[i].frame === 1);
    check(`${label}: per-frame steps are 16/17 ms only`, steps.every((d) => d === 16 || d === 17), `${steps.filter((d) => d === 17).length}×17 + ${steps.filter((d) => d === 16).length}×16`);
  }
  if (exact) check(`${label}: rAF timestamp == performance.now`, !bad.ts, bad.ts ? firstBad : '');
  check(`${label}: rendered box position matches the frame time (pixels)`, !bad.boxA && !bad.boxB, bad.boxA || bad.boxB ? firstBad : '');
  const wallPerFrame = (run.wallSeconds * 1000) / Math.max(1, run.stats.steps);
  return { run, deltas, wallPerFrame };
}

const srv = await startServer({ port: 0, latency: 80 });
const O = srv.origin;
fs.mkdirSync(OUT, { recursive: true });
console.log(`reference-capture tests → ${OUT}`);

// --- unit: png codec
{
  const w = 7, h = 5, px = new Uint8Array(w * h * 4).map((_, i) => (i * 37) & 255);
  const back = decodePng(encodePng(w, h, px));
  check('png: encode/decode round trip', back.width === w && back.height === h && back.data.every((v, i) => v === px[i]));
}

const animScript = path.join(HERE, 'anim-script.json');
if (want('clock-virtual')) {
  console.log('\nclock-virtual (2D canvas, 120 ms real render time per frame)');
  await capture(['--url', `${O}/anim.html?slow=120&bootDelay=300`, '--script', animScript, '--game', 'anim', '--run', 'virtual']);
  const r = verifyClock('virtual', path.join(OUT, 'anim/virtual'));
  check('virtual: rendering really was slow (wall ms per frame)', r.wallPerFrame > 100, `${r.wallPerFrame.toFixed(0)} ms wall per virtual frame`);
}
if (want('clock-webgl')) {
  console.log('\nclock-webgl (WebGL, preserveDrawingBuffer:false, 60 ms real render time per frame)');
  await capture(['--url', `${O}/anim.html?gl=1&slow=60`, '--script', animScript, '--game', 'anim', '--run', 'webgl']);
  verifyClock('webgl', path.join(OUT, 'anim/webgl'));
}
if (want('clock-after-boot')) {
  console.log('\nclock-after-boot (native boot, clock installed on the live page)');
  await capture(['--url', `${O}/anim.html?slow=40&bootDelay=2000`, '--script', animScript, '--game', 'anim', '--run', 'after-boot', '--clock', 'after-boot']);
  const r = verifyClock('after-boot', path.join(OUT, 'anim/after-boot'));
  check('after-boot: performance.now stayed monotonic across install', r.deltas.every((d) => d > 0));
  const run = r.run;
  // the page's first frame is >= 2000 ms into its native timeline (bootDelay); without the
  // alignment Playwright's clock would restart performance.now near 0 (~100 ms after pauseAt)
  check('after-boot: performance.now continues from the native timeline (no reset to 0)', run.baseTicks > 2000, `baseTicks ${run.baseTicks}`);
}
if (want('clock-realtime')) {
  console.log('\nclock-realtime (fallback; no virtual time)');
  await capture(['--url', `${O}/anim.html?slow=120`, '--script', animScript, '--game', 'anim', '--run', 'realtime', '--realtime']);
  const r = verifyClock('realtime', path.join(OUT, 'anim/realtime'), { exact: false, datePath: false });
  const d = r.deltas;
  const irregular = d.filter((x) => x !== 16 && x !== 17).length;
  check('realtime: captures, but NOT frame-exact (expected)', d.length > 2 && irregular > 0, `perf deltas min ${Math.min(...d)} / max ${Math.max(...d)} ms, ${irregular}/${d.length} not 16–17 ms`);
}

if (want('mock')) {
  console.log('\nmock slot + scripts/stake-default.json (full length, 640x360, --save-assets --video)');
  const url = `${O}/mock-slot.html?sessionID=${SECRET}&rgs_url=127.0.0.1:${srv.port}/rgs&lang=en&currency=USD&device=desktop&demo=true`;
  const t0 = Date.now();
  await capture(['--url', url, '--viewport', '640x360', '--game', 'mock-slot', '--run', 'default', '--save-assets', '--video']);
  const dir = path.join(OUT, 'mock-slot/default');
  const run = J(path.join(dir, 'run.json'));
  check('mock: run ok, no page errors', run.status === 'ok' && !run.pageErrors.length, `${run.stats.captured} frames, ${run.stats.shots} shots in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  // redaction
  const texts = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? e.name !== 'frames' && e.name !== 'assets' && walk(path.join(d, e.name)) : /\.(json|txt|html)$/.test(e.name) && texts.push(path.join(d, e.name))));
  walk(dir);
  const leaks = texts.filter((f) => fs.readFileSync(f, 'utf8').includes(SECRET));
  check('mock: sessionID redacted from every output file', !leaks.length, leaks.length ? leaks.join(', ') : `${texts.length} files scanned`);
  // network + rgs
  const net = J(path.join(dir, 'network.json'));
  check('mock: network.json has every request with status/type/size', net.requests.length >= 40 && net.requests.every((r) => r.method && r.type && (r.status || r.failure)), `${net.requests.length} requests`);
  const rgsFiles = fs.readdirSync(path.join(dir, 'rgs')).filter((f) => /^\d{4}-/.test(f));
  const rgs = rgsFiles.map((f) => J(path.join(dir, 'rgs', f)));
  const count = (ep) => rgs.filter((r) => r.endpoint === ep).length;
  check('mock: RGS calls saved (authenticate/play/end-round/bet-event)', count('wallet-authenticate') === 1 && count('wallet-play') === 16 && count('wallet-end-round') >= 5 && count('bet-event') === 16, `auth ${count('wallet-authenticate')}, play ${count('wallet-play')}, end-round ${count('wallet-end-round')}, event ${count('bet-event')}`);
  const play = rgs.find((r) => r.endpoint === 'wallet-play');
  check('mock: RGS request + response bodies parsed', play.request?.sessionID === '<sessionID>' && play.request.amount === 1000000 && Array.isArray(play.response?.round?.state), `play.frame ${play.frame} → response frame ${play.frameResponse}`);
  const sum = J(path.join(dir, 'rgs/summary.json'));
  check('mock: rgs/summary.json lists book event types + fields', sum.typeCounts.reveal === 16 && (sum.fieldsByType.reveal?.board === 'array'), JSON.stringify(sum.typeCounts));
  // assets
  const assets = J(path.join(dir, 'assets.json'));
  const kinds = assets.byKind;
  check('mock: assets.json classifies spine/atlas/image/audio/font', kinds['spine-json'] === 1 && kinds['texture-atlas-json'] === 1 && kinds.atlas === 1 && kinds.image === 1 && kinds.audio === 1 && kinds.font === 1, JSON.stringify(kinds));
  const saved = assets.assets.filter((a) => a.savedAs && fs.statSync(path.join(dir, a.savedAs)).size > 0);
  check('mock: --save-assets wrote every asset (incl. blob-consumed PNG via refetch) + STUDY-ONLY note', saved.length === assets.assets.length && fs.existsSync(path.join(dir, 'assets/STUDY-ONLY.txt')), `${saved.length}/${assets.assets.length}`);
  // segments / sheets / shots / video
  const segs = J(path.join(dir, 'segments.json'));
  const names = segs.segments.map((s) => s.name);
  const expected = ['intro-idle', 'intro-dismiss', 'idle', 'spin-01', ...Array.from({ length: 10 }, (_, i) => `spin-${String(i + 2).padStart(2, '0')}`), 'turbo-toggle', ...Array.from({ length: 5 }, (_, i) => `turbo-spin-0${i + 1}`), 'menu-open', 'paytable-open', 'menu-close'];
  check('mock: segments.json has every scripted segment', expected.every((n) => names.includes(n)), `${segs.segments.length} segments`);
  const ordered = segs.segments.every((s, i) => !i || s.frameStart === segs.segments[i - 1].frameEnd + 1);
  check('mock: segment frame ranges are contiguous', ordered);
  const s1 = segs.segments.find((s) => s.name === 'spin-01');
  check('mock: spin-01 captured every frame for 6 s', s1.every === 1 && s1.captured === 360 && s1.durationMs === 6000, `${s1.captured} frames, ${s1.durationMs} ms`);
  const withFrames = segs.segments.filter((s) => s.captured > 0);
  check('mock: contact sheet per captured segment', withFrames.every((s) => s.sheet && fs.existsSync(path.join(dir, s.sheet))), `${withFrames.length} sheets`);
  const turboOn = rgs.filter((r) => r.endpoint === 'bet-event' && r.request?.debug?.turbo).length;
  check('mock: clicks land on the right UI (turbo on for the 5 turbo spins)', turboOn === 5, `${turboOn} turbo rounds`);
  const shot = (n) => segs.shots.find((s) => s.name === n);
  const pb = (n) => fs.readFileSync(path.join(dir, shot(n).file));
  check('mock: menu/paytable screenshots taken and paytable pages differ', shot('menu') && shot('paytable-01') && shot('paytable-06') && !pb('paytable-01').equals(pb('paytable-02')) && !pb('menu').equals(pb('paytable-01')));
  check('mock: grid overlays for calibration shots', ['boot', 'base-game', 'turbo-on', 'menu'].every((n) => shot(n)?.grid && fs.existsSync(path.join(dir, shot(n).grid))));
  const ff = await findFfmpeg();
  if (ff) {
    const probe = spawnSync(ff.path, ['-v', 'error', '-i', path.join(dir, s1.video), '-f', 'null', '-'], { encoding: 'utf8' });
    const n = spawnSync(ff.path, ['-hide_banner', '-i', path.join(dir, s1.video), '-map', '0:v:0', '-c', 'copy', '-f', 'null', '-'], { encoding: 'utf8' }).stderr.match(/frame=\s*(\d+)/g)?.pop();
    check('mock: spin-01.mp4 decodes, 360 frames @60 fps', probe.status === 0 && /frame=\s*360\b/.test(n ?? ''), n ?? '');
  }
  // timings vs ground truth
  const tr = spawnSync(process.execPath, [path.join(TOOLS, 'timings.mjs'), dir, '--regions', '{"grid":[0.2,0.15,0.6,0.6]}', '--columns', '5'], { encoding: 'utf8' });
  check('timings: runs', tr.status === 0, tr.status ? tr.stderr.slice(-500) : '');
  const ev = J(path.join(dir, 'timings/events.json'));
  const truth = rgs.filter((r) => r.endpoint === 'bet-event').map((r) => r.request.debug);
  const base = run.baseTicks;
  let compared = 0, stopErr = [], gapErr = [], settleErr = [], settleChecked = 0;
  let flash = null;
  for (const seg of ev.segments) {
    const s = seg.summary;
    const press = s.actions?.find((a) => a.type === 'key');
    if (!press || !s.columnStops || s.columnStops.length !== 5) continue;
    const round = truth.find((d) => Math.abs(d.pressAt - base - press.t) <= 1);
    if (!round) continue;
    const every = seg.every || 1, tol = (1000 / 60) * every;
    compared++;
    s.columnStops.forEach((c, i) => {
      // strided segments resolve one sample (every × 16.7 ms) either way
      const lo = round.stops[i] - base - (every > 1 ? tol : 0), hi = round.settles[i] - base + tol;
      if (c.t < lo || c.t > hi) stopErr.push(`${seg.name} ${c.series}: ${c.t} not in [${lo}, ${Math.round(hi)}]`);
    });
    if (every === 1) {
      const gaps = s.stopGapsMs, want = round.turbo ? 60 : 200;
      gaps.forEach((g) => Math.abs(g - want) > 17 && gapErr.push(`${seg.name}: gap ${g} vs ${want}`));
      s.columnStops.forEach((c, i) => {
        const truthSettle = round.settles[i] - base;
        if (c.settleT < truthSettle || c.settleT - truthSettle > 17) settleErr.push(`${seg.name} ${c.series}: settle ${c.settleT} vs bounce end ${Math.round(truthSettle)}`);
      });
      settleChecked += s.columnStops.length;
      if (round.flash) flash = s.flashPeakSpacingMs;
    }
  }
  check('timings: detected reel stops fall between each reel landing and its bounce end', compared >= 8 && !stopErr.length, stopErr.length ? stopErr.slice(0, 4).join('; ') : `${compared} spins × 5 columns`);
  check('timings: spin-01 (every frame) stop gaps = 200 ms ± 1 frame', !gapErr.length, gapErr.join('; '));
  check('timings: landing-bounce end (settleT) = true bounce end, first frame after it', settleChecked === 5 && !settleErr.length, settleErr.length ? settleErr.join('; ') : `${settleChecked} columns`);
  check('timings: win-flash toggle cadence ≈ 125 ms', flash != null && Math.abs(flash - 125) <= 17, `detected ${flash} ms`);
  check('timings: csv + svg written', fs.existsSync(path.join(dir, 'timings/timings.csv')) && fs.statSync(path.join(dir, 'timings/timings.svg')).size > 1000);
}

await srv.close();
fs.writeFileSync(path.join(OUT, 'test-results.json'), JSON.stringify(results, null, 2));
console.log(`\n${failed ? `${failed} FAILED` : 'ALL PASSED'} (${results.length} checks) — outputs in ${OUT}`);
process.exit(failed ? 1 : 0);
