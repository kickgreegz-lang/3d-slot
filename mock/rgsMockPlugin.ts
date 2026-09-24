import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

/**
 * DEV-ONLY mock Stake Engine RGS, mounted by the Vite dev server at `/__rgs`.
 * Implements the exact wire shapes of the live RGS (money = integer API units,
 * round.state = book events) on top of the generated 7x5 fixture books:
 *
 *   POST /wallet/authenticate {sessionID, language}     -> {balance, config, round, meta}
 *   POST /wallet/play         {sessionID, amount, mode} -> {balance, round}
 *   POST /wallet/end-round    {sessionID}               -> {balance}
 *   POST /wallet/balance      {sessionID}               -> {balance}
 *   POST /bet/event           {sessionID, event}        -> {event}
 *   GET  /bet/replay/{game}/{version}/{mode}/{event}    -> {payoutMultiplier, costMultiplier, state}
 *   POST /__mock/reset        {sessionID}               -> {} (drop the session; dev tooling)
 *
 * Mock-only query parameters (the game client forwards them from the page URL in DEV):
 *   play:         book=<fixture key | book id>  bookMode=base|bonus
 *   authenticate: currency=<code>  jurisdiction=disabledTurbo,minimumRoundDuration:3000,...
 *
 * Book choice: BASE picks a random book from books_base_200.json, BONUS from
 * books_bonus_100.json; `book` forces a fixture (base_fixtures.json / bonus_fixtures.json
 * keys, or any book id found in the fixture files or pools).
 * Sessions live in memory (per sessionID), so reloading mid-bonus exercises resume.
 */

interface MockBook {
  id: number;
  payoutMultiplier: number;
  events: unknown[];
}

interface MockRound {
  betID: number;
  amount: number;
  payout: number;
  payoutMultiplier: number;
  costMultiplier: number;
  active: boolean;
  mode: string;
  event: string | null;
  state: unknown[];
}

interface Session {
  balance: number;
  currency: string;
  jurisdiction: Record<string, boolean | number>;
  round: MockRound | null;
}

const API = 1_000_000;
const DEMO_BALANCE = 1000 * API;
const BET_LEVELS = [
  0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.2, 1.4, 1.6, 1.8, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 25, 30,
  35, 40, 50, 60, 70, 80, 90, 100,
].map((v) => Math.round(v * API));
const BET_MODES: Record<string, { costMultiplier: number; pool: 'base' | 'bonus' }> = {
  BASE: { costMultiplier: 1, pool: 'base' },
  BONUS: { costMultiplier: 100, pool: 'bonus' },
};
const JURISDICTION_DEFAULTS: Record<string, boolean | number> = {
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

class BookStore {
  private cache: {
    fixtures: Record<'base' | 'bonus', Record<string, MockBook>>;
    pools: Record<'base' | 'bonus', MockBook[]>;
  } | null = null;

  constructor(private readonly dir: string) {}

  private load() {
    if (this.cache) return this.cache;
    const read = <T>(file: string): T => JSON.parse(fs.readFileSync(path.join(this.dir, file), 'utf8')) as T;
    this.cache = {
      fixtures: {
        base: read<Record<string, MockBook>>('base_fixtures.json'),
        bonus: read<Record<string, MockBook>>('bonus_fixtures.json'),
      },
      pools: {
        base: read<MockBook[]>('books_base_200.json'),
        bonus: read<MockBook[]>('books_bonus_100.json'),
      },
    };
    return this.cache;
  }

  /** Forced fixture key / id, searched in the requested pool first. */
  find(key: string, pool: 'base' | 'bonus'): MockBook | null {
    const { fixtures, pools } = this.load();
    const order: Array<'base' | 'bonus'> = pool === 'base' ? ['base', 'bonus'] : ['bonus', 'base'];
    for (const p of order) if (fixtures[p][key]) return fixtures[p][key];
    const id = Number(key);
    if (!Number.isInteger(id)) return null;
    for (const p of order) {
      const hit = pools[p].find((b) => b.id === id) ?? Object.values(fixtures[p]).find((b) => b.id === id);
      if (hit) return hit;
    }
    return null;
  }

  random(pool: 'base' | 'bonus'): MockBook {
    const list = this.load().pools[pool];
    return list[Math.floor(Math.random() * list.length)];
  }
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const readBody = (req: IncomingMessage): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c: Buffer) => {
      raw += c.toString('utf8');
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        const v: unknown = JSON.parse(raw);
        resolve(v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
      } catch {
        reject(new HttpError(400, 'ERR_VAL', 'Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });

const send = (res: ServerResponse, status: number, body: unknown): void => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

const parseJurisdiction = (spec: string | null): Record<string, boolean | number> => {
  const flags = { ...JURISDICTION_DEFAULTS };
  if (!spec) return flags;
  for (const part of spec.split(',')) {
    const [k, v] = part.split(':');
    if (!(k in flags)) continue;
    flags[k] = typeof flags[k] === 'number' ? Number(v ?? 0) || 0 : v !== 'false';
  }
  return flags;
};

export interface RgsMockOptions {
  /** mount point (default '/__rgs') */
  base?: string;
  /** fixture folder (default <root>/mock/books) */
  booksDir?: string;
}

export const rgsMockPlugin = (opts: RgsMockOptions = {}): Plugin => {
  const mount = opts.base ?? '/__rgs';
  let books: BookStore | null = null;
  const sessions = new Map<string, Session>();
  let nextBetId = 1000;

  const session = (body: Record<string, unknown>): Session => {
    const id = typeof body.sessionID === 'string' ? body.sessionID : '';
    const s = sessions.get(id);
    if (!id || !s) throw new HttpError(401, 'ERR_IS', 'Invalid or expired sessionID.');
    return s;
  };
  const balance = (s: Session) => ({ amount: s.balance, currency: s.currency });
  const publicRound = (r: MockRound | null) => (r ? { ...r } : null);

  const routes: Record<string, (body: Record<string, unknown>, q: URLSearchParams) => unknown> = {
    'POST /wallet/authenticate': (body, q) => {
      const id = typeof body.sessionID === 'string' ? body.sessionID : '';
      if (!id) throw new HttpError(400, 'ERR_VAL', 'sessionID is required.');
      let s = sessions.get(id);
      if (!s) {
        s = { balance: DEMO_BALANCE, currency: 'USD', jurisdiction: { ...JURISDICTION_DEFAULTS }, round: null };
        sessions.set(id, s);
      }
      const currency = q.get('currency');
      if (currency) s.currency = currency.toUpperCase();
      if (q.has('jurisdiction')) s.jurisdiction = parseJurisdiction(q.get('jurisdiction'));
      return {
        balance: balance(s),
        config: {
          gameID: 'swamp-funk-7x5',
          minBet: BET_LEVELS[0],
          maxBet: BET_LEVELS[BET_LEVELS.length - 1],
          stepBet: 10_000,
          defaultBetLevel: API,
          betLevels: BET_LEVELS,
          betModes: Object.fromEntries(
            Object.entries(BET_MODES).map(([k, m]) => [k, { costMultiplier: m.costMultiplier }]),
          ),
          jurisdiction: s.jurisdiction,
        },
        round: publicRound(s.round),
        meta: null,
      };
    },

    'POST /wallet/play': (body, q) => {
      const s = session(body);
      const amount = Number(body.amount);
      const mode = typeof body.mode === 'string' ? body.mode.toUpperCase() : '';
      const info = BET_MODES[mode];
      if (!info) throw new HttpError(400, 'ERR_VAL', `Unknown bet mode "${String(body.mode)}".`);
      if (!BET_LEVELS.includes(amount)) throw new HttpError(400, 'ERR_VAL', `Invalid bet amount ${amount}.`);
      if (s.round?.active) throw new HttpError(400, 'ERR_VAL', 'A round is already active.');
      const cost = Math.round(amount * info.costMultiplier);
      if (s.balance < cost) throw new HttpError(400, 'ERR_IPB', 'Insufficient player balance.');

      const pool = q.get('bookMode') === 'bonus' ? 'bonus' : q.get('bookMode') === 'base' ? 'base' : info.pool;
      const forced = q.get('book');
      const store = books as BookStore;
      const book = forced ? store.find(forced, pool) : store.random(pool);
      if (!book) throw new HttpError(400, 'ERR_VAL', `Mock: unknown fixture "${forced}".`);

      const payout = Math.round((amount * book.payoutMultiplier) / 100);
      s.balance -= cost;
      s.round = {
        betID: nextBetId++,
        amount,
        payout,
        payoutMultiplier: book.payoutMultiplier / 100,
        costMultiplier: info.costMultiplier,
        // zero-payout rounds are completed by the RGS itself
        active: payout > 0,
        mode,
        event: null,
        state: book.events,
      };
      return { balance: balance(s), round: publicRound(s.round) };
    },

    'POST /wallet/end-round': (body) => {
      const s = session(body);
      if (!s.round?.active) throw new HttpError(400, 'ERR_VAL', 'No active round.');
      s.balance += s.round.payout;
      s.round.active = false;
      return { balance: balance(s) };
    },

    'POST /wallet/balance': (body) => ({ balance: balance(session(body)) }),

    'POST /bet/event': (body) => {
      const s = session(body);
      const event = typeof body.event === 'string' ? body.event : String(body.event ?? '');
      if (!s.round?.active) throw new HttpError(400, 'ERR_VAL', 'No active round.');
      s.round.event = event;
      return { event };
    },

    'POST /__mock/reset': (body) => {
      if (typeof body.sessionID === 'string') sessions.delete(body.sessionID);
      else sessions.clear();
      return {};
    },
  };

  const replay = (pathname: string): unknown => {
    // '/bet/replay/{game}/{version}/{mode}/{event}'
    const [, , , game, version, mode, event] = pathname.split('/').map(decodeURIComponent);
    if (!game || !version || !mode || !event) throw new HttpError(400, 'ERR_VAL', 'Malformed replay path.');
    const info = BET_MODES[mode.toUpperCase()];
    const book = info ? (books as BookStore).find(event, info.pool) : null;
    if (!info || !book) throw new HttpError(404, 'NOT_FOUND', 'Replay data not found.');
    return { payoutMultiplier: book.payoutMultiplier / 100, costMultiplier: info.costMultiplier, state: book.events };
  };

  return {
    name: 'stake-rgs-mock',
    apply: 'serve',
    configResolved(config) {
      books = new BookStore(opts.booksDir ?? path.resolve(config.root, 'mock/books'));
    },
    configureServer(server) {
      server.middlewares.use(mount, (req, res) => {
        void (async () => {
          const url = new URL(req.url ?? '/', 'http://mock.local');
          const method = (req.method ?? 'GET').toUpperCase();
          if (method === 'OPTIONS') return send(res, 204, {});
          try {
            if (method === 'GET' && url.pathname.startsWith('/bet/replay/')) {
              return send(res, 200, replay(url.pathname));
            }
            const route = routes[`${method} ${url.pathname}`];
            if (!route) throw new HttpError(404, 'ERR_VAL', `Mock RGS: no route ${method} ${url.pathname}`);
            const body = method === 'POST' ? await readBody(req) : {};
            send(res, 200, route(body, url.searchParams));
          } catch (e) {
            if (e instanceof HttpError) send(res, e.status, { error: e.code, message: e.message });
            else send(res, 500, { error: 'ERR_GEN', message: e instanceof Error ? e.message : 'Mock failure' });
          }
        })();
      });
    },
  };
};
