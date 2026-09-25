import type { LayoutKind, LayoutSpec, Rect } from '../../../config/layout';
import { registerTiming } from '../../../core/timing';
import { GROOVE } from '../config';
import { BASS_DROP_LAYOUT } from '../layout';
import { GOLD, METER_SEGMENT_COLORS, PINK, TEAL } from '../timing';

/**
 * GROOVE METER geometry, notch data and the meter's own visual constants.
 *
 * The rig is drawn in RIG UNITS: the landscape ring (R = 160 design px, ANIMATION_SET §3
 * authors the Spine rig at 2x that) is the reference, and every other space scales the
 * same drawing by R / 160 (DESIGN.md §6.1: "all spaces share one drawing"). Radii are the
 * fractions of layout.json `meterGeometry`; angles are degrees clockwise from 12 o'clock.
 */
export const R_REF = 160;

export const GEOM = {
  startDeg: -150,
  sweepDeg: 300,
  ticks: 60,
  rimInner: 0.875,
  ledOuter: 0.85,
  ledInner: 0.7,
  counterR: 0.525,
  notchRadius: 0.94,
  notchR: 0.15,
} as const;

/** Meter-local look constants (placeholder rig; lab-tunable as section `bassDropMeter`). */
export const METER_LOOK = registerTiming('bassDropMeter', {
  /** idle cone breathe per beat (DESIGN §6.2 cold) and beat periods per mode (ms: 100 / 106 / 112 BPM) */
  breathScale: 1.02,
  beatMs: { base: 600, bonus: 566, super: 536 },
  /** heat flutter scale / armed cone vibration (rig px) / overdrive rim pulse (Hz) */
  heatFlutter: 1.035,
  armedVibrate: 1.5,
  overdriveHz: 1.25,
  /** rim glow alpha per state (cold / warm / heat / locked) */
  glow: { cold: 0.28, warm: 0.6, heat: 0.75, locked: 0.9 },
  /** clip poses (ANIMATION_SET §3): charge / boom keys (frame, value) at 30 fps */
  coneCharge: 0.88,
  cabSquash: 0.94,
  boomCone: [
    [1, 1.2],
    [5, 0.96],
    [8, 1.04],
    [14, 1],
  ] as Array<[number, number]>,
  boomCab: [
    [1, 1.08],
    [6, 0.98],
    [12, 1],
  ] as Array<[number, number]>,
  /** swirl spin at full charge (deg/s) */
  swirlSpin: 720,
  /** 'tick' (4 f) and 'pump' (6 f) overlays */
  tickScale: 1.03,
  tickFrames: 4,
  pumpScale: 1.08,
  pumpFrames: 6,
  /** feature_trigger pumps (cone per pump, cabinet stretch on the big one) */
  triggerCone: [1.12, 1.16, 1.3],
  triggerCab: 1.12,
  /** sound-wave rings from the woofer on the boom: end radius (x k) */
  ringRadius: 900,
  ringWidth: 22,
  /** feature trigger: the wipe (DESIGN §10.1, 620 ms) has covered the meter here; the drain + skin swap run behind it */
  wipeCover: 620,
  /** feature upgrade (DESIGN §10.4): drain start and the megamix skin swap (the MM emblem slam, f28) */
  upgradeDrainAt: 200,
  upgradeSkinAt: 933,
  /** notch burst sparks (minor / major) and their life (ms) */
  sparksMinor: 24,
  sparksMajor: 48,
  sparkLife: [500, 700] as [number, number],
  /** speaker blast fallback: smoke puffs */
  blastSmoke: 14,
  /** counter digit sizes, design px (DESIGN §6.1) */
  countFont: { landscape: 64, tablet: 64, portrait: 68, compact: 34 } as Record<LayoutKind, number>,
  /** chip: FS merge (portrait / compact) extra height, and chip text size (fraction of the chip height) */
  chipText: 0.58,
  /** orbs: core / halo / trail size (x k), comet size multiplier (ANIMATION_SET §7.2) */
  orbCore: 18,
  orbHalo: 48,
  orbTrail: 10,
  cometScale: 1.6,
  /** safety: launch the orbs anyway if no board:burst arrived within this long after board:tumble (game ms, s()-scaled) */
  burstSafety: 1500,
  /** arrival flash on the dust cap */
  capFlash: 0.6,
});

export type MeterSkin = 'base' | 'jukejam' | 'megamix' | 'bare';
export type NotchKind = 'w' | 'jj' | 'mm';
export type NotchState = 'off' | 'next' | 'lit' | 'spent';

export interface NotchDef {
  threshold: number;
  kind: NotchKind;
  /** wild pips on the W gem (wilds per drop) */
  pips: number;
  color: number;
}

/** Notch badges at 10..60 (DESIGN §6.1): W gem + pips, jukebox (40), crowned speaker (60). */
export const NOTCHES: readonly NotchDef[] = GROOVE.thresholds.map((threshold, i) => ({
  threshold,
  kind: threshold === GROOVE.bonusAt ? 'jj' : threshold === GROOVE.superAt ? 'mm' : 'w',
  pips: GROOVE.wildsPerDrop[threshold] ?? 1,
  color: METER_SEGMENT_COLORS[i],
}));

/** Notch index 0..5 of a threshold (thresholds above 60 wrap: DESIGN §6.7 / [M-2]). */
export const notchIndex = (threshold: number): number => ((Math.round(threshold / 10) - 1) % 6 + 6) % 6;

/** Skin trim colours. */
export const SKIN_TRIM: Record<MeterSkin, number> = { base: TEAL, jukejam: GOLD, megamix: PINK, bare: TEAL };

/** Angle (deg, clockwise from 12 o'clock) of meter value v (0..60). */
export const valueDeg = (v: number): number => GEOM.startDeg + (GEOM.sweepDeg * Math.min(Math.max(v, 0), 60)) / 60;

/** Centre angle of LED tick i (1..60): tick i spans value i-1..i. */
export const tickDeg = (i: number): number => valueDeg(i - 0.5);

/** Polar -> rig xy (y down). */
export const polar = (deg: number, r: number): { x: number; y: number } => {
  const a = (deg * Math.PI) / 180;
  return { x: Math.sin(a) * r, y: -Math.cos(a) * r };
};

/** LED / segment colour of value v (1..60). */
export const segmentColor = (v: number): number => METER_SEGMENT_COLORS[Math.min(5, Math.max(0, Math.ceil(v / 10) - 1))];

/** Everything the rig needs from one design space. */
export interface RigLayout {
  kind: LayoutKind;
  /** ring centre, design px */
  cx: number;
  cy: number;
  /** ring radius, design px, and rig scale (R / R_REF) */
  R: number;
  scale: number;
  /** cabinet rect in RIG units relative to the ring centre (null: bare ring) */
  cabinet: Rect | null;
  /** counter digit size in rig units */
  countFont: number;
  /** the chip's design rect and whether the FS plate is merged into it */
  chip: Rect;
  chipHasFs: boolean;
  /** k = pitch / 154 (orb sizes, distances) */
  k: number;
}

export const rigLayout = (L: LayoutSpec): RigLayout => {
  const x = BASS_DROP_LAYOUT[L.kind];
  const R = x.meter.ringOuterD / 2;
  const scale = R / R_REF;
  const c = x.cabinet;
  return {
    kind: L.kind,
    cx: x.meter.cx,
    cy: x.meter.cy,
    R,
    scale,
    cabinet: c
      ? { x: (c.x - x.meter.cx) / scale, y: (c.y - x.meter.cy) / scale, w: c.w / scale, h: c.h / scale }
      : null,
    countFont: METER_LOOK.countFont[L.kind] / scale,
    chip: x.meterChip,
    chipHasFs: x.fsPlate === 'meterChip',
    k: (L.cell + L.gap) / 154,
  };
};
