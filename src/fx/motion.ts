/**
 * REDUCED MOTION — the one switch every module reads before screen-space motion
 * (DESIGN bass-drop §20, ANIMATION_CONTRACT §9 photosensitivity / vestibular gates).
 *
 * Source of truth, in order:
 *   1. an explicit override (a future settings toggle, QA: `setReducedMotion(true)`;
 *      `null` returns to the OS preference);
 *   2. the OS preference `matchMedia('(prefers-reduced-motion: reduce)')`, followed live.
 *
 * What the engine does with it (callers own the rest, see the DESIGN list):
 *   - ScreenShake: offset x REDUCED_SHAKE_SCALE, no roll;
 *   - Board: no board thump / bass-react hop travel (squash only);
 *   - feature modules: skip arcs / shockwave filters / chromatic pulses (their own call).
 *
 * Plain module state (no DOM access at import time beyond one matchMedia query), so it is
 * safe in every module and in node tooling (no window -> never reduced).
 */

/** Screen-shake offset scale while reduced (roll is dropped entirely). */
export const REDUCED_SHAKE_SCALE = 0.3;

type Listener = (reduced: boolean) => void;

const listeners = new Set<Listener>();
let override: boolean | null = null;
let media: MediaQueryList | null = null;
let last = false;

const query = (): MediaQueryList | null => {
  if (media || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return media;
  media = window.matchMedia('(prefers-reduced-motion: reduce)');
  const onChange = (): void => notify();
  if (typeof media.addEventListener === 'function') media.addEventListener('change', onChange);
  return media;
};

const compute = (): boolean => override ?? query()?.matches ?? false;

const notify = (): void => {
  const now = compute();
  if (now === last) return;
  last = now;
  for (const fn of listeners) fn(now);
};

/** True when screen-space motion should be reduced. */
export const reducedMotion = (): boolean => {
  last = compute();
  return last;
};

/** Force reduced motion on / off, or `null` to follow the OS preference again. */
export const setReducedMotion = (on: boolean | null): void => {
  override = on;
  notify();
};

/** Called with the new value whenever it changes; returns the unsubscribe. */
export const onReducedMotion = (fn: Listener): (() => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
