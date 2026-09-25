import type { GameBookHandlers, GameEventEnv } from '../../book/gameEvents';
import type { RoundPlayback } from '../../book/handlers';
import type { BookEvent } from '../../book/types';

/**
 * SWAMP FUNK book events on top of the engine's core events (book/types.ts), played by
 * the engine through book/gameEvents.ts.
 *
 *   updateGrid -> spots:update | spots:reset (plays while the exploding winners are
 *                 still on screen: math emits it between winInfo and tumbleBoard)
 */
export interface UpdateGridEvent {
  index: number;
  type: 'updateGrid';
  /** UNPADDED [reel][visibleRow] multiplier-spot values */
  gridMultipliers: number[][];
}

export type GameBookEvent = UpdateGridEvent;

/** No per-round extras: the spot grid is engine state (RoundPlayback.grid). */
export type GameRoundState = Record<never, never>;
export const createGameRoundState = (): GameRoundState => ({});

const sameGrid = (a: number[][], b: number[][]): boolean =>
  a.length === b.length && a.every((col, r) => col.length === b[r].length && col.every((v, i) => v === b[r][i]));

const copyGrid = (g: number[][]): number[][] => g.map((col) => [...col]);

export const gameBookHandlers: GameBookHandlers<GameBookEvent> = {
  updateGrid: async (e, env) => {
    const grid = copyGrid(e.gridMultipliers);
    const previous = env.state.grid;
    env.state.grid = grid;
    if (!previous) {
      await env.emit('spots:reset', { grid });
      return;
    }
    if (sameGrid(previous, grid)) return;
    await env.emit('spots:update', { grid, previous });
  },
};

/** Resume / replay: fold an already-played event into the state (no presentation). */
export const foldGameEvent = (state: RoundPlayback, e: BookEvent): void => {
  if (e.type === 'updateGrid') state.grid = copyGrid(e.gridMultipliers);
};

/** Spots are restored by the engine (spots:reset with state.grid): nothing game-specific. */
export const restoreGameScene = async (_env: Pick<GameEventEnv, 'emit' | 'state'>): Promise<void> => undefined;
