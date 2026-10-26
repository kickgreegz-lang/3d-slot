import type { SymbolVariant } from '../../../assets/art';
import type { ManifestSpine, ManifestSymbol } from '../../../assets/manifest';

/**
 * Magpie Heist symbol art: board sprites (./assets/magpie-heist/symbols/sym_<id>[_blur|_glow]@2x.webp,
 * 360 x 360 @2x canvases = the rig's setup pose, so the static -> Spine swap cannot pop) and the Spine
 * rigs (generated 4.3 JSON + per-rig PMA atlas, tools/mhart/rigs/build.sh <ID> --ship). Shipped by tools/licence/ship.py (provenance rows in
 * art/manifest.json). Rules: src/assets/manifest.ts. Never list a file that is not shipped.
 */
export const SPRITE_IDS: readonly string[] = ['W', 'R', 'H1', 'H2', 'H3', 'H4', 'H5', 'S'];
export const SPINE_IDS: readonly string[] = ['W', 'R', 'H1'];
const SUFFIX: Record<SymbolVariant, string> = { static: '', blur: '_blur', glow: '_glow' };

export const SYMBOL_ART: ManifestSymbol[] = SPRITE_IDS.flatMap((id) =>
  (['static', 'blur', 'glow'] as const).map((variant) => ({
    id,
    variant,
    src: `./assets/magpie-heist/symbols/sym_${id}${SUFFIX[variant]}@2x.webp`,
  })),
);

export const SYMBOL_SPINE: ManifestSpine[] = SPINE_IDS.map((id) => ({
  id,
  skeleton: `./assets/magpie-heist/spine/sym_${id}.json`,
  atlas: `./assets/magpie-heist/spine/sym_${id}.atlas`,
}));
