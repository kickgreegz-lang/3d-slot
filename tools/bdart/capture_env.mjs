#!/usr/bin/env node
/**
 * Contact sheets for the Bass Drop env rigs (ANIMATION_SET 4) on the real runtime (pixi.js + spine-pixi-v8), through
 * the stock preview page (tools/spine/preview, window.__spinePreview) in its bottom-anchored mode (root = the rig's
 * anchor at the bottom centre), guides off, on the in-game backdrop colour. Frames are exact 1/60 s steps, two per
 * 30 fps frame; the plot shows the woofer scale, the cabinet hop and the first cable's physics swing.
 *
 *   node tools/bdart/capture_env.mjs --skel build/spine/bd/env_speaker_stack.json --out build/qa/rigs/env_speaker_stack/capture
 *        [--scenarios idle,pump,boom,feature|all] [--tile 240] [--size 520]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, parseArgs } from '../capture/browser.mjs';
import { startServer } from '../spine/preview/serve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const args = parseArgs();
const skel = path.resolve(args.skel);
const atlas = path.resolve(args.atlas ?? skel.replace(/\.json$/, '.atlas'));
const out = path.resolve(args.out ?? path.join(REPO, 'build/qa/rigs', path.basename(skel, '.json'), 'capture'));
const size = Number(args.size ?? 520);
const tile = Number(args.tile ?? 240);
const q = (s) => `__spinePreview.${s}`;
const SCEN = {
  idle: { frames: 72, every: 4, setup: q("play('idle', true)") },
  pump: { frames: 12, every: 1, setup: `${q("play('idle', true)")}; ${q("play('pump', false, 1, false)")}` },
  boom: { frames: 18 + 14, every: 1, setup: `${q("play('boom_follow', false)")}; ${q("queue('idle', true, 0)")}` },
  feature: { frames: 54 + 10, every: 2, setup: `${q("play('feature_follow', false)")}; ${q("queue('idle', true, 0)")}` },
};
let scenarios = (args.scenarios ?? 'all').split(',');
if (scenarios.includes('all')) scenarios = Object.keys(SCEN);
if ((process.env.TMPDIR ?? '').length > 60) process.env.TMPDIR = '/tmp';
const rel = (f) => `/${path.relative(REPO, f).split(path.sep).join('/')}`;
const server = await startServer({ port: 0 });
const browser = await launchBrowser();
let failed = false;
const trace = { skeleton: path.relative(REPO, skel), scenarios: {} };
try {
  const vw = size;
  const vh = Math.round(size * 1.12);
  const page = await browser.newPage({ viewport: { width: vw + 40, height: vh + 40 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const url = `${server.url}/tools/spine/preview/index.html?capture=1&mode=character&guides=0&bg=1b0d2e&size=${size}&w=${vw}&h=${vh}&skel=${encodeURIComponent(rel(skel))}&atlas=${encodeURIComponent(rel(atlas))}`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__spinePreview?.ready === true, null, { timeout: 60000 }).catch(() => {});
  if (!(await page.evaluate(() => window.__spinePreview?.ready === true))) throw new Error(`preview did not load: ${errs.join(' | ')}`);
  await page.evaluate(() => { const d = window.__spinePreview.spine.state.data; d.defaultMix = 0.08; });
  fs.mkdirSync(out, { recursive: true });
  const canvas = page.locator('canvas');
  for (const name of scenarios) {
    const sc = SCEN[name];
    const dir = path.join(out, name);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    await page.evaluate(`__spinePreview.reset(); ${sc.setup}`);
    const shots = [];
    const probes = [];
    for (let f = 0; f < sc.frames; f++) {
      const p = await page.evaluate(() => {
        const P = window.__spinePreview;
        const a = P.step(1 / 60);
        const b = P.step(1 / 60);
        const sk = P.spine.skeleton;
        const w = sk.findBone('woofer');
        const c = sk.findBone('cabinet');
        const pc = sk.findBone('phys_cable_1');
        const st = P.spine.state;
        const env = { woofer: w ? +w.appliedPose.scaleX.toFixed(4) : null, cabY: c ? +c.appliedPose.y.toFixed(2) : null,
          cable: pc ? +(pc.appliedPose.worldX - (P.__cab0 ??= pc.appliedPose.worldX)).toFixed(2) : null };
        const cur = [0, 1, 2].map((i) => st.tracks[i]?.animation?.name).filter(Boolean).join('+');
        return { t: b.t, events: [...a.events, ...b.events], anim: cur, env };
      });
      p.frame = f + 1;
      probes.push(p);
      if (f % sc.every === 0 || p.events.length) {
        const file = path.join(dir, `f_${String(p.frame).padStart(3, '0')}.png`);
        await canvas.screenshot({ path: file });
        shots.push({ file, frame: p.frame, ms: p.t, anim: p.anim, events: p.events.map((e) => e.name) });
      }
    }
    trace.scenarios[name] = probes;
    const sheet = path.join(out, `${name}.png`);
    await contactSheet(browser, shots, probes, sheet, `${path.basename(skel)} · ${name}`, tile, Math.round((tile * vh) / vw));
    console.log(`capture_env: ${name}: ${shots.length} frames -> ${path.relative(process.cwd(), sheet)}`);
  }
  if (errs.length) { console.error(`capture_env: page errors:\n  ${errs.join('\n  ')}`); failed = true; }
  fs.writeFileSync(path.join(out, 'trace.json'), `${JSON.stringify(trace)}\n`);
} catch (e) {
  console.error(`capture_env: ${e.stack || e}`);
  failed = true;
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);

async function contactSheet(browser, shots, probes, file, title, tileW, tileH) {
  const cols = Math.min(10, Math.max(4, Math.ceil(Math.sqrt(shots.length * 1.8))));
  const W = cols * (tileW + 6) + 12;
  const figs = shots.map((s) => `<figure><img src="data:image/png;base64,${fs.readFileSync(s.file).toString('base64')}"/><figcaption>f${s.frame} · ${s.ms}ms <i>${s.anim}</i> ${s.events.length ? `<b>${s.events.join(' ')}</b>` : ''}</figcaption></figure>`).join('');
  const PW = W - 24;
  const PH = 130;
  const n = probes.length;
  const xs = (i) => 30 + (i / Math.max(1, n - 1)) * (PW - 40);
  const lines = [];
  const add = (label, color, get, lo, hi) => {
    const pts = probes.map((p, i) => [xs(i), get(p)]).filter(([, v]) => Number.isFinite(v));
    if (!pts.length) return;
    const ys = (v) => 10 + (1 - (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (PH - 30);
    lines.push(`<polyline fill="none" stroke="${color}" stroke-width="2" points="${pts.map(([x, v]) => `${x.toFixed(1)},${ys(v).toFixed(1)}`).join(' ')}"/><text x="${PW - 230}" y="${16 + lines.length * 13}" fill="${color}">${label}</text>`);
  };
  add('woofer scale (0.9..1.25)', '#ffd54a', (p) => p.env?.woofer, 0.9, 1.25);
  add('cabinet y (-2..10 units)', '#35f2e0', (p) => p.env?.cabY, -2, 10);
  add('cable tip dx (-20..20)', '#ff9a3a', (p) => p.env?.cable, -20, 20);
  const ev = probes.map((p, i) => (p.events.length ? `<line x1="${xs(i)}" x2="${xs(i)}" y1="4" y2="${PH - 16}" stroke="#fff" stroke-dasharray="3 3"/><text x="${xs(i) + 3}" y="${PH - 4}" fill="#fff">${p.events.map((e) => e.name).join(',')}</text>` : '')).join('');
  const pg = await browser.newPage({ viewport: { width: W, height: 300 } });
  await pg.setContent(`<style>body{margin:0;background:#111;padding:6px;font:11px monospace;color:#ddd}h1{font:600 13px monospace;margin:0 0 4px}
    .g{display:grid;grid-template-columns:repeat(${cols},${tileW}px);gap:6px}figure{margin:0}img{width:${tileW}px;height:${tileH}px;display:block}
    figcaption{padding:1px 0;white-space:nowrap;overflow:hidden}b{color:#ffd54a}i{color:#8ab4ff;font-style:normal}svg text{font:11px monospace}</style>
    <h1>${title}</h1><svg width="${PW}" height="${PH}" style="background:#1a0b33;display:block;margin:6px 0">${ev}${lines.join('')}</svg><div class="g">${figs}</div>`);
  await pg.screenshot({ path: file, fullPage: true });
  await pg.close();
}
