import { registerTiming } from '../core/timing';

/**
 * Board-local timing/physics constants that are not (yet) part of the shared
 * TIMING bible in core/timing.ts. Same units: ms, design px, design px/ms.
 * Candidates for promotion into TIMING (see contractRequests in the report).
 */
export const BOARD_TIMING = registerTiming('board', {
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
  /** board:transform 'drop': the new symbol starts this many cells above the top visible row. */
  transformDropCells: 2.5,
  /** board:transform: gap between cells of one transform (reading order). */
  transformStagger: 140,
  /** board:transform: camera trauma per landed / morphed symbol. */
  transformTrauma: 0.28,
  /** board:transform 'impact': landing speed fed to the symbol's squash spring (design px / s). */
  transformImpactVelocity: 5200,
  /** board:transform 'impact': crush fx power of the replaced symbol (no board:burst, no orb). */
  impactCrushPower: 0.6,
  /** board:transform 'impact': the 4 orthogonal neighbours are pushed out this far (design px x k) and spring back. */
  impactPush: 6,
  impactPushMs: 200,
  /**
   * Physics / distance scale reference: k = pitch / physRefPitch (Swamp Funk landscape pitch 154),
   * applied to board:thump dips and the impact push so they read the same on every cell size.
   */
  physRefPitch: 154,
  /** board:thump grid spring: frequency (Hz) and damping ratio (ANIMATION_CONTRACT §9). */
  thumpHz: 9,
  thumpZeta: 0.5,
  /** board:focus default tint for the non-focused symbols (a light 20% dim). */
  focusTint: 0xcccccc,
} as const);
