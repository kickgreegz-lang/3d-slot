import { registerTiming } from '../../core/timing';

/**
 * MAGPIE HEIST choreography constants (docs/games/magpie-heist/DESIGN.md §8), registered as
 * timing section `heist` so the animation lab tunes them live. ms unless noted; gameplay values go
 * through s() (speed profile + slam). Design-px distances scale with the cell pitch.
 */
export const HEIST_TIMING = registerTiming('heist', {
  glint: {
    /** gold leaf spreads over a new square (after the explode burst) */
    gild: 320,
    gildStagger: 26,
    gildStaggerCap: 360,
    /** idle shimmer sweep period (s) */
    shimmerPeriod: 2.6,
    /** reset: squares fade + shrink */
    reset: 360,
    resetStagger: 18,
  },
  star: {
    /** the star symbol charges before the comet leaves */
    charge: 520,
    /** comet flight time per square visited (and the first leg) */
    legMs: 120,
    legMin: 70,
    firstLeg: 260,
    trailEvery: 14,
    trailLife: 360,
    /** hit-stop on launch */
    launchHitStop: 50,
  },
  loot: {
    /** coin flip-in on a square */
    flip: 300,
    revealStagger: 40,
    rerevealStagger: 55,
    settle: 180,
    /** diamond: charge, beam to each target, value roll */
    boostCharge: 300,
    boostBeam: 220,
    boostRoll: 360,
    boostPause: 160,
    /** nest: the collect flight of each coin, the nest's count-up */
    collectFlight: 460,
    collectStagger: 45,
    collectStaggerCap: 520,
    nestPunch: 220,
    nestPause: 220,
    /** payout: values fly to the loot plate, plate counts up, flies to the win */
    payFlight: 520,
    payStagger: 50,
    payStaggerCap: 700,
    plateCount: 900,
    plateHold: 650,
  },
  screens: {
    triggerHold: 1100,
    intro: 650,
    retrigger: 1400,
    upgrade: 2000,
    outroHold: 800,
  },
});

export const GOLD = 0xffc53d;
export const GOLD_HOT = 0xffe7a0;
export const GOLD_DEEP = 0xb87a14;
export const MIDNIGHT = 0x1b1f4a;
export const NAVY = 0x12163a;
export const MOON_TEAL = 0x4fd1d9;
export const CRIMSON = 0xc8203a;
export const PLUM = 0x5b2a6e;
export const PEARL = 0xfff4dc;

/** loot tier colours (coin rims, value text, trails) */
export const LOOT_COLOR = { bronze: 0xe08a4a, silver: 0xdfe8f2, gold: 0xffc53d, diamond: 0x9fe8ff, nest: 0xffd27a } as const;
