#!/usr/bin/env node
/**
 * Tiny static + mock-RGS server for the reference-capture tests (no dependencies).
 *
 *   node tools/reference/test/serve.mjs [--port 8765] [--latency 80]
 *
 * Serves tools/reference/test/*.html plus:
 *   GET  /sleep?ms=N                    blocks N ms (the test pages use a sync XHR to fake slow renders)
 *   GET  /assets/...                    generated fixture assets (png, atlas, spine-ish json, wav, woff2)
 *   POST /rgs/wallet/{authenticate,play,end-round,balance}, /rgs/bet/event
 *                                       Stake-Engine-shaped JSON (deterministic books), --latency ms delay
 *   GET  /rgs/bet/replay/:game/:version/:mode/:event
 * Import startServer() from tests to run it in-process.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from '../lib/png.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const makePng = (w, h) => {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      px[i] = (x * 255) / w; px[i + 1] = (y * 255) / h; px[i + 2] = 160; px[i + 3] = 255;
    }
  return encodePng(w, h, px);
};
const makeWav = (ms = 200, rate = 8000) => {
  const n = Math.round((rate * ms) / 1000);
  const b = Buffer.alloc(44 + n);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) b[44 + i] = 128 + Math.round(40 * Math.sin((i / rate) * 2 * Math.PI * 440));
  return b;
};
const ASSETS = {
  '/assets/symbols.png': ['image/png', () => makePng(64, 64)],
  '/assets/symbols.atlas': ['text/plain', () => 'symbols.png\nsize: 64,64\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\nH1\n  bounds: 0,0,32,32\n'],
  '/assets/dragon.json': ['application/json', () => JSON.stringify({ skeleton: { spine: '4.2.00', width: 64, height: 64 }, bones: [{ name: 'root' }], slots: [], skins: [], animations: { idle: {}, win: {} } })],
  '/assets/sheet.json': ['application/json', () => JSON.stringify({ frames: { a: { frame: { x: 0, y: 0, w: 32, h: 32 } } }, meta: { image: 'symbols.png' } })],
  '/assets/sfx/spin.wav': ['audio/wav', () => makeWav()],
  '/assets/fonts/ui.woff2': ['font/woff2', () => Buffer.from('wOF2-fixture-not-a-real-font')],
};

/** Deterministic Stake-Engine-style books: odd spins win (4 Hz highlight in the mock), even spins lose. */
const book = (n) => {
  const board = Array.from({ length: 5 }, (_, r) => Array.from({ length: 3 }, (_, i) => ({ name: 'ABCDEFG'[(n * 3 + r * 2 + i) % 7] })));
  const win = n % 2 === 1;
  if (win) for (let r = 0; r < 5; r++) board[r][1] = { name: 'W' };
  const events = [{ index: 0, type: 'reveal', board, paddingPositions: [0, 0, 0, 0, 0], gameType: 'basegame', anticipation: [0, 0, 0, 0, 0] }];
  if (win) {
    events.push({ index: 1, type: 'winInfo', totalWin: 250, wins: [{ symbol: 'W', kind: 5, win: 250, positions: [0, 1, 2, 3, 4].map((reel) => ({ reel, row: 1 })) }] });
    events.push({ index: 2, type: 'setTotalWin', amount: 250 });
    events.push({ index: 3, type: 'finalWin', amount: 250 });
  } else {
    events.push({ index: 1, type: 'setTotalWin', amount: 0 }, { index: 2, type: 'finalWin', amount: 0 });
  }
  return { payoutMultiplier: win ? 2.5 : 0, costMultiplier: 1, events };
};

export function startServer({ port = 0, latency = 80, root = HERE, quiet = true } = {}) {
  let balance = 1_000_000_000;
  let plays = 0;
  const log = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = decodeURIComponent(url.pathname);
    const send = (status, type, body, extra = {}) => {
      res.writeHead(status, { 'content-type': type, 'access-control-allow-origin': '*', 'cache-control': 'no-store', ...extra });
      res.end(body);
    };
    if (req.method === 'OPTIONS') return send(204, 'text/plain', '', { 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST' });
    if (!quiet) console.log(req.method, p);
    if (p === '/sleep') {
      const ms = Math.min(5000, Number(url.searchParams.get('ms') ?? 0));
      await new Promise((r) => setTimeout(r, ms));
      return send(200, 'text/plain', 'ok');
    }
    if (ASSETS[p]) return send(200, ASSETS[p][0], ASSETS[p][1]());
    if (p.startsWith('/rgs/')) {
      let body = '';
      for await (const c of req) body += c;
      let json = {};
      try {
        json = body ? JSON.parse(body) : {};
      } catch {}
      log.push({ path: p, body: json });
      await new Promise((r) => setTimeout(r, latency));
      const bal = () => ({ amount: balance, currency: 'USD' });
      if (!json.sessionID && !p.startsWith('/rgs/bet/replay')) return send(400, 'application/json', JSON.stringify({ error: 'ERR_IS' }));
      if (p === '/rgs/wallet/authenticate')
        return send(200, 'application/json', JSON.stringify({ balance: bal(), config: { gameID: 'mock', minBet: 100000, maxBet: 1000000000, stepBet: 10000, defaultBetLevel: 1000000, betLevels: [100000, 1000000, 10000000], jurisdiction: {} }, round: null }));
      if (p === '/rgs/wallet/play') {
        plays++;
        const b = book(plays);
        balance -= json.amount ?? 1000000;
        const payout = Math.round((json.amount ?? 1000000) * b.payoutMultiplier);
        return send(200, 'application/json', JSON.stringify({ balance: bal(), round: { betID: 1000 + plays, amount: json.amount ?? 1000000, payout, payoutMultiplier: b.payoutMultiplier, costMultiplier: 1, active: payout > 0, mode: json.mode ?? 'base', event: null, state: b.events } }));
      }
      if (p === '/rgs/wallet/end-round') return send(200, 'application/json', JSON.stringify({ balance: bal() }));
      if (p === '/rgs/wallet/balance') return send(200, 'application/json', JSON.stringify({ balance: bal() }));
      if (p === '/rgs/bet/event') return send(200, 'application/json', JSON.stringify({ event: json.event }));
      if (p.startsWith('/rgs/bet/replay/')) {
        const b = book(Number(p.split('/').pop()) || 1);
        return send(200, 'application/json', JSON.stringify({ payoutMultiplier: b.payoutMultiplier, costMultiplier: 1, state: b.events }));
      }
      return send(404, 'application/json', JSON.stringify({ error: 'NOT_FOUND' }));
    }
    const file = path.join(root, p === '/' ? 'anim.html' : p);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(404, 'text/plain', 'not found');
    const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png' }[path.extname(file)] ?? 'application/octet-stream';
    send(200, type, fs.readFileSync(file));
  });
  return new Promise((resolve) =>
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port;
      resolve({ server, port: actual, origin: `http://127.0.0.1:${actual}`, log, close: () => new Promise((r) => server.close(r)) });
    }),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const a = process.argv.slice(2);
  const get = (k, d) => (a.includes(`--${k}`) ? a[a.indexOf(`--${k}`) + 1] : d);
  const s = await startServer({ port: Number(get('port', 8765)), latency: Number(get('latency', 80)), quiet: false });
  console.log(`serving ${HERE} on ${s.origin}  (anim: ${s.origin}/anim.html  mock slot: ${s.origin}/mock-slot.html?sessionID=test-secret&rgs_url=127.0.0.1:${s.port}/rgs)`);
}
