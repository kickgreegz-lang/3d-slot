import { registerTiming } from '../../../core/timing';
import type { Keys } from './rig';

/**
 * Stage placeholder look + clip keys (ANIMATION_SET §4: env_speaker_stack, env_horn,
 * env_dj_booth), lab-tunable as section `bassDropStage`. Keys are (frame @ 30 fps, value);
 * clip lengths are the authored frame counts. Offsets are landscape design px (the rigs are
 * authored at 2x: "6 units" = 3 px). The choreography timing (when a clip starts) comes from
 * BASS_DROP_TIMING in the Stage module.
 */

/** Pump keys (1.0 at rest) with a peak at each frame of `at`: rise 2 f, rebound, settle. */
const pumps = (at: number[], peaks: number[], rest = 1): Keys => {
  const k: Array<[number, number]> = [[0, rest]];
  at.forEach((f, i) => {
    const p = peaks[i] ?? peaks[peaks.length - 1];
    k.push([f, p], [f + 4, rest - (p - rest) * 0.3], [f + 9, rest + (p - rest) * 0.1], [f + 14, rest]);
  });
  return k;
};

export const STAGE_LOOK = registerTiming('bassDropStage', {
  /** idle beat per mode (ms): 100 / 106 / 112 BPM, as the meter's cone breathing */
  beatMs: { base: 600, bonus: 566, super: 536 },
  /** skin (trim / LED / glow colour) crossfade, UI ms */
  skinFade: 400,
  cabinet: {
    /** idle woofer breathe per beat (scale at the kick) */
    breathe: 1.022,
    /** fx_glow / floor light alpha: idle base + beat envelope */
    glowIdle: 0.05,
    glowBeat: 0.12,
    floorIdle: 0.18,
    floorBeat: 0.12,
    pumpFrames: 6,
    pump: [
      [0, 1],
      [2, 1.06],
      [6, 1],
    ] as Keys,
    boomFrames: 18,
    /** woofer punches at f2 (2 frames behind the meter: the energy travels down) */
    boomWoofer: [
      [0, 1],
      [2, 1.16],
      [6, 0.95],
      [10, 1.03],
      [18, 1],
    ] as Keys,
    /** cabinet squash-stretch (sy, pivot at the feet; sx preserves volume) */
    boomSy: [
      [0, 1],
      [2, 1.05],
      [6, 0.97],
      [11, 1.01],
      [18, 1],
    ] as Keys,
    /** hop (px up = negative): 6 units at 2x */
    boomHop: [
      [0, 0],
      [2, -3],
      [6, 0.6],
      [10, 0],
    ] as Keys,
    boomGlow: [
      [0, 0],
      [2, 0.85],
      [18, 0],
    ] as Keys,
    featureFrames: 54,
    featureWoofer: pumps([2, 20, 38], [1.1, 1.12, 1.22]),
    featureSy: pumps([2, 20, 38], [1.025, 1.03, 1.06]),
    featureGlow: pumps([2, 20, 38], [0.55, 0.65, 1], 0),
    /** cable whip impulse (px/s) on boom / last feature pump */
    cableKick: 70,
  },
  horn: {
    breathe: 1.012,
    pumpFrames: 6,
    pump: [
      [0, 1],
      [2, 1.05],
      [6, 1],
    ] as Keys,
    boomFrames: 18,
    /** bell flares 1.18 at f2 */
    boomBell: [
      [0, 1],
      [2, 1.18],
      [6, 0.96],
      [11, 1.03],
      [18, 1],
    ] as Keys,
    /** recoil along the horn axis, x HORN.recoil (8 units at 2x = 4 px) */
    boomRecoil: [
      [0, 0],
      [2, 1],
      [8, -0.15],
      [14, 0],
    ] as Keys,
    boomGlow: [
      [0, 0],
      [2, 0.9],
      [16, 0],
    ] as Keys,
    featureFrames: 54,
    featureBell: pumps([2, 20, 38], [1.08, 1.1, 1.18]),
    featureRecoil: pumps([2, 20, 38], [0.5, 0.6, 1], 0),
    featureGlow: pumps([2, 20, 38], [0.5, 0.6, 0.95], 0),
    /** dust puffs (fx_puff) out of the bell on the boom: count, life (ms), travel (px) */
    puffs: 5,
    puffLife: 480,
    puffTravel: 34,
  },
  booth: {
    /** platter: one revolution per 72 f (2.4 s) idle, x3 in frenzy */
    platterRev: 2.4,
    frenzySpin: 3,
    scratchFrames: 36,
    /** scratch: platter back-and-forth x2 (rad) and fader slides */
    scratchSpin: [
      [0, 0],
      [5, 0.8],
      [10, -0.5],
      [16, 0.7],
      [22, -0.4],
      [30, 0],
    ] as Keys,
    scratchFader: [
      [0, 0.7],
      [5, 0.2],
      [10, 0.8],
      [16, 0.25],
      [22, 0.75],
      [30, 0.7],
    ] as Keys,
    scratchSfxFrame: 4,
    pressFrames: 15,
    /** drop_press: button glow ramps f0-f13, button down f14-f15 */
    pressGlow: [
      [0, 0],
      [13, 1],
      [15, 1],
    ] as Keys,
    pressDownFrame: 14,
    boomFrames: 18,
    /** crate hop (px up = negative) and the button release frame */
    boomHop: [
      [0, 0],
      [2, -5],
      [7, 1],
      [11, 0],
    ] as Keys,
    boomLeds: [
      [0, 1],
      [3, 1],
      [18, 0],
    ] as Keys,
    releaseFrame: 4,
    /** frenzy LED strobe (Hz, <= 3 for photosensitivity) */
    strobeHz: 2.5,
  },
});
