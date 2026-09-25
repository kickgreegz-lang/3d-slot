import { createGameRoundState, foldGameEvent, gameBookHandlers, restoreGameScene } from '@game/book';
import type { GameBookEvent } from '@game/book';
import type { BookEvent, GameType } from './types';
import type { SceneEmit } from '../game/events';
import type { RoundPlayback } from './handlers';

/**
 * Game-specific book events (src/games/<GAME>/book.ts). The engine plays the core events
 * itself (book/handlers.ts) and hands every other event to the game through this small
 * environment, so the same game handler serves the flow AND the DEV scene players
 * (dev/fixtures.ts ScenePlayer, board/demo.ts).
 *
 * A game's book module exports:
 *   GameBookEvent        union of its event interfaces ({ index, type: '<name>', ... })
 *   GameRoundState       per-round extras kept in RoundPlayback.game (meters, sticky sets, ...)
 *   createGameRoundState()
 *   gameBookHandlers     { [type]: (event, env) => Promise<void> } — emit scene events via env.emit
 *   foldGameEvent(state, event)  apply an ALREADY PLAYED event to the state (resume / replay start)
 *   restoreGameScene(env)        put game visuals into the folded state instantly (after board:set)
 */
export interface GameEventEnv {
  /** awaitable scene broadcast (ctx.game.broadcastAsync in the flow) */
  emit: SceneEmit;
  /** shared round state (board, spot grid, free spins, RoundPlayback.game extras) */
  state: RoundPlayback;
  /** HUD-visible state changed (free-spin counter, win) — a no-op in DEV players */
  hudChanged(): void;
  /** switch base <-> free presentation (mode:change + spot reset), only when it changes */
  setGameType(gameType: GameType): Promise<void>;
}

export type GameBookHandlers<E extends { type: string }> = {
  [K in E['type']]: (event: Extract<E, { type: K }>, env: GameEventEnv) => Promise<void>;
};

type AnyGameHandler = (event: GameBookEvent, env: GameEventEnv) => Promise<void>;
const HANDLERS = gameBookHandlers as unknown as Record<string, AnyGameHandler | undefined>;

/** Book event types the active game handles. */
export const GAME_EVENT_TYPES: readonly string[] = Object.keys(HANDLERS);

/** true when `event` belongs to the active game (has a game handler). */
export const isGameEvent = (event: BookEvent): event is GameBookEvent => Object.hasOwn(HANDLERS, event.type);

/** Play one game event through the game's handler. */
export const playGameEvent = async (event: GameBookEvent, env: GameEventEnv): Promise<void> => {
  await HANDLERS[event.type]?.(event, env);
};

/** Environment for DEV players that have no flow: HUD no-op, mode:change only on change. */
export const devGameEnv = (emit: SceneEmit, state: RoundPlayback): GameEventEnv => ({
  emit,
  state,
  hudChanged: () => undefined,
  setGameType: async (gameType) => {
    if (state.gameType === gameType) return;
    state.gameType = gameType;
    await emit('mode:change', { gameType });
  },
});

export { createGameRoundState, foldGameEvent, restoreGameScene };
