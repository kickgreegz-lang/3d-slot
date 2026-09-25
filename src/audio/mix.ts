import type { SfxId } from '../game/events';
import { registerTiming } from '../core/timing';

/**
 * The mixing desk: bus levels, per-sound play rules and audio-only timings.
 * Everything a sound designer tunes lives here; synth.ts only shapes timbre.
 *
 * Gain staging (measured with an OfflineAudioContext render, see devDemo.ts):
 * SFX peak around -6..-3 dBFS after the master limiter, the procedural music bed
 * sits near -20 LUFS integrated, so the SFX read ~8-12 LU above the music.
 */

/** 'hero': the one sound that ducks the others (bass boom) plays outside the SFX duck. */
export type BusId = 'sfx' | 'ui' | 'hero';

/** Linear bus gains (the limiter adds ~+3 dB of makeup gain, see graph.ts). */
export const BUS_LEVELS = {
  sfx: 0.9,
  ui: 0.9,
  /** sized for production stems mastered at -16 LUFS (pipeline loudnorm) -> ~-20 LUFS out */
  music: 0.42,
  /** procedural groove trim inside the music bus (lands it at ~-20 LUFS too) */
  groove: 0.43,
  /** convolution reverb return (shared room) */
  reverb: 0.42,
} as const;

export interface SfxRule {
  bus: BusId;
  /** voices sharing a group share the concurrency limit and minimum gap */
  group?: string;
  /** max concurrent voices in the group (oldest is stolen with a short fade) */
  max: number;
  /** a new play within this many ms of the group's last start is dropped (unless higher priority) */
  minGapMs: number;
  /**
   * How a payload `rate` is applied, so tonal sounds never leave the music's key:
   *  - 'free'    percussive: plain pitch multiplier
   *  - 'degrees' escalating tonal voices: rate -> whole pentatonic scale steps (≈2.4 semitones each)
   *  - 'octave'  other tonal voices: rate snapped to whole octaves (small rates are ignored)
   */
  pitch: 'free' | 'degrees' | 'octave';
  /** random pitch spread, fraction (0.04 = ±4%). Tonal sounds stay (almost) in tune with the music. */
  pitchJitter: number;
  /** base linear gain */
  gain: number;
  /** tie-breaker inside a group (heavier lands win over lighter ones inside the gap) */
  priority?: number;
  /** duck the music bus while this plays */
  duck?: { db: number; holdMs: number };
  /** duck the SFX + UI buses (everything but music and the hero bus) while this plays */
  duckSfx?: { db: number; holdMs: number };
  /** voices of this group are cut (fast fade) when this plays (the boom cuts the charge riser) */
  cuts?: string;
  /**
   * Music-bus reaction: 'charge' = high-pass sweep + duck over the play's span (released by a
   * 'drop' or a safety timeout); 'drop' = the filter snaps open, the duck lifts and the
   * groove plays a downbeat accent.
   */
  music?: 'charge' | 'drop';
}

/**
 * Rate for a 'degrees' sound that climbs `degrees` pentatonic scale steps (the engine turns
 * the rate back into whole steps: round(12 log2(rate) / 2.4)). e.g. meter_threshold notch n.
 */
export const pentaRate = (degrees: number): number => 2 ** ((degrees * 2.4) / 12);

/** Rate for a 'free' sound shifted by `semitones` (orb_absorb +1 per arrival, bass_boom +2 per chain step). */
export const semitoneRate = (semitones: number): number => 2 ** (semitones / 12);

/** ±1.5 dB random level spread on every play (avoids the machine-gun effect). */
export const VOLUME_JITTER_DB = 1.5;

const perc = (gain: number, group: string, max: number, minGapMs: number, priority = 0): SfxRule => ({
  bus: 'sfx', group, max, minGapMs, pitch: 'free', pitchJitter: 0.04, gain, priority,
});
const tonal = (gain: number, group: string, max: number, minGapMs: number): SfxRule => ({
  bus: 'sfx', group, max, minGapMs, pitch: 'octave', pitchJitter: 0.003, gain,
});
const ui = (gain: number): SfxRule => ({ bus: 'ui', group: 'ui', max: 2, minGapMs: 30, pitch: 'free', pitchJitter: 0.01, gain });

export const SFX_RULES: Record<SfxId, SfxRule> = {
  spin_start: { ...perc(1.2, 'spin', 1, 80), pitchJitter: 0.03 },
  fall_out: perc(1.1, 'fall', 1, 80),
  land_light: perc(1, 'land', 3, 30, 1),
  land_medium: perc(0.85, 'land', 3, 30, 2),
  land_heavy: perc(0.9, 'land', 3, 30, 3),
  land_special: { ...perc(0.9, 'landSpecial', 2, 40), pitch: 'octave', pitchJitter: 0.004 },
  scatter_land_1: tonal(0.95, 'scatter', 3, 0),
  scatter_land_2: tonal(1, 'scatter', 3, 0),
  scatter_land_3: { ...tonal(0.9, 'scatter', 3, 0), duck: { db: -4, holdMs: 1200 } },
  anticipation_loop: tonal(0.65, 'antic', 1, 0),
  anticipation_end: perc(0.8, 'anticEnd', 1, 100),
  win_small: tonal(0.8, 'winSmall', 1, 80),
  win_cluster: { ...tonal(0.8, 'win', 2, 60), pitch: 'degrees' },
  explode: perc(0.85, 'explode', 6, 35),
  tumble_drop: perc(1.1, 'tumble', 3, 30),
  spot_mark: tonal(0.9, 'spot', 3, 40),
  spot_upgrade: { ...tonal(0.8, 'spot', 3, 50), pitch: 'degrees' },
  counter_tick: { ...perc(0.8, 'tick', 1, 45), pitchJitter: 0.02 },
  counter_end: tonal(0.85, 'counterEnd', 1, 100),
  bigwin_start: { ...tonal(0.72, 'bigwin', 2, 150), duck: { db: -6, holdMs: 1800 } },
  bigwin_tier: { ...tonal(0.75, 'bigwin', 2, 150), pitch: 'degrees', duck: { db: -6, holdMs: 1100 } },
  bigwin_end: { ...tonal(0.72, 'bigwin', 2, 150), duck: { db: -6, holdMs: 2200 } },
  fs_trigger: { ...tonal(0.75, 'fs', 2, 200), duck: { db: -6, holdMs: 2400 } },
  fs_intro: { ...tonal(0.75, 'fs', 2, 200), duck: { db: -6, holdMs: 2600 } },
  fs_outro: { ...tonal(0.85, 'fs', 2, 200), duck: { db: -6, holdMs: 2200 } },
  ui_click: ui(1),
  ui_bet_up: { ...ui(0.75), pitch: 'octave', pitchJitter: 0.002 },
  ui_bet_down: { ...ui(0.75), pitch: 'octave', pitchJitter: 0.002 },
  // ---- Bass Drop (DESIGN bass-drop §17). Callers pass `rate` as noted; 'degrees' rates via pentaRate().
  /** once per cluster at link draw-on; rate = symbol tier pitch (free) */
  link_connect: { ...perc(0.8, 'link', 2, 40), pitchJitter: 0.02 },
  /** first orb burst of a step (one bundle, not per orb) */
  orb_launch: perc(0.7, 'orb', 1, 60),
  /** each orb arrival; rate = semitoneRate(arrival index, cap 12); <= 1 per 35 ms, 4 voices */
  orb_absorb: { ...perc(0.65, 'orbAbsorb', 4, 35), pitchJitter: 0.002 },
  /** minor notch chime; rate = pentaRate(notch index) */
  meter_threshold: { ...tonal(0.85, 'meter', 2, 60), pitch: 'degrees' },
  meter_lock_bonus: { ...tonal(0.95, 'meterLock', 1, 200), duck: { db: -5, holdMs: 1100 } },
  meter_lock_super: { ...tonal(1, 'meterLock', 1, 200), duck: { db: -6, holdMs: 1500 } },
  /** one low tick per play: call it on each heat pulse */
  meter_heat: { ...perc(0.4, 'meterHeat', 1, 90), pitchJitter: 0.01 },
  meter_drain: perc(0.45, 'meterDrain', 1, 200),
  meter_lap: { ...tonal(0.7, 'meter', 2, 100), pitch: 'degrees' },
  /** charge riser; the music high-passes + ducks over the charge until the boom */
  bass_charge: { ...perc(0.8, 'bassCharge', 1, 60), pitchJitter: 0, music: 'charge' },
  /** THE loudest SFX; rate = semitoneRate(2 x chain step); ducks every other SFX -4 dB for 300 ms */
  bass_boom: {
    bus: 'hero', group: 'bassBoom', max: 2, minGapMs: 60, pitch: 'free', pitchJitter: 0.005, gain: 1.35, priority: 5,
    duckSfx: { db: -4, holdMs: 300 }, cuts: 'bassCharge', music: 'drop',
  },
  /** rate = semitoneRate(2 x wild index) */
  wild_launch: { ...perc(0.75, 'wildLaunch', 3, 30), pitchJitter: 0.01 },
  wild_whoosh: perc(0.65, 'wildWhoosh', 3, 30),
  wild_impact: perc(1.1, 'wildImpact', 3, 30, 4),
  symbol_crush: perc(0.8, 'crush', 3, 30),
  /** badge slam / label-sum arrival; rate = pentaRate(tier or arrival index) */
  wild_mult: { ...tonal(0.8, 'wildMult', 3, 40), pitch: 'degrees' },
  sticky_lock: perc(0.85, 'sticky', 3, 40),
  /** rate = pentaRate(badge tier) */
  sticky_mult_up: { ...tonal(0.8, 'stickyUp', 3, 50), pitch: 'degrees' },
  feature_upgrade: { ...tonal(0.9, 'fs', 2, 200), duck: { db: -6, holdMs: 2200 } },
  intro_card: ui(0.75),
  buy_open: ui(0.85),
  buy_select: { ...ui(0.8), pitch: 'octave', pitchJitter: 0.002 },
  buy_confirm: ui(0.95),
  button_slam: perc(0.8, 'foley', 3, 30),
  cooler_slam: perc(0.9, 'foley', 3, 30),
  mic_drop: perc(0.85, 'foley', 3, 30),
  dj_scratch: perc(0.7, 'foley', 3, 30),
};

/** Audio-only timings (s). Gameplay timings stay in core/timing.ts. */
export const AUDIO_TIMING = registerTiming('audio', {
  /** mute / hide fade of the master bus */
  masterFade: 0.06,
  /** voice-steal fade */
  stealFade: 0.018,
  duckAttack: 0.08,
  duckRelease: 0.6,
  /** music fade-in on first unlock */
  musicFadeIn: 1.6,
  /** crossfade between production stems */
  stemCrossfade: 1.2,
  /**
   * Music scheduler: notes are queued `lookAhead` s ahead of the audio clock. The
   * scheduler is pumped by an audio-clock timer every `pumpInterval` s (immune to
   * frame drops / rAF throttling) and additionally on every rendered frame.
   */
  lookAhead: 0.5,
  pumpInterval: 0.12,
  /** anticipation: music low-pass target, sweep time and extra duck */
  anticipationCutoff: 850,
  anticipationSweep: 0.5,
  anticipationDuckDb: -3,
  anticipationFadeOut: 0.14,
  /** longest an anticipation loop may run without an 'anticipation_end' */
  anticipationMax: 12,
  /**
   * Bass-drop music reaction: over a 'charge' play the music high-pass sweeps chargeHpFrom ->
   * chargeHpTo Hz and ducks chargeDuckDb across the play's span (the charge length, normal
   * speed: chargeSpan s, speed-scaled by Sound); a 'drop' snaps it open in dropSnap s. Without
   * a drop the charge releases itself chargeSafety s after the span.
   */
  chargeSpan: 0.5,
  chargeHpFrom: 200,
  chargeHpTo: 2000,
  chargeDuckDb: -6,
  chargeSafety: 0.8,
  dropSnap: 0.025,
  /** voice-cut fade when a sound cuts another group (boom cuts the charge riser) */
  cutFade: 0.03,
  /** SFX duck attack / release (hero sounds) */
  sfxDuckAttack: 0.012,
  sfxDuckRelease: 0.18,
} as const);
