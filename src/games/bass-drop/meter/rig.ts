import type { Container } from 'pixi.js';
import type { MeterMode } from '../events';
import type { Counter } from './Counter';
import type { NotchState, RigLayout } from './geometry';
import type { LedArc } from './LedArc';

export type MeterLoop = 'idle' | 'heat_loop' | 'armed_loop' | 'overdrive_loop';

/** One notch badge as the conductor drives it (state + overlays, burst). */
export interface NotchView {
  /** State + armed strobe / solid (charging) / heat pulse; re-applies only on a change. */
  configure(st: NotchState, armed: boolean, solid: boolean, pulse: boolean): void;
  /** `threshold_minor` (15 f) / `threshold_major` (27 f) over `sec` gameplay seconds, in `color`. */
  burst(major: boolean, sec: number, color: number): void;
}

/**
 * The `ui_groove_meter` rig as the GrooveMeter module conducts it (ANIMATION_SET §3): the Spine rig
 * (MeterSpine, production) and the code-drawn placeholder (MeterRig, the fallback when the rig
 * cannot load) both implement it, so the module, its choreography and its timings never know which
 * one draws. Methods are the rig's clips; `play()` picks the track-0 loop.
 */
export interface GrooveRig {
  readonly view: Container;
  /** code-drawn 60-tick LED arc in the `led_arc` slot */
  readonly led: LedArc;
  /** live counter in the `txt_count` slot (drawn on winLayer by the module) */
  readonly counter: Counter;
  readonly notches: { readonly badges: readonly NotchView[] };
  readonly currentLoop: MeterLoop;
  /** Place for a design space; `res` = display px per design px of the meter (code rig bakes at it). */
  layout(g: RigLayout, res: number): void;
  /** Mode skin (base / jukejam / megamix; compact: bare + the trim). */
  setSkin(mode: MeterMode): void;
  /** Rim trim colour (skin trims, also the locked 40 / 60 trims in the base game). */
  setTrim(color: number): void;
  setGlowLevel(level: number): void;
  play(loop: MeterLoop): void;
  flashRim(color: number, sec: number): void;
  tick(): void;
  pump(scale?: number): void;
  charge(sec: number, chained: boolean): void;
  boom(): void;
  featurePump(i: number): void;
  drain(sec: number): void;
  rest(): void;
  mountBlast(display: Container): void;
  unmountBlast(display: Container): void;
  syncMount(root: Container): void;
  /** Displacement (design px) of the chip anchor from its rest place (the chip rides the cabinet squash). */
  chipOffset(out: { x: number; y: number }): void;
  /** dt game seconds; `beat` = 0..1 phase of the shared music beat (0 = the kick). */
  update(dt: number, beat: number): void;
  destroy(): void;
}
