#!/usr/bin/env node
/**
 * Animation review capture — the artifact an AI vision model (or a human animator) reviews.
 *
 * USAGE (dev server must be running, e.g. `npx vite --port 5173`):
 *   node tools/qa/animation-review.mjs --url http://localhost:5173/ \
 *        [--out screenshots/review] [--viewport 960x540] [--every 3] [--profile normal] \
 *        [--scenarios spin,tumbleChain,symbolLand:H1] [--max-seconds 16] [--tail 40] \
 *        [--settle 20] [--png] [--no-video] [--hmr]
 *
 * For every scenario (fresh page each, `?dev=lab&capture=1`, manual clock at exactly 60 fps):
 *   <out>/<key>/f0000.jpg…       every --every-th frame
 *   <out>/<key>/sheet.png        contact sheet (≤ 30 evenly spaced frames, frame # + ms)
 *   <out>/<key>/video.mp4|webm   when an ffmpeg is found (full build → H.264 MP4, Playwright's → VP8 WebM)
 *   <out>/<key>/motion.svg       y-offset + body scaleX/scaleY curves of one probed symbol
 * plus <out>/review.json (scenario, frames, durations, events, motion samples) and
 * <out>/index.html (sheets, videos, motion graphs with hover read-out, event timelines).
 *
 * Scenario spec: `name` or `name:SYMBOL` (sets opts.id) or `bigWin:mega` (sets opts.tiers).
 * Names come from src/dev/scenarios.ts (`__slot.scenarios()`).
 * Exit code: 0 when every scenario finished without page errors, 1 otherwise.
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  contactSheet,
  findFfmpeg,
  launchBrowser,
  openGame,
  parseArgs,
  parseViewport,
} from '../capture/browser.mjs';

const args = parseArgs();
const baseUrl = args.url ?? 'http://localhost:5173/';
const outDir = path.resolve(args.out ?? 'screenshots/review');
const viewport = parseViewport(args.viewport ?? '960x540');
const every = Math.max(1, Number(args.every ?? 3));
const profile = args.profile ?? 'normal';
const maxFrames = Math.round(Number(args['max-seconds'] ?? 16) * 60);
const tail = Number(args.tail ?? 40);
const settle = Number(args.settle ?? 20);
const ext = args.png ? 'png' : 'jpg';
const FRAME_MS = 1000 / 60;
const SHEET_TILES = 30;

const DEFAULT_SCENARIOS = [
  'spin',
  'anticipation',
  'clusterWin',
  'tumbleChain',
  'spots',
  'bigWin:mega',
  'fsTrigger',
  'mascots',
  'particles',
  'shakeFlash',
  'symbolLand:H1',
  'symbolLand:L1',
  'symbolStates:S',
];

const TIER_KEYS = new Set(['big', 'super', 'mega', 'epic', 'max']);
const parseSpec = (s) => {
  const [name, arg] = s.split(':');
  const opts = {};
  if (arg && TIER_KEYS.has(arg)) opts.tiers = [arg];
  else if (arg) opts.id = arg;
  return { key: arg ? `${name}-${arg}` : name, name, opts };
};
const specs = (args.scenarios ? args.scenarios.split(',') : DEFAULT_SCENARIOS).map((s) => parseSpec(s.trim()));

const labUrl = (() => {
  const u = new URL(baseUrl);
  u.searchParams.set('dev', 'lab');
  u.searchParams.set('capture', '1');
  return u.toString();
})();

const ffmpeg = args['no-video'] ? null : findFfmpeg();
fs.mkdirSync(outDir, { recursive: true });

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Scene milestones worth a marker on the motion graph (sfx/fx/mascot stay in the table). */
const MARKER_RE = /^(round:|board:|spots:update|win:tumble|bigwin:|fs:trigger|mode:change)/;

const COLORS = {
  surface: '#1a1a19',
  grid: '#2c2c2a',
  axis: '#5d5c57',
  textSecondary: '#c3c2b7',
  textMuted: '#8d8c85',
  seriesY: '#3987e5',
  seriesSx: '#3987e5',
  seriesSy: '#d95926',
  marker: '#6f6e68',
  rest: '#8d8c85',
};

// ---------------------------------------------------------------------------
// capture
// ---------------------------------------------------------------------------

const browser = await launchBrowser();
const results = [];

for (const spec of specs) {
  const dir = path.join(outDir, spec.key);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const consoleErrors = [];
  const t0 = Date.now();
  const r = { key: spec.key, name: spec.name, opts: spec.opts, status: 'error', frames: [], errors: [], consoleErrors };
  let page;
  try {
    const opened = await openGame(browser, labUrl, {
      viewport,
      blockHmr: args.hmr !== 'true',
      onConsole: (m) => {
        if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(`${m.type()}: ${m.text()}`);
      },
    });
    page = opened.page;
    r.errors = opened.errors;
    const meta = await page.evaluate(
      ({ profile, settle, name }) => {
        const s = window.__slot;
        if (typeof s.scenario !== 'function') throw new Error('__slot.scenario missing — is this a DEV server?');
        s.manual(true);
        s.slowmo(1);
        s.speed(profile);
        for (let i = 0; i < settle; i++) s.step(1000 / 60);
        const def = s.scenarios().find((d) => d.name === name);
        return { label: def?.label ?? null };
      },
      { profile, settle, name: spec.name },
    );
    r.label = meta.label ?? spec.name;
    r.probe = await page.evaluate((sp) => window.__slot.motion.start({ scenario: sp.name, opts: sp.opts }), spec);
    await page.evaluate((sp) => {
      window.__rv = { done: false, start: window.__slot.now() };
      window.__slot
        .scenario(sp.name, sp.opts)
        .then((res) => (window.__rv.result = res))
        .catch((e) => (window.__rv.error = String(e?.stack ?? e)))
        .finally(() => (window.__rv.done = true));
    }, spec);

    let doneAt = -1;
    let i = 0;
    for (; i < maxFrames; i++) {
      const done = await page.evaluate((ms) => {
        window.__slot.step(ms);
        return window.__rv.done;
      }, FRAME_MS);
      if (i % every === 0) {
        const file = path.join(dir, `f${String(r.frames.length).padStart(4, '0')}.${ext}`);
        await page.screenshot({ path: file, type: ext === 'png' ? 'png' : 'jpeg', ...(ext === 'jpg' ? { quality: 88 } : {}) });
        r.frames.push({ file: path.relative(outDir, file), frame: i, ms: Math.round(i * FRAME_MS) });
      }
      if (done && doneAt < 0) doneAt = i;
      if (doneAt >= 0 && i - doneAt >= tail) break;
    }
    r.framesStepped = i;
    const rv = await page.evaluate(() => ({
      result: window.__rv.result ?? null,
      error: window.__rv.error ?? null,
      start: window.__rv.start,
      motion: window.__slot.motion.stop(),
      events: window.__slot.events(),
    }));
    r.motion = rv.motion;
    r.durationMs = rv.result?.durationMs ?? null;
    // all events since the scenario started (incl. ones other modules fired during the tail),
    // expressed relative to the scenario start (== frame 0)
    r.events = rv.events
      .filter((e) => e.t >= rv.start)
      .map((e) => ({ ...e, t: Math.round((e.t - rv.start) * 10) / 10 }));
    if (rv.error) r.errors.push(`scenario: ${rv.error}`);
    r.status = rv.error ? 'error' : doneAt < 0 ? 'timeout' : r.errors.length ? 'pageerror' : 'ok';
  } catch (err) {
    r.errors.push(String(err?.message ?? err));
  } finally {
    await page?.close().catch(() => {});
  }

  if (r.frames.length > 1) {
    const pick = sampleEvenly(r.frames, SHEET_TILES);
    await contactSheet(
      browser,
      pick.map((f) => ({ file: path.join(outDir, f.file), i: f.frame, ms: f.ms })),
      path.join(dir, 'sheet.png'),
      { cols: 6, tileW: 320, vw: viewport.width, vh: viewport.height, title: `${r.label ?? r.name} (${r.key})` },
    );
    r.sheet = path.relative(outDir, path.join(dir, 'sheet.png'));
    if (ffmpeg) r.video = await encodeVideo(dir, r.frames.length);
  }
  if (r.motion?.samples?.length) {
    fs.writeFileSync(path.join(dir, 'motion.svg'), motionSvg(r.motion, r.events ?? [], r.label ?? r.name));
    r.motionSvg = path.relative(outDir, path.join(dir, 'motion.svg'));
  }
  r.wallMs = Date.now() - t0;
  results.push(r);
  console.log(
    `${r.status.padEnd(9)} ${r.key.padEnd(18)} ${String(r.durationMs ?? '—').padStart(6)} ms  ${r.frames.length} frames  ${(r.wallMs / 1000).toFixed(1)} s${r.errors.length ? `  ERR ${r.errors[0].slice(0, 160)}` : ''}`,
  );
}
await browser.close();

const report = {
  generatedAt: new Date().toISOString(),
  url: labUrl,
  viewport,
  fps: 60 / every,
  stepMs: FRAME_MS,
  every,
  profile,
  ffmpeg: ffmpeg ? { path: ffmpeg.path, format: ffmpeg.mp4 ? 'mp4' : 'webm' } : null,
  scenarios: results.map((r) => ({
    key: r.key,
    name: r.name,
    label: r.label,
    opts: r.opts,
    status: r.status,
    durationMs: r.durationMs,
    framesStepped: r.framesStepped,
    frames: r.frames,
    sheet: r.sheet ?? null,
    video: r.video ?? null,
    motionSvg: r.motionSvg ?? null,
    probe: r.probe ?? null,
    motion: r.motion ?? null,
    events: r.events ?? [],
    errors: r.errors,
    consoleErrors: r.consoleErrors,
  })),
};
fs.writeFileSync(path.join(outDir, 'review.json'), JSON.stringify(report, null, 1));
fs.writeFileSync(path.join(outDir, 'index.html'), indexHtml(report));
console.log(`\nreview: ${path.join(outDir, 'index.html')}`);
process.exit(results.every((r) => r.status === 'ok') ? 0 : 1);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function sampleEvenly(list, n) {
  if (list.length <= n) return list;
  return Array.from({ length: n }, (_, k) => list[Math.round((k * (list.length - 1)) / (n - 1))]);
}

async function encodeVideo(dir, count) {
  const fps = String(60 / every);
  try {
    if (ffmpeg.mp4) {
      const out = path.join(dir, 'video.mp4');
      execFileSync(
        ffmpeg.path,
        ['-y', '-loglevel', 'error', '-framerate', fps, '-i', path.join(dir, `f%04d.${ext}`),
          '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20',
          '-movflags', '+faststart', out],
        { stdio: ['ignore', 'ignore', 'pipe'] },
      );
      return path.relative(outDir, out);
    }
    if (ext !== 'jpg') return null; // Playwright's ffmpeg decodes MJPEG only
    const out = path.join(dir, 'video.webm');
    const proc = spawn(ffmpeg.path, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', fps,
      '-i', '-', '-c:v', 'libvpx', '-b:v', '4M', out], { stdio: ['pipe', 'ignore', 'ignore'] });
    const closed = new Promise((resolve) => proc.on('close', resolve));
    for (let k = 0; k < count; k++) proc.stdin.write(fs.readFileSync(path.join(dir, `f${String(k).padStart(4, '0')}.jpg`)));
    proc.stdin.end();
    await closed;
    return fs.existsSync(out) ? path.relative(outDir, out) : null;
  } catch {
    return null;
  }
}

function niceStep(range, target) {
  const raw = range / Math.max(1, target);
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * p) return m * p;
  return 10 * p;
}

/**
 * Two stacked panels sharing the time axis (never a dual y-axis):
 *   1) vertical offset from rest, px (up = above rest),
 *   2) body scaleX / scaleY (1.0 = rest), legend + direct labels.
 */
function motionSvg(motion, events, title) {
  const S = motion.samples;
  const W = 760;
  const PH = 150;
  const M = { l: 56, r: 64, t: 40, gap: 46, b: 34 };
  const H = M.t + PH + M.gap + PH + M.b;
  const tMax = Math.max(S[S.length - 1].t, 1);
  const x = (t) => M.l + (t / tMax) * (W - M.l - M.r);

  const ys = S.map((s) => -s.y);
  let yMin = Math.min(0, ...ys);
  let yMax = Math.max(0, ...ys);
  if (yMax - yMin < 20) yMax = yMin + 20;
  const pad1 = (yMax - yMin) * 0.08;
  yMin -= pad1;
  yMax += pad1;
  const y1 = (v) => M.t + PH - ((v - yMin) / (yMax - yMin)) * PH;

  const sc = S.flatMap((s) => [s.sx, s.sy]);
  let sMin = Math.min(1, ...sc);
  let sMax = Math.max(1, ...sc);
  if (sMax - sMin < 0.2) {
    const mid = (sMax + sMin) / 2;
    sMin = mid - 0.1;
    sMax = mid + 0.1;
  }
  const pad2 = (sMax - sMin) * 0.08;
  sMin -= pad2;
  sMax += pad2;
  const top2 = M.t + PH + M.gap;
  const y2 = (v) => top2 + PH - ((v - sMin) / (sMax - sMin)) * PH;

  const path = (fx, fy) =>
    S.map((s, k) => `${k ? 'L' : 'M'}${fx(s.t).toFixed(1)},${fy(s).toFixed(1)}`).join('');

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="motion-svg"
    data-l="${M.l}" data-r="${W - M.r}" data-tmax="${tMax}" font-family="ui-sans-serif,system-ui,sans-serif">`);
  out.push(`<rect width="${W}" height="${H}" fill="${COLORS.surface}"/>`);
  out.push(`<text x="${M.l}" y="18" fill="${COLORS.textSecondary}" font-size="13" font-weight="600">${esc(title)} — ${esc(motion.target)}</text>`);

  // time grid (shared)
  const tStep = niceStep(tMax, 8);
  for (let t = 0; t <= tMax + 1e-6; t += tStep) {
    const xx = x(t).toFixed(1);
    out.push(`<line x1="${xx}" x2="${xx}" y1="${M.t}" y2="${M.t + PH}" stroke="${COLORS.grid}"/>`);
    out.push(`<line x1="${xx}" x2="${xx}" y1="${top2}" y2="${top2 + PH}" stroke="${COLORS.grid}"/>`);
    out.push(`<text x="${xx}" y="${H - 12}" fill="${COLORS.textMuted}" font-size="11" text-anchor="middle">${Math.round(t)}</text>`);
  }
  out.push(`<text x="${W - M.r}" y="${H - 12}" dx="8" fill="${COLORS.textMuted}" font-size="11">ms</text>`);

  // panel 1: offset
  const yStep = niceStep(yMax - yMin, 4);
  for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax; v += yStep) {
    const yy = y1(v).toFixed(1);
    out.push(`<line x1="${M.l}" x2="${W - M.r}" y1="${yy}" y2="${yy}" stroke="${COLORS.grid}"/>`);
    out.push(`<text x="${M.l - 8}" y="${yy}" dy="4" fill="${COLORS.textMuted}" font-size="11" text-anchor="end">${Math.round(v)}</text>`);
  }
  out.push(`<line x1="${M.l}" x2="${W - M.r}" y1="${y1(0)}" y2="${y1(0)}" stroke="${COLORS.rest}" stroke-dasharray="4 3"/>`);
  out.push(`<text x="${M.l}" y="${M.t - 8}" fill="${COLORS.textMuted}" font-size="11">height above rest (px) — up = above</text>`);
  out.push(`<path d="${path(x, (s) => y1(-s.y))}" fill="none" stroke="${COLORS.seriesY}" stroke-width="2" stroke-linejoin="round"/>`);
  for (const s of S.filter((q) => q.repick)) {
    out.push(`<circle cx="${x(s.t).toFixed(1)}" cy="${y1(-s.y).toFixed(1)}" r="4" fill="${COLORS.surface}" stroke="${COLORS.textSecondary}" stroke-width="1.5"><title>probe re-picked a new symbol view</title></circle>`);
  }

  // panel 2: scale
  const sStep = niceStep(sMax - sMin, 4);
  for (let v = Math.ceil(sMin / sStep) * sStep; v <= sMax + 1e-9; v += sStep) {
    const yy = y2(v).toFixed(1);
    out.push(`<line x1="${M.l}" x2="${W - M.r}" y1="${yy}" y2="${yy}" stroke="${COLORS.grid}"/>`);
    out.push(`<text x="${M.l - 8}" y="${yy}" dy="4" fill="${COLORS.textMuted}" font-size="11" text-anchor="end">${v.toFixed(2)}</text>`);
  }
  out.push(`<line x1="${M.l}" x2="${W - M.r}" y1="${y2(1)}" y2="${y2(1)}" stroke="${COLORS.rest}" stroke-dasharray="4 3"/>`);
  out.push(`<text x="${M.l}" y="${top2 - 8}" fill="${COLORS.textMuted}" font-size="11">body scale (1.00 = rest)</text>`);
  // legend
  const lx = W - M.r - 150;
  out.push(`<line x1="${lx}" x2="${lx + 16}" y1="${top2 - 12}" y2="${top2 - 12}" stroke="${COLORS.seriesSx}" stroke-width="2"/>`);
  out.push(`<text x="${lx + 20}" y="${top2 - 8}" fill="${COLORS.textSecondary}" font-size="11">scaleX</text>`);
  out.push(`<line x1="${lx + 74}" x2="${lx + 90}" y1="${top2 - 12}" y2="${top2 - 12}" stroke="${COLORS.seriesSy}" stroke-width="2" stroke-dasharray="6 3"/>`);
  out.push(`<text x="${lx + 94}" y="${top2 - 8}" fill="${COLORS.textSecondary}" font-size="11">scaleY</text>`);
  out.push(`<path d="${path(x, (s) => y2(s.sx))}" fill="none" stroke="${COLORS.seriesSx}" stroke-width="2" stroke-linejoin="round"/>`);
  out.push(`<path d="${path(x, (s) => y2(s.sy))}" fill="none" stroke="${COLORS.seriesSy}" stroke-width="2" stroke-dasharray="6 3" stroke-linejoin="round"/>`);
  const last = S[S.length - 1];
  const lyX = y2(last.sx);
  const lyY = y2(last.sy);
  const sep = Math.abs(lyX - lyY) < 12 ? 7 : 0;
  out.push(`<text x="${W - M.r + 6}" y="${lyX - sep}" dy="4" fill="${COLORS.textSecondary}" font-size="11">X</text>`);
  out.push(`<text x="${W - M.r + 6}" y="${lyY + sep}" dy="4" fill="${COLORS.textSecondary}" font-size="11">Y</text>`);

  // scene milestones
  let row = 0;
  for (const e of events.filter((ev) => MARKER_RE.test(ev.type) && ev.t >= 0 && ev.t <= tMax)) {
    const xx = x(e.t).toFixed(1);
    out.push(`<line x1="${xx}" x2="${xx}" y1="${M.t}" y2="${top2 + PH}" stroke="${COLORS.marker}" stroke-dasharray="2 3"><title>${esc(e.type)} @ ${e.t} ms</title></line>`);
    out.push(`<text x="${xx}" y="${M.t + 11 + (row % 3) * 11}" dx="3" fill="${COLORS.textMuted}" font-size="10">${esc(e.type.replace(/^(board|win|round|spots|fs|bigwin):/, ''))}</text>`);
    row++;
  }

  // hover layer (driven by the page script)
  out.push(`<line class="xh" x1="0" x2="0" y1="${M.t}" y2="${top2 + PH}" stroke="${COLORS.textSecondary}" visibility="hidden"/>`);
  out.push(`<rect x="${M.l}" y="${M.t}" width="${W - M.l - M.r}" height="${top2 + PH - M.t}" fill="transparent" class="hit"/>`);
  out.push('</svg>');
  return out.join('\n');
}

function indexHtml(rep) {
  const rows = rep.scenarios
    .map(
      (s) => `<tr><td><a href="#${esc(s.key)}">${esc(s.key)}</a></td><td>${esc(s.label ?? '')}</td>
      <td class="st ${s.status}">${s.status}</td><td class="n">${s.durationMs ?? '—'}</td><td class="n">${s.frames.length}</td>
      <td class="n">${s.events.length}</td><td class="n">${s.errors.length}</td><td class="n">${s.consoleErrors.length}</td></tr>`,
    )
    .join('');
  const sections = rep.scenarios
    .map((s) => {
      const video = s.video
        ? `<video src="${esc(s.video)}" controls loop muted playsinline preload="metadata"></video>`
        : '<p class="muted">no video (ffmpeg unavailable)</p>';
      const motion = s.motionSvg
        ? `<figure class="motion" data-key="${esc(s.key)}">${fs.readFileSync(path.join(outDir, s.motionSvg), 'utf8')}<figcaption class="tip"></figcaption></figure>
           <script type="application/json" id="m-${esc(s.key)}">${JSON.stringify(s.motion.samples)}</script>`
        : '<p class="muted">no motion probe for this scenario</p>';
      const events = s.events
        .map((e) => `<tr><td class="n">${e.t}</td><td>${esc(e.type)}</td><td>${esc(e.detail ?? '')}</td></tr>`)
        .join('');
      const errs = [...s.errors, ...s.consoleErrors].map((e) => `<li>${esc(e)}</li>`).join('');
      return `<section id="${esc(s.key)}">
        <h2>${esc(s.label ?? s.name)} <small>${esc(s.key)} · <span class="st ${s.status}">${s.status}</span> · ${s.durationMs ?? '—'} ms · ${s.frames.length} frames</small></h2>
        ${errs ? `<ul class="errs">${errs}</ul>` : ''}
        <div class="media">${s.sheet ? `<a href="${esc(s.sheet)}"><img src="${esc(s.sheet)}" alt="contact sheet ${esc(s.key)}"></a>` : ''}${video}</div>
        ${motion}
        <details><summary>Event timeline (${s.events.length})</summary><table class="ev"><tr><th>ms</th><th>event</th><th>detail</th></tr>${events}</table></details>
      </section>`;
    })
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Animation Review</title>
<style>
  :root{color-scheme:dark;--bg:#111110;--surface:#1a1a19;--ink:#f2f1ea;--ink2:#c3c2b7;--muted:#8d8c85;--line:#2c2c2a;--ok:#199e70;--bad:#e66767;--warn:#c98500}
  body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 ui-sans-serif,system-ui,sans-serif;padding:24px 16px;max-width:1500px;margin-inline:auto}
  h1{font-size:20px;margin:0 0 4px}h2{font-size:17px;margin:32px 0 8px}h2 small{font-weight:400;color:var(--muted);font-size:13px}
  .meta,.muted{color:var(--muted)}table{border-collapse:collapse}td,th{padding:4px 10px;border-bottom:1px solid var(--line);text-align:left}
  td.n{text-align:right;font-variant-numeric:tabular-nums}.st.ok{color:var(--ok)}.st.error,.st.pageerror{color:var(--bad)}.st.timeout{color:var(--warn)}
  a{color:#7fb2f0}.media{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start}.media img{max-width:100%;width:980px;border:1px solid var(--line)}
  video{width:480px;max-width:100%;border:1px solid var(--line);background:#000}
  figure.motion{position:relative;margin:12px 0;display:inline-block;max-width:100%}figure.motion svg{max-width:100%;height:auto;display:block;border:1px solid var(--line)}
  .tip{position:absolute;top:30px;right:70px;background:rgba(10,10,10,.9);border:1px solid var(--line);padding:4px 8px;font:12px ui-monospace,monospace;color:var(--ink);pointer-events:none;display:none;white-space:nowrap}
  details{margin:8px 0}summary{cursor:pointer;color:var(--ink2)}.ev td{font:12px ui-monospace,monospace}.errs{color:var(--bad);font:12px ui-monospace,monospace}
</style></head><body>
<h1>Animation review</h1>
<p class="meta">${esc(rep.generatedAt)} · ${esc(rep.url)} · ${rep.viewport.width}×${rep.viewport.height} · stepped at 60 fps, captured every ${rep.every} (${rep.fps} fps) · profile ${esc(rep.profile)} · video ${rep.ffmpeg ? esc(rep.ffmpeg.format) : 'off'}</p>
<p class="meta">Motion graphs: the probed symbol's height above its rest position and its body scaleX/scaleY per frame (real time, so hit-stop holds show as flat segments). Dotted verticals = scene events; hollow dots = the probe switched to a new symbol view.</p>
<table><tr><th>key</th><th>scenario</th><th>status</th><th>ms</th><th>frames</th><th>events</th><th>errors</th><th>console</th></tr>${rows}</table>
${sections}
<script>
for (const fig of document.querySelectorAll('figure.motion')) {
  const svg = fig.querySelector('svg'); const tip = fig.querySelector('.tip'); const xh = svg.querySelector('.xh');
  const data = JSON.parse(document.getElementById('m-' + fig.dataset.key).textContent);
  const l = +svg.dataset.l, r = +svg.dataset.r, tmax = +svg.dataset.tmax;
  const hit = svg.querySelector('.hit');
  hit.addEventListener('mousemove', (ev) => {
    const pt = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(svg.getScreenCTM().inverse());
    const t = ((pt.x - l) / (r - l)) * tmax;
    let lo = 0, hi = data.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (data[mid].t < t) lo = mid; else hi = mid; }
    const s = Math.abs(data[lo].t - t) < Math.abs(data[hi].t - t) ? data[lo] : data[hi];
    const x = l + (s.t / tmax) * (r - l);
    xh.setAttribute('x1', x); xh.setAttribute('x2', x); xh.setAttribute('visibility', 'visible');
    tip.style.display = 'block';
    tip.textContent = 't ' + s.t.toFixed(0) + ' ms · y ' + (-s.y).toFixed(1) + ' px · sx ' + s.sx.toFixed(3) + ' · sy ' + s.sy.toFixed(3);
  });
  hit.addEventListener('mouseleave', () => { xh.setAttribute('visibility', 'hidden'); tip.style.display = 'none'; });
}
</script>
</body></html>`;
}
