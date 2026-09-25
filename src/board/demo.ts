import { devGameEnv, foldGameEvent, isGameEvent, playGameEvent } from '../book/gameEvents';
import { createRoundPlayback } from '../book/handlers';
import type { Book, ClusterWin, Position, RawSymbol } from '../book/types';
import { GRID, getSymbolDef } from '../config/game';
import { type SpeedProfile, getSpeedProfile, setSpeedProfile } from '../core/timing';
import type { GameContext } from '../game/context';
import type { GameEvents } from '../game/events';
import { planTumble } from './model';

/**
 * DEV ONLY — plays a book's board events by broadcasting the matching scene
 * events in book order (a stand-in for the flow module while it is written in
 * parallel), and cross-checks the Board model against the book:
 *   - after every reveal the model must equal reveal.board;
 *   - every winInfo position must hold the cluster symbol or a wild (this is an
 *     independent check of the tumble refill: wins after a tumble are computed
 *     by the math on the post-tumble board);
 *   - free-spin trigger positions must hold scatters.
 *
 *   const b = await __slot.fixtures();
 *   await __boardDemo(__slot.ctx, b.base.tumble_chain, { from: 0, speed: 'normal' });
 */
export interface BoardDemoOptions {
  /** first event index to animate; earlier events are applied instantly (board:set / spots:reset) */
  from?: number;
  /** last event index to play (inclusive) */
  to?: number;
  speed?: SpeedProfile;
  /** broadcast fs:trigger (other modules may show their intro overlay); default true */
  fsTrigger?: boolean;
}

interface BoardModel {
  readonly ids: string[][];
}

let board: BoardModel | null = null;
/** Called by Board.init() in DEV so the demo can verify the model. */
export const registerBoard = (b: BoardModel): void => {
  board = b;
};

const names = (b: RawSymbol[][]): string[][] => b.map((reel) => reel.map((s) => s.name));
const emptyGrid = (): number[][] => Array.from({ length: GRID.reels }, () => Array<number>(GRID.rows).fill(0));

const fail = (msg: string): never => {
  throw new Error(`[boardDemo] ${msg}`);
};

const verifyBoard = (expected: string[][], where: string): void => {
  if (!board) return;
  const ids = board.ids;
  for (let r = 0; r < GRID.reels; r++) {
    for (let row = 0; row < GRID.paddedRows; row++) {
      if (ids[r][row] !== expected[r][row]) fail(`${where}: slot ${r},${row} is ${ids[r][row]}, book says ${expected[r][row]}`);
    }
  }
};

const verifyWins = (wins: ClusterWin[], where: string): void => {
  if (!board) return;
  const ids = board.ids;
  for (const w of wins) {
    for (const p of w.positions) {
      const id = ids[p.reel][p.row];
      if (id !== w.symbol && getSymbolDef(id).kind !== 'wild') {
        fail(`${where}: win ${w.symbol} at ${p.reel},${p.row} but board shows ${id}`);
      }
    }
  }
};

const verifyScatters = (positions: Position[], where: string): void => {
  if (!board) return;
  const ids = board.ids;
  for (const p of positions) {
    if (getSymbolDef(ids[p.reel][p.row]).kind !== 'scatter') fail(`${where}: no scatter at ${p.reel},${p.row}`);
  }
};

export const playBoardBook = async (ctx: GameContext, book: Book, opts: BoardDemoOptions = {}): Promise<void> => {
  const emit = <K extends keyof GameEvents>(type: K, payload: GameEvents[K]) => ctx.game.broadcastAsync(type, payload);
  const prevSpeed = getSpeedProfile();
  if (opts.speed) setSpeedProfile(opts.speed);
  const profile = getSpeedProfile();
  const events = book.events;
  const from = Math.max(0, opts.from ?? 0);
  const to = Math.min(events.length - 1, opts.to ?? events.length - 1);

  // ---- fast-forward: rebuild board + spot/game state up to `from` ----------
  // (game events — Swamp Funk updateGrid, ... — fold/play through the game's book module)
  const state = createRoundPlayback();
  state.grid = emptyGrid();
  let ids: string[][] | null = null;
  let gameType: string | null = null;
  for (let i = 0; i < from; i++) {
    const e = events[i];
    if (e.type === 'reveal') {
      ids = names(e.board);
      gameType = e.gameType;
    } else if (e.type === 'tumbleBoard' && ids) {
      ids = planTumble(ids, e.explodingSymbols, names(e.newSymbols)).next;
    } else {
      foldGameEvent(state, e);
    }
  }
  if (gameType === 'freegame') await emit('mode:change', { gameType: 'freegame' });
  if (ids) await emit('board:set', { board: ids });
  await emit('spots:reset', { grid: from > 0 ? state.grid : null });
  state.gameType = gameType === 'freegame' ? 'freegame' : 'basegame';
  const env = devGameEnv(emit, state);

  // ---- play ---------------------------------------------------------------
  for (let i = from; i <= to; i++) {
    const e = events[i];
    const where = `book ${book.id} event #${e.index} ${e.type}`;
    if (isGameEvent(e)) {
      await playGameEvent(e, env);
      continue;
    }
    switch (e.type) {
      case 'reveal': {
        if (e.gameType !== gameType) {
          gameType = e.gameType;
          state.gameType = e.gameType;
          await emit('mode:change', { gameType: e.gameType });
        }
        await emit('round:start', { profile });
        const b = names(e.board);
        await emit('board:reveal', { board: b, anticipation: e.anticipation, gameType: e.gameType });
        verifyBoard(b, where);
        break;
      }
      case 'winInfo':
        verifyWins(e.wins, where);
        await emit('board:showWins', { wins: e.wins, totalWin: e.totalWin });
        break;
      case 'tumbleBoard':
        await emit('board:tumble', { exploding: e.explodingSymbols, newSymbols: names(e.newSymbols) });
        break;
      case 'freeSpinTrigger':
      case 'freeSpinRetrigger':
        verifyScatters(e.positions, where);
        if (opts.fsTrigger !== false) {
          await emit('fs:trigger', { total: e.totalFs, positions: e.positions, retrigger: e.type === 'freeSpinRetrigger' });
        }
        break;
      default:
        break;
    }
  }
  await emit('round:end', { totalWin: book.payoutMultiplier });
  if (opts.speed) setSpeedProfile(prevSpeed);
};

declare global {
  interface Window {
    __boardDemo?: (ctx: GameContext, book: Book, opts?: BoardDemoOptions) => Promise<void>;
  }
}

if (import.meta.env.DEV) window.__boardDemo = playBoardBook;
