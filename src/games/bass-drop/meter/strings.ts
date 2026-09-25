import type { GameStrings } from '../../../i18n';

/**
 * Groove Meter copy (counter suffixes, the next-drop chip and its merged free-spin line),
 * merged into ../i18n.ts GAME_STRINGS. Nothing here carries a restricted social word, so
 * the social table needs no overrides (the socialize() safety net still runs on every t()).
 */
export const STRINGS: GameStrings = {
  en: {
    'bd.meter.of': '/{max}',
    'bd.meter.max': 'MAX',
    'bd.meter.laps': '×{n}',
    'bd.meter.nextDrop': 'NEXT DROP',
    'bd.meter.megaMix': 'MEGA MIX',
    'bd.meter.megaMixBang': 'MEGA MIX!',
    'bd.meter.jukeJam': 'JUKE JAM',
    'bd.meter.sticky': '{n} STICKY',
    'bd.meter.multRange': '×{min}–{max}',
  },
  social: {},
};
