#!/usr/bin/env node
/**
 * Contact sheets for the Magpie Heist rigs on the real runtime (pixi.js + spine-pixi-v8), through the stock preview
 * page (tools/spine/preview/index.html + preview.mjs, window.__spinePreview). Adapted from
 * tools/spine/examples/bass_drop/capture_bd.mjs: the contract scenarios, the anticipation sequence the runtime plays
 * (intro -> loop -> out), and a live "WILD" BitmapText mounted in `txt_wild` (addSlotObject, the style the game uses:
 * src/games/magpie-heist/glint/wildWord.json) whenever the skeleton has that slot.
 *
 *   node tools/mhart/rigs/capture_mh.mjs --skel build/spine/mh/sym_H1.json --atlas build/spine/mh/sym_H1.atlas \
 *        --out build/qa/rigs/mh_sym_H1/capture [--scenarios land,win,...|all] [--tile 196] [--size 420] [--kick -27]
 *
 * Scenarios: land (runtime-like reel stop: blur fall, physics kick, land -> idle), win (win -> win_loop), explode,
 *   idle, anticipation (anticipation_intro -> anticipation x2 -> anticipation_out, when the rig has them), appear, blur,
 *   rest (the setup pose next to the shipped board sprite when --board is given).
 * The default tile (196 px for a 420 px canvas) shows the 300-unit cell at 140 px: the game's landscape cell.
 * Each frame is rendered at an exact 1/60 s step (two per 30 fps frame); every sheet shows frame, ms and events.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, parseArgs } from '../../capture/browser.mjs';
import { startServer } from '../../spine/preview/serve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const args = parseArgs();
if (args.help || !args.skel) {
  const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
  console.log(src.slice(src.indexOf('/**') + 3, src.indexOf('*/')).replace(/^ \* ?/gm, '').trim());
  process.exit(args.help ? 0 : 2);
}
const skel = path.resolve(args.skel);
const atlas = path.resolve(args.atlas ?? skel.replace(/\.json$/, '.atlas'));
const out = path.resolve(args.out ?? path.join(REPO, 'build/qa/rigs', `mh_${path.basename(skel, '.json')}`, 'capture'));
const size = Number(args.size ?? 420);
const tile = Number(args.tile ?? 196);
const kick = Number(args.kick ?? -27);
const WORD = path.join(REPO, 'src/games/magpie-heist/glint/wildWord.json');
const word = fs.existsSync(WORD) ? JSON.parse(fs.readFileSync(WORD, 'utf8')) : null;
const skelJson = JSON.parse(fs.readFileSync(skel, 'utf8'));
const hasTxt = (skelJson.slots ?? []).some((s) => s.name === 'txt_wild');

const q = (s) => `__spinePreview.${s}`;
const SCEN = {
  land: { frames: 30, every: 1, setup: q(`drop({ from: 220, frames: 6, kick: ${kick} })`) },
  win: { frames: 72, every: 2, setup: `${q("play('win', false)")}; ${q("queue('win_loop', true)")}` },
  explode: { frames: 17, every: 1, setup: q("play('explode', false)") },
  idle: { frames: 80, every: 4, setup: q("play('idle', false)") },
  appear: { frames: 11, every: 1, setup: q("play('appear', false)") },
  blur: { frames: 2, every: 1, setup: q("play('blur', true)") },
};
/** anticipation as the runtime plays it: intro -> loop (x2) -> out (SymbolRig.anticipate on / off) */
const anticipationScenario = (frames) => {
  const intro = frames.anticipation_intro ?? 0;
  const loopF = frames.anticipation;
  const outF = frames.anticipation_out ?? 0;
  const total = intro + 2 * loopF + (outF ? outF + 4 : 0);
  return {
    frames: total,
    every: 1,
    setup: intro ? `${q("play('anticipation_intro', false)")}; ${q("queue('anticipation', true, 0)")}` : q("play('anticipation', true)"),
    drive: outF ? (f) => (f === intro + 2 * loopF ? q("play('anticipation_out', false)") : '') : null,
  };
};
let scenarios = (args.scenarios ?? 'all').split(',');

if ((process.env.TMPDIR ?? '').length > 60) process.env.TMPDIR = '/tmp';
const extraRoots = {};
const urlFor = (file) => {
  const rel = path.relative(REPO, file);
  if (!rel.startsWith('..')) return `/${rel.split(path.sep).join('/')}`;
  const key = `/__ext${Object.keys(extraRoots).length}/`;
  extraRoots[key] = path.dirname(file);
  return `${key}${path.basename(file)}`;
};
const server = await startServer({ port: 0, extraRoots });
const browser = await launchBrowser();
let failed = false;
const trace = { skeleton: path.relative(REPO, skel), scenarios: {} };
try {
  const page = await browser.newPage({ viewport: { width: size + 40, height: size + 40 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const url = `${server.url}/tools/spine/preview/index.html?capture=1&mode=symbol&size=${size}&kick=${kick}&bg=1d1238&skel=${encodeURIComponent(urlFor(skel))}&atlas=${encodeURIComponent(urlFor(atlas))}`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__spinePreview?.ready === true, null, { timeout: 60000 }).catch(() => {});
  if (!(await page.evaluate(() => window.__spinePreview?.ready === true))) throw new Error(`preview did not load: ${errs.join(' | ')}`);
  if (hasTxt && word) await mountWord(page, word);
  const info = await page.evaluate(() => window.__spinePreview.info);
  const frames = Object.fromEntries(info.animations.map((a) => [a.name, Math.round(a.frames)]));
  if (frames.anticipation) SCEN.anticipation = anticipationScenario(frames);
  if (scenarios.includes('all')) scenarios = Object.keys(SCEN);
  console.log(`capture_mh: ${info.skeleton} ${info.animations.map((a) => `${a.name}:${a.frames}f`).join(' ')}${hasTxt && word ? ' (+ live WILD in txt_wild)' : ''}`);
  fs.mkdirSync(out, { recursive: true });
  const canvas = page.locator('canvas');
  for (const name of scenarios) {
    const sc = SCEN[name];
    if (!sc) throw new Error(`unknown scenario ${name} (${Object.keys(SCEN).join(', ')})`);
    const dir = path.join(out, name);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    await page.evaluate(`__spinePreview.reset(); ${sc.setup}`);
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
    await contactSheet(browser, shots, probes, sheet, `${path.basename(skel)} · ${name} · cell = ${Math.round((tile * 300) / size)} px`, tile, tile);
    console.log(`capture_mh: ${name}: ${shots.length} frames -> ${path.relative(process.cwd(), sheet)}`);
  }
  if (errs.length) {
    console.error(`capture_mh: page errors:\n  ${errs.join('\n  ')}`);
    failed = true;
  }
  fs.writeFileSync(path.join(out, 'trace.json'), `${JSON.stringify(trace)}\n`);
} catch (e) {
  console.error(`capture_mh: ${e.stack || e}`);
  failed = true;
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);

/** The game's live WILD (BitmapText, wildWord.json style) mounted in the txt_wild slot, as SymbolRig does. */
async function mountWord(page, w) {
  const ok = await page.evaluate(async (w) => {
    const PIXI = await import('pixi.js');
    const face = new FontFace(w.fontFamily, `url(/public/assets/fonts/${w.fontFile})`);
    await face.load();
    document.fonts.add(face);
    const holder = new PIXI.Container({ label: 'wildWord' });
    const text = new PIXI.BitmapText({
      text: w.text,
      style: {
        fontFamily: w.fontFamily,
        fontSize: w.fontSize,
        fill: w.fill,
        stroke: { color: w.stroke, width: w.strokeWidth, join: 'round' },
        dropShadow: w.shadow ? { color: w.shadow, alpha: 1, blur: 0, distance: w.shadowDistance, angle: Math.PI / 2 } : undefined,
        letterSpacing: w.letterSpacing,
      },
      anchor: 0.5,
    });
    if (text.width > w.maxWidth) text.scale.set(w.maxWidth / text.width);
    text.y = w.y;
    holder.addChild(text);
    const sp = window.__spinePreview.spine;
    sp.addSlotObject('txt_wild', holder);
    sp.update(0);
    window.__spinePreview.app.render();
    return true;
  }, w);
  if (!ok) throw new Error('could not mount the WILD text');
}

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
    lines.push(`<polyline fill="none" stroke="${color}" stroke-width="2" points="${pts.map(([x, v]) => `${x.toFixed(1)},${ys(v).toFixed(1)}`).join(' ')}"/><text x="${PW - 260}" y="${16 + lines.length * 13}" fill="${color}">${label}</text>`);
  };
  add('squash sy (0.6..1.4)', '#ffd54a', (p) => p.squashSY, 0.6, 1.4);
  add('squash sx (0.6..1.4)', '#ff9a3a', (p) => p.squashSX, 0.6, 1.4);
  add('body scale (0.6..1.4)', '#35f2e0', (p) => p.bodyS, 0.6, 1.4);
  const physNames = Object.keys(probes[0]?.phys ?? {});
  const palette = ['#ff6bd6', '#9b8cff', '#7dffa0', '#ff8a8a', '#c8ff5a', '#5ad1ff'];
  physNames.forEach((nm, i) => add(`${nm} rot (-40..40)`, palette[i % palette.length], (p) => p.phys[nm]?.rot, -40, 40));
  const ev = probes.map((p, i) => (p.events.length ? `<line x1="${xs(i)}" x2="${xs(i)}" y1="4" y2="${PH - 16}" stroke="#fff" stroke-dasharray="3 3"/><text x="${xs(i) + 3}" y="${PH - 4}" fill="#fff">${p.events.map((e) => e.name).join(',')}</text>` : '')).join('');
  const pg = await browser.newPage({ viewport: { width: W, height: 300 } });
  await pg.setContent(`<style>body{margin:0;background:#111;padding:6px;font:11px monospace;color:#ddd}h1{font:600 13px monospace;margin:0 0 4px}
    .g{display:grid;grid-template-columns:repeat(${cols},${tileW}px);gap:6px}figure{margin:0}img{width:${tileW}px;height:${tileH}px;display:block}
    figcaption{padding:1px 0;white-space:nowrap;overflow:hidden}b{color:#ffd54a}i{color:#8ab4ff;font-style:normal}svg text{font:11px monospace}</style>
    <h1>${title}</h1><svg width="${PW}" height="${PH}" style="background:#1a0b33;display:block;margin:6px 0">${ev}${lines.join('')}</svg><div class="g">${figs}</div>`);
  await pg.screenshot({ path: file, fullPage: true });
  await pg.close();
}
