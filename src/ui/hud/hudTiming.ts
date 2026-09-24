import { registerTiming, TIMING } from '../../core/timing';

/**
 * HUD micro-interaction timing (ms, UI time — never speed-profile scaled; use sUi()).
 * TIMING.ui holds press/hover; the rest is LOCAL until it is promoted into
 * core/timing.ts (see the UI module's contractRequests).
 */
export const HUD_TIMING = registerTiming('hud', {
  ...TIMING.ui,
  /** spring back after a press */
  releaseDuration: 240,
  releaseEase: 'back.out(3)',
  /** show / hide of a control (replay, free spins, jurisdiction) */
  fadeDuration: 220,
  /** spin button idle "breathing" glow period (one in-out) */
  breathePeriod: 2600,
  /** idle attract: the arrow spins once after this long without a round... */
  attractDelay: 7000,
  /** ...and repeats this often */
  attractRepeat: 9000,
  attractDuration: 900,
  /** arrow spin while a round is running: seconds per revolution at full speed */
  spinRevolution: 520,
  spinRampUp: 380,
  spinSettle: 600,
  /** autoplay: slower ring rotation */
  autoRevolution: 2400,
  /** hover nudge of the spin arrow (degrees) */
  hoverNudge: 28,
  /** stop-square / count swap in the spin hole */
  centerSwap: 200,
  /** win counter: tick SFX throttle and end punch */
  tickInterval: 70,
  countGrowScale: 1.1,
  punchScale: 1.28,
  punchDuration: 420,
  punchEase: 'elastic.out(1.1, 0.45)',
  /** value flash when balance / bet text changes */
  valueBump: 180,
  /** free-spin badge punch when the counter changes */
  fsPunch: 260,
  /** replay chip dot pulse period */
  replayPulse: 1400,
} as const);
