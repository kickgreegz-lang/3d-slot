import type { SymbolVariant } from '../../../assets/art';
import type { ManifestSpine, ManifestSymbol } from '../../../assets/manifest';

/**
 * Bass Drop symbol art (owned by the symbols integration): board sprites
 * (./assets/bass-drop/symbols/sym_<id>[_blur|_glow]@2x.webp) and the Spine rigs of H1-H4 and W.
 * Rules: src/assets/manifest.ts. Never list a file that is not shipped.
 *
 * Shipped by tools/artqa/ship_symbols.py (provenance rows in art/manifest.json, shipped: true):
 *  - board sprites: 360 x 360 @2x canvases, the rig's SETUP POSE for H1-H4 / W (so SymbolRig's
 *    static -> Spine swap cannot pop), the formula-D royal glyphs for L1-L5; the glow is white and
 *    tinted with SYMBOLS[id].color at runtime;
 *  - rigs: generated 4.3 JSON + per-rig PMA atlas (one lossless WebP page <= 1024 px). The W's
 *    skins (default / mult / sticky), badge tier and live text are driven through SymbolView.setLook
 *    by the Bass Drop module (drop/registry.ts); production swaps in `.skel` + the shared atlas.
 */
const SPRITE_IDS = ['H1', 'H2', 'H3', 'H4', 'W', 'L1', 'L2', 'L3', 'L4', 'L5'] as const;
const SUFFIX: Record<SymbolVariant, string> = { static: '', blur: '_blur', glow: '_glow' };

export const SYMBOL_ART: ManifestSymbol[] = SPRITE_IDS.flatMap((id) =>
  (['static', 'blur', 'glow'] as const).map((variant) => ({
    id,
    variant,
    src: `./assets/bass-drop/symbols/sym_${id}${SUFFIX[variant]}@2x.webp`,
  })),
);

export const SYMBOL_SPINE: ManifestSpine[] = (['H1', 'H2', 'H3', 'H4', 'W'] as const).map((id) => ({
  id,
  skeleton: `./assets/bass-drop/spine/sym_${id}.json`,
  atlas: `./assets/bass-drop/spine/sym_${id}.atlas`,
}));
