import { devGameEnv, isGameEvent, playGameEvent } from '../book/gameEvents';
import { createRoundPlayback } from '../book/handlers';
import type { Book, BookEvent, GameType, RawSymbol } from '../book/types';
import { GRID } from '../config/game';
import { getSpeedProfile } from '../core/timing';
import type { SceneEmit } from '../game/events';

/**
 * DEV-ONLY fixture books + a minimal book -> scene-event mapper for the animation
 * lab and Playwright QA. It mirrors the flow module's handler map (reveal ->
 * board:reveal, winInfo -> board:showWins, tumbleBoard -> board:tumble,
 * updateTumbleWin -> win:tumble, ...; game events such as Swamp Funk's updateGrid go
 * through the game's own handlers) WITHOUT money, RGS or FSM, so visual modules can be
 * exercised in isolation.
 */

/**
 * Fixture books by set ('base', 'bonus', and any other `<set>_fixtures.json` the game
 * ships) and scenario key. A set the game has no file for is empty.
 */
export interface FixtureBooks {
  base: Record<string, Book>;
  bonus: Record<string, Book>;
  [set: string]: Record<string, Book>;
}

export type { SceneEmit };

/** Served by the mock RGS plugin from mock/games/<GAME>/books (missing files -> empty sets). */
const FIXTURE_URL = '/__rgs/__mock/fixtures';

let pending: Promise<FixtureBooks> | null = null;

const fetchBooks = async (url: string): Promise<FixtureBooks> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fixture fetch failed: ${url} (${res.status})`);
  const sets = (await res.json()) as Partial<FixtureBooks>;
  return { ...sets, base: sets.base ?? {}, bonus: sets.bonus ?? {} };
};

/** Loads (once) the active game's fixture books (mock/games/<GAME>/books via the dev server). */
export const loadFixtures = (): Promise<FixtureBooks> => {
  pending ??= fetchBooks(FIXTURE_URL).catch((err: unknown) => {
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
  /** playback state shared with the game's handlers (spot grid starts empty, not null) */
  private readonly state = createRoundPlayback('basegame');

  constructor(
    private readonly emit: SceneEmit,
    private readonly opts: PlayerOptions = {},
  ) {
    this.state.grid = emptySpots();
  }

  /** Syncs internal state with what the scene currently shows (after spots:reset / mode:change). */
  sync(gameType: GameType, spots: number[][] | null): void {
    this.state.gameType = gameType;
    this.state.grid = spots ? cloneGrid(spots) : emptySpots();
  }

  async playAll(events: readonly BookEvent[]): Promise<void> {
    for (const e of events) await this.play(e);
  }

  async play(e: BookEvent): Promise<void> {
    const emit = this.emit;
    if (isGameEvent(e)) {
      await playGameEvent(e, devGameEnv(emit, this.state));
      return;
    }
    switch (e.type) {
      case 'reveal':
        if (e.gameType !== this.state.gameType) {
          this.state.gameType = e.gameType;
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
