import { gsap } from 'gsap';
import type { ObservablePoint } from 'pixi.js';

/** Scale punch: jump to `from` x base, settle back to `base` (overshoot comes from the ease). */
export const punchScale = (
  scale: ObservablePoint,
  from: number,
  duration: number,
  ease: string,
  base = 1,
): gsap.core.Tween =>
  gsap.fromTo(scale, { x: base * from, y: base * from }, { x: base, y: base, duration, ease });

/** Tween a scale uniformly to `to`. */
export const scaleTo = (scale: ObservablePoint, to: number, vars: gsap.TweenVars): gsap.core.Tween =>
  gsap.to(scale, { x: to, y: to, ...vars });
