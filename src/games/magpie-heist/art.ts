import type { ArtManifest } from '../../assets/manifest';
import type { SymbolBuilder } from '../../assets/placeholder/ProceduralArt';
import { ENV_ART } from './manifest/env';
import { SYMBOL_ART, SYMBOL_SPINE } from './manifest/symbols';

/**
 * MAGPIE HEIST art bindings. Production symbols / rigs / frame come from ./manifest/* (shipped by
 * tools/mhart, docs/games/magpie-heist/ART_PLAN.md); every id without a shipped file falls back to the
 * engine's procedural placeholder (royal glyph). Plates, logo, mascot and loot art are loaded by their
 * own modules (scene/, mascots/, loot/).
 */
export const SYMBOL_BUILDERS: Record<string, SymbolBuilder> = {};

export const ART_MANIFEST: ArtManifest = {
  symbols: SYMBOL_ART,
  env: ENV_ART,
  particles: [],
  spine: SYMBOL_SPINE,
};
