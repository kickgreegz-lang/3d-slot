import type { GameStrings } from '../../../i18n';

/**
 * Bass Drop copy (live text on the W ribbon and the multiplier badges, the badge clones of the
 * label sums and the Mega Mix "+1" preview), merged into ../i18n.ts GAME_STRINGS. No restricted social word
 * appears here, so the social table needs no overrides (socialize() still runs on every t()).
 */
export const STRINGS: GameStrings = {
  en: {
    'bd.drop.mult': '×{n}',
    /** engine key: the cluster label's multiplier badge, same glyph as the wild badges */
    'win.mult': '×{n}',
    'bd.drop.plusOne': '+{n}',
    /** the W's ribbon word (live text in the rig's txt_wild slot, never baked) */
    'bd.wild': 'WILD',
  },
  social: {},
};
