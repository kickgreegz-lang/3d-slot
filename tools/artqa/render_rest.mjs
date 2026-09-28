#!/usr/bin/env node
/**
 * Render Spine rigs on the real runtime (pixi.js + spine-pixi-v8, through tools/spine/preview) to
 * straight-alpha PNGs, for the art-direction contact sheets (tools/artqa/contact_sheet.py).
 *
 *   node tools/artqa/render_rest.mjs [--jobs jobs.json]   (default: every Bass Drop rig -> build/qa/artqa/rest)
 *
 * jobs.json: [{ "skel": "...json", "atlas": "...atlas", "out": "x.png", "w": 420, "h": 420,
 *               "x": 210, "y": 210, "zoom": 1, "skin": "default", "attach": {"slot": "att"},
 *               "anim": "idle", "t": 0.5 }]
 * The root is placed at (x, y) canvas px with scale `zoom` (y down). Every job is drawn twice, on
 * black and on white, and the alpha is recovered from the difference (exact for the PMA renderer):
 * a = 1 - (white - black) / 255, colour = black / a. Default pose: the setup pose (no animation).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, parseArgs } from '../capture/browser.mjs';
import { startServer } from '../spine/preview/serve.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = parseArgs();
// default set: every Bass Drop rig in its setup pose, as tools/artqa/contact_sheet.py expects (build/qa/artqa/rest)
const R = 'build/qa/artqa/rest';
const bd = (s, extra = {}) => ({ skel: `build/spine/bd/${s}.json`, atlas: `build/spine/bd/${s}.atlas`, ...extra });
const chr = (m, extra = {}) => ({ skel: `art/source/mascots/${m}/spine/chr_${m}.json`, atlas: `art/source/mascots/${m}/spine/chr_${m}.atlas`, ...extra });
const DEFAULT_JOBS = [
  ...['H1', 'H2', 'H3', 'H4', 'W'].map((s) => bd(`sym_${s}`, { out: `${R}/sym_${s}.png`, w: 360, h: 360, x: 180, y: 180 })),
  bd('sym_W', { out: `${R}/sym_W_mult_t3.png`, w: 360, h: 360, x: 180, y: 180, skin: 'mult', attach: { badge: 'badge_t3' } }),
  ...['base', 'jukejam', 'megamix'].map((k) => bd('ui_groove_meter', { out: `${R}/ui_groove_meter_${k}.png`, w: 720, h: 870, x: 360, y: 425, skin: k })),
  bd('env_speaker_stack', { out: `${R}/env_speaker_stack.png`, w: 660, h: 680, x: 330, y: 672 }),
  chr('gumbo', { out: `${R}/chr_gumbo.png`, w: 720, h: 920, x: 440, y: 905 }),
  chr('croak', { out: `${R}/chr_croak.png`, w: 760, h: 1120, x: 350, y: 1110 }),
  chr('gumbo', { out: `${R}/chr_gumbo_idle.png`, w: 720, h: 920, x: 440, y: 905, anim: 'idle', t: 0.8 }),
  chr('croak', { out: `${R}/chr_croak_idle.png`, w: 760, h: 1120, x: 350, y: 1110, anim: 'idle', t: 0.8 }),
];
const jobs = args.jobs ? JSON.parse(fs.readFileSync(path.resolve(args.jobs), 'utf8')) : DEFAULT_JOBS;
if ((process.env.TMPDIR ?? '').length > 60) process.env.TMPDIR = '/tmp';
const url = (f) => `/${path.relative(REPO, path.resolve(f)).split(path.sep).join('/')}`;
const server = await startServer({ port: 0 });
const browser = await launchBrowser();
let failed = false;
try {
  for (const j of jobs) {
    const w = j.w ?? 420;
    const h = j.h ?? 420;
    const page = await browser.newPage({ viewport: { width: w + 40, height: h + 40 }, deviceScaleFactor: 1 });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    const mode = j.mode ?? 'symbol';
    await page.goto(`${server.url}/tools/spine/preview/index.html?capture=1&guides=0&bg=000000&mode=${mode}&w=${w}&h=${h}&size=${Math.max(w, h)}&skel=${encodeURIComponent(url(j.skel))}&atlas=${encodeURIComponent(url(j.atlas))}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__spinePreview?.ready === true, null, { timeout: 60000 }).catch(() => {});
    if (!(await page.evaluate(() => window.__spinePreview?.ready === true))) throw new Error(`${j.skel}: preview did not load: ${errs.join(' | ')}`);
    await page.evaluate((j) => {
      const P = window.__spinePreview;
      P.reset();
      const sk = P.spine.skeleton;
      if (j.skin) { sk.setSkin(j.skin); sk.setupPoseSlots(); }
      for (const [s, a] of Object.entries(j.attach ?? {})) sk.setAttachment(s, a);
      if (j.anim) {
        P.play(j.anim, true);
        const n = Math.round((j.t ?? 0) * 60);
        for (let i = 0; i < n; i++) P.step(1 / 60);
      }
      P.spine.update(0); // spine-pixi refreshes slot attachments on update()
      const holder = P.spine.parent;
      holder.position.set(j.x, j.y);
      holder.scale.set(j.zoom ?? 1);
    }, j);
    const shot = async (color) => {
      await page.evaluate((c) => { const a = window.__spinePreview.app; a.renderer.background.color = c; a.render(); }, color);
      return (await page.locator('canvas').screenshot()).toString('base64');
    };
    const b64B = await shot(0x000000);
    const b64W = await shot(0xffffff);
    // difference matte in a 2D canvas (no PNG codec needed in node)
    const dataUrl = await page.evaluate(async ([b, w]) => {
      const load = (s) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = `data:image/png;base64,${s}`; });
      const [ib, iw] = await Promise.all([load(b), load(w)]);
      const c = document.createElement('canvas');
      c.width = ib.width; c.height = ib.height;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(ib, 0, 0); const B = g.getImageData(0, 0, c.width, c.height);
      g.clearRect(0, 0, c.width, c.height);
      g.drawImage(iw, 0, 0); const W = g.getImageData(0, 0, c.width, c.height);
      const o = g.createImageData(c.width, c.height);
      for (let i = 0; i < B.data.length; i += 4) {
        const d = ((W.data[i] - B.data[i]) + (W.data[i + 1] - B.data[i + 1]) + (W.data[i + 2] - B.data[i + 2])) / 3;
        const a = Math.max(0, Math.min(255, 255 - d));
        const k = a > 0 ? 255 / a : 0;
        o.data[i] = Math.min(255, Math.round(B.data[i] * k));
        o.data[i + 1] = Math.min(255, Math.round(B.data[i + 1] * k));
        o.data[i + 2] = Math.min(255, Math.round(B.data[i + 2] * k));
        o.data[i + 3] = Math.round(a);
      }
      // putImageData keeps straight alpha; toDataURL writes it unpremultiplied
      g.clearRect(0, 0, c.width, c.height);
      g.putImageData(o, 0, 0);
      return c.toDataURL('image/png');
    }, [b64B, b64W]);
    fs.mkdirSync(path.dirname(path.resolve(j.out)), { recursive: true });
    fs.writeFileSync(path.resolve(j.out), Buffer.from(dataUrl.split(',')[1], 'base64'));
    if (errs.length) { console.error(`${j.out}: page errors: ${errs.join(' | ')}`); failed = true; }
    console.log(`render_rest: ${path.relative(REPO, path.resolve(j.out))}`);
    await page.close();
  }
} catch (e) {
  console.error(e.stack || e);
  failed = true;
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
