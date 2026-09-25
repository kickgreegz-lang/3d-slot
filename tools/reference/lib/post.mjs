/**
 * Post-processing for a capture run directory (also runnable on its own via postprocess.mjs):
 *   segments/<NN-name>/sheet.png   contact sheet per captured segment (frame # + ms under tiles)
 *   shots/*.grid.png               screenshots with a 0..1 canvas-coordinate grid (for "points")
 *   video/<NN-name>.mp4, video/all.mp4   real-time 60 fps H.264 (with --video)
 *   index.html                     local browser for all of the above
 * Contact sheets are composed in a clean browser context (no clock) with Playwright.
 */
import fs from 'node:fs';
import path from 'node:path';
import { findFfmpeg, framesToMp4 } from './ffmpeg.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const readJson = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);

function pick(list, max) {
  if (list.length <= max) return list;
  const out = [];
  for (let k = 0; k < max; k++) out.push(list[Math.round((k * (list.length - 1)) / (max - 1))]);
  return [...new Set(out)];
}

async function localPage(browser, runDir, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 400 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.route('http://ref.local/**', (route) => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/+/, '');
    if (rel === '__page') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: page.__html ?? '' });
    const abs = path.resolve(runDir, rel);
    if (!abs.startsWith(path.resolve(runDir)) || !fs.existsSync(abs)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ path: abs });
  });
  return { ctx, page };
}

async function render(page, html, file) {
  page.__html = html;
  await page.goto('http://ref.local/__page', { waitUntil: 'load' });
  await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete), null, { polling: 100, timeout: 120_000 });
  await page.screenshot({ path: file, fullPage: true });
}

export async function contactSheet(browser, runDir, seg, frames, { cols = 8, max = 60, aspect = 16 / 9 } = {}) {
  cols = Math.max(1, cols);
  const tileW = Math.max(160, Math.min(320, Math.floor(2400 / cols)));
  const tileH = Math.round(tileW / aspect);
  const tiles = pick(frames, max);
  const width = cols * (tileW + 6) + 20;
  const { ctx, page } = await localPage(browser, runDir, width);
  const sampled = tiles.length < frames.length ? ` · ${tiles.length} of ${frames.length} captured frames shown` : '';
  const head = `<h1>${esc(seg.name)}</h1><p class="m">${esc(seg.type)} · frames ${seg.frameStart}–${seg.frameEnd} · t ${seg.tStart}–${seg.tEnd} ms · every ${seg.every}${sampled}${seg.notes ? ` · ${esc(seg.notes)}` : ''}${seg.stoppedEarly ? ` · stopped: ${esc(seg.stoppedEarly)}` : ''}</p>`;
  const figs = tiles
    .map((f) => `<figure><img src="http://ref.local/${esc(f.file)}"><figcaption><b>#${f.frame}</b> ${f.t} ms <i>+${f.t - seg.tStart}</i></figcaption></figure>`)
    .join('');
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#15171a;color:#e8eaed;font:12px/1.35 ui-monospace,Menlo,Consolas,monospace;padding:10px}
    h1{font-size:15px;margin:0 0 2px}.m{color:#9aa0a6;margin:0 0 8px}
    .g{display:grid;grid-template-columns:repeat(${cols},${tileW}px);gap:6px}
    figure{margin:0}img{width:${tileW}px;height:${tileH}px;display:block;background:#000;object-fit:contain}
    figcaption{padding:2px 0 0;white-space:nowrap}b{color:#fff}i{color:#8ab4f8;font-style:normal}
  </style>${head}<div class="g">${figs}</div>`;
  const dir = path.join(runDir, 'segments', `${String(seg.index).padStart(2, '0')}-${seg.name}`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'sheet.png');
  await render(page, html, file);
  await ctx.close();
  return path.relative(runDir, file).split(path.sep).join('/');
}

/** Screenshot + normalised canvas grid (every 0.05, labels every 0.1) for picking click points. */
export async function gridOverlay(browser, runDir, shot, run) {
  const vw = run.viewport?.width ?? 1920, vh = run.viewport?.height ?? 1080;
  const c = shot.canvas ?? run.canvas ?? { x: 0, y: 0, width: vw, height: vh };
  const { ctx, page } = await localPage(browser, runDir, vw);
  await page.setViewportSize({ width: vw, height: vh });
  let lines = '';
  for (let k = 0; k <= 20; k++) {
    const f = k / 20, major = k % 2 === 0;
    const x = c.x + f * c.width, y = c.y + f * c.height;
    const st = major ? 'stroke="#00e5ff" stroke-opacity=".75" stroke-width="1.5"' : 'stroke="#00e5ff" stroke-opacity=".35" stroke-width="1" stroke-dasharray="4 4"';
    lines += `<line x1="${x}" y1="${c.y}" x2="${x}" y2="${c.y + c.height}" ${st}/><line x1="${c.x}" y1="${y}" x2="${c.x + c.width}" y2="${y}" ${st}/>`;
    if (major && k < 20) {
      const lab = f.toFixed(1);
      lines += `<text x="${x + 3}" y="${c.y + 14}">${lab}</text><text x="${c.x + 3}" y="${y + 14}">${lab}</text>`;
    }
  }
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;width:${vw}px;height:${vh}px;position:relative;overflow:hidden;background:#000}
    img{position:absolute;left:0;top:0;width:${vw}px;height:${vh}px}svg{position:absolute;left:0;top:0}
    text{font:bold 13px ui-monospace,Menlo,monospace;fill:#fff;paint-order:stroke;stroke:#000;stroke-width:3px}</style>
    <img src="http://ref.local/${esc(shot.file)}"><svg width="${vw}" height="${vh}">${lines}</svg>`;
  const out = shot.file.replace(/\.png$/, '.grid.png');
  page.__html = html;
  await page.goto('http://ref.local/__page', { waitUntil: 'load' });
  await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete), null, { polling: 100 });
  await page.screenshot({ path: path.join(runDir, out) });
  await ctx.close();
  return out;
}

function writeIndex(runDir, run, segs, framesIdx, shots) {
  const rgs = readJson(path.join(runDir, 'rgs/summary.json'), null);
  const assets = readJson(path.join(runDir, 'assets.json'), null);
  const rows = segs
    .map(
      (s) => `<tr><td>${s.index}</td><td><b>${esc(s.name)}</b>${s.notes ? `<br><small>${esc(s.notes)}</small>` : ''}</td><td>${esc(s.type)}</td><td>${s.frameStart}–${s.frameEnd}</td><td>${s.tStart}–${s.tEnd}</td><td>${s.every || ''}</td><td>${s.captured || ''}</td>
      <td>${s.sheet ? `<a href="${esc(s.sheet)}"><img loading="lazy" src="${esc(s.sheet)}"></a>` : ''}</td><td>${s.video ? `<video src="${esc(s.video)}" controls preload="none" width="320"></video>` : ''}</td></tr>`,
    )
    .join('');
  const shotHtml = shots.map((s) => `<figure><a href="${esc(s.grid ?? s.file)}"><img loading="lazy" src="${esc(s.file)}"></a><figcaption>${esc(s.name)} · #${s.frame ?? '-'} · ${s.t ?? '-'} ms${s.grid ? ` · <a href="${esc(s.grid)}">grid</a>` : ''}</figcaption></figure>`).join('');
  const rgsHtml = rgs
    ? `<h2>RGS (${rgs.calls.length} calls)</h2><p>${Object.entries(rgs.typeCounts).map(([k, v]) => `${esc(k)}×${v}`).join(' · ')}</p><ol>${rgs.calls.map((c) => `<li><a href="${esc(c.file)}">${esc(c.endpoint)}</a> status ${c.status} · frame ${c.frame ?? '-'}→${c.tResponse ?? '-'} ms</li>`).join('')}</ol>`
    : '';
  const html = `<!doctype html><meta charset="utf-8"><title>${esc(run.game)} ${esc(run.run)}</title><style>
    body{font:14px/1.4 system-ui,sans-serif;margin:16px;background:#111;color:#ddd}a{color:#8ab4f8}table{border-collapse:collapse}
    td,th{border-bottom:1px solid #333;padding:4px 8px;vertical-align:top;text-align:left}td img{width:320px}
    .shots{display:flex;flex-wrap:wrap;gap:8px}.shots img{width:320px}figure{margin:0}small{color:#999}</style>
    <h1>${esc(run.game)} / ${esc(run.run)}</h1>
    <p><b>Reference only</b> — third-party material for private study of timing/animation/design. Never ship or commit.</p>
    <p>clock: ${esc(run.clock)} · ${run.fps} fps · viewport ${run.viewport?.width}×${run.viewport?.height} · ${framesIdx.length} captured frames ·
    <a href="segments.json">segments.json</a> · <a href="frames.json">frames.json</a> · <a href="network.json">network.json</a> · <a href="assets.json">assets.json</a>${assets ? ` (${assets.assets.length})` : ''} · <a href="run.json">run.json</a>${fs.existsSync(path.join(runDir, 'video/all.mp4')) ? ' · <a href="video/all.mp4">all.mp4</a>' : ''}${fs.existsSync(path.join(runDir, 'timings/timings.svg')) ? ' · <a href="timings/timings.svg">timings.svg</a>' : ''}</p>
    <table><tr><th>#</th><th>segment</th><th>type</th><th>frames</th><th>t (ms)</th><th>every</th><th>captured</th><th>sheet</th><th>video</th></tr>${rows}</table>
    <h2>Screenshots</h2><div class="shots">${shotHtml}</div>${rgsHtml}`;
  fs.writeFileSync(path.join(runDir, 'index.html'), html);
}

export async function postprocess(runDir, { browser, video = false, sheets = true, sheetCols = 8, sheetMax = 60, log = console.log } = {}) {
  const run = readJson(path.join(runDir, 'run.json'), {});
  const segDoc = readJson(path.join(runDir, 'segments.json'), { segments: [] });
  const framesIdx = readJson(path.join(runDir, 'frames.json'), { frames: [] }).frames;
  const shots = segDoc.shots ?? [];
  const byId = new Map();
  for (const f of framesIdx) {
    if (!byId.has(f.seg)) byId.set(f.seg, []);
    byId.get(f.seg).push(f);
  }
  const vw = run.viewport?.width ?? 1920, vh = run.viewport?.height ?? 1080;
  const c = run.clip === 'canvas' && run.canvas ? run.canvas : null;
  const aspect = c ? c.width / c.height : vw / vh;
  if (sheets) {
    for (const seg of segDoc.segments) {
      const fr = byId.get(seg.index) ?? [];
      if (!fr.length) continue;
      seg.sheet = await contactSheet(browser, runDir, seg, fr, { cols: sheetCols, max: sheetMax, aspect });
      log(`  sheet  ${seg.sheet}`);
    }
    for (const s of shots) {
      if (s.grid === true) {
        s.grid = await gridOverlay(browser, runDir, s, run);
        log(`  grid   ${s.grid}`);
      }
    }
  }
  if (video) {
    const ff = await findFfmpeg();
    if (!ff?.x264) {
      log('  ! --video: no ffmpeg with libx264 found (set $FFMPEG); skipping MP4s');
    } else {
      const abs = (list) => list.map((f) => ({ ...f, file: path.join(runDir, f.file) }));
      for (const seg of segDoc.segments) {
        const fr = byId.get(seg.index) ?? [];
        if (fr.length < 2) continue;
        const out = path.join(runDir, 'video', `${String(seg.index).padStart(2, '0')}-${seg.name}.mp4`);
        await framesToMp4(ff, abs(fr), out, { fps: run.fps ?? 60 });
        seg.video = path.relative(runDir, out).split(path.sep).join('/');
        log(`  video  ${seg.video}`);
      }
      if (framesIdx.length > 1) {
        await framesToMp4(ff, abs(framesIdx), path.join(runDir, 'video', 'all.mp4'), { fps: run.fps ?? 60, maxGap: 6 });
        log('  video  video/all.mp4');
      }
    }
  }
  fs.writeFileSync(path.join(runDir, 'segments.json'), JSON.stringify(segDoc, null, 2));
  writeIndex(runDir, run, segDoc.segments, framesIdx, shots);
  return segDoc;
}
