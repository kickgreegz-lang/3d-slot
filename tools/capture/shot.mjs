#!/usr/bin/env node
/**
 * Deterministic visual capture for AI/human review of animations.
 *
 *   node tools/capture/shot.mjs --url "http://localhost:5173/?dev=lab" --out screenshots/land \
 *        [--viewport 1920x1080] [--script "await __slot.emit('board:reveal', {...})"] \
 *        [--frames 90] [--step 16.667] [--every 3] [--sheet] [--cols 6] [--wait 0]
 *        [--scenario tumbleChain] [--until-done] [--tail 30] [--hmr]
 *
 * - Waits for window.__slot.ready (in ?dev=lab|gallery: once the lab is built), switches the
 *   game clock to MANUAL, then (optionally) starts --script WITHOUT awaiting it (so animations
 *   can be stepped), and steps --frames frames of --step ms, saving every --every-th frame as PNG.
 * - --frames 0 => single screenshot after the script resolves.
 * - --sheet => also writes <out>/sheet.png contact sheet (frame number + ms under each tile).
 * - --scenario <name> => shorthand for --script "await __slot.scenario('<name>')" (DEV lab API).
 * - --until-done => stop stepping --tail frames after the script promise settles
 *   (--frames is then the upper bound).
 * - Vite's HMR socket is stubbed so edits elsewhere in the tree can't reload the page
 *   mid-capture; pass --hmr to keep live reload.
 * Exits non-zero on page errors. Uses the preinstalled Chromium with SwiftShader WebGL2.
 */
import fs from 'node:fs';
import path from 'node:path';
import { contactSheet, launchBrowser, openGame, parseArgs, parseViewport } from './browser.mjs';

const args = parseArgs();
const url = args.url ?? 'http://localhost:5173/';
const out = args.out ?? 'screenshots/shot';
const viewport = parseViewport(args.viewport);
const frames = Number(args.frames ?? 0);
const step = Number(args.step ?? 1000 / 60);
const every = Math.max(1, Number(args.every ?? 1));
const waitMs = Number(args.wait ?? 0);
const tail = Number(args.tail ?? 30);
const script = args.scenario ? `await __slot.scenario(${JSON.stringify(args.scenario)})` : args.script;
fs.mkdirSync(out, { recursive: true });

const browser = await launchBrowser();
const { page, errors } = await openGame(browser, url, {
  viewport,
  blockHmr: args.hmr !== 'true',
  onConsole: (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`[page:${m.type()}]`, m.text());
  },
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
if (waitMs) await page.waitForTimeout(waitMs);

const shots = [];
if (frames > 0) {
  await page.evaluate(() => window.__slot.manual(true));
  if (script) {
    await page.evaluate(
      `window.__captureDone = false; window.__capturePromise = (async () => { ${script} })()` +
        `.catch((e) => { window.__captureError = String(e && e.stack || e); })` +
        `.finally(() => { window.__captureDone = true; })`,
    );
  }
  let doneAt = -1;
  for (let i = 0; i < frames; i++) {
    await page.evaluate((ms) => window.__slot.step(ms), step);
    if (i % every === 0) {
      const file = path.join(out, `f${String(i).padStart(4, '0')}.png`);
      await page.screenshot({ path: file });
      shots.push({ file, i, ms: Math.round(i * step) });
    }
    if (args['until-done'] && script) {
      if (doneAt < 0 && (await page.evaluate(() => window.__captureDone === true))) doneAt = i;
      if (doneAt >= 0 && i - doneAt >= tail) break;
    }
  }
  const scriptError = script ? await page.evaluate(() => window.__captureError ?? null) : null;
  if (scriptError) {
    errors.push(`script: ${scriptError}`);
    console.log('[script error]', scriptError);
  }
} else {
  if (script) await page.evaluate(`(async () => { ${script} })()`);
  const file = path.join(out, 'shot.png');
  await page.screenshot({ path: file });
  shots.push({ file, i: 0, ms: 0 });
}

if (args.sheet && shots.length > 1) {
  await contactSheet(browser, shots, path.join(out, 'sheet.png'), {
    cols: Number(args.cols ?? 6),
    vw: viewport.width,
    vh: viewport.height,
  });
}

await browser.close();
console.log(JSON.stringify({ out, shots: shots.length, errors }, null, 0));
process.exit(errors.length ? 1 : 0);
