#!/usr/bin/env node
/**
 * Deterministic visual capture for AI/human review of animations.
 *
 *   node tools/capture/shot.mjs --url "http://localhost:5173/?dev=lab" --out screenshots/land \
 *        [--viewport 1920x1080] [--script "await __slot.emit('board:reveal', {...})"] \
 *        [--frames 90] [--step 16.667] [--every 3] [--sheet] [--cols 6] [--wait 0]
 *
 * - Waits for window.__slot.ready, switches the game clock to MANUAL, then (optionally)
 *   starts --script WITHOUT awaiting it (so animations can be stepped), and steps
 *   --frames frames of --step ms, saving every --every-th frame as PNG.
 * - --frames 0 => single screenshot after the script resolves.
 * - --sheet => also writes <out>/sheet.png contact sheet (frame number + ms under each tile).
 * Exits non-zero on page errors. Uses the preinstalled Chromium with SwiftShader WebGL2.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true']);
    return acc;
  }, []),
);
const url = args.url ?? 'http://localhost:5173/';
const out = args.out ?? 'screenshots/shot';
const [vw, vh] = (args.viewport ?? '1920x1080').split('x').map(Number);
const frames = Number(args.frames ?? 0);
const step = Number(args.step ?? 1000 / 60);
const every = Math.max(1, Number(args.every ?? 1));
const waitMs = Number(args.wait ?? 0);
fs.mkdirSync(out, { recursive: true });

const executablePath =
  process.env.CHROMIUM_PATH ??
  ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));

const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[page:${m.type()}]`, m.text());
});
page.on('pageerror', (e) => {
  errors.push(e.message);
  console.log('[pageerror]', e.message);
});
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__slot?.ready === true, null, { timeout: 90_000 });
if (waitMs) await page.waitForTimeout(waitMs);

const shots = [];
if (frames > 0) {
  await page.evaluate(() => window.__slot.manual(true));
  if (args.script) {
    await page.evaluate(`window.__capturePromise = (async () => { ${args.script} })()`);
  }
  for (let i = 0; i < frames; i++) {
    await page.evaluate((ms) => window.__slot.step(ms), step);
    if (i % every === 0) {
      const file = path.join(out, `f${String(i).padStart(4, '0')}.png`);
      await page.screenshot({ path: file });
      shots.push({ file, i, ms: Math.round(i * step) });
    }
  }
} else {
  if (args.script) await page.evaluate(`(async () => { ${args.script} })()`);
  const file = path.join(out, 'shot.png');
  await page.screenshot({ path: file });
  shots.push({ file, i: 0, ms: 0 });
}

if (args.sheet && shots.length > 1) {
  const cols = Number(args.cols ?? 6);
  const tileW = 320;
  const tileH = Math.round((tileW * vh) / vw);
  const imgs = shots
    .map((s) => {
      const b64 = fs.readFileSync(s.file).toString('base64');
      return `<figure><img src="data:image/png;base64,${b64}"/><figcaption>#${s.i} · ${s.ms}ms</figcaption></figure>`;
    })
    .join('');
  const sheet = await browser.newPage({ viewport: { width: cols * (tileW + 8) + 8, height: 200 } });
  await sheet.setContent(
    `<style>body{margin:0;background:#111;display:grid;grid-template-columns:repeat(${cols},${tileW}px);gap:8px;padding:8px}
     figure{margin:0}img{width:${tileW}px;height:${tileH}px;display:block}figcaption{color:#ddd;font:12px monospace;padding:2px 0}</style>${imgs}`,
  );
  await sheet.screenshot({ path: path.join(out, 'sheet.png'), fullPage: true });
}

await browser.close();
console.log(JSON.stringify({ out, shots: shots.length, errors }, null, 0));
process.exit(errors.length ? 1 : 0);
