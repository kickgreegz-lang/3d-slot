#!/usr/bin/env node
/**
 * Deterministic Playwright capture of a Spine rig on the real runtime (pixi.js + spine-pixi-v8),
 * for AI / human motion review. Starts its own static server (tools/spine/preview/serve.mjs),
 * steps an exact 1/60 s clock, saves every 30 fps frame and a contact sheet per scenario with
 * frame number, ms, events and a motion plot (squash sy, body scale, physics bone rotations).
 *
 *   node tools/spine/preview/capture.mjs --skel public/assets/spine/demo/sym_demo.json \
 *        --atlas public/assets/spine/demo/sym_demo.atlas --out <dir> \
 *        [--scenarios land,win,explode,idle,anticipation,appear,blur] [--kick -27] [--size 420] [--tile 224]
 *   node tools/spine/preview/capture.mjs --skel build/spine/chr_gumbo.json --atlas build/spine/chr_gumbo.atlas \
 *        --out <dir> [--scenarios idle,bass_drop,fs_trigger | all] [--size 560] [--tile 200] [--every N]
 *
 * 2D characters (chr_*, ANIMATION_SET 5): any clip name is a scenario and plays with its contract loop
 * flag and track (tools/spine/contract.json characters): body clips on track 0 (one-shots, then 12
 * frames of idle hand-off), overlays additive on track 1 over idle, blink on track 2 over idle. Extra
 * scenarios: charge_drop (bass_drop_charge -> bass_drop, mix 0), look (idle while the runtime sweeps
 * ctrl_look around a circle, track 3), win_celebrate (win_big -> celebrate). `all` = every clip. The
 * sheet plots hips dx/dy, head rotation, chest scale and the springs; the pink cross is ctrl_look.
 *
 * Scenarios: land = runtime-like reel stop (blur while falling, inheritance off; at contact
 * setPositionInheritance(0, 0.6) + physicsTranslate(0, kick) + land -> idle, ANIMATION_CONTRACT 5);
 * win = win -> win_loop; others play once (loops twice). --kick is in runtime y-down units
 * (contract research value: -impact * 0.006 ~ -27; the runtime's SpineRig.impact uses -26 * squash).
 * Output: <out>/<scenario>/f_###.png, <out>/<scenario>.png (sheet), <out>/trace.json.
 * Exit 1 on page errors, missing animations or a failed load; 2 on bad arguments or missing files.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, parseArgs } from '../../capture/browser.mjs';
import { startServer } from './serve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const args = parseArgs();
if (args.help || args.h || !args.skel) {
  const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
  console.log(src.slice(src.indexOf('/**') + 3, src.indexOf('*/')).replace(/^ \* ?/gm, '').trim());
  process.exit(args.help || args.h ? 0 : 2);
}
const skel = path.resolve(args.skel);
const atlas = path.resolve(args.atlas ?? skel.replace(/\.(json|skel)$/, '.atlas'));
const out = path.resolve(args.out ?? path.join(REPO, 'build/spine/preview', path.basename(skel).replace(/\.(json|skel)$/, '')));
const size = Number(args.size ?? 420);
const tile = Number(args.tile ?? 224);
const kick = Number(args.kick ?? -27);
const CONTRACT = JSON.parse(fs.readFileSync(path.join(REPO, 'tools/spine/contract.json'), 'utf8'));
const isChar = args.mode === 'character' || (args.mode !== 'symbol' && /^chr_/.test(path.basename(skel)));
let scenarios = (args.scenarios ?? (isChar ? 'idle,bass_drop,fs_trigger' : 'land,win,explode,idle,anticipation')).split(',').filter(Boolean);
for (const [name, v] of [['size', size], ['tile', tile], ['kick', kick]]) {
  if (!Number.isFinite(v) || (name !== 'kick' && v <= 0)) {
    console.error(`capture: --${name} must be a number`);
    process.exit(2);
  }
}
if (!fs.existsSync(skel) || !fs.existsSync(atlas)) {
  console.error(`capture: not found: ${!fs.existsSync(skel) ? skel : atlas}`);
  process.exit(2);
}

// serve the repo, plus the directories of skel/atlas when they live outside it
const extraRoots = {};
const urlFor = (file) => {
  const rel = path.relative(REPO, file);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) return `/${rel.split(path.sep).join('/')}`;
  const dir = path.dirname(file);
  let key = Object.keys(extraRoots).find((k) => extraRoots[k] === dir);
  if (!key) {
    key = `/__ext${Object.keys(extraRoots).length}/`;
    extraRoots[key] = dir;
  }
  return `${key}${path.basename(file)}`;
};
const skelUrl = urlFor(skel);
const atlasUrl = urlFor(atlas);
const server = await startServer({ port: Number(args.port ?? 0), extraRoots });
// characters: portrait canvas (the figure is ~0.6-0.9 as wide as tall)
const vw = isChar ? Math.round(size * 0.78) : size;
const vh = size;
const tileW = tile;
const tileH = Math.round((tile * vh) / vw);

const SCEN = {
  land: { frames: 34, every: 1, setup: `__spinePreview.drop({ from: 220, frames: 6, kick: ${kick} })` },
  win: { frames: 66, every: 2, setup: `__spinePreview.play('win', false); __spinePreview.queue('win_loop', true)`, needs: ['win', 'win_loop'] },
  explode: { frames: 15, every: 1, setup: `__spinePreview.play('explode', false)`, needs: ['explode'] },
  idle: { frames: 92, every: 6, setup: `__spinePreview.play('idle', true)`, needs: ['idle'] },
  anticipation: { frames: 34, every: 2, setup: `__spinePreview.play('anticipation', true)`, needs: ['anticipation'] },
  appear: { frames: 12, every: 1, setup: `__spinePreview.play('appear', false)`, needs: ['appear'] },
  blur: { frames: 4, every: 1, setup: `__spinePreview.play('blur', true)`, needs: ['blur'] },
};

let failed = false;
// Chromium keeps a unix socket in its profile dir under TMPDIR; long TMPDIRs (> ~100 chars of
// socket path) make it die with SIGTRAP at launch, so fall back to /tmp for the browser profile.
if ((process.env.TMPDIR ?? '').length > 60) process.env.TMPDIR = '/tmp';
let browser;
try {
  browser = await launchBrowser();
} catch (e) {
  console.error(`capture: cannot launch Chromium: ${String(e.message).split('\n')[0]}`);
  await server.close();
  process.exit(1);
}
const trace = { skeleton: path.relative(REPO, skel), atlas: path.relative(REPO, atlas), kick, scenarios: {} };
try {
  const page = await browser.newPage({ viewport: { width: vw + 40, height: vh + 40 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push(m.text());
  });
  const url = `${server.url}/tools/spine/preview/index.html?capture=1&size=${size}&w=${vw}&h=${vh}&kick=${kick}${isChar ? '&mode=character' : ''}&skel=${encodeURIComponent(skelUrl)}&atlas=${encodeURIComponent(atlasUrl)}`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__spinePreview?.ready === true, null, { timeout: 60_000 }).catch(() => {});
  const ready = await page.evaluate(() => window.__spinePreview?.ready === true);
  if (!ready) throw new Error(`preview did not load: ${pageErrors.join(' | ') || 'timeout'}`);
  const info = await page.evaluate(() => window.__spinePreview.info);
  trace.info = info;
  console.log(`capture: ${info.skeleton} (spine ${info.version}) ${info.animations.map((a) => `${a.name}:${a.frames}f`).join(' ')}`);
  const canvas = page.locator('canvas');
  fs.mkdirSync(out, { recursive: true });
  if (isChar) {
    const rig = CONTRACT.characters?.rigs?.[info.skeleton.split('/').pop().replace(/\.(json|skel)$/, '')] ?? {};
    const rule = (n) => ({ ...(CONTRACT.characters?.clips?.[n] ?? {}), ...(rig.clips?.[n] ?? {}) });
    const has = (n) => info.animations.some((a) => a.name === n);
    const len = (n) => info.animations.find((a) => a.name === n)?.frames ?? 0;
    const every = (f) => Number(args.every ?? Math.max(1, Math.round(f / 24)));
    for (const a of info.animations) {
      const r = rule(a.name);
      const f = Math.round(a.frames);
      if (r.track === 1) SCEN[a.name] = { frames: f + 8, every: 1, setup: `__spinePreview.play('idle', true); __spinePreview.play('${a.name}', false, 1, true)`, needs: ['idle', a.name] };
      else if (r.track === 2) SCEN[a.name] = { frames: f + 4, every: 1, setup: `__spinePreview.play('idle', true); __spinePreview.play('${a.name}', false, 2)`, needs: ['idle', a.name] };
      else if (r.loop) SCEN[a.name] = { frames: f, every: every(f), setup: `__spinePreview.play('${a.name}', true)`, needs: [a.name] };
      else SCEN[a.name] = { frames: f + 12, every: every(f + 12), setup: `__spinePreview.play('${a.name}', false); __spinePreview.queue('idle', true, 0)`, needs: [a.name, 'idle'] };
    }
    if (has('bass_drop_charge') && has('bass_drop')) {
      const f = Math.round(len('bass_drop_charge') + len('bass_drop')) + 10;
      SCEN.charge_drop = { frames: f, every: every(f), setup: `__spinePreview.play('bass_drop_charge', false); __spinePreview.queue('bass_drop', false, 0); __spinePreview.queue('idle', true, 0)`, needs: ['bass_drop_charge', 'bass_drop', 'idle'] };
    }
    SCEN.look = { frames: 96, every: 4, setup: `__spinePreview.play('idle', true)`, needs: ['idle'], drive: (f) => `__spinePreview.look(${(300 * Math.cos((2 * Math.PI * f) / 96)).toFixed(1)}, ${(220 * Math.sin((2 * Math.PI * f) / 96)).toFixed(1)})` };
    if (has('win_big') && has('celebrate')) {
      const f = Math.round(len('win_big') + 36);
      SCEN.win_celebrate = { frames: f, every: every(f), setup: `__spinePreview.play('win_big', false); __spinePreview.queue('celebrate', true, 0)`, needs: ['win_big', 'celebrate'] };
    }
    if (scenarios.includes('all')) scenarios = [...info.animations.map((a) => a.name), 'charge_drop', 'look', 'win_celebrate'].filter((n) => SCEN[n]);
  }

  for (const name of scenarios) {
    const sc = SCEN[name];
    if (!sc && isChar && ['charge_drop', 'look', 'win_celebrate'].includes(name)) {
      console.log(`capture: ${name}: not applicable to this rig (its clips are missing), skipped`);
      continue;
    }
    if (!sc) throw new Error(`unknown scenario ${name} (${Object.keys(SCEN).join(', ')})`);
    const missing = (sc.needs ?? []).filter((n) => !info.animations.some((a) => a.name === n));
    if (missing.length) {
      console.error(`capture: ${name}: missing animation(s) ${missing.join(', ')}`);
      failed = true;
      continue;
    }
    const dir = path.join(out, name);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    await page.evaluate(`__spinePreview.reset(); ${sc.setup}`);
    const shots = [];
    const probes = [];
    for (let f = 0; f < sc.frames; f++) {
      if (sc.drive) await page.evaluate(sc.drive(f));
      // two 60 Hz physics steps per 30 fps frame (same as the runtime at 60 fps)
      const p = await page.evaluate(() => {
        const a = window.__spinePreview.step(1 / 60);
        const b = window.__spinePreview.step(1 / 60);
        return { ...b, events: [...a.events, ...b.events] };
      });
      p.frame = f + 1; // frames elapsed (30 fps) when this image was taken
      probes.push(p);
      if (f % sc.every === 0 || p.events.length) {
        const file = path.join(dir, `f_${String(p.frame).padStart(3, '0')}.png`);
        await canvas.screenshot({ path: file });
        shots.push({ file, frame: p.frame, ms: p.t, events: p.events.map((e) => e.name + (e.string ? `:${e.string}` : '')) });
      }
    }
    trace.scenarios[name] = probes;
    const sheet = path.join(out, `${name}.png`);
    await contactSheet(browser, shots, probes, sheet, { title: `${path.basename(skel)} · ${name}${isChar ? '' : ` · kick ${kick}`}`, tileW, tileH, isChar });
    console.log(`capture: ${name}: ${shots.length} frames -> ${path.relative(process.cwd(), sheet)}`);
  }
  if (pageErrors.length) {
    console.error(`capture: page errors:\n  ${pageErrors.join('\n  ')}`);
    failed = true;
  }
  fs.writeFileSync(path.join(out, 'trace.json'), `${JSON.stringify(trace, null, 1)}\n`);
} catch (e) {
  console.error(`capture: ${e.stack || e}`);
  failed = true;
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);

// ---------------------------------------------------------------------------- contact sheet
async function contactSheet(browser, shots, probes, file, { title, tileW, tileH, isChar = false }) {
  const tile = tileW;
  const cols = Math.min(8, Math.max(4, Math.ceil(Math.sqrt(shots.length * 1.6))));
  const W = cols * (tile + 6) + 12;
  const figs = shots
    .map((s) => {
      const b64 = fs.readFileSync(s.file).toString('base64');
      const ev = s.events.length ? `<b>${s.events.join(' ')}</b>` : '';
      return `<figure><img src="data:image/png;base64,${b64}"/><figcaption>f${s.frame} · ${s.ms}ms ${ev}</figcaption></figure>`;
    })
    .join('');
  // motion plot
  const PW = W - 24;
  const PH = 150;
  const n = probes.length;
  const xs = (i) => 30 + (i / Math.max(1, n - 1)) * (PW - 40);
  const series = [];
  const add = (label, color, get, lo, hi) => {
    const pts = probes.map((p, i) => [xs(i), get(p)]).filter(([, v]) => v !== null && v !== undefined && Number.isFinite(v));
    if (!pts.length) return;
    const ys = (v) => 10 + (1 - (v - lo) / (hi - lo)) * (PH - 30);
    series.push(`<polyline fill="none" stroke="${color}" stroke-width="2" points="${pts.map(([x, v]) => `${x.toFixed(1)},${ys(Math.max(lo, Math.min(hi, v))).toFixed(1)}`).join(' ')}"/>`);
    series.push(`<text x="${PW - 240}" y="${16 + series.length * 7}" fill="${color}">${label}</text>`);
  };
  if (isChar) {
    add('hips dy (-60..20)', '#ffd54a', (p) => p.hipsDY, -60, 20);
    add('hips dx (-40..40)', '#ffa040', (p) => p.hipsDX, -40, 40);
    add('head rot (-30..30°)', '#35f2e0', (p) => p.headRot, -30, 30);
    add('chest scale (0.95..1.1)', '#ffffff', (p) => p.chestS, 0.95, 1.1);
  } else {
    add('squash sy (0.8..1.3)', '#ffd54a', (p) => p.squashSY, 0.8, 1.3);
    add('body scale (0.8..1.3)', '#35f2e0', (p) => p.bodyS, 0.8, 1.3);
  }
  let physNames = Object.keys(probes[0]?.phys ?? {});
  if (isChar) {
    // one curve per spring chain: its tip (phys_tail_4, phys_chain_3, ...), at most 4
    const tips = new Map();
    for (const n of physNames) tips.set(n.replace(/_\d+$/, ''), n);
    physNames = [...tips.values()].slice(0, 4);
  }
  const colors = ['#ff5a9e', '#9a7bff', '#7dff8a', '#ff8a3a'];
  physNames.forEach((nm, i) => {
    const rot = probes[0].phys[nm].mode === 'rotate';
    if (rot) add(`${nm} rot (-40..40°)`, colors[i % 4], (p) => p.phys[nm].rot, -40, 40);
    else add(`${nm} dy (-20..20)`, colors[i % 4], (p) => p.phys[nm].dy, -20, 20);
  });
  const evMarks = probes
    .map((p, i) => (p.events.length ? `<line x1="${xs(i)}" x2="${xs(i)}" y1="4" y2="${PH - 16}" stroke="#fff" stroke-dasharray="3 3" opacity=".6"/><text x="${xs(i) + 3}" y="${PH - 4}" fill="#fff">${p.events.map((e) => e.name).join(',')}</text>` : ''))
    .join('');
  const ticks = probes.map((p, i) => (p.frame % 5 === 0 ? `<text x="${xs(i) - 4}" y="${PH - 18}" fill="#888" font-size="9">${p.frame}</text>` : '')).join('');
  const plot = `<svg width="${PW}" height="${PH}" style="background:#1a0b33;display:block;margin:6px 0">${ticks}${evMarks}${series.join('')}</svg>`;
  const page = await browser.newPage({ viewport: { width: W, height: 300 } });
  await page.setContent(`<style>body{margin:0;background:#111;padding:6px;font:11px monospace;color:#ddd}h1{font:600 13px monospace;margin:0 0 4px}
    .g{display:grid;grid-template-columns:repeat(${cols},${tile}px);gap:6px}figure{margin:0}img{width:${tile}px;height:${tileH}px;display:block}
    figcaption{padding:1px 0}b{color:#ffd54a;font-weight:600}svg text{font:11px monospace}</style>
    <h1>${title.replace(/</g, '&lt;')}</h1>${plot}<div class="g">${figs}</div>`);
  await page.screenshot({ path: file, fullPage: true });
  await page.close();
}
