import { gsap } from 'gsap';
import { type Container, Rectangle } from 'pixi.js';
import type { LayoutSpec } from '../../config/layout';
import { removeFilter, tryAddFilter } from './budget';
import { ChromaticFilter } from './ChromaticFilter';
import { ShockwaveFilter } from './ShockwaveFilter';

/**
 * One-shot filter pulses on a design-space container (normally `layers.root`).
 * Each pulse borrows a budget slot for its lifetime only, uses resolution 0.5 and a
 * filterArea equal to the design rect, and silently does nothing when the tier
 * budget is exhausted (the particle ring still sells the hit).
 */

export interface PulseTarget {
  target: Container;
  layout: LayoutSpec;
}

let shock: ShockwaveFilter | null = null;
let shockTween: gsap.core.Tween | null = null;
let shockOn: Container | null = null;

/**
 * Filter pass resolution. Low tier: 0.5 (budget rule). High tier: the renderer's own
 * resolution — these passes cover the WHOLE game for 250-550 ms and a half-res pass
 * visibly softens every symbol and HUD label while it runs.
 */
let filterResolution: number | 'inherit' = 0.5;
export const configureFilterQuality = (tier: 'low' | 'high'): void => {
  filterResolution = tier === 'low' ? 0.5 : 'inherit';
};

let chroma: ChromaticFilter | null = null;
let chromaTween: gsap.core.Tween | null = null;
let chromaOn: Container | null = null;

export interface ShockwaveOptions {
  /** seconds (already speed-scaled by the caller) */
  duration: number;
  /** final radius in design px */
  radius: number;
  /** displacement in design px */
  amplitude: number;
  /** ring thickness in design px */
  width: number;
  brightness?: number;
}

/**
 * Expanding displacement ring centred at design point (x, y). The filterArea is the
 * design rect (a smaller area would clip everything outside it — filters render
 * their container only inside the filter bounds).
 */
export const pulseShockwave = ({ target, layout }: PulseTarget, x: number, y: number, o: ShockwaveOptions): void => {
  shock ??= new ShockwaveFilter();
  const f = shock;
  f.resolution = filterResolution;
  shockTween?.kill();
  if (shockOn !== target) {
    if (shockOn) removeFilter(shockOn, f);
    shockOn = null;
    if (!tryAddFilter(target, f)) return;
    shockOn = target;
  }
  target.filterArea = new Rectangle(0, 0, layout.width, layout.height);
  const W = layout.width;
  f.setCenter({ x: x / W, y: y / layout.height, aspect: W / layout.height });
  f.halfWidth = o.width / 2 / W;
  f.brightness = o.brightness ?? 0.18;
  const state = { t: 0 };
  shockTween = gsap.to(state, {
    t: 1,
    duration: o.duration,
    ease: 'none',
    onUpdate: () => {
      const e = 1 - (1 - state.t) ** 2.2;
      f.radius = (e * o.radius) / W;
      f.amplitude = ((1 - state.t) ** 1.5 * o.amplitude) / W;
    },
    onComplete: () => {
      if (shockOn) removeFilter(shockOn, f);
      shockOn = null;
      shockTween = null;
    },
  });
};

export interface ChromaticOptions {
  duration: number;
  /** peak split (normalised, 0.02 = strong) */
  amount: number;
}

/**
 * Quick RGB-split "lens" punch radiating from design point (x, y). Applied to the
 * whole stage (screen space, so it never shares a filterArea with a shockwave on
 * the root); `root` converts the design point to screen coordinates.
 */
export const pulseChromatic = (
  view: { stage: Container; root: Container; width: number; height: number },
  x: number,
  y: number,
  o: ChromaticOptions,
): void => {
  chroma ??= new ChromaticFilter();
  const f = chroma;
  f.resolution = filterResolution;
  const target = view.stage;
  chromaTween?.kill();
  if (chromaOn !== target) {
    if (chromaOn) removeFilter(chromaOn, f);
    chromaOn = null;
    if (!tryAddFilter(target, f)) return;
    chromaOn = target;
  }
  target.filterArea = new Rectangle(0, 0, view.width, view.height);
  const p = view.root.toGlobal({ x, y });
  f.setCenter(p.x / view.width, p.y / view.height);
  const state = { t: 0 };
  chromaTween = gsap.to(state, {
    t: 1,
    duration: o.duration,
    ease: 'none',
    onUpdate: () => {
      // fast attack, eased release
      const t = state.t;
      f.amount = o.amount * (t < 0.15 ? t / 0.15 : (1 - (t - 0.15) / 0.85) ** 2);
    },
    onComplete: () => {
      if (chromaOn) removeFilter(chromaOn, f);
      chromaOn = null;
      chromaTween = null;
    },
  });
};
