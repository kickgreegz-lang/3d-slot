/**
 * Game-wide static configuration: grid geometry, symbol registry, win tiers,
 * multiplier-spot heat bands. Everything here is data — no Pixi imports — so the
 * math/logic team and the art pipeline can edit it without touching rendering.
 *
 * COORDINATE CONVENTION (matches Stake math-sdk books):
 *   - Board arrays are [reel][row].
 *   - Symbol boards are PADDED: 7 rows per reel, row 0 and row 6 are off-screen
 *     padding symbols; visible rows are 1..5. Positions in winInfo / tumbleBoard /
 *     freeSpinTrigger use padded rows.
 *   - gridMultipliers (updateGrid) are UNPADDED: [reel][visibleRow 0..4].
 *   Use `toSpotRow(paddedRow)` / `toPaddedRow(visibleRow)` at the boundary.
 */

export const GRID = {
  reels: 7,
  rows: 5,
  paddedRows: 7,
  /** first visible padded row index */
  firstVisibleRow: 1,
  /** last visible padded row index */
  lastVisibleRow: 5,
} as const;

export const toSpotRow = (paddedRow: number): number => paddedRow - GRID.firstVisibleRow;
export const toPaddedRow = (visibleRow: number): number => visibleRow + GRID.firstVisibleRow;
export const isVisibleRow = (paddedRow: number): boolean =>
  paddedRow >= GRID.firstVisibleRow && paddedRow <= GRID.lastVisibleRow;

export type SymbolKind = 'royal' | 'high' | 'wild' | 'scatter' | 'special';

/** How heavy a symbol "feels" when it lands — drives squash, bounce, shake, SFX. */
export type LandWeight = 'light' | 'medium' | 'heavy' | 'special';

export interface SymbolDef {
  id: string;
  kind: SymbolKind;
  /** Display name used in paytable (localised later). */
  label: string;
  /** Primary hue of the symbol (used by placeholder art, glows, particles, cluster labels). */
  color: number;
  /** Darker companion hue for particles/shadows. */
  shade: number;
  /** Content scale inside the 150px cell (royals ~0.85, highs ~0.96, specials ~1.12). */
  cellScale: number;
  /** Resting rotation in degrees (specials are tilted to break grid monotony). */
  restAngle: number;
  landWeight: LandWeight;
  /** Royal glyph for vector royals (placeholder + production royals are both vector). */
  glyph?: string;
  /**
   * Art binding. Keys resolve through the asset manifest.
   * - `spine` present  => SymbolView borrows a pooled Spine instance for land/win/anticipation/explode.
   * - otherwise        => procedural GSAP/shader animation on the static texture.
   */
  art: {
    static: string;
    blur?: string;
    glow?: string;
    spine?: { skeleton: string; atlas: string; skin?: string };
  };
}

const royal = (
  id: string,
  glyph: string,
  label: string,
  color: number,
  shade: number,
): SymbolDef => ({
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
 * Working theme: "SWAMP FUNK" (placeholder direction — a neon bayou juke joint).
 * Swap labels/colours/art keys per theme; ids must match the math-sdk paytable.
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
  S: {
    id: 'S', kind: 'scatter', label: 'Golden Mic', color: 0xffd54a, shade: 0x7a3e00,
    cellScale: 1.12, restAngle: -18, landWeight: 'special',
    art: { static: 'sym_S', blur: 'sym_S_blur', glow: 'sym_S_glow' },
  },
};

export const SYMBOL_IDS = Object.keys(SYMBOLS);

export const getSymbolDef = (id: string): SymbolDef => {
  const def = SYMBOLS[id];
  if (!def) throw new Error(`Unknown symbol id "${id}"`);
  return def;
};

/**
 * Win tiers in multiples of the bet (math-sdk config.py): winLevel from setWin maps here too.
 * level >= BIG triggers the big-win sequence.
 */
export const WIN_TIERS = [
  { key: 'big', minX: 15, label: 'BIG WIN' },
  { key: 'super', minX: 30, label: 'SUPER WIN' },
  { key: 'mega', minX: 50, label: 'MEGA WIN' },
  { key: 'epic', minX: 100, label: 'EPIC WIN' },
  { key: 'max', minX: Number.POSITIVE_INFINITY, label: 'MAX WIN' },
] as const;
export type WinTierKey = (typeof WIN_TIERS)[number]['key'];

/**
 * Multiplier-spot heat bands. The math decides whether values grow additively
 * (+1, math-sdk sample) or by doubling (reference game) — the front-end renders
 * any integer through these thresholds. value 0 = no spot, 1 = marked (no number).
 */
export interface SpotBand {
  tier: 0 | 1 | 2 | 3 | 4 | 5;
  /** inclusive minimum value for this band */
  min: number;
}
export const SPOT_BANDS_DOUBLING: SpotBand[] = [
  { tier: 0, min: 0 },
  { tier: 1, min: 1 },
  { tier: 2, min: 2 },
  { tier: 3, min: 32 },
  { tier: 4, min: 128 },
  { tier: 5, min: 512 },
];
export const SPOT_BANDS_ADDITIVE: SpotBand[] = [
  { tier: 0, min: 0 },
  { tier: 1, min: 1 },
  { tier: 2, min: 2 },
  { tier: 3, min: 4 },
  { tier: 4, min: 8 },
  { tier: 5, min: 16 },
];
/** Active band table — the fixture books are additive (math-sdk sample). */
export const SPOT_BANDS: SpotBand[] = SPOT_BANDS_ADDITIVE;

export const spotTier = (value: number, bands: SpotBand[] = SPOT_BANDS): SpotBand['tier'] => {
  let tier: SpotBand['tier'] = 0;
  for (const b of bands) if (value >= b.min) tier = b.tier;
  return tier;
};

/** Book amounts (winInfo.totalWin, setWin.amount, ...) are bet multiples x100. */
export const BOOK_AMOUNT_SCALE = 100;
/** RGS API money is integer micro-units. */
export const API_MONEY_SCALE = 1_000_000;
