#!/usr/bin/env node
/**
 * Board sprite = the rig's SETUP POSE rendered on the real runtime (pixi.js + spine-pixi-v8, through
 * tools/spine/preview) on the 360 x 360 @2x canvas, root at the centre, 1 skeleton unit = 1 px: the runtime's
 * static -> Spine swap (SymbolRig.placeSpine: scale tex.width / 360) cannot pop. The approach of
 * tools/artqa/render_rest.mjs (each frame drawn on black and on white, alpha recovered from the difference, exact
 * for the PMA renderer), plus the live-text stand-in: a skeleton with a `txt_wild` slot gets the game's BitmapText
 * (src/games/magpie-heist/glint/wildWord.json, the same style WildText.ts mounts) in that slot, so the baked word
 * sits exactly where the live one will.
 *
 *   node tools/mhart/rigs/render_board.mjs --skel build/spine/mh/sym_W.json --atlas build/spine/mh/sym_W.atlas \
 *        --out art/source/magpie-heist/symbols/W/board.png [--no-text]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, parseArgs } from '../../capture/browser.mjs';
import { startServer } from '../../spine/preview/serve.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = parseArgs();
if (!args.skel || !args.out) {
  console.error('usage: render_board.mjs --skel <json> --atlas <atlas> --out <png> [--no-text]');
  process.exit(2);
}
const skel = path.resolve(args.skel);
const atlas = path.resolve(args.atlas ?? skel.replace(/\.json$/, '.atlas'));
const out = path.resolve(args.out);
const WORD = path.join(REPO, 'src/games/magpie-heist/glint/wildWord.json');
const sk = JSON.parse(fs.readFileSync(skel, 'utf8'));
const word = !args['no-text'] && fs.existsSync(WORD) ? JSON.parse(fs.readFileSync(WORD, 'utf8')) : null;
const mountWord = word && (sk.slots ?? []).some((s) => s.name === word.slot) ? word : null;
if ((process.env.TMPDIR ?? '').length > 60) process.env.TMPDIR = '/tmp';
const url = (f) => `/${path.relative(REPO, f).split(path.sep).join('/')}`;
const server = await startServer({ port: 0 });
const browser = await launchBrowser();
let failed = false;
try {
  const W = 360;
  const page = await browser.newPage({ viewport: { width: W + 40, height: W + 40 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${server.url}/tools/spine/preview/index.html?capture=1&guides=0&bg=000000&mode=symbol&w=${W}&h=${W}&size=${W}&skel=${encodeURIComponent(url(skel))}&atlas=${encodeURIComponent(url(atlas))}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__spinePreview?.ready === true, null, { timeout: 60000 }).catch(() => {});
  if (!(await page.evaluate(() => window.__spinePreview?.ready === true))) throw new Error(`preview did not load: ${errs.join(' | ')}`);
  await page.evaluate(async (w) => {
    const P = window.__spinePreview;
    P.reset();
    if (w) {
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
      P.spine.addSlotObject(w.slot, holder);
    }
    P.spine.update(0);
    const holder = P.spine.parent;
    holder.position.set(180, 180);
    holder.scale.set(1);
  }, mountWord);
  const shot = async (color) => {
    await page.evaluate((c) => { const a = window.__spinePreview.app; a.renderer.background.color = c; a.render(); }, color);
    return (await page.locator('canvas').screenshot()).toString('base64');
  };
  const b64B = await shot(0x000000);
  const b64W = await shot(0xffffff);
  const dataUrl = await page.evaluate(async ([b, w]) => {
    const load = (s) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = `data:image/png;base64,${s}`; });
    const [ib, iw] = await Promise.all([load(b), load(w)]);
    const c = document.createElement('canvas');
    c.width = ib.width; c.height = ib.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(ib, 0, 0); const B = g.getImageData(0, 0, c.width, c.height);
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(iw, 0, 0); const Wd = g.getImageData(0, 0, c.width, c.height);
    const o = g.createImageData(c.width, c.height);
    for (let i = 0; i < B.data.length; i += 4) {
      const d = ((Wd.data[i] - B.data[i]) + (Wd.data[i + 1] - B.data[i + 1]) + (Wd.data[i + 2] - B.data[i + 2])) / 3;
      const a = Math.max(0, Math.min(255, 255 - d));
      const k = a > 0 ? 255 / a : 0;
      o.data[i] = Math.min(255, Math.round(B.data[i] * k));
      o.data[i + 1] = Math.min(255, Math.round(B.data[i + 1] * k));
      o.data[i + 2] = Math.min(255, Math.round(B.data[i + 2] * k));
      o.data[i + 3] = Math.round(a);
    }
    g.clearRect(0, 0, c.width, c.height);
    g.putImageData(o, 0, 0);
    return c.toDataURL('image/png');
  }, [b64B, b64W]);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
  if (errs.length) {
    console.error(`render_board: page errors: ${errs.join(' | ')}`);
    failed = true;
  }
  console.log(`render_board: ${path.relative(REPO, out)}${mountWord ? ` (+ "${mountWord.text}" in ${mountWord.slot})` : ''}`);
} catch (e) {
  console.error(e.stack || e);
  failed = true;
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
