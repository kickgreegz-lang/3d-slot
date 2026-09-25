import type { AttractSpec, GameFeatures, GridSpec, SpotBand, SymbolDef, WinTier } from '../../config/game';
import type { BetModeDef } from '../../flow/modes';

/**
 * SWAMP FUNK: BASS DROP — static game configuration. Same world and symbols as Swamp Funk
 * (gator bouncer Gumbo, bullfrog DJ Baron Croak, neon bayou juke joint) on a 6x6 cluster
 * tumble grid with a GROOVE METER instead of multiplier spots:
 *
 *  - clusters of 5+ orthogonally connected identical symbols pay (W substitutes); winners
 *    explode, gravity refills from the top (Stake web-sdk tumble rule);
 *  - the meter counts every exploded (connected) symbol of the round; each threshold
 *    (10..60) triggers a BASS DROP: the speaker stack drops Wilds onto the refilled board;
 *  - round end (base): meter >= 60 -> Mega Mix (super bonus), >= 40 -> Juke Jam (bonus).
 *
 * Board: 6 reels x 6 rows, padded to 8 rows per reel (row 0 and row 7 are off-screen
 * padding; visible rows 1..6). Engine types / helpers: src/config/game.ts.
 */

export const GRID: GridSpec = {
  reels: 6,
  rows: 6,
  paddedRows: 8,
  firstVisibleRow: 1,
  lastVisibleRow: 6,
};

export const FEATURES: GameFeatures = {
  /** no multiplier spots: the board keeps its plain (tier 0) tiles */
  multiplierSpots: false,
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

/**
 * Swamp Funk's symbol set without the Scatter (features come from the meter). Keep ids,
 * colours and rest angles in step with src/games/swamp-funk/config.ts: the placeholder
 * art is shared (./art.ts).
 */
export const SYMBOLS: Record<string, SymbolDef> = {
  H1: {
    id: 'H1', kind: 'high', label: 'Golden Boombox', color: 0xffc629, shade: 0x8a4b0a,
    cellScale: 0.97, restAngle: -6, landWeight: 'heavy',
    art: { static: 'sym_H1', blur: 'sym_H1_blur', glow: 'sym_H1_glow' },
  },
  H2: {
    id: 'H2', kind: 'high', label: 'Vinyl Record', color: 0xff3fa8, shade: 0x5a0f3c,
    cellScale: 0.96, restAngle: 0, landWeight: 'medium',
    art: { static: 'sym_H2', blur: 'sym_H2_blur', glow: 'sym_H2_glow' },
  },
  H3: {
    id: 'H3', kind: 'high', label: 'Crawfish', color: 0xff5a2a, shade: 0x6b1608,
    cellScale: 0.96, restAngle: -14, landWeight: 'medium',
    art: { static: 'sym_H3', blur: 'sym_H3_blur', glow: 'sym_H3_glow' },
  },
  H4: {
    id: 'H4', kind: 'high', label: 'Hot Sauce', color: 0xe8262e, shade: 0x5c0b10,
    cellScale: 0.95, restAngle: -12, landWeight: 'medium',
    art: { static: 'sym_H4', blur: 'sym_H4_blur', glow: 'sym_H4_glow' },
  },
  L1: royal('L1', 'A', 'Ace', 0xd13242, 0x4b283d),
  L2: royal('L2', 'K', 'King', 0xf1c81c, 0x4b283d),
  L3: royal('L3', 'Q', 'Queen', 0x75d92a, 0x4b283d),
  L4: royal('L4', 'J', 'Jack', 0xe6a37f, 0x4b283d),
  L5: royal('L5', '10', 'Ten', 0xaa621b, 0x4b283d),
  W: {
    id: 'W', kind: 'wild', label: 'Wild', color: 0x35f2e0, shade: 0x0b3b52,
    cellScale: 1.02, restAngle: 0, landWeight: 'special',
    art: { static: 'sym_W', blur: 'sym_W_blur', glow: 'sym_W_glow' },
  },
};

/** Big-win tiers in bet multiples (placeholder until the math config is final). */
export const WIN_TIERS: readonly WinTier[] = [
  { key: 'big', minX: 15, label: 'BIG WIN' },
  { key: 'super', minX: 30, label: 'SUPER WIN' },
  { key: 'mega', minX: 50, label: 'MEGA WIN' },
  { key: 'epic', minX: 100, label: 'EPIC WIN' },
  { key: 'max', minX: Number.POSITIVE_INFINITY, label: 'MAX WIN' },
];

/** Tile tiers (board/SpotGrid draws the tier-0 tile under every cell; no spot values here). */
export const SPOT_BANDS: SpotBand[] = [
  { tier: 0, min: 0 },
  { tier: 1, min: 1 },
  { tier: 2, min: 2 },
  { tier: 3, min: 4 },
  { tier: 4, min: 8 },
  { tier: 5, min: 16 },
];

/**
 * Bet modes (math-sdk keys, sent verbatim to /wallet/play). Both buys cost more than 2x,
 * so the confirm step is mandatory (Stake rule). TODO(math): RTP / max win placeholders.
 */
export const BET_MODES: Record<string, BetModeDef> = {
  BASE: { key: 'BASE', cost: 1, buy: false, rtp: 0.962, maxWinX: 10000 },
  BONUS: { key: 'BONUS', cost: 100, buy: true, rtp: 0.962, maxWinX: 10000 },
  SUPER: { key: 'SUPER', cost: 300, buy: true, rtp: 0.962, maxWinX: 10000 },
};

/** Idle board before the first spin: no scatter in this game, one wild teaser. */
export const ATTRACT: AttractSpec = {
  pool: ['H1', 'H2', 'H3', 'H4', 'L1', 'L2', 'L3', 'L4', 'L5', 'H1', 'H2', 'H3', 'H4'],
  specials: { '1,2': 'W', '4,5': 'W' },
};

/**
 * DEV lab scenarios (src/dev/scenarios.ts) name Swamp Funk's fixture keys; these map them to
 * this game's generated fixtures (mock/games/bass-drop/books/base_fixtures.json).
 */
export const DEV_FIXTURE_ALIASES: Record<string, string> = {
  small_win_1_tumble: 'small_win',
  fs_trigger: 'bonus_trigger',
};

/**
 * GROOVE METER / BASS DROP / FEATURES — the decided mechanics, as data for the feature
 * modules, the rules page and the math generator (values mirror the math; outcomes always
 * come from the book events meterUpdate / wildDrop / stickyWilds / featureTrigger /
 * featureUpgrade, see ./book.ts).
 */
export const GROOVE = {
  /** meter face shows 0..displayMax (it may count past it) */
  displayMax: 60,
  /** every multiple of 10 up to 60 triggers a bass drop */
  thresholds: [10, 20, 30, 40, 50, 60],
  /** wilds dropped per threshold */
  wildsPerDrop: { 10: 1, 20: 1, 30: 2, 40: 2, 50: 3, 60: 3 } as Record<number, number>,
  /** base round end: meter >= bonusAt -> Juke Jam, >= superAt -> Mega Mix */
  bonusAt: 40,
  superAt: 60,
  /** JUKE JAM (bonus): meter persists across its free spins; wilds carry x2..x5 */
  bonus: { freeSpins: 8, wildMult: [2, 5] as const },
  /** reaching superAt during Juke Jam upgrades to Mega Mix with this many extra spins */
  upgradeSpins: 4,
  /** MEGA MIX (super): wilds are sticky, x2..x10, +1 each time they win, capped */
  super: { freeSpins: 10, wildMult: [2, 10] as const, cap: 25 },
} as const;
