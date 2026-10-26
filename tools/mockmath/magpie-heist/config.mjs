/**
 * MAGPIE HEIST — mock math configuration (NOT the certified math).
 *
 * Every rule the simulator (engine.mjs) and the checker (validate.mjs) apply lives here, so tuning
 * the mock is a data edit. Amounts are Stake book units: bet multiple x100 (integers). Nothing is
 * RTP-tuned; stats.mjs prints sanity numbers only.
 */

export const GAME_ID = 'magpie-heist';

/** 6x5 visible, padded to 7 rows per reel: row 0 (top) and row 6 (bottom) are off-screen. */
export const GRID = {
  reels: 6,
  rows: 5,
  paddedRows: 7,
  firstVisibleRow: 1,
  lastVisibleRow: 5,
};

export const WILD = 'W';
export const SCATTER = 'S';
export const STAR = 'R';
/** paying symbols (W substitutes; a group of wilds alone pays nothing; S and R never pay) */
export const PAY_SYMBOLS = ['H1', 'H2', 'H3', 'H4', 'H5', 'L1', 'L2', 'L3', 'L4', 'L5'];
export const ALL_SYMBOLS = [...PAY_SYMBOLS, WILD, SCATTER, STAR];

/** Cluster pays: 5+ orthogonally connected identical symbols (wilds count toward the size). */
export const MIN_CLUSTER = 5;

/** Cluster size tiers (inclusive lower bounds): 5, 6, 7, 8, 9, 10, 11, 12, 13+. */
export const CLUSTER_TIERS = [5, 6, 7, 8, 9, 10, 11, 12, 13];
export const TIER_LABELS = ['5', '6', '7', '8', '9', '10', '11', '12', '13+'];

/** Pay per cluster in book units (x100 bet multiple), one value per tier. */
export const PAYTABLE = {
  H1: [200, 300, 500, 800, 1200, 2000, 4000, 7500, 10000], // Jeweled Crown
  H2: [150, 200, 300, 500, 800, 1200, 2500, 4000, 5000], //  Jeweled Egg
  H3: [120, 150, 250, 400, 600, 1000, 2000, 3000, 5000], //  Pocket Watch
  H4: [80, 120, 200, 300, 500, 800, 1500, 2500, 3000], //    Ruby Chalice
  H5: [60, 100, 150, 250, 400, 600, 1200, 2000, 2500], //    Key Ring
  L1: [30, 40, 60, 100, 150, 250, 500, 1000, 1500], //       A
  L2: [25, 35, 50, 80, 120, 200, 400, 800, 1200], //         K
  L3: [20, 30, 40, 60, 100, 150, 300, 600, 1000], //         Q
  L4: [20, 25, 35, 50, 80, 120, 250, 500, 1000], //          J
  L5: [15, 20, 30, 45, 70, 100, 200, 400, 800], //           10
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
 * SUPER CASCADE: a winning symbol type explodes everywhere on the board (every instance, not
 * only the cluster); wilds explode only when they are part of a winning cluster. Only the
 * winning cluster positions turn into GLINT SQUARES.
 */
export const SUPER_CASCADE = true;

/**
 * GLINT SQUARE items, revealed by a Shooting Star. `kind` weights per phase, then the value table
 * of the kind. Coins are book units (x100). Diamonds multiply the coin and nest values of the 8
 * surrounding cells. Nests collect every coin on the board (each nest of a round the full sum),
 * then every emptied glint square reveals again (until a round reveals no nest, or maxRounds).
 */
export const ITEMS = {
  coins: {
    bronze: { 20: 40, 50: 30, 100: 17, 200: 8, 300: 3, 400: 2 },
    silver: { 500: 52, 1000: 28, 1500: 13, 2000: 7 },
    gold: { 2500: 62, 5000: 25, 10000: 9, 25000: 3, 50000: 1 },
  },
  diamonds: { 2: 46, 3: 26, 4: 14, 5: 10, 10: 4 },
  /** kind weights for the first reveal of an activation, by phase */
  kinds: {
    base: { bronze: 86, silver: 7.5, gold: 0.4, diamond: 3.6, nest: 2.5 },
    prowl: { bronze: 80, silver: 11.2, gold: 0.9, diamond: 4.8, nest: 3.1 },
    vault: { bronze: 85, silver: 8, gold: 0.5, diamond: 3.8, nest: 2.7 },
    starfall: { bronze: 0, silver: 88, gold: 1.2, diamond: 6, nest: 4.8 },
  },
  /** re-reveals after a nest collected: fewer nests, so chains end */
  rerevealKinds: {
    base: { bronze: 87, silver: 7.5, gold: 0.4, diamond: 3.6, nest: 1.5 },
    prowl: { bronze: 81, silver: 11.2, gold: 0.9, diamond: 4.8, nest: 2.1 },
    vault: { bronze: 86, silver: 8, gold: 0.5, diamond: 3.8, nest: 1.7 },
    starfall: { bronze: 0, silver: 89, gold: 1.2, diamond: 6, nest: 3.8 },
  },
  maxRounds: 8,
};

/** chance that a spin's reveal board carries a forced star (Star Spins mode / Starfall) */
export const FORCED_STAR = { STARS: 1, starfall: 1 };

/**
 * Shooting Stars are not on the reel strips: a reveal board carries one with `reveal` chance (on a
 * random visible cell that is not a scatter), and each tumble refill turns one of its new symbols
 * into a star with `tumble` chance (so stars also land during the cascade). By phase.
 */
export const STAR_CHANCE = {
  base: { reveal: 0.011, tumble: 0.014 },
  prowl: { reveal: 0.2, tumble: 0.12 },
  vault: { reveal: 0.2, tumble: 0.12 },
  starfall: { reveal: 0, tumble: 0 },
};

/**
 * FREE SPINS. Base game: 3 / 4 / 5 scatters on the final board of the cascade sequence trigger
 * Night Prowl / Vault Raid / Starfall.
 *  - prowl: glint squares persist from spin to spin until a star activates them (then they reset).
 *  - vault: glint squares never reset (items are paid and cleared, the squares stay).
 *  - starfall: as vault, plus a star on every spin and no bronze coins.
 * Retriggers per free spin (scatters on its final board): `retrigger[n]` extra spins;
 * prowl with 4+ scatters upgrades to vault (+upgradeAddFs).
 */
export const FEATURES = {
  prowl: { freeSpins: 8, keepSquares: 'untilStar', retrigger: { 2: 2, 3: 4 }, upgradeAt: 4, upgradeTo: 'vault', upgradeAddFs: 4 },
  vault: { freeSpins: 12, keepSquares: 'always', retrigger: { 2: 2, 3: 3 }, upgradeAt: null },
  starfall: { freeSpins: 12, keepSquares: 'always', retrigger: { 2: 2, 3: 3 }, upgradeAt: null },
};
export const TRIGGER = { 3: 'prowl', 4: 'vault', 5: 'starfall' };
/** the spin count a feature starts with */
export const triggerFor = (scatters) => (scatters >= 5 ? 'starfall' : TRIGGER[scatters] ?? null);

/** Stake bet modes (mock.json mirrors cost + pool). `require` = the feature a buy guarantees. */
export const BET_MODES = {
  BASE: { cost: 1, pool: 'base', require: null, reelset: 'basegame' },
  HUNT: { cost: 3, pool: 'hunt', require: null, reelset: 'hunt' },
  STARS: { cost: 10, pool: 'stars', require: null, reelset: 'basegame', forcedStar: true },
  PROWL: { cost: 100, pool: 'prowl', require: 'prowl', reelset: 'basegame' },
  VAULT: { cost: 250, pool: 'vault', require: 'vault', reelset: 'basegame' },
};

/** Max win of the round in bet multiples (payout is truncated and the round stops). */
export const WINCAP_X = 10000;
export const WINCAP = WINCAP_X * 100;

/**
 * Reel strips: symbol counts per strip (one strip per reel, shuffled with a fixed seed).
 * S and R only ever sit in runs of 1.
 */
export const REELSETS = {
  basegame: {
    counts: { H1: 10, H2: 12, H3: 14, H4: 16, H5: 18, L1: 22, L2: 22, L3: 24, L4: 24, L5: 26, W: 2, S: 2 },
    runs: { 1: 58, 2: 32, 3: 10 },
  },
  /** Bonus Hunt: about five times the scatters */
  hunt: {
    counts: { H1: 10, H2: 12, H3: 14, H4: 16, H5: 18, L1: 22, L2: 22, L3: 24, L4: 24, L5: 26, W: 2, S: 6 },
    runs: { 1: 58, 2: 32, 3: 10 },
  },
  freegame: {
    counts: { H1: 12, H2: 14, H3: 16, H4: 18, H5: 18, L1: 20, L2: 20, L3: 20, L4: 20, L5: 20, W: 2, S: 2 },
    runs: { 1: 56, 2: 32, 3: 12 },
  },
  wcap: {
    counts: { H1: 16, H2: 14, H3: 10, H4: 8, H5: 8, L1: 6, L2: 5, L3: 4, L4: 4, L5: 4, W: 4, S: 0 },
    runs: { 2: 30, 3: 40, 4: 30 },
  },
};
export const STRIP_SEED = 'magpie-heist-strips-v1';

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
