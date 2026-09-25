import type { ArtManifest } from '../../assets/manifest';
import type { SymbolBuilder } from '../../assets/placeholder/ProceduralArt';
import { buildBoombox, buildCrawfish, buildHotSauce, buildVinyl } from './placeholder/symbolsHigh';
import { buildMic, buildWild } from './placeholder/symbolsSpecial';

/**
 * SWAMP FUNK art bindings.
 *
 * SYMBOL_BUILDERS: procedural cel-style placeholders by symbol id (baked once by
 * assets/placeholder/ProceduralArt.ts). Royals are not listed: the engine's generic
 * royal builder draws them from SymbolDef.glyph / color.
 *
 * ART_MANIFEST: PRODUCTION art filled by the art pipeline (Higgsfield -> matte ->
 * AssetPack); every key listed here replaces the placeholder (see assets/manifest.ts
 * for the rules: relative URLs only, 360x360 @2x symbol canvases, ...).
 */
export const SYMBOL_BUILDERS: Record<string, SymbolBuilder> = {
  H1: (r, s) => buildBoombox(r, s),
  H2: (r, s) => buildVinyl(r, s),
  H3: (r, s) => buildCrawfish(r, s),
  H4: (r, s) => buildHotSauce(r, s),
  W: (r, s) => buildWild(r, s),
  S: (r, s) => buildMic(r, s),
};

export const ART_MANIFEST: ArtManifest = {
  symbols: [],
  env: [],
  particles: [],
  spine: [],
};
