/**
 * SWAMP FUNK: BASS DROP — mock math configuration (NOT the certified math).
 *
 * Every rule the simulator (engine.mjs) and the checker (validate.mjs) apply lives here,
 * so tuning the mock is a data edit. Amounts are Stake book units: bet multiple x100
 * (integers). Nothing is RTP-tuned; stats.mjs prints the sanity numbers.
 */

export const GAME_ID = 'bass-drop';

/** 6x6 visible, padded to 8 rows per reel: row 0 (top) and row 7 (bottom) are off-screen. */
export const GRID = {
  reels: 6,
  rows: 6,
  paddedRows: 8,
  firstVisibleRow: 1,
  lastVisibleRow: 6,
};

export const WILD = 'W';
/** paying symbols (W only substitutes; a group of wilds alone pays nothing) */
export const PAY_SYMBOLS = ['H1', 'H2', 'H3', 'H4', 'L1', 'L2', 'L3', 'L4', 'L5'];
export const ALL_SYMBOLS = [...PAY_SYMBOLS, WILD];

/** Cluster pays: 5+ orthogonally connected identical symbols (wilds count toward the size). */
export const MIN_CLUSTER = 5;

/** Cluster size tiers (inclusive lower bounds): 5-6, 7-8, 9-10, 11-12, 13-15, 16+. */
export const CLUSTER_TIERS = [5, 7, 9, 11, 13, 16];
export const TIER_LABELS = ['5-6', '7-8', '9-10', '11-12', '13-15', '16+'];

/** Pay per cluster in book units (x100 bet multiple), one value per tier. */
export const PAYTABLE = {
  H1: [200, 400, 800, 2000, 5000, 10000], // Golden Boombox
  H2: [150, 300, 600, 1200, 3000, 6000], // Vinyl
  H3: [120, 250, 450, 900, 2250, 4500], // Crawfish
  H4: [100, 150, 300, 600, 1500, 3000], // Hot Sauce
  L1: [60, 100, 150, 300, 750, 1500], // A
  L2: [50, 80, 120, 250, 600, 1200], // K
  L3: [40, 60, 100, 180, 450, 900], // Q
  L4: [30, 50, 80, 150, 400, 750], // J
  L5: [30, 40, 70, 150, 300, 600], // 10
};

export const tierIndex = (size) => {
  let t = -1;
  for (let i = 0; i < CLUSTER_TIERS.length; i++) if (size >= CLUSTER_TIERS[i]) t = i;
  return t;
};

/** book units for a cluster of `size` symbols (0 below MIN_CLUSTER) */
export const payFor = (symbol, size) => {
  const t = tierIndex(size);
  return t < 0 ? 0 : PAYTABLE[symbol][t];
};

/**
 * GROOVE METER: counts every exploded (connected) symbol of the round. Every multiple of
 * `step` crossed triggers a BASS DROP of wilds onto the refilled board.
 */
export const METER = {
  step: 10,
  /** displayed maximum (0/60) and the super threshold */
  max: 60,
  bonusAt: 40,
  superAt: 60,
  /** wilds per drop for the thresholds 10..60 */
  dropWilds: { 10: 1, 20: 1, 30: 2, 40: 2, 50: 3, 60: 3 },
  /**
   * wilds per drop for every further multiple of 10 above 60, by phase. 0 = no drop and the
   * threshold is NOT listed in meterUpdate.thresholds. All 0 in the mock: the base game locks
   * the super at 60, Juke Jam upgrades at 60 (Mega Mix then restarts at 0), Mega Mix is full.
   */
  overflowWilds: { base: 0, bonus: 0, super: 0 },
};

/** wilds dropped at `threshold` in `phase` ('base' | 'bonus' | 'super') */
export const wildsForThreshold = (threshold, phase) =>
  threshold <= METER.max ? (METER.dropWilds[threshold] ?? 0) : METER.overflowWilds[phase];

/** Drop thresholds crossed going from `prev` to `value` (ascending; only the ones that drop wilds). */
export const crossedThresholds = (prev, value, phase) => {
  const out = [];
  for (let t = (Math.floor(prev / METER.step) + 1) * METER.step; t <= value; t += METER.step) {
    if (wildsForThreshold(t, phase) > 0) out.push(t);
  }
  return out;
};

export const FEATURES = {
  /** JUKE JAM (bonus): meter persists across its free spins, drop wilds carry x2..x5 */
  bonus: {
    freeSpins: 8,
    multipliers: { 2: 20, 3: 30, 4: 28, 5: 22 },
    sticky: false,
    maxSticky: 0,
  },
  /** MEGA MIX (super): drop wilds are sticky for the rest of the feature, x2..x10, +1 per win (cap x25) */
  super: {
    freeSpins: 10,
    multipliers: { 2: 60, 3: 25, 4: 8, 5: 4, 6: 2, 7: 1, 8: 0.5, 9: 0.3, 10: 0.2 },
    sticky: true,
    /** sticky registry size cap; drop wilds beyond it are one-shot (sticky:false) multiplier wilds */
    maxSticky: 5,
    growPerWin: 1,
    multCap: 25,
  },
  /** Juke Jam reaching the super threshold -> Mega Mix, +addFs spins (applied at the end of that free spin) */
  upgradeAddFs: 4,
};

/** plain wilds (natural reel wilds and base-game drops) */
export const BASE_WILD_MULT = 1;

/** Stake bet modes (mock.json mirrors cost + pool). `require` = the feature a buy guarantees. */
export const BET_MODES = {
  BASE: { cost: 1, pool: 'base', require: null },
  BONUS: { cost: 100, pool: 'bonus', require: 'bonus' },
  SUPER: { cost: 300, pool: 'super', require: 'super' },
};

/** Max win of the round in bet multiples (payout is truncated and the round stops). */
export const WINCAP_X = 5000;
export const WINCAP = WINCAP_X * 100;

/**
 * Reel strips: symbol counts per strip (one strip per reel, shuffled with a fixed seed).
 * `wcap` is only used by the generator's forced max-win search (math-sdk style forcing reelset).
 */
export const REELSETS = {
  basegame: {
    counts: { H1: 6, H2: 7, H3: 8, H4: 9, L1: 11, L2: 11, L3: 12, L4: 12, L5: 13, W: 1 },
    runs: { 1: 62, 2: 30, 3: 8 },
  },
  /** Juke Jam free spins */
  bonus: {
    counts: { H1: 9, H2: 10, H3: 10, H4: 11, L1: 10, L2: 10, L3: 10, L4: 10, L5: 10, W: 1 },
    runs: { 1: 60, 2: 28, 3: 12 },
  },
  /** Mega Mix free spins (no natural wilds: the sticky set is the wild story) */
  super: {
    counts: { H1: 9, H2: 10, H3: 10, H4: 11, L1: 10, L2: 10, L3: 10, L4: 10, L5: 10, W: 0 },
    runs: { 1: 60, 2: 29, 3: 11 },
  },
  wcap: {
    counts: { H1: 16, H2: 14, H3: 10, H4: 8, L1: 7, L2: 6, L3: 5, L4: 4, L5: 4, W: 4 },
    runs: { 2: 30, 3: 40, 4: 30 },
  },
};
export const STRIP_SEED = 'bass-drop-strips-v1';

/**
 * math-sdk win levels (config.py): [lowerX, upperX) in bet multiples -> level. `standard` for
 * setWin, `endFeature` for freeSpinEnd. Level 10 = win cap.
 */
export const WIN_LEVELS = {
  standard: [0, 0.1, 1, 2, 5, 15, 30, 50, 100, WINCAP_X],
  endFeature: [0, 1, 5, 10, 20, 50, 100, 250, 1000, WINCAP_X],
};

/** level 1..10 for `amount` book units */
export const winLevel = (amount, kind = 'standard') => {
  const x = amount / 100;
  const bounds = WIN_LEVELS[kind];
  let level = 1;
  for (let i = 0; i < bounds.length; i++) if (x >= bounds[i]) level = i + 1;
  return level;
};
