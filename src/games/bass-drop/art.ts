import type { ArtManifest } from '../../assets/manifest';
import type { SymbolBuilder } from '../../assets/placeholder/ProceduralArt';
import { buildBoombox, buildCrawfish, buildHotSauce, buildVinyl } from '../swamp-funk/placeholder/symbolsHigh';
import { buildWild } from '../swamp-funk/placeholder/symbolsSpecial';

/**
 * SWAMP FUNK: BASS DROP art bindings. Same world as Swamp Funk, so the placeholder symbols
 * are Swamp Funk's cel builders (they read Swamp Funk's rest angles — keep ./config.ts
 * SYMBOLS in step). Royals use the engine's generic royal builder.
 * ART_MANIFEST: production files for this game (rules in assets/manifest.ts).
 */
export const SYMBOL_BUILDERS: Record<string, SymbolBuilder> = {
  H1: (r, s) => buildBoombox(r, s),
  H2: (r, s) => buildVinyl(r, s),
  H3: (r, s) => buildCrawfish(r, s),
  H4: (r, s) => buildHotSauce(r, s),
  W: (r, s) => buildWild(r, s),
};

export const ART_MANIFEST: ArtManifest = {
  symbols: [],
  env: [],
  particles: [],
  spine: [],
};
