#!/usr/bin/env node
/**
 * Stake Engine approval smoke tests against the PRODUCTION build (`vite preview`).
 *
 * USAGE:
 *   npx vite build
 *   npx vite preview --port 4173 --strictPort &            # or pass --serve to let this script start/stop it
 *   node tools/qa/approval.mjs --url http://localhost:4173/ \
 *        [--out screenshots/approval] [--dist dist] [--rgs rgs.approval.test] \
 *        [--serve --port 4173] [--settle-ms 4000] [--spin first|all|none] [--spin-ms 9000] \
 *        [--viewports 1200x675,375x667] [--strict-gpu] [--allow-url "<regex>"] [--no-mock-rgs]
 *
 * Checks (report: <out>/approval.json, exit 1 on any failure):
 *   1. dist/ grep: no absolute http(s):// URLs in shipped code/data (XML namespace URIs such as
 *      http://www.w3.org/2000/svg and template-built `https://${rgs}` URLs are allowed; URLs inside
 *      .txt licence files are listed under `docUrls` without failing), no root-absolute
 *      src/href in index.html (Stake serves from a CDN sub-path).
 *   2. The 7 required viewports (1200x675, 1024x576, 800x450, 400x225, 425x812, 375x667, 320x568):
 *      boots to window.__slot.ready, screenshot per viewport (+ after a spacebar spin).
 *   3. Request-host allowlist: only the page origin and the rgs_url host are contacted.
 *   4. ZERO console messages (any level), zero pageerrors, zero failed / >=400 requests.
 *      SwiftShader "GL Driver Message" / "GPU stall" lines are Chromium-generated and are reported
 *      as `gpuNoise` without failing (pass --strict-gpu to fail on them too).
 * The RGS (https://<rgs>/wallet/*, /bet/*) is answered by an in-process mock built on
 * mock/books fixtures (same wire shapes as mock/rgsMockPlugin.ts), so no real RGS is needed.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, parseArgs, parseViewport } from '../capture/browser.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = parseArgs();
const port = Number(args.port ?? 4173);
const baseUrl = args.url ?? `http://localhost:${port}/`;
const outDir = path.resolve(args.out ?? 'screenshots/approval');
const distDir = path.resolve(args.dist ?? path.join(REPO, 'dist'));
const rgsHost = args.rgs ?? 'rgs.approval.test';
const settleMs = Number(args['settle-ms'] ?? 4000);
const spinMode = args.spin ?? 'first';
const spinMs = Number(args['spin-ms'] ?? 9000);
const strictGpu = args['strict-gpu'] === 'true';
const mockRgs = args['no-mock-rgs'] !== 'true';
const VIEWPORTS = (args.viewports ?? '1200x675,1024x576,800x450,400x225,425x812,375x667,320x568').split(',');

/** Never fetched: XML namespace identifiers, and template-built RGS URLs (`https://${rgs_url}`). */
const ALLOWED_URLS = [
  /^http:\/\/www\.w3\.org\//,
  /^https:\/\/\$\{/,
  ...(args['allow-url'] ? [new RegExp(args['allow-url'])] : []),
];
/** Plain-text documents shipped for licensing (OFL/Apache font licences): reported, never fail. */
const DOC_EXT = new Set(['.txt']);
const GPU_NOISE = /GL Driver Message|GPU stall due to|\[\.WebGL-[0-9a-fx]+\]|Automatic fallback to software WebGL/i;
const TEXT_EXT = new Set(['.js', '.mjs', '.css', '.html', '.json', '.atlas', '.txt', '.svg', '.xml', '.webmanifest']);

fs.mkdirSync(outDir, { recursive: true });
const failures = [];

// ---------------------------------------------------------------------------
// 1. dist scan
// ---------------------------------------------------------------------------

const walk = (dir) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
        const p = path.join(dir, d.name);
        return d.isDirectory() ? walk(p) : [p];
      })
    : [];

const distReport = { dir: distDir, filesScanned: 0, violations: [], docUrls: [], allowed: {}, rootAbsoluteRefs: [] };
if (!fs.existsSync(distDir)) {
  failures.push(`dist: ${distDir} not found (run npx vite build first)`);
} else {
  const URL_RE = /https?:\/\/[^\s'"`<>()\\,;]+/g;
  for (const file of walk(distDir).filter((f) => TEXT_EXT.has(path.extname(f)))) {
    distReport.filesScanned++;
    const text = fs.readFileSync(file, 'utf8');
    const rel = path.relative(distDir, file);
    const seen = new Map();
    for (const m of text.matchAll(URL_RE)) {
      const u = m[0].replace(/[.:]+$/, '');
      if (ALLOWED_URLS.some((re) => re.test(u))) {
        distReport.allowed[u] = (distReport.allowed[u] ?? 0) + 1;
        continue;
      }
      const hit = seen.get(u);
      if (hit) hit.count++;
      else {
        const ctx = text.slice(Math.max(0, m.index - 60), m.index + u.length + 40).replace(/\s+/g, ' ');
        seen.set(u, { file: rel, url: u, count: 1, context: ctx });
      }
    }
    (DOC_EXT.has(path.extname(file)) ? distReport.docUrls : distReport.violations).push(...seen.values());
    if (rel === 'index.html') {
      for (const m of text.matchAll(/\b(?:src|href)=["'](\/[^"']*)["']/g)) distReport.rootAbsoluteRefs.push(m[1]);
    }
  }
  if (distReport.violations.length) {
    failures.push(`dist: ${distReport.violations.length} absolute URL(s) in shipped assets`);
  }
  if (distReport.rootAbsoluteRefs.length) {
    failures.push(`dist: root-absolute refs in index.html: ${distReport.rootAbsoluteRefs.join(', ')}`);
  }
}

// ---------------------------------------------------------------------------
// optional preview server
// ---------------------------------------------------------------------------

let server = null;
if (args.serve === 'true') {
  server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
    cwd: REPO,
    stdio: 'ignore',
    detached: true,
  });
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const res = await fetch(baseUrl);
      if (res.ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      failures.push(`serve: vite preview did not come up on ${baseUrl}`);
      break;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}
const stopServer = () => {
  if (server?.pid) {
    try {
      process.kill(-server.pid);
    } catch {
      // already gone
    }
  }
};

// ---------------------------------------------------------------------------
// RGS mock (wire shapes of the live RGS; money = integer API units)
// ---------------------------------------------------------------------------

const API = 1_000_000;
const fixtures = JSON.parse(fs.readFileSync(path.join(REPO, 'mock/books/base_fixtures.json'), 'utf8'));
const SPIN_BOOK = fixtures.small_win_1_tumble ?? Object.values(fixtures)[0];
const JURISDICTION = {
  socialCasino: false,
  disabledFullscreen: false,
  disabledTurbo: false,
  disabledSuperTurbo: false,
  disabledAutoplay: false,
  disabledSlamstop: false,
  disabledSpacebar: false,
  disabledBuyFeature: false,
  displayNetPosition: false,
  displayRTP: false,
  displaySessionTimer: false,
  minimumRoundDuration: 0,
};
const BET_LEVELS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100].map((v) => Math.round(v * API));

const createRgs = () => {
  const s = { balance: 1000 * API, round: null, betId: 5000 };
  const balance = () => ({ amount: s.balance, currency: 'USD' });
  return (method, pathname, body) => {
    if (method === 'POST' && pathname === '/wallet/authenticate') {
      return {
        balance: balance(),
        config: {
          gameID: 'approval-smoke',
          minBet: BET_LEVELS[0],
          maxBet: BET_LEVELS[BET_LEVELS.length - 1],
          stepBet: 10_000,
          defaultBetLevel: API,
          betLevels: BET_LEVELS,
          betModes: {},
          jurisdiction: JURISDICTION,
        },
        round: null,
        meta: null,
      };
    }
    if (method === 'POST' && pathname === '/wallet/balance') return { balance: balance() };
    if (method === 'POST' && pathname === '/wallet/play') {
      const amount = Number(body?.amount ?? API);
      const payout = Math.round((amount * SPIN_BOOK.payoutMultiplier) / 100);
      s.balance += payout - amount;
      s.round = {
        betID: ++s.betId,
        amount,
        payout,
        payoutMultiplier: SPIN_BOOK.payoutMultiplier / 100,
        costMultiplier: 1,
        active: payout > 0,
        mode: String(body?.mode ?? 'BASE'),
        event: null,
        state: SPIN_BOOK.events,
      };
      return { balance: balance(), round: s.round };
    }
    if (method === 'POST' && pathname === '/wallet/end-round') {
      if (s.round) s.round.active = false;
      return { balance: balance() };
    }
    if (method === 'POST' && pathname === '/bet/event') return { event: String(body?.event ?? '') };
    if (method === 'GET' && pathname.startsWith('/bet/replay/')) {
      return { payoutMultiplier: SPIN_BOOK.payoutMultiplier / 100, costMultiplier: 1, state: SPIN_BOOK.events };
    }
    return null;
  };
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// ---------------------------------------------------------------------------
// 2-4. viewports
// ---------------------------------------------------------------------------

const pageUrl = (device) => {
  const u = new URL(baseUrl);
  u.searchParams.set('sessionID', 'qa-approval');
  u.searchParams.set('rgs_url', rgsHost);
  u.searchParams.set('lang', 'en');
  u.searchParams.set('currency', 'USD');
  u.searchParams.set('device', device);
  return u.toString();
};

const results = [];
const browser = failures.some((f) => f.startsWith('serve:')) ? null : await launchBrowser();
for (const [index, vp] of VIEWPORTS.entries()) {
  if (!browser) break;
  const size = parseViewport(vp);
  const mobile = size.height > size.width;
  const url = pageUrl(mobile ? 'mobile' : 'desktop');
  const origin = new URL(url).host;
  const r = {
    viewport: vp,
    device: mobile ? 'mobile' : 'desktop',
    ready: false,
    bootMs: null,
    screenshots: [],
    console: [],
    gpuNoise: [],
    pageErrors: [],
    requestViolations: [],
    networkErrors: [],
    hosts: {},
    requests: 0,
  };
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  const page = await context.newPage();
  if (mockRgs) {
    const rgs = createRgs();
    await page.route(`https://${rgsHost}/**`, async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      let body = null;
      try {
        body = req.postDataJSON();
      } catch {
        body = null;
      }
      const res = rgs(req.method(), new URL(req.url()).pathname, body);
      if (!res) return route.fulfill({ status: 404, headers: CORS, contentType: 'application/json', body: '{"error":"ERR_VAL"}' });
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(res) });
    });
  }
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:') return;
    r.requests++;
    r.hosts[u.host] = (r.hosts[u.host] ?? 0) + 1;
    if (u.host !== origin && u.host !== rgsHost) r.requestViolations.push(req.url());
  });
  page.on('requestfailed', (req) => r.networkErrors.push(`${req.failure()?.errorText ?? 'failed'} ${req.url()}`));
  page.on('response', (res) => {
    if (res.status() >= 400) r.networkErrors.push(`${res.status()} ${res.url()}`);
  });
  page.on('console', (m) => {
    const line = `${m.type()}: ${m.text()}`;
    if (GPU_NOISE.test(m.text())) r.gpuNoise.push(line);
    else r.console.push(line);
  });
  page.on('pageerror', (e) => r.pageErrors.push(e.message));

  const t0 = Date.now();
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
    await page.waitForFunction(() => window.__slot?.ready === true, null, { timeout: 60_000 });
    r.ready = true;
    r.bootMs = Date.now() - t0;
  } catch (err) {
    r.pageErrors.push(`boot: ${String(err?.message ?? err).split('\n')[0]}`);
  }
  await page.waitForTimeout(settleMs);
  const shot = path.join(outDir, `${vp}.png`);
  await page.screenshot({ path: shot });
  r.screenshots.push(path.relative(outDir, shot));
  if (r.ready && (spinMode === 'all' || (spinMode === 'first' && index === 0))) {
    await page.mouse.click(size.width / 2, size.height / 2); // user gesture (audio unlock / tap-to-start)
    await page.waitForTimeout(500);
    await page.keyboard.press('Space');
    await page.waitForTimeout(spinMs);
    const spinShot = path.join(outDir, `${vp}-spin.png`);
    await page.screenshot({ path: spinShot });
    r.screenshots.push(path.relative(outDir, spinShot));
    r.spun = true;
  }
  await context.close();

  const fail = (msg) => failures.push(`${vp}: ${msg}`);
  if (!r.ready) fail('never reached __slot.ready');
  if (r.console.length) fail(`${r.console.length} console message(s) — first: ${r.console[0].slice(0, 200)}`);
  if (strictGpu && r.gpuNoise.length) fail(`${r.gpuNoise.length} GPU driver console message(s)`);
  if (r.pageErrors.length) fail(`${r.pageErrors.length} page error(s) — first: ${r.pageErrors[0].slice(0, 200)}`);
  if (r.requestViolations.length) fail(`request(s) to non-allowlisted hosts: ${[...new Set(r.requestViolations.map((u) => new URL(u).host))].join(', ')}`);
  if (r.networkErrors.length) fail(`${r.networkErrors.length} network error(s) — first: ${r.networkErrors[0].slice(0, 200)}`);
  results.push(r);
  console.log(
    `${vp.padEnd(9)} ${r.ready ? 'ready' : 'NOT READY'} ${String(r.bootMs ?? '—').padStart(6)} ms  console ${r.console.length}  gpu ${r.gpuNoise.length}  errors ${r.pageErrors.length}  net ${r.networkErrors.length}  hosts ${Object.keys(r.hosts).join(',')}`,
  );
}
await browser?.close();
stopServer();

const report = {
  ok: failures.length === 0,
  generatedAt: new Date().toISOString(),
  url: baseUrl,
  rgsHost,
  mockRgs,
  dist: distReport,
  viewports: results,
  failures,
};
fs.writeFileSync(path.join(outDir, 'approval.json'), JSON.stringify(report, null, 1));
console.log(`\n${failures.length ? `FAIL (${failures.length})` : 'PASS'} — ${path.join(outDir, 'approval.json')}`);
for (const f of failures) console.log(`  ✖ ${f}`);
process.exit(failures.length ? 1 : 0);
