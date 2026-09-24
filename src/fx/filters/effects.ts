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

let chroma: ChromaticFilter | null = null;
let chromaTween: gsap.core.Tween | null = null;
let chromaOn: Container | null = null;

const areaFor = (L: LayoutSpec): Rectangle => new Rectangle(0, 0, L.width, L.height);

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

/** Expanding displacement ring centred at design point (x, y). */
export const pulseShockwave = ({ target, layout }: PulseTarget, x: number, y: number, o: ShockwaveOptions): void => {
  shock ??= new ShockwaveFilter();
  const f = shock;
  shockTween?.kill();
  if (shockOn !== target) {
    if (shockOn) removeFilter(shockOn, f);
    shockOn = null;
    if (!tryAddFilter(target, f)) return;
    shockOn = target;
  }
  target.filterArea = areaFor(layout);
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

/** Quick RGB-split punch radiating from design point (x, y). */
export const pulseChromatic = ({ target, layout }: PulseTarget, x: number, y: number, o: ChromaticOptions): void => {
  chroma ??= new ChromaticFilter();
  const f = chroma;
  chromaTween?.kill();
  if (chromaOn !== target) {
    if (chromaOn) removeFilter(chromaOn, f);
    chromaOn = null;
    if (!tryAddFilter(target, f)) return;
    chromaOn = target;
  }
  target.filterArea = areaFor(layout);
  f.setCenter(x / layout.width, y / layout.height);
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
