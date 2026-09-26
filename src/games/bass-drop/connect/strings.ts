import type { GameStrings } from '../../../i18n';

/**
 * Connection-presentation copy (the "+N" count pops that ride the orb stream into the Groove
 * Meter), merged into ../i18n.ts GAME_STRINGS. No restricted social word, so the social
 * table needs no overrides (socialize() still runs on every t()).
 */
export const STRINGS: GameStrings = {
  en: {
    'bd.connect.plus': '+{n}',
  },
  social: {},
};
