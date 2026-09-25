import type { GameStrings } from '../../i18n';

/**
 * SWAMP FUNK copy merged over the engine tables (i18n/en.ts, i18n/social.ts): symbol
 * names, specials and the feature rules referenced by ./gameInfo.ts. `social` holds
 * hand-tuned stake.us overrides; everything else still passes through socialize().
 */
export const GAME_STRINGS: GameStrings = {
  en: {
    // ── symbols (fallback: SYMBOLS[id].label) ─────────────────────────────
    'sym.H1': 'Golden Boombox',
    'sym.H2': 'Vinyl Record',
    'sym.H3': 'Crawfish',
    'sym.H4': 'Hot Sauce',
    'sym.L1': 'Ace',
    'sym.L2': 'King',
    'sym.L3': 'Queen',
    'sym.L4': 'Jack',
    'sym.L5': 'Ten',
    'sym.W': 'Wild',
    'sym.S': 'Golden Mic',

    // ── paytable specials ─────────────────────────────────────────────────
    'paytable.scatter.title': 'SCATTER',
    'paytable.scatter.desc': '{min} or more Scatters anywhere on the grid trigger Free Spins. Scatters do not form clusters.',

    // ── rules ─────────────────────────────────────────────────────────────
    'rules.wild.body': 'The Wild substitutes for all paying symbols. It does not substitute for Scatters.',
    'rules.fs.title': 'FREE SPINS',
    'rules.fs.body':
      'Landing {min} or more Scatters anywhere on the grid triggers Free Spins. The number of Free Spins awarded depends on the number of Scatters:',
    'rules.fs.row': '{n} Scatters',
    'rules.fs.award': '{spins} Free Spins',
    'rules.fs.retrigger':
      'During the feature, {min} or more Scatters award additional Free Spins. Free Spins are played at the bet of the triggering round.',
  },
  social: {
    'rules.fs.retrigger':
      'During the feature, {min} or more Scatters award additional Free Spins. Free Spins use the play amount of the triggering round.',
  },
};
