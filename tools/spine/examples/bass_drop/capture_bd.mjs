#!/usr/bin/env node
/**
 * Contact sheets for the Bass Drop rigs on the real runtime (pixi.js + spine-pixi-v8), through the stock preview
 * page (tools/spine/preview/index.html + preview.mjs, window.__spinePreview) with the Bass Drop scenarios that
 * tools/spine/preview/capture.mjs does not know: skins, additive track-1 overlays, the wild's drop / sticky /
 * multiplier sequences and the Groove Meter clips (ANIMATION_SET 2.6 / 3).
 *
 *   node tools/spine/examples/bass_drop/capture_bd.mjs --skel build/spine/bd/sym_W.json --atlas build/spine/bd/sym_W.atlas \
 *        --out build/qa/rigs/sym_W/capture [--scenarios land,win,drop,...|all] [--tile 224] [--size 420] [--kick -27]
 *
 * Scenarios (symbols): land (runtime-like reel stop, as capture.mjs), win (win -> win_loop), explode, idle,
 *   anticipation, appear, blur, bass_react (idle + bass_react additive on track 1), and for sym_W: drop (mult skin,
 *   badge_t3: drop_launch -> drop_fall -> drop_fall -> drop_impact -> idle), sticky (sticky skin: drop_impact ->
 *   sticky_lock -> sticky_idle), mult_up (sticky: sticky_idle -> mult_up with the runtime's tier swap at mult_swap ->
 *   sticky_idle), unlock (sticky_idle -> sticky_unlock), explode_sticky, win_sticky.
 * Scenarios (ui_groove_meter, --mode ui): idle, heat_loop, armed_loop, overdrive_loop, tick, pump, threshold_minor,
 *   threshold_major (overlays over idle), boom (charge -> boom -> idle), chained (charge_chained -> boom), drain,
 *   feature_trigger (-> overdrive_loop), skins (base / jukejam / megamix / bare stills).
 * Each frame is rendered at an exact 1/60 s step (two per 30 fps frame); every sheet shows frame, ms and events.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, parseArgs } from '../../../capture/browser.mjs';
import { startServer } from '../../preview/serve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const args = parseArgs();
if (args.help || !args.skel) {
  const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
  console.log(src.slice(src.indexOf('/**') + 3, src.indexOf('*/')).replace(/^ \* ?/gm, '').trim());
  process.exit(args.help ? 0 : 2);
}
const skel = path.resolve(args.skel);
const atlas = path.resolve(args.atlas ?? skel.replace(/\.json$/, '.atlas'));
const out = path.resolve(args.out ?? path.join(REPO, 'build/qa/rigs', path.basename(skel, '.json'), 'capture'));
const isUi = args.mode === 'ui' || /^ui_/.test(path.basename(skel));
const size = Number(args.size ?? (isUi ? 560 : 420));
const tile = Number(args.tile ?? 224);
const kick = Number(args.kick ?? -27);
const zoom = Number(args.zoom ?? (isUi ? 0.56 : 1));
const isW = /sym_W/.test(path.basename(skel));

const q = (s) => `__spinePreview.${s}`;
const sk = (name) => `__spinePreview.spine.skeleton.setSkin('${name}'); __spinePreview.spine.skeleton.setupPoseSlots();`;
const att = (slot, a) => `__spinePreview.spine.skeleton.setAttachment('${slot}', ${a === null ? 'null' : `'${a}'`});`;
const SCEN = {};
if (!isUi) {
  Object.assign(SCEN, {
    land: { frames: 34, every: 1, setup: q(`drop({ from: 220, frames: 6, kick: ${kick} })`) },
    win: { frames: 70, every: 2, setup: `${q("play('win', false)")}; ${q("queue('win_loop', true)")}` },
    explode: { frames: 16, every: 1, setup: q("play('explode', false)") },
    idle: { frames: 106, every: 6, setup: q("play('idle', true)") },
    anticipation: { frames: 34, every: 2, setup: q("play('anticipation', true)") },
    appear: { frames: 12, every: 1, setup: q("play('appear', false)") },
    blur: { frames: 3, every: 1, setup: q("play('blur', true)") },
    bass_react: { frames: 14, every: 1, setup: `${q("play('idle', true)")}; ${q("play('bass_react', false, 1, true)")}` },
  });
  if (isW) {
    Object.assign(SCEN, {
      drop: { frames: 8 + 24 + 15 + 8, every: 1, setup: `${sk('mult')} ${att('badge', 'badge_t3')} ${q("play('drop_launch', false)")}; ${q("queue('drop_fall', true, 0)")}; ${q("queue('drop_impact', false, 0.8 - 0.27)")}; ${q("queue('idle', true, 0)")}` },
      sticky: { frames: 15 + 12 + 30, every: 1, setup: `${sk('sticky')} ${att('badge', 'badge_t2')} ${q("play('drop_impact', false)")}; ${q("queue('sticky_lock', false, 0)")}; ${q("queue('sticky_idle', true, 0)")}` },
      mult_up: { frames: 70, every: 2, setup: `${sk('sticky')} ${att('badge', 'badge_t2')} ${q("play('sticky_idle', true)")}; ${q("queue('mult_up', false, 0.6)")}; ${q("queue('sticky_idle', true, 0)")}`,
        drive: (f) => (f === 18 + 4 ? att('badge', 'badge_t4') : '') },
      unlock: { frames: 24, every: 1, setup: `${sk('sticky')} ${att('badge', 'badge_t2')} ${q("play('sticky_idle', true)")}; ${q("queue('sticky_unlock', false, 0.3)")}` },
      explode_sticky: { frames: 16, every: 1, setup: `${sk('sticky')} ${att('badge', 'badge_t5')} ${q("play('sticky_idle', true)")}; __spinePreview.spine.update(0.2); ${q("play('explode', false)")}` },
      win_sticky: { frames: 70, every: 2, setup: `${sk('sticky')} ${att('badge', 'badge_t5')} ${q("play('sticky_idle', true)")}; __spinePreview.spine.update(0.1); ${q("play('win', false)")}; ${q("queue('win_loop', true)")}` },
      tiers: { frames: 6, every: 1, setup: `${sk('mult')} ${q("play('idle', true)")}`, drive: (f) => (f < 5 ? att('badge', `badge_t${f + 1}`) : '') },
    });
  }
} else {
  const over = (n, tr) => ({ frames: 30, every: 1, setup: `${q("play('idle', true)")}; ${q(`play('${n}', false, ${tr})`)}` });
  Object.assign(SCEN, {
    idle: { frames: 72, every: 4, setup: q("play('idle', true)") },
    heat_loop: { frames: 32, every: 1, setup: q("play('heat_loop', true)") },
    armed_loop: { frames: 30, every: 1, setup: q("play('armed_loop', true)") },
    overdrive_loop: { frames: 48, every: 2, setup: q("play('overdrive_loop', true)") },
    tick: { ...over('tick', 1), frames: 8 },
    pump: { ...over('pump', 1), frames: 10 },
    drain: { ...over('drain', 1), frames: 16 },
    threshold_minor: { ...over('threshold_minor', 2), frames: 18 },
    threshold_major: { ...over('threshold_major', 2), frames: 30 },
    boom: { frames: 15 + 18 + 10, every: 1, setup: `${q("play('charge', false)")}; ${q("queue('boom', false, 0)")}; ${q("queue('idle', true, 0)")}` },
    chained: { frames: 6 + 18 + 6, every: 1, setup: `${q("play('charge_chained', false)")}; ${q("queue('boom', false, 0)")}; ${q("queue('idle', true, 0)")}` },
    feature_trigger: { frames: 54 + 24, every: 2, setup: `${q("play('feature_trigger', false)")}; ${q("queue('overdrive_loop', true, 0)")}` },
    skins: { frames: 4, every: 1, setup: q("play('idle', true)"), drive: (f) => sk(['base', 'jukejam', 'megamix', 'bare'][f]) },
  });
}
let scenarios = (args.scenarios ?? 'all').split(',');
if (scenarios.includes('all')) scenarios = Object.keys(SCEN);

if ((process.env.TMPDIR ?? '').length > 60) process.env.TMPDIR = '/tmp';
const extraRoots = {};
const urlFor = (file) => {
  const rel = path.relative(REPO, file);
  if (!rel.startsWith('..')) return `/${rel.split(path.sep).join('/')}`;
  const key = `/__ext${Object.keys(extraRoots).length}/`;
  extraRoots[key] = path.dirname(file);
  return `${key}${path.basename(file)}`;
};
const skelUrl = urlFor(skel);
const atlasUrl = urlFor(atlas);
const server = await startServer({ port: 0, extraRoots });
const browser = await launchBrowser();
let failed = false;
const trace = { skeleton: path.relative(REPO, skel), scenarios: {} };
try {
  const vw = size;
  const vh = isUi ? Math.round(size * 1.18) : size;
  const page = await browser.newPage({ viewport: { width: vw + 40, height: vh + 40 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const url = `${server.url}/tools/spine/preview/index.html?capture=1&mode=symbol&size=${size}&w=${vw}&h=${vh}&zoom=${zoom}&kick=${kick}${isUi ? '&guides=0&bg=1b0d2e' : ''}&skel=${encodeURIComponent(skelUrl)}&atlas=${encodeURIComponent(atlasUrl)}`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__spinePreview?.ready === true, null, { timeout: 60000 }).catch(() => {});
  if (!(await page.evaluate(() => window.__spinePreview?.ready === true))) throw new Error(`preview did not load: ${errs.join(' | ')}`);
  const info = await page.evaluate(() => window.__spinePreview.info);
  // Bass Drop mixes (ANIMATION_SET 2.6 / 3) on top of the preview's contract mixes
  await page.evaluate(() => {
    const d = window.__spinePreview.spine.state.data;
    const has = (n) => !!d.skeletonData.findAnimation(n);
    const set = (a, b, t) => has(a) && has(b) && d.setMix(a, b, t);
    set('drop_launch', 'drop_fall', 0); set('drop_fall', 'drop_impact', 0.03); set('drop_impact', 'idle', 0.1);
    set('drop_impact', 'sticky_lock', 0); set('sticky_lock', 'sticky_idle', 0); set('sticky_idle', 'win', 0.06);
    set('win_loop', 'mult_up', 0.05); set('mult_up', 'sticky_idle', 0.05); set('sticky_idle', 'mult_up', 0.05);
    set('sticky_idle', 'sticky_unlock', 0.05); set('sticky_idle', 'explode', 0.05);
    set('charge', 'boom', 0); set('charge_chained', 'boom', 0); set('boom', 'idle', 0.1); set('feature_trigger', 'overdrive_loop', 0);
  });
  console.log(`capture_bd: ${info.skeleton} ${info.animations.map((a) => `${a.name}:${a.frames}f`).join(' ')}`);
  fs.mkdirSync(out, { recursive: true });
  const canvas = page.locator('canvas');
  for (const name of scenarios) {
    const sc = SCEN[name];
    if (!sc) throw new Error(`unknown scenario ${name} (${Object.keys(SCEN).join(', ')})`);
    const dir = path.join(out, name);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    await page.evaluate(`__spinePreview.reset(); __spinePreview.spine.skeleton.setSkin('${isUi ? 'base' : 'default'}'); __spinePreview.spine.skeleton.setupPoseSlots(); ${sc.setup}`);
    const shots = [];
    const probes = [];
    for (let f = 0; f < sc.frames; f++) {
      if (sc.drive) {
        const d = sc.drive(f);
        if (d) await page.evaluate(d);
      }
      const p = await page.evaluate(() => {
        const a = window.__spinePreview.step(1 / 60);
        const b = window.__spinePreview.step(1 / 60);
        const st = window.__spinePreview.spine.state;
        const cur = [0, 1, 2].map((i) => st.tracks[i]?.animation?.name).filter(Boolean).join('+');
        return { ...b, events: [...a.events, ...b.events], anim: cur };
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
    console.log(`capture_bd: ${name}: ${shots.length} frames -> ${path.relative(process.cwd(), sheet)}`);
  }
  if (errs.length) {
    console.error(`capture_bd: page errors:\n  ${errs.join('\n  ')}`);
    failed = true;
  }
  fs.writeFileSync(path.join(out, 'trace.json'), `${JSON.stringify(trace)}\n`);
} catch (e) {
  console.error(`capture_bd: ${e.stack || e}`);
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
  add('squash sy (0.6..1.4)', '#ffd54a', (p) => p.squashSY, 0.6, 1.4);
  add('squash sx (0.6..1.4)', '#ff9a3a', (p) => p.squashSX, 0.6, 1.4);
  add('body scale (0.6..1.4)', '#35f2e0', (p) => p.bodyS, 0.6, 1.4);
  const ev = probes.map((p, i) => (p.events.length ? `<line x1="${xs(i)}" x2="${xs(i)}" y1="4" y2="${PH - 16}" stroke="#fff" stroke-dasharray="3 3"/><text x="${xs(i) + 3}" y="${PH - 4}" fill="#fff">${p.events.map((e) => e.name).join(',')}</text>` : '')).join('');
  const pg = await browser.newPage({ viewport: { width: W, height: 300 } });
  await pg.setContent(`<style>body{margin:0;background:#111;padding:6px;font:11px monospace;color:#ddd}h1{font:600 13px monospace;margin:0 0 4px}
    .g{display:grid;grid-template-columns:repeat(${cols},${tileW}px);gap:6px}figure{margin:0}img{width:${tileW}px;height:${tileH}px;display:block}
    figcaption{padding:1px 0;white-space:nowrap;overflow:hidden}b{color:#ffd54a}i{color:#8ab4ff;font-style:normal}svg text{font:11px monospace}</style>
    <h1>${title}</h1><svg width="${PW}" height="${PH}" style="background:#1a0b33;display:block;margin:6px 0">${ev}${lines.join('')}</svg><div class="g">${figs}</div>`);
  await pg.screenshot({ path: file, fullPage: true });
  await pg.close();
}
