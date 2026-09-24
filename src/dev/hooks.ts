import type { clock as Clock } from '../core/clock';
import type { GameContext } from '../game/context';

/**
 * window.__slot — automation surface for AI-driven visual QA and the animation lab.
 *   __slot.ready            true once booted
 *   __slot.ctx              GameContext
 *   __slot.manual(on)       stop/start the real-time ticker
 *   __slot.step(ms)         advance exactly ms of game time and render one frame
 *   __slot.emit(type, p)    broadcastAsync a scene event (returns a promise)
 * Used by tools/capture/*.mjs (Playwright) to render deterministic frame sequences.
 * STUB — the dev module extends this (fixture playback, lab controls).
 */
export interface SlotHooks {
  ready: boolean;
  ctx: GameContext;
  manual(on: boolean): void;
  step(ms?: number): void;
  emit(type: string, payload: unknown): Promise<void>;
  [k: string]: unknown;
}

declare global {
  interface Window {
    __slot?: SlotHooks;
  }
}

export const installDevHooks = (ctx: GameContext, clock: typeof Clock): SlotHooks => {
  const hooks: SlotHooks = {
    ready: true,
    ctx,
    manual: (on) => clock.setManual(on),
    step: (ms = 1000 / 60) => clock.step(ms),
    emit: (type, payload) =>
      (ctx.game.broadcastAsync as (t: string, p: unknown) => Promise<void>)(type, payload),
  };
  window.__slot = hooks;
  return hooks;
};
