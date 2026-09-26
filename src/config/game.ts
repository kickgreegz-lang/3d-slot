/**
 * ENGINE VIEW of the active game's static configuration.
 *
 * The data (grid, symbol registry, win tiers, spot bands, bet modes, feature flags,
 * attract board) lives in the game folder — `src/games/<GAME>/config.ts`, resolved at
 * build time through the `@game` alias (vite.config.ts `GAME` env var; tsconfig `paths`).
 * This module re-exports it and owns the generic types and helpers, so engine modules
 * keep importing '../config/game' and never reach into src/games/** directly.
 *
 * COORDINATE CONVENTION (matches Stake math-sdk books):
 *   - Board arrays are [reel][row].
 *   - Symbol boards are PADDED: GRID.paddedRows rows per reel; the rows above
 *     GRID.firstVisibleRow and below GRID.lastVisibleRow are off-screen padding symbols
 *     (one each for both games: Swamp Funk 7 rows = 0 + 1..5 + 6, Bass Drop 8 rows =
 *     0 + 1..6 + 7). Positions in winInfo / tumbleBoard / freeSpinTrigger use padded rows.
 *   - gridMultipliers (updateGrid) are UNPADDED: [reel][visibleRow 0..GRID.rows-1].
 *   Use `toSpotRow(paddedRow)` / `toPaddedRow(visibleRow)` at the boundary.
 */
import { GRID, SPOT_BANDS, SYMBOLS } from '@game/config';
import META from '@game/meta.json';

export * from '@game/config';

/** Grid geometry of a game (reels x visible rows, padded boards). */
export interface GridSpec {
  reels: number;
  rows: number;
  /** rows per reel in book boards (visible rows + padding) */
  paddedRows: number;
  /** first visible padded row index */
  firstVisibleRow: number;
  /** last visible padded row index */
  lastVisibleRow: number;
}

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
  /** Content scale inside the cell (royals ~0.85, highs ~0.96, specials ~1.12). */
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

/** Big-win tiers (the presentation has one celebration per key). */
export type WinTierKey = 'big' | 'super' | 'mega' | 'epic' | 'max';

/**
 * Win tier in multiples of the bet (math-sdk config.py): winLevel from setWin maps here too.
 * level >= BIG triggers the big-win sequence.
 */
export interface WinTier {
  key: WinTierKey;
  minX: number;
  label: string;
}

/**
 * Multiplier-spot heat band: any integer spot value maps to a tier through the game's
 * SPOT_BANDS. value 0 = no spot, 1 = marked (no number).
 */
export interface SpotBand {
  tier: 0 | 1 | 2 | 3 | 4 | 5;
  /** inclusive minimum value for this band */
  min: number;
}

/** Optional engine features a game switches on. */
export interface GameFeatures {
  /** heat-tier multiplier spots (board/SpotGrid numbers, spots:update); tiles are always drawn */
  multiplierSpots: boolean;
  /**
   * Cluster wins with meta.wildMult > 1: 'auto' (default) = WinPresenter shows the xN badge and
   * counts winWithoutMult -> win by itself; 'external' = a game module drives it with
   * 'win:labelMult' events (WinPresenter falls back to 'auto' after a safety timeout).
   */
  wildMultSum?: 'auto' | 'external';
  /** bonus-buy hex opens the DOM buy dialog ('dom', default) or a game module's own screen ('game'). */
  buyScreen?: 'dom' | 'game';
  /**
   * Gravity falls (drop-in, tumble refill, transform 'drop') keep the time per cell of the
   * reference pitch BOARD_TIMING.physRefPitch (154): fall distances are measured in reference
   * px (distance / k, k = pitch / 154), so a smaller cell falls with gravity x k and lands with
   * the reference velocity (same squash). Default false (fixed gravity in design px).
   */
  physicsScale?: boolean;
  /**
   * Explode shake of a tumble step: trauma = min(explodeMax, explodeBase + explodePerSymbol x n).
   * Replaces BOARD_TIMING.explodeTrauma* when set (pass a live timing table to keep it lab-tunable).
   */
  explodeShake?: { explodeBase: number; explodePerSymbol: number; explodeMax: number };
}

/** Deterministic idle board before the first spin (flow/attract.ts). */
export interface AttractSpec {
  /** weighted symbol pool (repeat ids to weight them) */
  pool: string[];
  /** fixed symbols at 'reel,paddedRow' cells (teasers: wild, scatter, ...) */
  specials: Record<string, string>;
}

/** Build/host metadata of a game (src/games/<id>/meta.json; also read by vite.config.ts and the mock RGS). */
export interface GameMeta {
  /** folder name under src/games/ (= GAME env var) */
  id: string;
  /** display title (index.html <title>, status line, rules) */
  title: string;
  /** game id the mock RGS reports in authenticate.config.gameID */
  rgsGameId: string;
  /** localStorage key prefix for player preferences */
  storagePrefix: string;
}

export const GAME_META: GameMeta = META;
/**
 * Active game id = the folder under src/games/ (GAME env var, vite `define` __GAME_ID__;
 * the dev server defines it through its client, so modules loaded without it fall back to meta).
 */
export const GAME_ID: string = typeof __GAME_ID__ === 'string' ? __GAME_ID__ : META.id;

export const toSpotRow = (paddedRow: number): number => paddedRow - GRID.firstVisibleRow;
export const toPaddedRow = (visibleRow: number): number => visibleRow + GRID.firstVisibleRow;
export const isVisibleRow = (paddedRow: number): boolean =>
  paddedRow >= GRID.firstVisibleRow && paddedRow <= GRID.lastVisibleRow;

export const SYMBOL_IDS = Object.keys(SYMBOLS);

export const getSymbolDef = (id: string): SymbolDef => {
  const def = SYMBOLS[id];
  if (!def) throw new Error(`Unknown symbol id "${id}"`);
  return def;
};

export const spotTier = (value: number, bands: SpotBand[] = SPOT_BANDS): SpotBand['tier'] => {
  let tier: SpotBand['tier'] = 0;
  for (const b of bands) if (value >= b.min) tier = b.tier;
  return tier;
};

/** Book amounts (winInfo.totalWin, setWin.amount, ...) are bet multiples x100. */
export const BOOK_AMOUNT_SCALE = 100;
/** RGS API money is integer micro-units. */
export const API_MONEY_SCALE = 1_000_000;
