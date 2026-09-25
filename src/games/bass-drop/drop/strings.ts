import type { GameStrings } from '../../../i18n';

/**
 * Bass Drop copy (live text on the multiplier badges, the badge clones of the label sums and
 * the Mega Mix "+1" preview), merged into ../i18n.ts GAME_STRINGS. No restricted social word
 * appears here, so the social table needs no overrides (socialize() still runs on every t()).
 */
export const STRINGS: GameStrings = {
  en: {
    'bd.drop.mult': '×{n}',
    'bd.drop.plusOne': '+{n}',
  },
  social: {},
};
