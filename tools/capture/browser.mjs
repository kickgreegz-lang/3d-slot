/**
 * Shared Playwright helpers for tools/capture and tools/qa.
 *
 *   import { launchBrowser, openGame, contactSheet, findFfmpeg } from '../capture/browser.mjs';
 *
 * - launchBrowser(): the preinstalled Chromium with SwiftShader WebGL2 (same flags everywhere).
 * - openGame(browser, url, {viewport, blockHmr, onConsole}): new page, Vite HMR socket stubbed
 *   (the working tree is edited by many agents; a full-reload mid-capture destroys the page),
 *   waits for window.__slot.ready.
 * - contactSheet(browser, shots, file, {cols, tileW, vw, vh, title}): PNG grid of frames.
 * - findFfmpeg(): best ffmpeg available ({path, mp4}) or null.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHROMIUM_ARGS = [
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--no-sandbox',
];

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const chromiumPath = () =>
  process.env.CHROMIUM_PATH ??
  ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium'].find((p) => fs.existsSync(p));

export const launchBrowser = () =>
  chromium.launch({ headless: true, executablePath: chromiumPath(), args: CHROMIUM_ARGS });

/** Parses `--key value` / `--flag` argv into an object (same convention as shot.mjs). */
export const parseArgs = (argv = process.argv.slice(2)) =>
  Object.fromEntries(
    argv.reduce((acc, a, i, arr) => {
      if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true']);
      return acc;
    }, []),
  );

export const parseViewport = (s = '1920x1080') => {
  const [width, height] = s.split('x').map(Number);
  return { width, height };
};

/**
 * Opens the game and waits for `__slot.ready` (in ?dev=lab|gallery that also means the lab is built).
 * Returns { page, errors } — errors collects pageerror messages.
 */
export const openGame = async (browser, url, opts = {}) => {
  const { viewport = { width: 1920, height: 1080 }, blockHmr = true, onConsole, timeout = 90_000 } = opts;
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const errors = [];
  if (blockHmr) {
    // Keep Vite's HMR client "connected" to a silent stub so file edits never reload the page.
    await page.routeWebSocket(/.*/, () => {});
  }
  page.on('console', (m) => onConsole?.(m));
  page.on('pageerror', (e) => errors.push(e.message));
  // Transient dev-server failures: Vite re-optimising deps (504 "Outdated Optimize Dep") or a
  // module caught mid-edit by another agent (500). With HMR stubbed the page can't self-heal,
  // so retry the navigation a few times.
  let serverError = 0;
  page.on('response', (r) => {
    if (r.status() >= 500 && r.url().startsWith(new URL(url).origin)) serverError = Date.now();
  });
  for (let attempt = 1; ; attempt++) {
    serverError = 0;
    const before = errors.length;
    await page.goto(url, { waitUntil: 'load' });
    const started = Date.now();
    let outcome = null;
    while (!outcome) {
      const st = await page.evaluate(() =>
        window.__slot?.ready === true ? 'ready' : document.body.innerText.includes('Boot failed') ? 'bootFailed' : null,
      );
      if (st) outcome = st;
      else if (serverError && Date.now() - serverError > 4000) outcome = 'serverError';
      else if (Date.now() - started > timeout) outcome = 'timeout';
      else await page.waitForTimeout(250);
    }
    if (outcome === 'ready') break;
    if (attempt >= 4 || outcome === 'timeout' || (outcome === 'bootFailed' && !serverError)) {
      const text = await page.evaluate(() => document.body.innerText.slice(0, 2000));
      throw new Error(`Game failed to boot (${outcome}): ${text}`);
    }
    errors.splice(before);
    await page.waitForTimeout(3000);
  }
  return { page, errors };
};

/** Renders a contact sheet PNG (frame index + ms under each tile) using the given browser. */
export const contactSheet = async (browser, shots, file, opts = {}) => {
  const { cols = 6, tileW = 320, vw = 1920, vh = 1080, title = '' } = opts;
  const tileH = Math.round((tileW * vh) / vw);
  const figs = shots
    .map((s) => {
      const ext = path.extname(s.file).slice(1).replace('jpg', 'jpeg');
      const b64 = fs.readFileSync(s.file).toString('base64');
      return `<figure><img src="data:image/${ext};base64,${b64}"/><figcaption>#${s.i} · ${s.ms}ms</figcaption></figure>`;
    })
    .join('');
  const head = title ? `<h1>${title.replace(/</g, '&lt;')}</h1>` : '';
  const sheet = await browser.newPage({ viewport: { width: cols * (tileW + 8) + 8, height: 200 } });
  await sheet.setContent(
    `<style>body{margin:0;background:#111;padding:8px}h1{color:#eee;font:600 14px monospace;margin:0 0 8px}
     .g{display:grid;grid-template-columns:repeat(${cols},${tileW}px);gap:8px}
     figure{margin:0}img{width:${tileW}px;height:${tileH}px;display:block}figcaption{color:#ddd;font:12px monospace;padding:2px 0}</style>
     ${head}<div class="g">${figs}</div>`,
  );
  await sheet.screenshot({ path: file, fullPage: true });
  await sheet.close();
};

const probeFfmpeg = (bin) => {
  try {
    const enc = execFileSync(bin, ['-hide_banner', '-encoders'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const dec = execFileSync(bin, ['-hide_banner', '-decoders'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return {
      path: bin,
      mp4: /libx264/.test(enc) && /\bpng\b/.test(dec),
      webm: /libvpx/.test(enc) && /mjpeg/.test(dec),
      png: /\bpng\b/.test(dec),
    };
  } catch {
    return null;
  }
};

/**
 * Best ffmpeg available: $FFMPEG, PATH, the full static build shipped with
 * @ffmpeg-installer (node_modules), then Playwright's minimal build
 * (/opt/pw-browsers/ffmpeg-*: VP8/WebM from MJPEG only). null if none works.
 */
export const findFfmpeg = () => {
  const candidates = [];
  if (process.env.FFMPEG) candidates.push(process.env.FFMPEG);
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (dir) candidates.push(path.join(dir, 'ffmpeg'));
  }
  const pnpm = path.join(REPO, 'node_modules/.pnpm');
  if (fs.existsSync(pnpm)) {
    for (const d of fs.readdirSync(pnpm).filter((n) => n.startsWith('@ffmpeg-installer+linux-x64'))) {
      candidates.push(path.join(pnpm, d, 'node_modules/@ffmpeg-installer/linux-x64/ffmpeg'));
    }
  }
  if (fs.existsSync('/opt/pw-browsers')) {
    for (const d of fs.readdirSync('/opt/pw-browsers').filter((n) => n.startsWith('ffmpeg-'))) {
      candidates.push(path.join('/opt/pw-browsers', d, 'ffmpeg'), path.join('/opt/pw-browsers', d, 'ffmpeg-linux'));
    }
  }
  let fallback = null;
  for (const c of candidates) {
    if (!fs.existsSync(c)) continue;
    const info = probeFfmpeg(c);
    if (info?.mp4) return info;
    if (info?.webm && !fallback) fallback = info;
  }
  return fallback;
};
