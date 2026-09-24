import type { clock as Clock } from '../core/clock';
import type { GameContext } from '../game/context';
import { createDevApi, type DevApi } from './devApi';

/**
 * window.__slot — automation surface for AI-driven visual QA and the animation lab.
 *
 * Production builds expose ONLY:
 *   __slot.ready            true once booted
 *   __slot.manual(on)       stop/start the real-time ticker
 *   __slot.step(ms)         advance exactly ms of game time and render one frame
 *   __slot.emit(type, p)    broadcastAsync a scene event (returns a promise)
 *
 * DEV builds add `ctx` plus the lab/QA API from devApi.ts (scenario, setTiming,
 * getTiming, slowmo, speed, fixtures, advance, motion, events, ...). That code is
 * referenced only inside `import.meta.env.DEV` branches, so it is tree-shaken
 * out of production bundles.
 * Used by tools/capture/*.mjs and tools/qa/*.mjs (Playwright).
 */
export interface SlotHooks {
  ready: boolean;
  /** DEV only */
  ctx?: GameContext;
  manual(on: boolean): void;
  step(ms?: number): void;
  emit(type: string, payload: unknown): Promise<void>;
  [k: string]: unknown;
}

/** Hooks as seen by DEV tooling (lab, QA scripts). */
export type DevSlotHooks = SlotHooks & DevApi & { ctx: GameContext };

declare global {
  interface Window {
    __slot?: SlotHooks;
  }
}

export const installDevHooks = (ctx: GameContext, clock: typeof Clock): SlotHooks => {
  const hooks: SlotHooks = {
    ready: true,
    manual: (on) => clock.setManual(on),
    step: (ms = 1000 / 60) => clock.step(ms),
    emit: (type, payload) =>
      (ctx.game.broadcastAsync as (t: string, p: unknown) => Promise<void>)(type, payload),
  };
  if (import.meta.env.DEV) {
    Object.assign(hooks, createDevApi(ctx, clock), { ctx });
    // the lab/gallery flips these once its scene is built (see lab.ts)
    if (ctx.params.dev === 'lab' || ctx.params.dev === 'gallery') {
      hooks.ready = false;
      hooks.labReady = false;
    }
  }
  window.__slot = hooks;
  return hooks;
};

/** DEV-only typed accessor for the extended hooks (null in production). */
export const devHooks = (): DevSlotHooks | null =>
  import.meta.env.DEV && window.__slot?.ctx ? (window.__slot as DevSlotHooks) : null;
