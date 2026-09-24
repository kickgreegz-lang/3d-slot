import { BOOK_AMOUNT_SCALE, GRID } from '../config/game';
import type { Book, BookEvent, ClusterWin, GameType, RawSymbol } from './types';

/**
 * Normalises books from any source (RGS round.state, replay, fixtures, legacy
 * web-sdk sample books) into the current math-sdk upload format the handlers expect:
 *
 *  - payoutMultiplier: int x100 (legacy float 1.3 -> 130; finalWin is authoritative)
 *  - winInfo meta.winWithoutMult: int x100 (legacy float 1.3 -> 130, detected per win
 *    by checking which scale reproduces `win`)
 *  - updateFreeSpin.amount: 1-based (generic math-sdk executables emit 0-based)
 *  - reveal.gameType 'freeSpins' (scatter FE) -> 'freegame'; missing anticipation -> zeros
 *  - setTumbleWin -> updateTumbleWin; missing `index` -> array position
 */

type Loose = Record<string, unknown>;

const isObj = (v: unknown): v is Loose => typeof v === 'object' && v !== null;
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

const normGameType = (v: unknown): GameType =>
  v === 'freegame' || v === 'freeSpins' || v === 'freespins' || v === 'bonus' ? 'freegame' : 'basegame';

const normWin = (w: Loose): ClusterWin => {
  const meta = isObj(w.meta) ? w.meta : {};
  const win = num(w.win);
  const globalMult = num(meta.globalMult, 1) || 1;
  const clusterMult = num(meta.clusterMult, 1) || 1;
  let wwm = num(meta.winWithoutMult, win / (globalMult * clusterMult));
  // legacy books carry winWithoutMult as a float bet multiple (x1 instead of x100)
  const legacy = !Number.isInteger(wwm) || Math.abs(wwm * 100 * globalMult * clusterMult - win) < Math.abs(wwm * globalMult * clusterMult - win);
  if (legacy) wwm = Math.round(wwm * BOOK_AMOUNT_SCALE);
  const positions = Array.isArray(w.positions) ? (w.positions as ClusterWin['positions']) : [];
  const overlay = isObj(meta.overlay) ? (meta.overlay as unknown as ClusterWin['meta']['overlay']) : positions[0];
  return {
    symbol: String(w.symbol ?? ''),
    clusterSize: num(w.clusterSize, positions.length),
    win,
    positions,
    meta: { globalMult, clusterMult, winWithoutMult: wwm, overlay: overlay ?? { reel: 0, row: GRID.firstVisibleRow } },
  };
};

/** Normalise an events array (RGS `round.state` / replay `state` / book `events`). */
export const normalizeEvents = (raw: unknown): BookEvent[] => {
  if (!Array.isArray(raw)) return [];
  const fsZeroBased = raw.some((e) => isObj(e) && e.type === 'updateFreeSpin' && num(e.amount, -1) === 0);
  const out: BookEvent[] = [];
  raw.forEach((e, i) => {
    if (!isObj(e) || typeof e.type !== 'string') return;
    const ev: Loose = { ...e, index: num(e.index, i) };
    switch (e.type) {
      case 'reveal':
        ev.gameType = normGameType(e.gameType);
        ev.anticipation = Array.isArray(e.anticipation) ? e.anticipation : new Array(GRID.reels).fill(0);
        ev.board = Array.isArray(e.board) ? e.board : [];
        break;
      case 'winInfo':
        ev.wins = Array.isArray(e.wins) ? e.wins.filter(isObj).map(normWin) : [];
        ev.totalWin = num(e.totalWin);
        break;
      case 'setTumbleWin':
        ev.type = 'updateTumbleWin';
        break;
      case 'updateFreeSpin':
        if (fsZeroBased) ev.amount = num(e.amount) + 1;
        break;
      default:
        break;
    }
    out.push(ev as unknown as BookEvent);
  });
  return out;
};

/** Normalise a whole book (fixture / uploaded format / legacy sample). */
export const normalizeBook = (raw: unknown): Book => {
  const b = isObj(raw) ? raw : {};
  const events = normalizeEvents(Array.isArray(raw) ? raw : b.events ?? b.state);
  const final = [...events].reverse().find((e) => e.type === 'finalWin');
  let payoutMultiplier = num(b.payoutMultiplier);
  if (final && final.type === 'finalWin') payoutMultiplier = final.amount;
  else if (!Number.isInteger(payoutMultiplier)) payoutMultiplier = Math.round(payoutMultiplier * BOOK_AMOUNT_SCALE);
  return {
    id: num(b.id),
    payoutMultiplier,
    events,
    criteria: typeof b.criteria === 'string' ? b.criteria : undefined,
  };
};

/** Symbol object -> registry id ({name:'S', scatter:true} -> 'S'). */
export const symbolId = (s: RawSymbol | string): string => (typeof s === 'string' ? s : s.name);

/** RawSymbol[][] -> id[][] (same [reel][paddedRow] layout). */
export const boardIds = (board: ReadonlyArray<ReadonlyArray<RawSymbol | string>>): string[][] =>
  board.map((reel) => reel.map(symbolId));

export const countReveals = (events: readonly BookEvent[]): number =>
  events.reduce((n, e) => n + (e.type === 'reveal' ? 1 : 0), 0);
