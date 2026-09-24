/**
 * Board-local timing/physics constants that are not (yet) part of the shared
 * TIMING bible in core/timing.ts. Same units: ms, design px, design px/ms.
 * Candidates for promotion into TIMING (see contractRequests in the report).
 */
export const BOARD_TIMING = {
  /** Motion-blur texture above this speed (design px / ms). */
  blurSpeed: 1.5,
  /** Blur switches off this long before impact so the squash frame is crisp. */
  blurOffLead: 34,
  /** Cluster outline: draw-on sweep, pulse period while held, fade-out. */
  outlineDraw: 340,
  outlineDrawEase: 'power2.out',
  outlinePulse: 620,
  outlineFade: 160,
  /** Delay between clusters presented in the same winInfo. */
  clusterStagger: 120,
  /** Winning-cell tile glow in/out. */
  tileHighlightIn: 140,
  tileHighlightOut: 200,
  /** Idle life: random gap between idle accents (real time, not speed-scaled). */
  idleMin: 2500,
  idleMax: 5000,
  /** Spots: one intermediate value per rollStep while counting n -> m (max rollMaxSteps shown). */
  rollStep: 55,
  rollMaxSteps: 8,
  /** Reading-order stagger between spot cells animating in the same update. */
  spotStagger: 28,
  /** ...but the whole update never spreads over more than this. */
  spotStaggerMax: 320,
  /** Mark ignite: glow ring peak alpha and hold before it settles. */
  markGlowHold: 120,
  /** Anticipation beam: rising streak speed (design px / s) and count. */
  beamStreakSpeed: 520,
  beamStreaks: 9,
  /** Explode shake: trauma = base + perSymbol * count (clamped to max). */
  explodeTraumaBase: 0.12,
  explodeTraumaPerSymbol: 0.035,
  explodeTraumaMax: 0.55,
} as const;
