#!/usr/bin/env node
/**
 * Reference capture for THIRD-PARTY slot demos — frame-exact frames, contact sheets, RGS/network
 * logs — for private study of animation, timing and design. Output is never shipped or committed
 * (art/_reference/ is gitignored). See tools/reference/README.md.
 *
 *   node tools/reference/capture.mjs --url "<demo url>" [options]
 *
 * Common options
 *   --script <name|path>   stake-default (default) | probe | path/to/script.json|.mjs
 *   --probe                shorthand for --script probe (boot, grid screenshots, exit)
 *   --clock <mode>         virtual (default) | after-boot | realtime      --realtime = --clock realtime
 *   --game <name>          output folder name (default: derived from the URL path)
 *   --run <name>           run folder name (default: timestamp)
 *   --out <dir>            base output dir (default: art/_reference)
 *   --viewport 1920x1080   --dpr 1   --fps 60
 *   --point name=x,y       override a script point (repeatable), 0..1 of the canvas
 *   --frames-scale 0.1     scale every frames/wait length (quick smoke runs)
 *   --jpeg [q]             JPEG frames (default q=85) instead of PNG — ~10x smaller
 *   --clip canvas          crop frames to the game canvas (default: whole viewport)
 *   --video                also encode MP4s (ffmpeg with libx264)
 *   --save-assets          ALSO download game assets into <run>/assets (STUDY ONLY, never ship)
 *   --no-sheets            skip contact sheets     --sheet-cols 8  --sheet-max 60
 *   --no-net-sync          don't hold frames while fetch/xhr are in flight (see README)
 *   --headed | --gpu       real GPU instead of SwiftShader (on your own machine)
 *   --channel chrome       use installed Google Chrome (proprietary codecs)
 *   --no-redact            keep the sessionID in logs (default: redacted)
 *   --trust-ca <pem>       trust a TLS-inspecting proxy's CA (pins its key; corporate proxies)
 *                          — automatic for this repo's Claude sandbox proxy (--no-proxy-ca to skip)
 *   --stub-ws              answer every WebSocket with a silent stub (local dev servers: stops
 *                          Vite/webpack HMR from reloading the page mid-capture)
 *   --dry-run              validate the script, print the plan, exit
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { parseArgs, parseViewport, stamp } from './lib/args.mjs';
import { Aborted, Driver } from './lib/driver.mjs';
import { NetLog } from './lib/net.mjs';
import { postprocess } from './lib/post.mjs';
import { Runner, loadScript, validate } from './lib/script.mjs';
import { pageShim } from './lib/shim.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const SWIFTSHADER = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'];
const MODES = ['virtual', 'after-boot', 'realtime'];

const args = parseArgs(process.argv.slice(2), {
  booleans: ['realtime', 'save-assets', 'video', 'no-sheets', 'headed', 'gpu', 'no-redact', 'dry-run', 'probe', 'help', 'no-net-sync', 'force', 'stub-ws', 'no-proxy-ca'],
  multi: ['point'],
});

if (args.help) {
  const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
  console.log(src.slice(src.indexOf('/**') + 3, src.indexOf('*/')).replace(/^ \* ?/gm, ''));
  process.exit(0);
}

const log = (...a) => console.log(...a);
const die = (msg) => {
  console.error(`capture: ${msg}`);
  process.exit(2);
};

const script = await loadScript(args.probe ? 'probe' : (args.script ?? 'stake-default'), path.join(HERE, 'scripts')).catch((e) => die(e.message));
const url = args.url ?? script.url;
if (!url || url === true) die('--url "<demo url>" is required');
const mode = args.realtime ? 'realtime' : (args.clock ?? script.clock ?? 'virtual');
if (!MODES.includes(mode)) die(`--clock must be one of ${MODES.join(', ')}`);
const fps = Number(args.fps ?? script.fps ?? 60);
const viewport = parseViewport(args.viewport ?? script.viewport ?? '1920x1080');
const dpr = Number(args.dpr ?? 1);
const points = { ...(script.points ?? {}) };
for (const p of args.point ?? []) {
  const m = /^([\w.-]+)=([\d.]+),([\d.]+)$/.exec(p);
  if (!m) die(`bad --point "${p}" (expected name=x,y with x,y in 0..1)`);
  points[m[1]] = [Number(m[2]), Number(m[3])];
}
const framesScale = Number(args['frames-scale'] ?? 1);
const format = args.jpeg ? 'jpeg' : 'png';
const quality = args.jpeg && args.jpeg !== true ? Number(args.jpeg) : 85;
let plan = { frames: 0, captured: 0 };
if (!script.fn) {
  try {
    plan = validate(script.steps, points, fps);
  } catch (e) {
    die(`script ${script.file}: ${e.message}`);
  }
}

const deriveGame = (u) => {
  try {
    const x = new URL(u);
    const seg = x.pathname.split('/').filter((s) => s && !/^v?\d+(\.\d+)*$/.test(s) && !/\.html?$/.test(s));
    const file = x.pathname.split('/').pop()?.replace(/\.html?$/, '');
    return (seg[0] ?? file ?? x.hostname).replace(/[^\w.-]+/g, '-') || x.hostname;
  } catch {
    return 'game';
  }
};
const game = String(args.game ?? deriveGame(url));
const runName = String(args.run ?? `${stamp()}-${mode}`);
const outDir = path.resolve(REPO, String(args.out ?? 'art/_reference'), game, runName);

const estMB = (plan.captured * framesScale * viewport.width * viewport.height * dpr * dpr * (format === 'png' ? 1.4 : 0.15)) / 1e6;
log(`reference capture — ${game} / ${runName}`);
log(`  script   ${path.relative(REPO, script.file)}${script.fn ? ' (js)' : ` · ~${Math.round(plan.frames * framesScale)} frames stepped, ~${Math.round(plan.captured * framesScale)} captured (~${estMB > 1000 ? `${(estMB / 1000).toFixed(1)} GB` : `${Math.round(estMB)} MB`} ${format})`}`);
log(`  clock    ${mode} @ ${fps} fps · viewport ${viewport.width}x${viewport.height}@${dpr}x · ${args.headed ? 'headed' : args.gpu ? 'headless GPU' : 'headless SwiftShader'}`);
log(`  output   ${path.relative(process.cwd(), outDir) || outDir}`);
if (estMB > 2000 && format === 'png') log('  tip      that is a lot of disk: --jpeg 90 is ~10x smaller, or --viewport 1280x720, or --frames-scale for a shorter run');
log('  NOTE     reference only: third-party material for private study. Never ship, commit or redistribute.');
if (args['save-assets']) log('  WARNING  --save-assets: downloaded game assets are copyrighted — STUDY ONLY, never ship/commit/trace them.');
if (args['dry-run']) process.exit(0);
if (fs.existsSync(outDir) && fs.readdirSync(outDir).length && !args.force) die(`${outDir} already exists (pick another --run or pass --force)`);
fs.mkdirSync(outDir, { recursive: true });

/* ------------------------------------------------------------------ browser */
// --chromium <path> wins; otherwise $CHROMIUM_PATH or this container's preinstalled Chromium;
// otherwise (your own machine) Playwright's own download (`npx playwright install chromium`).
const execPath = args.chromium
  ? String(args.chromium)
  : args.channel
    ? undefined
    : [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => p && fs.existsSync(p));
const launchArgs = ['--mute-audio', '--autoplay-policy=no-user-gesture-required'];
// TLS-inspecting proxies: Chromium reads its own NSS store, not SSL_CERT_FILE, so pin the
// proxy CA's public key instead. Only chains issued by THAT CA are affected; public sites
// still verify normally. Auto-applies to the Claude Code sandbox egress proxy only.
{
  const certsIn = (file) => (fs.readFileSync(file, 'utf8').match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? []).map((pem) => new crypto.X509Certificate(pem));
  const spki = (c) => crypto.createHash('sha256').update(c.publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
  let pins = [], from = '';
  if (args['trust-ca']) {
    from = String(args['trust-ca']);
    pins = certsIn(from).map(spki);
  } else if (!args['no-proxy-ca'] && process.env.CCR_AGENT_PROXY_ENABLED === '1' && fs.existsSync('/root/.ccr/ca-bundle.crt')) {
    from = '/root/.ccr/ca-bundle.crt (sandbox proxy CAs only)';
    pins = certsIn('/root/.ccr/ca-bundle.crt').filter((c) => /Proxy CA|interception CA|Egress Gateway CA|TLS Inspection CA/i.test(c.subject)).map(spki);
  }
  pins = [...new Set(pins)];
  if (pins.length) {
    launchArgs.push(`--ignore-certificate-errors-spki-list=${pins.join(',')}`);
    log(`  tls      trusting ${pins.length} TLS-inspection CA key(s) from ${from}`);
  }
}
if (!args.gpu && !args.headed) launchArgs.push(...SWIFTSHADER);
else if (args.gpu) launchArgs.push('--enable-gpu', '--ignore-gpu-blocklist');
const browser = await chromium.launch({ headless: !args.headed, executablePath: execPath, channel: args.channel ? String(args.channel) : undefined, args: launchArgs });

let userAgent;
{
  const probeCtx = await browser.newContext();
  const pp = await probeCtx.newPage();
  userAgent = (await pp.evaluate(() => navigator.userAgent)).replace('HeadlessChrome', 'Chrome');
  await probeCtx.close();
}
const context = await browser.newContext({ viewport, deviceScaleFactor: dpr, userAgent, serviceWorkers: 'block', locale: 'en-US' });
if (mode === 'virtual') await context.clock.install({ time: Date.now() }); // must precede the shim (see lib/shim.mjs)
await context.addInitScript(pageShim);
if (args['stub-ws']) await context.routeWebSocket(/.*/, () => {});

let driver;
const net = new NetLog({ outDir, pageUrl: url, saveAssets: !!args['save-assets'], redact: !args['no-redact'], now: () => (driver ? driver.pos() : { frame: null, t: null }) });
net.attach(context);
const page = await context.newPage();
net.watchPage(page);
driver = new Driver({
  page,
  context,
  outDir,
  mode,
  fps,
  format,
  quality,
  net,
  netSync: !args['no-net-sync'],
  netSyncTimeout: Number(args['net-sync-timeout'] ?? 5000),
  clip: args.clip === 'canvas' ? 'canvas' : 'viewport',
  log,
});

const consoleFile = fs.createWriteStream(path.join(outDir, 'console.txt'));
const pageErrors = [];
page.on('console', (m) => {
  const p = driver.pos();
  consoleFile.write(`[${p.frame ?? '-'} ${p.t ?? '-'}ms] ${m.type()}: ${net.redact(m.text())}\n`);
});
page.on('pageerror', (e) => {
  const p = driver.pos();
  pageErrors.push({ ...p, message: net.redact(String(e.message)) });
  consoleFile.write(`[${p.frame ?? '-'} ${p.t ?? '-'}ms] PAGEERROR: ${net.redact(String(e.stack ?? e.message))}\n`);
});
page.on('crash', () => log('  ! page crashed'));
let reloadedAt = null;
// a NEW document (reload / navigation) after frame stepping began; pushState/hash changes don't fire this
page.on('domcontentloaded', () => {
  if (driver.ticks0 != null && reloadedAt == null) {
    reloadedAt = driver.pos();
    driver.warn('nav', `the game navigated/reloaded mid-capture at frame ${reloadedAt.frame}; stopping (outputs so far are kept)`);
    driver.aborted = true;
  }
});

let sigints = 0;
process.on('SIGINT', () => {
  if (++sigints > 1) process.exit(130);
  log('\n  Ctrl-C: stopping after the current frame and writing outputs (Ctrl-C again to quit now)');
  driver.aborted = true;
});

/* ---------------------------------------------------------------------- run */
const started = new Date();
let status = 'ok', error = null;
try {
  log(`  opening ${net.redact(url)}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: Number(args.timeout ?? 120_000) });
  const runner = new Runner(driver, { points, framesScale, fps, log });
  if (script.fn) await script.fn(runner.api(), { args, points, url });
  else await runner.run(script.steps);
} catch (e) {
  if (reloadedAt) {
    status = 'error';
    error = `page reloaded/navigated at frame ${reloadedAt.frame} (t ${reloadedAt.t} ms). A local dev server? pass --stub-ws to block its HMR socket.`;
    log(`  ERROR ${error}`);
  } else if (e instanceof Aborted || driver.aborted) status = 'aborted';
  else {
    status = 'error';
    error = String(e.stack ?? e);
    log(`  ERROR ${String(e.message ?? e).split('\n')[0]}`);
  }
}

/* ------------------------------------------------------------------ outputs */
const w = (name, data) => fs.writeFileSync(path.join(outDir, name), JSON.stringify(data, null, 2));
const shim = await page.evaluate(() => globalThis.__ref?.stats()).catch(() => null);
w('frames.json', { fps, frameMs: 1000 / fps, format, frames: driver.framesIndex });
w('segments.json', {
  fps,
  frameMs: 1000 / fps,
  clock: mode,
  note: 'frame = virtual frame index since the first pause; t = virtual ms since frame 0 (frame n at round(n*1000/fps))',
  segments: driver.segments,
  actions: driver.actions,
  shots: driver.shots,
});
const netSummary = await net.finalize();
consoleFile.end();
const runInfo = {
  tool: 'tools/reference/capture.mjs',
  referenceOnly: 'Third-party material captured for private study of animation/timing/design. Never ship, commit or redistribute.',
  game,
  run: runName,
  url: net.redact(url),
  status,
  error,
  clock: mode,
  fps,
  viewport,
  dpr,
  format,
  clip: driver.clipMode,
  canvas: driver.canvas,
  baseTicks: driver.ticks0,
  netSync: driver.netSync,
  browser: `${args.channel ?? 'chromium'} ${browser.version()}`,
  renderer: args.headed ? 'headed' : args.gpu ? 'gpu' : 'swiftshader',
  userAgent,
  script: { file: path.relative(REPO, script.file), name: script.name, framesScale, points },
  analysis: { regions: script.regions ?? null, columns: script.columns ?? null },
  startedAt: started.toISOString(),
  finishedAt: new Date().toISOString(),
  wallSeconds: Math.round((Date.now() - started) / 1000),
  stats: { ...driver.stats, segments: driver.segments.length, shots: driver.shots.length, ...netSummary },
  shim,
  warnings: driver.warnings,
  pageErrors,
};
w('run.json', runInfo);
await context.close().catch(() => {});

if (driver.framesIndex.length || driver.shots.length) {
  log('  post-processing…');
  try {
    await postprocess(outDir, { browser, video: !!args.video, sheets: !args['no-sheets'], sheetCols: Number(args['sheet-cols'] ?? 8), sheetMax: Number(args['sheet-max'] ?? 60), log });
  } catch (e) {
    log(`  ! post-processing failed: ${e.message} (re-run: node tools/reference/postprocess.mjs "${outDir}")`);
  }
}
await browser.close();

const rel = path.relative(process.cwd(), outDir) || outDir;
log(`\n${status.toUpperCase()} — ${driver.stats.captured} frames, ${driver.shots.length} screenshots, ${netSummary.requests} requests (${netSummary.rgs} RGS), ${netSummary.assets} assets${args['save-assets'] ? ` (${(netSummary.savedAssetBytes / 1e6).toFixed(1)} MB saved, STUDY ONLY)` : ''}, ${runInfo.wallSeconds}s`);
const failed = Object.entries(netSummary.failedHosts).sort((a, b) => b[1] - a[1]);
if (failed.length) {
  log(`  failed requests (host + error): ${failed.slice(0, 6).map(([k, n]) => `${k} ×${n}`).join(' · ')}${failed.length > 6 ? ' …' : ''}`);
  if (failed.some(([k]) => /TUNNEL_CONNECTION_FAILED|PROXY/.test(k))) log('  hint   ERR_TUNNEL_CONNECTION_FAILED = the egress proxy blocks that host; every host the game uses (page, RGS, asset CDN) must be allowed');
}
if (driver.warnings.length) log(`  ${driver.warnings.length} warning(s) — see run.json`);
if (pageErrors.length) log(`  ${pageErrors.length} page error(s) — see console.txt`);
if (driver.framesIndex.length || driver.shots.length) log(`  open   ${rel}/index.html`);
if (driver.framesIndex.length > 1) log(`  next   node tools/reference/timings.mjs "${rel}"${script.regions ? '' : ' --regions \'{"grid":[x,y,w,h]}\' --columns 5'}`);
process.exit(status === 'error' ? 1 : status === 'aborted' ? 130 : 0);
