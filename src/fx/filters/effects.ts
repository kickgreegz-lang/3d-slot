import { gsap } from 'gsap';
import { type Container, Rectangle } from 'pixi.js';
import type { Rect } from '../../config/layout';
import { removeFilter, tryAddFilter } from './budget';
import { ChromaticFilter } from './ChromaticFilter';
import { ShockwaveFilter } from './ShockwaveFilter';

/**
 * One-shot filter pulses on a design-space container (normally `layers.root`).
 * Each pulse borrows a budget slot for its lifetime only, covers the visible design
 * rect and silently does nothing when the tier budget is exhausted (the particle ring
 * still sells the hit).
 *
 * Both pulses go on the SAME container (one FilterEffect, one FilterSystem stack slot):
 * live filters must never nest. Pixi 8.21 reads a nested push's resolution from the
 * slot's previous input texture, already back in the TexturePool, and a resize destroys
 * those -> TypeError inside render -> the ticker stops for good.
 */

export interface PulseTarget {
  target: Container;
  /** target-local visible rect (design rect + letterbox, see visibleDesignRect) */
  view: Rect;
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

/** The other pulse is live on a different container: adding here would nest filters. */
const nests = (other: Container | null, target: Container): boolean => other !== null && other !== target;

/**
 * filterArea = the visible rect (anything smaller clips what the target draws outside
 * it, e.g. the letterbox-covering overlay dimmer), padded so the camera shake never
 * exposes an edge. The pass is clipped to the viewport, so the pad costs nothing and
 * the output frame is the unpadded rect the uniforms are normalised against.
 */
const coverView = (target: Container, v: Rect): void => {
  const pad = (v.w + v.h) * 0.03;
  target.filterArea = new Rectangle(v.x - pad, v.y - pad, v.w + pad * 2, v.h + pad * 2);
};

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
export const pulseShockwave = ({ target, view: v }: PulseTarget, x: number, y: number, o: ShockwaveOptions): void => {
  shock ??= new ShockwaveFilter();
  const f = shock;
  f.resolution = filterResolution;
  shockTween?.kill();
  if (shockOn !== target) {
    if (shockOn) removeFilter(shockOn, f);
    shockOn = null;
    if (nests(chromaOn, target) || !tryAddFilter(target, f)) return;
    shockOn = target;
  }
  coverView(target, v);
  f.setCenter({ x: (x - v.x) / v.w, y: (y - v.y) / v.h, aspect: v.w / v.h });
  f.halfWidth = o.width / 2 / v.w;
  f.brightness = o.brightness ?? 0.18;
  const state = { t: 0 };
  shockTween = gsap.to(state, {
    t: 1,
    duration: o.duration,
    ease: 'none',
    onUpdate: () => {
      const e = 1 - (1 - state.t) ** 2.2;
      f.radius = (e * o.radius) / v.w;
      f.amplitude = ((1 - state.t) ** 1.5 * o.amplitude) / v.w;
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
 * Quick RGB-split "lens" punch radiating from design point (x, y). Same container
 * and filterArea as the shockwave (a tier punch fires both), so the two share one
 * FilterEffect instead of nesting.
 */
export const pulseChromatic = ({ target, view: v }: PulseTarget, x: number, y: number, o: ChromaticOptions): void => {
  chroma ??= new ChromaticFilter();
  const f = chroma;
  f.resolution = filterResolution;
  chromaTween?.kill();
  if (chromaOn !== target) {
    if (chromaOn) removeFilter(chromaOn, f);
    chromaOn = null;
    if (nests(shockOn, target) || !tryAddFilter(target, f)) return;
    chromaOn = target;
  }
  coverView(target, v);
  f.setCenter((x - v.x) / v.w, (y - v.y) / v.h);
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
