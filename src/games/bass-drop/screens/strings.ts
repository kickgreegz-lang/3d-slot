import type { GameStrings } from '../../../i18n';

/**
 * Screen copy (game intro cards, bonus buy screen, feature intro / upgrade / outro and the
 * feature plate), merged into ../i18n.ts GAME_STRINGS. Every word on these screens is live
 * text from here; numbers come in through {vars}.
 *
 * Social mode (stake.us): the hand-written overrides below replace every restricted phrase
 * of this table (BONUS BUY -> BONUS, BUY -> PLAY, x BET -> x PLAY, COST -> PLAY AMOUNT); the
 * socialize() safety net still runs on every t(), so a new key can never leak one.
 */
export const STRINGS: GameStrings = {
  en: {
    // ---- feature names (intro banner, upgrade, outro, plate, cards)
    'bd.feature.jukeJam': 'JUKE JAM',
    'bd.feature.megaMix': 'MEGA MIX',
    'bd.feature.freeSpins': 'FREE SPINS',
    'bd.feature.count': '{n}',
    'bd.feature.addSpins': '+{n}',
    'bd.feature.tapToStart': 'TAP TO START',
    'bd.feature.tapToContinue': 'TAP TO CONTINUE',
    'bd.feature.totalWin': 'TOTAL WIN',
    'bd.feature.fsOf': '{current} / {total}',

    // ---- game intro (DESIGN §12)
    'bd.intro.logoTop': 'SWAMP FUNK',
    'bd.intro.logoMain': 'BASS DROP',
    'bd.intro.meter.title': 'GROOVE METER',
    'bd.intro.meter.body': 'EVERY {n} CONNECTED SYMBOLS DROP WILDS ON THE BOARD',
    'bd.intro.jukeJam.title': 'JUKE JAM',
    'bd.intro.jukeJam.body': 'CONNECT {at} SYMBOLS IN ONE SPIN FOR {spins} FREE SPINS WITH MULTIPLIER WILDS',
    'bd.intro.megaMix.title': 'MEGA MIX',
    'bd.intro.megaMix.body': 'CONNECT {at} FOR {spins} FREE SPINS WITH STICKY MULTIPLIER WILDS THAT GROW UP TO ×{cap}',
    'bd.intro.footer': 'WIN UP TO {x}×',
    'bd.intro.press': 'PRESS TO CONTINUE',
    'bd.intro.dontShow': "DON'T SHOW AGAIN",
    'bd.intro.mult': '×{n}',

    // ---- bonus buy (DESIGN §13)
    'bd.buy.title': 'BONUS BUY',
    'bd.buy.spins': '{n} FREE SPINS',
    'bd.buy.costX': '{x}× BET',
    'bd.buy.button': 'BUY',
    'bd.buy.cost': 'COST',
    'bd.buy.confirm': 'CONFIRM',
    'bd.buy.cancel': 'CANCEL',
    'bd.buy.insufficient': 'INSUFFICIENT BALANCE',
  },
  social: {
    'bd.buy.title': 'BONUS',
    'bd.buy.costX': '{x}× PLAY',
    'bd.buy.button': 'PLAY',
    'bd.buy.cost': 'PLAY AMOUNT',
  },
};
