import { registerTiming } from '../../../core/timing';
import type { MascotId } from './assets';

/**
 * Character data of the two Bass Drop 2D mascots (ANIMATION_SET §5.1 / §5.2, the built rigs in
 * art/source/mascots/<id>/spine). Clip names are the rigs' own; the cue -> clip table lives in
 * ./Mascots.ts (DESIGN §16).
 */
export type MascotSide = 'left' | 'right';

/** Track-0 body clips (both rigs; Croak has no meter_heat and Gumbo no bass_drop_charge). */
export type BodyClip =
  | 'idle'
  | 'idle_bored'
  | 'anticipation'
  | 'meter_heat'
  | 'react_small'
  | 'react_point'
  | 'bass_drop_charge'
  | 'bass_drop'
  | 'win_big'
  | 'celebrate'
  | 'fs_trigger'
  | 'fs_end';

/** Loops a one-shot returns to. */
export type LoopClip = 'idle' | 'idle_bored' | 'anticipation' | 'meter_heat' | 'celebrate';

/** Track-1 additive overlays. */
export type OverlayClip = 'wild_land_react' | 'pouch_pump';

export const LOOP_CLIPS: ReadonlySet<BodyClip> = new Set<BodyClip>(['idle', 'idle_bored', 'anticipation', 'meter_heat', 'celebrate']);

export interface MascotDef {
  id: MascotId;
  side: MascotSide;
  /** +1: faces screen right (toward the reels from the left), -1: faces screen left */
  facing: 1 | -1;
  /** the rig's 2x canvas (skeleton units); the root (feet) is its bottom centre */
  canvas: readonly [number, number];
  /** the heat loop: Gumbo `meter_heat`, Croak leans on the fader (`anticipation`) */
  heatClip: LoopClip;
  /**
   * Loops authored on the 100 BPM beat (18 f per beat), phase-locked to the room's shared music
   * beat (stage/beat.ts): the clip's length in beats. Others free-run from a seeded phase.
   */
  beatLoops: Partial<Record<LoopClip, number>>;
  /** reaction delay (ms, game time) after a cue, so the pair never moves in lockstep */
  reactDelay: number;
  /** start phase of the free-running idle (0..1) */
  idlePhase: number;
  seed: number;
  /** foley ids the rig's `sfx` events may carry (anything else is ignored) */
  sfx: readonly ('cooler_slam' | 'button_slam' | 'mic_drop' | 'dj_scratch')[];
  /** additive fx slot the runtime dresses (Croak's music notes); null = none */
  fxSlot: 'fx_note' | null;
}

/** LEFT: Gumbo, heavyset alligator bouncer (tempo 0.92 is authored into the clips). */
export const GUMBO: MascotDef = {
  id: 'gumbo',
  side: 'left',
  facing: 1,
  canvas: [868, 992],
  heatClip: 'meter_heat',
  beatLoops: { celebrate: 4 },
  // the heavy bouncer reacts late; Croak (the DJ) is on the beat with his booth
  reactDelay: 130,
  idlePhase: 0.1,
  seed: 0x6a7b,
  sfx: ['cooler_slam'],
  fxSlot: null,
};

/** RIGHT: Baron Croak, lanky bullfrog DJ (tempo 1.06). */
export const CROAK: MascotDef = {
  id: 'croak',
  side: 'right',
  facing: -1,
  canvas: [720, 1260],
  heatClip: 'anticipation',
  beatLoops: { idle: 8, celebrate: 4 },
  reactDelay: 0,
  idlePhase: 0.55,
  seed: 0xc40a,
  sfx: ['button_slam', 'mic_drop', 'dj_scratch'],
  fxSlot: 'fx_note',
};

export const MASCOT_DEFS: readonly MascotDef[] = [GUMBO, CROAK];

/**
 * Presentation tuning (seconds unless noted; registered as timing section `bassDropMascots`
 * for the animation lab). Gameplay sync points (the charge, the boom, the pumps) come from
 * BASS_DROP_TIMING / the feature screens, never from here.
 */
export const MASCOT_TUNING = registerTiming('bassDropMascots', {
  /** idle -> idle_bored after this long without a cue, + up to boredJitter per character */
  boredAfter: 20,
  boredJitter: 6,
  /** runtime blink (track 2) every blinkMin..blinkMax s, never across an authored eye swap */
  blinkMin: 4,
  blinkMax: 7,
  /** an authored eye change this close (s) postpones the blink */
  blinkGuard: 0.3,
  /** ignore a repeat of the same one-shot within this window (s; flow + scene events can double-cue) */
  dedupe: 0.3,
  /** showWins at or above this many x bet (book units x100) => win_big instead of react_small */
  bigWinX: 10,
  /** look-at (track 3): how long a cue holds its focus, per cue kind (s) */
  look: {
    cluster: 1.6,
    tumble: 1.0,
    meter: 1.3,
    orbs: 0.9,
    wildLand: 0.8,
    player: 2.4,
    trigger: 2.2,
    /** response of the aim (1/s) and of the blend in/out */
    follow: 9,
    blend: 7,
    /** pupils saturate at this ctrl_look x offset (skeleton units; the rig clamps at 5 units = 167) */
    pupilReach: 200,
    /** head elevation limit (deg; the rig clamps at 12) and deg per 100 units */
    headMax: 13,
    degPer100: 5,
  },
  /** procedural kicks (track 3): damped springs on the head (nod) and the chest (lean), in degrees */
  kick: { hz: 3.2, zeta: 0.42, spinLean: 5, spinNod: 4, nod: 6, thresholdNod: 5 },
  /** low tier: skeleton updates per second (0 = every frame) */
  lowTierHz: 30,
  /** the feature upgrade screen's Mega Mix slam (DESIGN §10.4, ui_feature_upgrade f28) */
  upgradeSlamAt: 933,
  /** foley frames of the rigs (30 fps), used to line a clip's hit up with a scheduled beat */
  frames: { coolerSlamWinBig: 24, micDrop: 36, chargeHit: 15 },
});
