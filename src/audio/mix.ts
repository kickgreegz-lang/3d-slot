import type { SfxId } from '../game/events';

/**
 * The mixing desk: bus levels, per-sound play rules and audio-only timings.
 * Everything a sound designer tunes lives here; synth.ts only shapes timbre.
 *
 * Gain staging (measured with an OfflineAudioContext render, see devDemo.ts):
 * SFX peak around -6..-3 dBFS after the master limiter, the procedural music bed
 * sits near -20 LUFS integrated, so the SFX read ~8-12 LU above the music.
 */

export type BusId = 'sfx' | 'ui';

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
}

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
  explode: perc(0.85, 'explode', 3, 35),
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
};

/** Audio-only timings (s). Gameplay timings stay in core/timing.ts. */
export const AUDIO_TIMING = {
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
} as const;
