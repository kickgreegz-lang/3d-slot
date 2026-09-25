/**
 * THE animation timing bible. Every duration/ease/physics constant used by the
 * board, symbols, FX and presentation lives here so it can be tuned live in the
 * animation lab (?dev=lab) and exported back into this file.
 *
 * Units: ms for durations (converted to seconds at the GSAP boundary with `s()`),
 * design px and design px/s² for physics.
 *
 * Speed profiles: turbo/superTurbo do NOT duplicate values — `s()` divides every
 * gameplay duration by the profile's scale and `stagger()` zeroes staggers. A change
 * while animations run (slam-stop) retimes the ones registered with `followSpeed()`.
 * Jurisdiction flags may forbid turbo (flow/jurisdiction.ts).
 */

export type SpeedProfile = 'normal' | 'turbo' | 'superTurbo';

export const SPEED_SCALE: Record<SpeedProfile, number> = {
  normal: 1,
  turbo: 2,
  superTurbo: 3,
};

export const TIMING = {
  spin: {
    /** Old board falls out of the grid. */
    fallOutDuration: 260,
    fallOutEase: 'power1.in',
    fallOutColumnStagger: 35,
    fallOutRowStagger: 15,
    /** extra distance (in cells) the old symbols fall below the grid */
    fallOutDistanceCells: 6,
  },
  drop: {
    /** Gravity for new symbols dropping into the grid (design px / s²). t = sqrt(2d/g). */
    gravity: 12000,
    /** Symbols start this many cells above their slot (plus their row offset). */
    startOffsetCells: 5.5,
    columnStagger: 60,
    rowStagger: 25,
    /** Minimum fall duration so short drops still read. */
    minFall: 140,
  },
  land: {
    /** Squash on impact: scaleX up, scaleY down (pivot at the symbol's feet). */
    squashX: 1.12,
    squashY: 0.86,
    squashDuration: 55,
    /** Spring recovery back to 1.0 (GSAP ease). */
    recoverDuration: 160,
    recoverEase: 'back.out(2)',
    /** Small secondary hop after impact, in design px (0 = none). */
    hopHeight: 6,
    /** Per-weight multipliers applied to squash amount & hop. */
    weight: { light: 0.7, medium: 1, heavy: 1.35, special: 1.6 } as Record<string, number>,
    /**
     * Squash recovery spring (unit mass): ~6 Hz, ζ≈0.32 — measured in the lab probe:
     * squash 0.854, one rebound to 1.059, settles within ±2% in 150 ms.
     */
    springStiffness: 1400,
    springDamping: 24,
    /** Dust puff particles on heavy/special lands. */
    dustParticles: 10,
  },
  tumble: {
    /** Tumble refill gravity (slightly softer than the spin drop). */
    gravity: 9000,
    columnStagger: 50,
    rowStagger: 20,
    landEase: 'back.out(2)',
    landDuration: 150,
    /** Pause between explode and refill. */
    preRefillDelay: 90,
  },
  anticipation: {
    /** Each remaining column waits this much longer when anticipation is on. */
    holdPerColumn: 1200,
    introDuration: 300,
    outroDuration: 250,
    dimTint: 0x7f7f7f,
    /** Heartbeat scale pulse for scatters already landed. */
    pulseScale: 1.08,
    pulsePeriod: 520,
  },
  win: {
    dimTint: 0x5a5a5a,
    dimDuration: 170,
    popScale: 1.2,
    popDuration: 130,
    popEase: 'back.out(3)',
    /** Loopable win animation length (Spine win or procedural). */
    winAnimDuration: 900,
    clusterLabelIn: 250,
    clusterLabelHold: 700,
    clusterLabelFloat: 40,
    clusterLabelOut: 400,
    /** Shine sweep across winning symbols. */
    shineDuration: 520,
  },
  explode: {
    anticipateScale: 0.9,
    anticipateDuration: 80,
    anticipateEase: 'power2.in',
    burstScale: 1.35,
    burstDuration: 180,
    /** Freeze-frame after the burst ("hit-stop"). */
    hitStop: 100,
    particles: 18,
  },
  spots: {
    /** Number roll + punch when a multiplier spot changes. */
    punchScale: 1.3,
    punchDuration: 200,
    tierFlash: 150,
    markDuration: 240,
  },
  shake: {
    /** Trauma-based shake: offset = maxOffset * trauma² * noise (big-win tier 0.55-0.8 -> 7-14 px). */
    maxOffset: 22,
    maxAngle: 1.2,
    decayPerSecond: 1.6,
    frequency: 18,
  },
  counters: {
    /** Small-win count-up duration by win level 1..5 (setWin.winLevel). */
    smallByLevel: [0, 400, 600, 1000, 1500, 2000],
  },
  bigWin: {
    /** Count-up duration per tier (ms): big, super, mega, epic, max. */
    tierDurations: { big: 5000, super: 7000, mega: 9000, epic: 13000, max: 18000 } as Record<string, number>,
    tierPunch: 300,
    tierPunchEase: 'back.out(2.5)',
    /** Linear count-up with a power3.out final 10%. */
    finalPortion: 0.1,
    /** Autoplay auto-close delay after count-up. */
    autoCloseDelay: 1500,
    coinRate: 60,
  },
  freeSpins: {
    introDuration: 2600,
    outroDuration: 2200,
    counterPunch: 250,
  },
  mascot: {
    crossFade: 0.25,
    crossFadeTurbo: 0.15,
  },
  ui: {
    pressScale: 0.92,
    pressDuration: 60,
    hoverScale: 1.03,
    hoverDuration: 100,
  },
};

export type Timing = typeof TIMING;

/**
 * Module-local timing tables (board, symbols, HUD, presentation, FX, audio, scene)
 * register here so the animation lab (?dev=lab) can tune EVERY constant live, not
 * just the core TIMING bible. Modules keep ownership of their tables:
 *   export const BOARD_TIMING = registerTiming('board', { ... });
 */
export type TimingTable = Record<string, unknown>;
export const TIMING_SECTIONS: Record<string, TimingTable> = { core: TIMING };
export const registerTiming = <T extends object>(section: string, table: T): T => {
  TIMING_SECTIONS[section] = table as TimingTable;
  return table;
};

let currentProfile: SpeedProfile = 'normal';

/**
 * Gameplay ms -> GSAP seconds, scaled by the speed profile (turbo = 2x faster).
 * Use for EVERY gameplay duration/delay. UI micro-interactions use `sUi`.
 */
export const s = (ms: number): number => ms / 1000 / SPEED_SCALE[currentProfile];
/** Unscaled ms -> seconds (UI hover/press, big-win count-ups the player controls). */
export const sUi = (ms: number): number => ms / 1000;
/** Current speed multiplier (for Spine timeScale / three mixer timeScale). */
export const speedScale = (): number => SPEED_SCALE[currentProfile];

type SpeedChange = (fromScale: number, toScale: number) => void;
const speedListeners = new Set<SpeedChange>();
/** Called with the old and new speedScale() whenever the profile changes (slam-stop, turbo mid-round). */
export const onSpeedChange = (fn: SpeedChange): (() => void) => {
  speedListeners.add(fn);
  return () => void speedListeners.delete(fn);
};

/**
 * s() only sizes animations built AFTER a profile change. Gameplay animations that must
 * follow a change while they run (a slam-stop mid-reveal) register here and are retimed
 * in place: timeScale *= to / from (a pending delay shrinks too). Register ROOT
 * animations only (a child already follows its timeline). Finished or killed ones
 * (no parent any more) drop out.
 */
const followers = new Set<gsap.core.Animation>();
let pruneAt = 256;
const pruneFollowers = (): void => {
  for (const a of followers) if (!a.parent) followers.delete(a);
};
export const followSpeed = <A extends gsap.core.Animation>(a: A): A => {
  if (followers.size >= pruneAt) {
    pruneFollowers();
    pruneAt = Math.max(256, followers.size * 2);
  }
  followers.add(a);
  return a;
};

export const setSpeedProfile = (p: SpeedProfile): void => {
  const from = SPEED_SCALE[currentProfile];
  const to = SPEED_SCALE[p];
  currentProfile = p;
  pruneFollowers();
  if (to === from) return;
  for (const a of followers) a.timeScale((a.timeScale() * to) / from);
  for (const fn of speedListeners) fn(from, to);
};
export const getSpeedProfile = (): SpeedProfile => currentProfile;
export const isTurbo = (): boolean => currentProfile !== 'normal';

/** Staggers collapse to 0 in turbo so the whole board lands at once. */
export const stagger = (ms: number): number => (currentProfile === 'normal' ? ms : 0);

/** Free-fall time for a distance under gravity: t = sqrt(2d/g), in ms. */
export const fallTime = (distancePx: number, gravity: number, minMs = 0): number =>
  Math.max(minMs, Math.sqrt((2 * Math.max(0, distancePx)) / gravity) * 1000);
