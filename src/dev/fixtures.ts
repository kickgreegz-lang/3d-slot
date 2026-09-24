import type { Book, BookEvent, GameType, RawSymbol } from '../book/types';
import { GRID } from '../config/game';
import { getSpeedProfile } from '../core/timing';
import type { GameEvents } from '../game/events';

/**
 * DEV-ONLY fixture books + a minimal book -> scene-event mapper for the animation
 * lab and Playwright QA. It mirrors the flow module's handler map (reveal ->
 * board:reveal, winInfo -> board:showWins, updateGrid -> spots:update,
 * tumbleBoard -> board:tumble, updateTumbleWin -> win:tumble, ...) WITHOUT money,
 * RGS or FSM, so visual modules can be exercised in isolation.
 */

export interface FixtureBooks {
  base: Record<string, Book>;
  bonus: Record<string, Book>;
}

/** Awaitable scene emitter (the lab wraps broadcastAsync with logging). */
export type SceneEmit = <K extends keyof GameEvents>(type: K, payload: GameEvents[K]) => Promise<void>;

const FIXTURE_URLS = {
  base: '/mock/books/base_fixtures.json',
  bonus: '/mock/books/bonus_fixtures.json',
} as const;

let pending: Promise<FixtureBooks> | null = null;

const fetchBooks = async (url: string): Promise<Record<string, Book>> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fixture fetch failed: ${url} (${res.status})`);
  return (await res.json()) as Record<string, Book>;
};

/** Loads (once) the fixture books served by the Vite dev server from mock/books. */
export const loadFixtures = (): Promise<FixtureBooks> => {
  pending ??= Promise.all([fetchBooks(FIXTURE_URLS.base), fetchBooks(FIXTURE_URLS.bonus)])
    .then(([base, bonus]) => ({ base, bonus }))
    .catch((err: unknown) => {
      pending = null;
      throw err;
    });
  return pending;
};

export const boardNames = (board: RawSymbol[][]): string[][] => board.map((reel) => reel.map((s) => s.name));

export const emptySpots = (): number[][] =>
  Array.from({ length: GRID.reels }, () => Array.from({ length: GRID.rows }, () => 0));

const cloneGrid = (g: number[][]): number[][] => g.map((r) => [...r]);

/** Finds the n-th event of a type (0-based) in a book. */
export const findEvent = <T extends BookEvent['type']>(
  book: Book,
  type: T,
  nth = 0,
): Extract<BookEvent, { type: T }> => {
  const hits = book.events.filter((e): e is Extract<BookEvent, { type: T }> => e.type === type);
  const hit = hits[nth];
  if (!hit) throw new Error(`Book ${book.id} has no ${type} #${nth}`);
  return hit;
};

export interface PlayerOptions {
  /** emit round:start before every reveal (old board falls out first). default true */
  spinBeforeReveal?: boolean;
}

/**
 * Stateful book -> scene mapper (tracks spot grid + game type so spots:update
 * gets a correct `previous` and base<->free transitions emit mode:change).
 */
export class ScenePlayer {
  private spots = emptySpots();
  private gameType: GameType = 'basegame';

  constructor(
    private readonly emit: SceneEmit,
    private readonly opts: PlayerOptions = {},
  ) {}

  /** Syncs internal state with what the scene currently shows (after spots:reset / mode:change). */
  sync(gameType: GameType, spots: number[][] | null): void {
    this.gameType = gameType;
    this.spots = spots ? cloneGrid(spots) : emptySpots();
  }

  async playAll(events: readonly BookEvent[]): Promise<void> {
    for (const e of events) await this.play(e);
  }

  async play(e: BookEvent): Promise<void> {
    const emit = this.emit;
    switch (e.type) {
      case 'reveal':
        if (e.gameType !== this.gameType) {
          this.gameType = e.gameType;
          await emit('mode:change', { gameType: e.gameType });
        }
        if (this.opts.spinBeforeReveal ?? true) await emit('round:start', { profile: getSpeedProfile() });
        await emit('board:reveal', { board: boardNames(e.board), anticipation: e.anticipation, gameType: e.gameType });
        return;
      case 'winInfo':
        await emit('board:showWins', { wins: e.wins, totalWin: e.totalWin });
        return;
      case 'updateTumbleWin':
        await emit('win:tumble', { amount: e.amount });
        return;
      case 'tumbleBoard':
        await emit('board:tumble', { exploding: e.explodingSymbols, newSymbols: boardNames(e.newSymbols) });
        return;
      case 'updateGrid': {
        const previous = this.spots;
        this.spots = cloneGrid(e.gridMultipliers);
        await emit('spots:update', { grid: cloneGrid(e.gridMultipliers), previous });
        return;
      }
      case 'setWin':
        await emit('win:set', { amount: e.amount, level: e.winLevel });
        return;
      case 'setTotalWin':
        await emit('win:total', { amount: e.amount });
        return;
      case 'freeSpinTrigger':
      case 'freeSpinRetrigger':
        await emit('fs:trigger', {
          total: e.totalFs,
          positions: e.positions,
          retrigger: e.type === 'freeSpinRetrigger',
        });
        return;
      case 'updateFreeSpin':
        await emit('fs:update', { current: e.amount, total: e.total });
        return;
      case 'freeSpinEnd':
        await emit('fs:end', { amount: e.amount, level: e.winLevel });
        return;
      case 'finalWin':
        await emit('win:final', { amount: e.amount });
        return;
      case 'updateGlobalMult':
      case 'wincap':
        return;
    }
  }
}
