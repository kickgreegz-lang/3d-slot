import type { AttractSpec, GameFeatures, GridSpec, SpotBand, SymbolDef, WinTier } from '../../config/game';
import type { BetModeDef } from '../../flow/modes';

/**
 * MAGPIE HEIST — static game configuration. Monty the magpie burglar raids a moonlit museum
 * vault on a 6x5 cluster tumble grid (docs/games/magpie-heist/DESIGN.md):
 *
 *  - clusters of 5+ orthogonally connected identical symbols pay (W substitutes); SUPER CASCADE:
 *    every instance of a winning symbol type explodes, gravity refills from the top;
 *  - every winning position becomes a GLINT SQUARE (gold leaf under the cell);
 *  - a SHOOTING STAR (R) on the settled board activates the squares: they reveal loot coins,
 *    diamonds (multiply the 8 neighbours) and nests (collect every coin, then the emptied squares
 *    reveal again);
 *  - 3 / 4 / 5 SAFES (S) trigger Night Prowl / Vault Raid / Starfall.
 *
 * Board: 6 reels x 5 rows, padded to 7 rows per reel (row 0 and row 6 are off-screen padding;
 * visible rows 1..5). Engine types / helpers: src/config/game.ts. The mechanics data (HEIST) mirror
 * tools/mockmath/magpie-heist/config.mjs; outcomes always come from the book events (./book.ts).
 */

export const GRID: GridSpec = {
  reels: 6,
  rows: 5,
  paddedRows: 7,
  firstVisibleRow: 1,
  lastVisibleRow: 5,
};

export const FEATURES: GameFeatures = {
  /** no multiplier spots: the board keeps its plain (tier 0) tiles; glint squares are the game's own layer */
  multiplierSpots: false,
  /** canvas buy screen with the four heist cards (screens/BuyScreen.ts) */
  buyScreen: 'game',
  /** 140 px cells fall with the reference time per cell */
  physicsScale: true,
  /** super cascades explode many symbols at once: a lighter per-symbol shake */
  explodeShake: { explodeBase: 0.16, explodePerSymbol: 0.012, explodeMax: 0.42 },
  /** the loot layer (coin trails, nest collects) keeps a quarter of the particle budget */
  particleReserve: 0.25,
};

const royal = (id: string, glyph: string, label: string, color: number, shade: number): SymbolDef => ({
  id,
  kind: 'royal',
  label,
  color,
  shade,
  glyph,
  cellScale: 0.86,
  restAngle: 0,
  landWeight: 'light',
  art: { static: `sym_${id}`, blur: `sym_${id}_blur`, glow: `sym_${id}_glow` },
});

export const SYMBOLS: Record<string, SymbolDef> = {
  H1: {
    id: 'H1', kind: 'high', label: 'Jeweled Crown', color: 0xffc53d, shade: 0x7a4a08,
    cellScale: 0.97, restAngle: 0, landWeight: 'heavy',
    art: { static: 'sym_H1', blur: 'sym_H1_blur', glow: 'sym_H1_glow' },
  },
  H2: {
    id: 'H2', kind: 'high', label: 'Jeweled Egg', color: 0x2e6bff, shade: 0x0f1f5c,
    cellScale: 0.96, restAngle: 0, landWeight: 'medium',
    art: { static: 'sym_H2', blur: 'sym_H2_blur', glow: 'sym_H2_glow' },
  },
  H3: {
    id: 'H3', kind: 'high', label: 'Pocket Watch', color: 0xffd76a, shade: 0x6b4210,
    cellScale: 0.96, restAngle: -8, landWeight: 'medium',
    art: { static: 'sym_H3', blur: 'sym_H3_blur', glow: 'sym_H3_glow' },
  },
  H4: {
    id: 'H4', kind: 'high', label: 'Ruby Chalice', color: 0xc8203a, shade: 0x4a0a14,
    cellScale: 0.96, restAngle: 0, landWeight: 'medium',
    art: { static: 'sym_H4', blur: 'sym_H4_blur', glow: 'sym_H4_glow' },
  },
  H5: {
    id: 'H5', kind: 'high', label: 'Key Ring', color: 0xd9b36a, shade: 0x4a3410,
    cellScale: 0.95, restAngle: -10, landWeight: 'medium',
    art: { static: 'sym_H5', blur: 'sym_H5_blur', glow: 'sym_H5_glow' },
  },
  L1: royal('L1', 'A', 'Ace', 0xc8203a, 0x2a1a3e),
  L2: royal('L2', 'K', 'King', 0x4fd1d9, 0x2a1a3e),
  L3: royal('L3', 'Q', 'Queen', 0xb06cff, 0x2a1a3e),
  L4: royal('L4', 'J', 'Jack', 0x5fd36b, 0x2a1a3e),
  L5: royal('L5', '10', 'Ten', 0xff9a3d, 0x2a1a3e),
  W: {
    id: 'W', kind: 'wild', label: 'Bandit Mask', color: 0xffc53d, shade: 0x1b1f4a,
    cellScale: 1.04, restAngle: 0, landWeight: 'special',
    art: { static: 'sym_W', blur: 'sym_W_blur', glow: 'sym_W_glow' },
  },
  S: {
    id: 'S', kind: 'scatter', label: 'Safe', color: 0xc8203a, shade: 0x3a0610,
    cellScale: 1.04, restAngle: 0, landWeight: 'special',
    art: { static: 'sym_S', blur: 'sym_S_blur', glow: 'sym_S_glow' },
  },
  R: {
    id: 'R', kind: 'special', label: 'Shooting Star', color: 0xffe27a, shade: 0x5b2a6e,
    cellScale: 1.06, restAngle: 0, landWeight: 'special',
    art: { static: 'sym_R', blur: 'sym_R_blur', glow: 'sym_R_glow' },
  },
};

/** Big-win tiers in bet multiples (placeholder until the math config is final). */
export const WIN_TIERS: readonly WinTier[] = [
  { key: 'big', minX: 20, label: 'BIG WIN' },
  { key: 'super', minX: 50, label: 'SUPER WIN' },
  { key: 'mega', minX: 100, label: 'MEGA WIN' },
  { key: 'epic', minX: 250, label: 'EPIC WIN' },
  { key: 'max', minX: Number.POSITIVE_INFINITY, label: 'MAX WIN' },
];

/** Tile tiers (board/SpotGrid draws the tier-0 tile under every cell; no spot values in this game). */
export const SPOT_BANDS: SpotBand[] = [
  { tier: 0, min: 0 },
  { tier: 1, min: 1 },
  { tier: 2, min: 2 },
  { tier: 3, min: 4 },
  { tier: 4, min: 8 },
  { tier: 5, min: 16 },
];

/**
 * Bet modes (math-sdk keys, sent verbatim to /wallet/play). HUNT and STARS are FEATURE SPINS:
 * picked once on the buy screen, then every spin (and autoplay) plays them until switched off
 * (`spin: true`). PROWL and VAULT are one-round feature buys. Everything above 2x needs the confirm
 * step (Stake rule). TODO(math): RTP placeholders; max win follows the mock wincap (10,000x).
 */
export const BET_MODES: Record<string, BetModeDef> = {
  BASE: { key: 'BASE', cost: 1, buy: false, rtp: 0.9634, maxWinX: 10000 },
  HUNT: { key: 'HUNT', cost: 3, buy: false, spin: true, rtp: 0.9628, maxWinX: 10000 },
  STARS: { key: 'STARS', cost: 10, buy: false, spin: true, rtp: 0.9636, maxWinX: 10000 },
  PROWL: { key: 'PROWL', cost: 100, buy: true, rtp: 0.963, maxWinX: 10000 },
  VAULT: { key: 'VAULT', cost: 250, buy: true, rtp: 0.964, maxWinX: 10000 },
};

/** Idle board before the first spin: a crown cluster teaser, one wild, one star and two safes. */
export const ATTRACT: AttractSpec = {
  pool: ['H1', 'H2', 'H3', 'H4', 'H5', 'L1', 'L2', 'L3', 'L4', 'L5', 'H2', 'H3', 'H4'],
  specials: { '1,2': 'W', '4,3': 'R', '0,4': 'S', '5,1': 'S' },
};

/**
 * DEV lab scenarios (src/dev/scenarios.ts) name Swamp Funk's fixture keys; these map them to this
 * game's generated fixtures (mock/games/magpie-heist/books/base_fixtures.json).
 */
export const DEV_FIXTURE_ALIASES: Record<string, string> = {
  small_win_1_tumble: 'small_win',
  tumble_chain: 'cascade_chain',
  fs_trigger: 'prowl_trigger',
};

export type HeistFeature = 'prowl' | 'vault' | 'starfall';
export type LootTier = 'bronze' | 'silver' | 'gold';

/** The decided mechanics as data, for the rules page, the screens and the loot look. */
export const HEIST = {
  minCluster: 5,
  /** coin values in bet multiples per tier (the book sends the exact value) */
  coins: { bronze: [0.2, 4], silver: [5, 20], gold: [25, 500] } as Record<LootTier, [number, number]>,
  diamonds: [2, 3, 4, 5, 10] as const,
  maxRounds: 8,
  features: {
    prowl: { scatters: 3, freeSpins: 8, retrigger: { 2: 2, 3: 4 } as Record<number, number>, upgradeAt: 4, upgradeAddFs: 4 },
    vault: { scatters: 4, freeSpins: 12, retrigger: { 2: 2, 3: 3 } as Record<number, number> },
    starfall: { scatters: 5, freeSpins: 12, retrigger: { 2: 2, 3: 3 } as Record<number, number> },
  },
  wincapX: 10000,
} as const;
