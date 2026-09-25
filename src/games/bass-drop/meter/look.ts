import { label } from '../../../present/common/text';
import { GROOVE } from '../config';
import type { GrooveFeature, MeterMode } from '../events';
import { GOLD, PINK, TEAL } from '../timing';
import type { ChipModel } from './Chip';
import { METER_LOOK as LOOK, NOTCHES, type NotchState } from './geometry';
import type { MeterLoop } from './MeterRig';

const MAX = GROOVE.displayMax;
/** Mega Mix home registry cap ([M-10], mock FEATURES.super.maxSticky) */
export const MAX_HOMES = 5;

/** What the look is derived from (the GrooveMeter model). */
export interface MeterLookInput {
  mode: MeterMode;
  /** displayed counter */
  shown: number;
  /** fallback laps (a threshold above 60 was listed) */
  lapMode: boolean;
  /** thresholds that burst and wait for their wild:drop / the one charging now */
  armed: ReadonlySet<number>;
  charging: number | null;
  homes: number;
  /** portrait / compact: the FS plate is merged into the chip */
  chipHasFs: boolean;
  fsFeature: GrooveFeature | null;
  fs: { current: number; total: number } | null;
}

export interface NotchLook {
  state: NotchState;
  armed: boolean;
  solid: boolean;
  pulse: boolean;
}

export interface MeterLook {
  /** lit LED ticks and whether the head tick is white-hot */
  level: number;
  hot: boolean;
  /** counter digits, MAX tag, lap pips */
  count: number;
  max: boolean;
  laps: number;
  /** rim / cabinet / chip trim colour */
  trim: number;
  heat: boolean;
  glow: number;
  loop: MeterLoop;
  notches: NotchLook[];
  chip: ChipModel;
}

/** Which feature a threshold locks: base 40 -> Juke Jam, base 60 -> Mega Mix, Juke Jam 60 -> the upgrade. */
export const lockOf = (mode: MeterMode, t: number): GrooveFeature | null => {
  if (mode === 'base') return t === GROOVE.bonusAt ? 'bonus' : t === GROOVE.superAt ? 'super' : null;
  if (mode === 'bonus') return t === GROOVE.superAt ? 'super' : null;
  return null;
};

/**
 * Meter state -> look (DESIGN §6.2 states, §6.7 values above 60, §6.8 chip). Pure: the module
 * applies the result to the rig and the chip after every counter step or state change.
 *  - cold 0-9 / warm 10-34 / heat 35-39 and 55-59 (base, Juke Jam) / locked (base 40+) glow;
 *  - armed: a crossed notch waits for its drop (strobe; solid while charging);
 *  - 60+: ring full, MAX tag, overdrive loop; trims gold at 40 / pink at 60 in base.
 */
export const deriveLook = (m: MeterLookInput): MeterLook => {
  const v = m.shown;
  const lap = m.lapMode ? v % MAX : v;
  const full = !m.lapMode && v >= MAX;
  const level = m.lapMode ? lap : Math.min(v, MAX);
  const trim =
    m.mode === 'bonus' ? GOLD : m.mode === 'super' ? PINK : v >= GROOVE.superAt ? PINK : v >= GROOVE.bonusAt ? GOLD : TEAL;
  const heat = m.mode !== 'super' && ((v >= 35 && v < 40) || (v >= 55 && v < 60));
  const locked = (m.mode === 'base' && v >= GROOVE.bonusAt) || full;
  const glow = locked ? LOOK.glow.locked : heat ? LOOK.glow.heat : v >= 10 ? LOOK.glow.warm : LOOK.glow.cold;
  const loop: MeterLoop = full ? 'overdrive_loop' : m.armed.size ? 'armed_loop' : heat ? 'heat_loop' : 'idle';
  const next = lap >= MAX ? null : (Math.floor(lap / 10) + 1) * 10;
  const notches = NOTCHES.map((d): NotchLook => {
    const t = d.threshold;
    const armed = m.armed.has(t);
    let state: NotchState;
    if (armed) state = 'lit';
    else if (lap >= t) state = lockOf(m.mode, t) ? 'lit' : 'spent';
    else if (t === next) state = 'next';
    else state = 'off';
    return { state, armed, solid: armed && m.charging === t, pulse: heat && t === next };
  });
  return {
    level,
    hot: level > 0 && level < MAX,
    count: m.lapMode ? lap : v,
    max: full,
    laps: m.lapMode ? Math.floor(v / MAX) : 0,
    trim,
    heat,
    glow,
    loop,
    notches,
    chip: chipModel(m, lap, next, trim),
  };
};

const range = (r: readonly [number, number]): string => label('bd.meter.multRange', '×{min}–{max}', { min: r[0], max: r[1] });

const chipModel = (m: MeterLookInput, v: number, next: number | null, accent: number): ChipModel => {
  const fs = m.chipHasFs && m.fsFeature && m.fs ? { feature: m.fsFeature, current: m.fs.current, total: m.fs.total } : null;
  const t = next ?? MAX;
  const c: ChipModel = {
    kind: 'next',
    accent,
    threshold: t,
    wilds: GROOVE.wildsPerDrop[t] ?? 1,
    sticky: false,
    feature: null,
    tag: null,
    upgradeAt: null,
    homes: m.homes,
    fs,
  };
  if (m.mode === 'base') {
    if (next === null) c.kind = 'megaMix';
    else c.feature = t === GROOVE.bonusAt ? 'jj' : t === GROOVE.superAt ? 'mm' : null;
  } else if (m.mode === 'bonus') {
    if (next === null) c.kind = 'megaMix';
    else {
      c.tag = range(GROOVE.bonus.wildMult);
      c.upgradeAt = v >= 50 ? GROOVE.superAt : null;
    }
  } else if (next === null) c.kind = 'max';
  else {
    c.sticky = m.homes < MAX_HOMES;
    c.tag = c.sticky ? null : range(GROOVE.super.wildMult);
  }
  return c;
};
