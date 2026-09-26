import { registerTiming } from '../../../core/timing';

/**
 * Connection-presentation look constants (placeholder art; lab-tunable as section
 * `bassDropConnect`). Timing lives in BASS_DROP_TIMING.links / .countPop (DESIGN.md §18.2);
 * this table holds the sizes, alphas and budgets that are not in the spec table.
 * Design-px sizes are multiplied by k = pitch / 154 at use.
 */
export const CONNECT_LOOK = registerTiming('bassDropConnect', {
  /** link body: tinted waveform strip alpha; white-hot core width (x k) and alpha */
  bodyAlpha: 0.9,
  coreWidth: 4,
  coreAlpha: 0.95,
  /** symbol colour -> link tint: lightened this much (DESIGN §7.3: 35%) */
  lighten: 0.35,
  /** soft tube glow around the strip: length / width factors (x the strip) and alpha */
  haloLength: 1.2,
  haloWidth: 2.6,
  haloAlpha: 0.4,
  /** half-width taper per strip column along the visible segment (pinched ends) */
  taper: [0.34, 0.8, 1, 1, 1, 0.8, 0.34],
  /** draw-on head glow at the growing tip (x k) */
  headSize: 38,
  headAlpha: 0.95,
  /** travelling blip (root -> leaves once per links.pulsePeriod): glow size (x k), peak alpha */
  blipSize: 46,
  blipAlpha: 1,
  /** the whole link brightens this much while the blip crosses it */
  blipBoost: 0.35,
  /** snap: midpoint flash (x k, ms), sparks per link (halved on the low tier), spark budget per tumble */
  snapFlash: 52,
  snapFlashMs: 170,
  sparksPerLink: 6,
  sparkBudget: 150,
  sparkPower: 0.3,
  /** fade-out (ms, s()-scaled) when no tumble snaps the links (win cap, round end, new reveal) */
  fadeOut: 200,
  /** count pop "+N": font size (x k), pop-in overshoot, rise during the pop (x k), scale at the meter */
  popSize: 44,
  popOvershoot: 1.3,
  popRise: 16,
  popEndScale: 0.6,
  /** additive teal halo behind the pop (x k) and its alpha */
  popHalo: 120,
  popHaloAlpha: 0.55,
});
