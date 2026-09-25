import { BOOK_AMOUNT_SCALE, WIN_TIERS, type WinTierKey } from '../config/game';
import { clock } from '../core/clock';
import { TIMING, speedScale } from '../core/timing';
import type { GameContext } from '../game/context';
import type { GameRoundState } from '@game/book';
import { boardIds } from './adapter';
import {
  GAME_EVENT_TYPES,
  type GameEventEnv,
  createGameRoundState,
  foldGameEvent,
  isGameEvent,
  playGameEvent,
  restoreGameScene,
} from './gameEvents';
import type { BookEventHandler, BookEventHandlerMap } from './player';
import type { BookEvent, BookEventOf, CoreBookEventType, GameType, Position, RevealEvent } from './types';

/**
 * Book event -> scene choreography. Each handler awaits `ctx.game.broadcastAsync`
 * so the round only advances when every subscriber's animation has finished.
 *
 *   reveal          -> [mode:change] board:reveal
 *   winInfo         -> board:showWins            (winners stay visible, highlighted)
 *   updateTumbleWin -> win:tumble
 *   tumbleBoard     -> board:tumble              (explode + gravity refill)
 *   setWin          -> win:set + HUD count-up, or bigwin:show when >= BIG (15x)
 *   setTotalWin     -> win:total
 *   freeSpinTrigger / freeSpinRetrigger -> fs:trigger [+ mode:change freegame]
 *   updateFreeSpin  -> fs:update
 *   updateGlobalMult-> (state only — no scene event in the contract yet)
 *   freeSpinEnd     -> [bigwin:show] fs:end + mode:change basegame
 *   finalWin        -> win:final
 *   wincap          -> mascot 'celebrate' + HUD count-up to the cap; later tiers become 'max'
 *
 *   <game events>   -> the active game's handlers (src/games/<GAME>/book.ts via
 *                      book/gameEvents.ts), e.g. Swamp Funk updateGrid -> spots:update
 *
 * Mascot reactions / SFX are derived by the scene modules from these events (only the
 * wincap cue is emitted here: no scene event conveys a mid-bonus cap).
 * GameEvents amounts are BOOK units (x100 bet multiple); HUD values are API units.
 */

export interface FreeSpinsState {
  current: number;
  total: number;
}

/** Mutable per-round presentation state (also rebuilt from history on resume). */
export interface RoundPlayback {
  gameType: GameType;
  /** bet mode of the round ('BASE', or the bought feature's mode) */
  betMode: string;
  /** ids [reel][paddedRow] of the board currently on screen */
  board: string[][] | null;
  /** last multiplier grid (unpadded) or null while no spots are shown */
  grid: number[][] | null;
  /** round total so far (book units; last setTotalWin) */
  roundTotal: number;
  /** round total when the current (free)spin started */
  spinStartTotal: number;
  /** running win of the current spin (updateTumbleWin) */
  spinWin: number;
  freeSpins: FreeSpinsState | null;
  globalMult: number;
  wincap: boolean;
  /** win value shown by the HUD (API units) */
  hudWin: number;
  /** the active game's per-round extras (src/games/<GAME>/book.ts) */
  game: GameRoundState;
}

export interface PlaybackHooks {
  /** a reveal is about to play (bonus rounds: the flow records /bet/event) */
  onReveal?(event: RevealEvent): void;
  /** HUD-visible state changed (win value / free-spin counter) */
  onHudChange?(state: RoundPlayback): void;
}

export interface BookContext {
  ctx: GameContext;
  bookEvents: readonly BookEvent[];
  state: RoundPlayback;
  hooks: PlaybackHooks;
}

export const createRoundPlayback = (
  gameType: GameType = 'basegame',
  board: string[][] | null = null,
  betMode = 'BASE',
): RoundPlayback => ({
  gameType,
  betMode,
  board,
  grid: null,
  roundTotal: 0,
  spinStartTotal: 0,
  spinWin: 0,
  freeSpins: null,
  globalMult: 1,
  wincap: false,
  hudWin: 0,
  game: createGameRoundState(),
});

/** WIN_TIERS key for a bet multiple (null below BIG). A capped win is always 'max'. */
export const winTierFor = (multiple: number, capped = false): WinTierKey | null => {
  if (capped) return 'max';
  let tier: WinTierKey | null = null;
  for (const t of WIN_TIERS) if (multiple >= t.minX) tier = t.key;
  return tier;
};

/** Board after a tumble: exploded cells removed, new symbols stacked on top (index 0 = top). */
export const applyTumble = (board: string[][], exploding: readonly Position[], newSymbols: string[][]): string[][] =>
  board.map((reel, r) => {
    const gone = new Set(exploding.filter((p) => p.reel === r).map((p) => p.row));
    const next = [...(newSymbols[r] ?? []), ...reel.filter((_, row) => !gone.has(row))];
    return next.length > reel.length ? next.slice(next.length - reel.length) : next;
  });

const copyGrid = (g: number[][]): number[][] => g.map((col) => [...col]);

const setHudWin = (c: BookContext, apiUnits: number): void => {
  if (c.state.hudWin === apiUnits) return;
  c.state.hudWin = apiUnits;
  c.hooks.onHudChange?.(c.state);
};

/** Count the HUD win display up to `to` (API units) over a speed-scaled duration. */
const countHud = async (c: BookContext, to: number, ms: number): Promise<void> => {
  const from = c.state.hudWin;
  if (to <= from || ms <= 0) {
    setHudWin(c, to);
    return;
  }
  await Promise.all([
    c.ctx.hud.broadcastAsync('hud:countWin', { from, to, durationMs: ms / speedScale() }),
    clock.wait(ms),
  ]);
  setHudWin(c, to);
};

const smallCountMs = (level: number): number => {
  const table = TIMING.counters.smallByLevel;
  return table[Math.max(1, Math.min(table.length - 1, Math.round(level)))];
};

/** Switch base <-> free presentation (only when it actually changes). */
const setGameType = async (c: BookContext, gameType: GameType): Promise<void> => {
  if (c.state.gameType === gameType) return;
  c.state.gameType = gameType;
  const tasks = [c.ctx.game.broadcastAsync('mode:change', { gameType })];
  if (gameType === 'basegame') {
    c.state.grid = null;
    tasks.push(c.ctx.game.broadcastAsync('spots:reset', { grid: null }));
  }
  await Promise.all(tasks);
};

type CoreHandlerMap = { [K in CoreBookEventType]: BookEventHandler<BookEventOf<K>, BookContext> };

const coreHandlers: CoreHandlerMap = {
  reveal: async (e, c) => {
    const { ctx, state } = c;
    state.spinStartTotal = state.roundTotal;
    state.spinWin = 0;
    c.hooks.onReveal?.(e);
    await setGameType(c, e.gameType);
    const board = boardIds(e.board);
    state.board = board;
    await ctx.game.broadcastAsync('board:reveal', { board, anticipation: e.anticipation, gameType: e.gameType });
  },

  winInfo: async (e, c) => {
    await c.ctx.game.broadcastAsync('board:showWins', { wins: e.wins, totalWin: e.totalWin });
  },

  updateTumbleWin: async (e, c) => {
    c.state.spinWin = e.amount;
    await c.ctx.game.broadcastAsync('win:tumble', { amount: e.amount });
  },

  tumbleBoard: async (e, c) => {
    const { ctx, state } = c;
    const newSymbols = boardIds(e.newSymbols);
    await ctx.game.broadcastAsync('board:tumble', { exploding: e.explodingSymbols, newSymbols });
    if (state.board) state.board = applyTumble(state.board, e.explodingSymbols, newSymbols);
  },

  setWin: async (e, c) => {
    const { ctx, state } = c;
    const tier = winTierFor(e.amount / BOOK_AMOUNT_SCALE, state.wincap);
    const target = ctx.money.fromBook(state.spinStartTotal + e.amount);
    const tasks: Promise<unknown>[] = [ctx.game.broadcastAsync('win:set', { amount: e.amount, level: e.winLevel })];
    if (tier) {
      tasks.push(ctx.game.broadcastAsync('bigwin:show', { amount: e.amount, tier }));
    } else {
      tasks.push(countHud(c, target, smallCountMs(e.winLevel)));
    }
    await Promise.all(tasks);
    setHudWin(c, target);
  },

  setTotalWin: async (e, c) => {
    c.state.roundTotal = e.amount;
    await c.ctx.game.broadcastAsync('win:total', { amount: e.amount });
    if (c.ctx.money.fromBook(e.amount) > c.state.hudWin) setHudWin(c, c.ctx.money.fromBook(e.amount));
  },

  freeSpinTrigger: async (e, c) => {
    const { ctx, state } = c;
    state.freeSpins = { current: 0, total: e.totalFs };
    c.hooks.onHudChange?.(state);
    await ctx.game.broadcastAsync('fs:trigger', { total: e.totalFs, positions: e.positions, retrigger: false });
    await setGameType(c, 'freegame');
  },

  freeSpinRetrigger: async (e, c) => {
    const { ctx, state } = c;
    state.freeSpins = { current: state.freeSpins?.current ?? 0, total: e.totalFs };
    c.hooks.onHudChange?.(state);
    await ctx.game.broadcastAsync('fs:trigger', { total: e.totalFs, positions: e.positions, retrigger: true });
  },

  updateFreeSpin: async (e, c) => {
    c.state.freeSpins = { current: e.amount, total: e.total };
    c.hooks.onHudChange?.(c.state);
    await c.ctx.game.broadcastAsync('fs:update', { current: e.amount, total: e.total });
  },

  updateGlobalMult: async (e, c) => {
    // Current math never emits this (Swamp Funk multipliers live in the spot grid). Kept as
    // state so labels/resume stay correct if the math adds a global multiplier.
    c.state.globalMult = e.globalMult;
  },

  freeSpinEnd: async (e, c) => {
    const { ctx, state } = c;
    const tier = winTierFor(e.amount / BOOK_AMOUNT_SCALE, state.wincap);
    if (tier) {
      await ctx.game.broadcastAsync('bigwin:show', { amount: e.amount, tier });
    }
    await ctx.game.broadcastAsync('fs:end', { amount: e.amount, level: e.winLevel });
    state.freeSpins = null;
    c.hooks.onHudChange?.(state);
    await setGameType(c, 'basegame');
  },

  finalWin: async (e, c) => {
    const target = c.ctx.money.fromBook(e.amount);
    await Promise.all([
      c.ctx.game.broadcastAsync('win:final', { amount: e.amount }),
      countHud(c, target, smallCountMs(1)),
    ]);
    setHudWin(c, target);
  },

  wincap: async (e, c) => {
    const { ctx, state } = c;
    state.wincap = true;
    ctx.game.broadcast('mascot:cue', { cue: 'celebrate', intensity: 1 });
    const cap = e.amount ?? state.spinStartTotal + state.spinWin;
    await countHud(c, ctx.money.fromBook(cap), smallCountMs(5));
  },
};

/** The game's handlers see the round through a GameEventEnv (same shape the DEV players use). */
const gameEnv = (c: BookContext): GameEventEnv => ({
  emit: (type, payload) => c.ctx.game.broadcastAsync(type, payload),
  state: c.state,
  hudChanged: () => c.hooks.onHudChange?.(c.state),
  setGameType: (gameType) => setGameType(c, gameType),
});

const gameHandler = async (e: BookEvent, c: BookContext): Promise<void> => {
  if (isGameEvent(e)) await playGameEvent(e, gameEnv(c));
};

/**
 * Core handlers + one entry per game event type (all routed through gameHandler). An event
 * type in neither still has no handler, so the player throws on it in DEV.
 */
export const bookEventHandlerMap = {
  ...Object.fromEntries(GAME_EVENT_TYPES.map((type) => [type, gameHandler])),
  ...coreHandlers,
} as BookEventHandlerMap<BookContext>;

/**
 * Fold already-played events into a playback state WITHOUT presenting them
 * (resume mid-bonus: the web-sdk "createBonusSnapshot" equivalent).
 */
export const foldHistory = (state: RoundPlayback, events: readonly BookEvent[], money: GameContext['money']): RoundPlayback => {
  for (const e of events) {
    switch (e.type) {
      case 'reveal':
        state.board = boardIds(e.board);
        state.gameType = e.gameType;
        state.spinStartTotal = state.roundTotal;
        state.spinWin = 0;
        break;
      case 'tumbleBoard':
        if (state.board) state.board = applyTumble(state.board, e.explodingSymbols, boardIds(e.newSymbols));
        break;
      case 'updateTumbleWin':
        state.spinWin = e.amount;
        break;
      case 'setTotalWin':
        state.roundTotal = e.amount;
        break;
      case 'freeSpinTrigger':
      case 'freeSpinRetrigger':
        state.freeSpins = { current: state.freeSpins?.current ?? 0, total: e.totalFs };
        state.gameType = 'freegame';
        break;
      case 'updateFreeSpin':
        state.freeSpins = { current: e.amount, total: e.total };
        break;
      case 'updateGlobalMult':
        state.globalMult = e.globalMult;
        break;
      case 'wincap':
        state.wincap = true;
        break;
      case 'freeSpinEnd':
        state.freeSpins = null;
        state.gameType = 'basegame';
        state.grid = null;
        break;
      default:
        break;
    }
    // the game folds its own events (and may react to core ones, e.g. reset extras on freeSpinEnd)
    foldGameEvent(state, e);
  }
  state.hudWin = money.fromBook(state.roundTotal);
  return state;
};

/** Put the scene into a folded state instantly (no fanfare): resume / replay start. */
export const restoreScene = async (ctx: GameContext, state: RoundPlayback): Promise<void> => {
  const tasks: Promise<void>[] = [ctx.game.broadcastAsync('mode:change', { gameType: state.gameType })];
  if (state.board) tasks.push(ctx.game.broadcastAsync('board:set', { board: state.board }));
  tasks.push(ctx.game.broadcastAsync('spots:reset', { grid: state.grid ? copyGrid(state.grid) : null }));
  if (state.freeSpins) tasks.push(ctx.game.broadcastAsync('fs:update', { ...state.freeSpins }));
  if (state.roundTotal > 0) tasks.push(ctx.game.broadcastAsync('win:total', { amount: state.roundTotal }));
  await Promise.all(tasks);
  await restoreGameScene({ emit: (type, payload) => ctx.game.broadcastAsync(type, payload), state });
};
