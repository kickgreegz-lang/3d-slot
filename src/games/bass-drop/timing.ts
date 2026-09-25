import { registerTiming } from '../../core/timing';

/**
 * SWAMP FUNK: BASS DROP choreography constants (DESIGN.md §18.2), registered as timing
 * section `bassDrop` so the animation lab can tune them live.
 *
 * ms unless noted. Gameplay values go through s() (speed profile + slam); UI screens use
 * sUi(). Design-px distances are multiplied by `k = pitch / 154` (see `physK`) so the
 * motion reads the same on every layout. Trauma values are not scaled.
 */
export const BASS_DROP_TIMING = registerTiming('bassDrop', {
  links: { depthStagger: 40, grow: 90, cap: 320, pulsePeriod: 620, snap: 80, width: 16, lengthPitch: 0.56, scrollWaves: 1.6 },
  countPop: { in: 180, flight: 520, fadeFrom: 0.7 },
  orbs: {
    popOut: 90,
    popRise: 14,
    flight: 520,
    ease: 'power2.in',
    depthStagger: 22,
    orbStagger: 6,
    spreadCap: 300,
    liftFactor: 0.22,
    liftMin: 120,
    liftMax: 320,
    jitter: 40,
    tealFrom: 0.6,
    trailEvery: 16,
    trailLife: 220,
    turboFlightVariance: 0.1,
    superTurboComets: 6,
    cometRoll: 60,
  },
  meter: {
    tickLed: 60,
    tickSettle: 120,
    tickOvershoot: 1.6,
    fillTween: 120,
    punchScale: 1.1,
    punch: 90,
    punchMinGap: 45,
    pumpMinGap: 90,
    thresholdMinor: 500,
    thresholdMajor: 900,
    heatAt: [35, 55],
    heatHz: 1.9,
    armedHz: 2,
    drain: 400,
    lapFlash: 300,
    lapEmpty: 200,
    chipPunch: 200,
  },
  drop: {
    charge: 500,
    chargeChained: 200,
    chargeFloor: 160,
    reticleAt: 150,
    reticleSpin: 90,
    boomHitStop: 60,
    shockDuration: 520,
    shockAmplitude: 26,
    shockWavelength: 160,
    ringsGap: 90,
    launchDelay: 40,
    launchStagger: 110,
    flight: 640,
    apexLiftPitch: 1.2,
    launchScale: 0.55,
    peakScale: 1.75,
    peakAt: 0.6,
    spinTurns: 1.25,
    shadowFrom: 0.55,
    shadowAlpha: 0.45,
    crushLead: 80,
    impactHitStop: 40,
    neighbourPush: 6,
    neighbourSpring: 200,
    thumpPx: 5,
    settle: 300,
    multSlamDelay: 120,
    multSlam: 180,
    stickyLockDelay: 180,
    dimTint: 0xcccccc,
    boardReactPerPx: 0.25,
    boardReactCap: 180,
  },
  multSum: { flight: 240, stagger: 150, count: 250, slamScale: 1.25 },
  sticky: { homeMarkerIn: 200, plusOneDelay: 150, plusOneRise: 30, plusOne: 400, returnStagger: 90, multUpStagger: 120, multUpCap: 600 },
  feature: {
    triggerHold: 200,
    triggerDim: 0.5,
    pumpGap: 600,
    triggerTotal: 1800,
    upgrade: 2200,
    introTapLock: 900,
    /** UI time, sUi() */
    introCardsTapLock: 600,
  },
  shake: {
    explodeBase: 0.08,
    explodePerSymbol: 0.02,
    explodeMax: 0.35,
    thresholdMinor: 0.1,
    thresholdBonus: 0.3,
    thresholdSuper: 0.4,
    boom: 0.45,
    boomChainAdd: 0.1,
    boomMax: 0.65,
    wildImpact: 0.2,
    stickyLock: 0.05,
    triggerPumps: [0.2, 0.3, 0.6],
    upgrade: 0.5,
    upgradeShatter: 0.3,
    titleHit: 0.2,
    introTitle: 0.35,
    countHit: 0.2,
  },
  flash: { thresholdMajor: 0.25, boom: 0.2, boomMs: 120, trigger: 0.3, triggerMs: 140, upgrade: 0.3, minGap: 334 },
  hitStop: { thresholdMajor: 60, boom: 60, wildImpact: 40, triggerFinal: 80, max: 120 },
});

/** Physics / distance scale of a layout: k = pitch / 154 (DESIGN.md §5). */
export const physK = (L: { cell: number; gap: number }): number => (L.cell + L.gap) / 154;

/** LED / notch palette per 10-segment of the meter (DESIGN.md §6.1). */
export const METER_SEGMENT_COLORS = [0x35f2e0, 0x4ff0b0, 0xa8f03a, 0xffc629, 0xff8a3d, 0xff3fa8] as const;
export const METER_UNLIT = 0x243056;
export const GOLD = 0xffc629;
export const PINK = 0xff3fa8;
export const TEAL = 0x35f2e0;

/** Multiplier badge tiers (DESIGN.md §9.4): inclusive minimum multiplier -> plate colour. */
export const MULT_TIERS = [
  { tier: 1, min: 2, color: 0x35f2e0 },
  { tier: 2, min: 4, color: 0xa8f03a },
  { tier: 3, min: 6, color: 0xffc629 },
  { tier: 4, min: 10, color: 0xff8a3d },
  { tier: 5, min: 15, color: 0xff3fa8 },
] as const;

export const multTier = (m: number): (typeof MULT_TIERS)[number] => {
  let t: (typeof MULT_TIERS)[number] = MULT_TIERS[0];
  for (const x of MULT_TIERS) if (m >= x.min) t = x;
  return t;
};
