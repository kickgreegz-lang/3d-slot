import type { GameStrings } from '../../i18n';

/**
 * SWAMP FUNK: BASS DROP copy merged over the engine tables: symbol names, the Groove
 * Meter / Bass Drop / Juke Jam / Mega Mix rules and the two feature buys. Engine keys
 * overridden here that also have an engine social override (rules.buy.body, buy.desc)
 * get their own social version below.
 */
export const GAME_STRINGS: GameStrings = {
  en: {
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

    'paytable.wild.desc.bassdrop':
      'Substitutes for all paying symbols and can be part of any cluster. Wilds are dropped onto the board by the Bass Drop and can carry multipliers in the features.',

    'rules.wild.body': 'The Wild substitutes for all paying symbols. Wilds only reach the board through the Bass Drop.',
    'rules.groove.title': 'GROOVE METER',
    'rules.groove.body':
      'Every winning symbol that explodes adds 1 to the Groove Meter. The meter counts every connected symbol of the round (shown up to {max}) and starts again from 0 on every base game spin.',
    'rules.bassdrop.title': 'BASS DROP',
    'rules.bassdrop.body':
      'Each time the Groove Meter passes a multiple of 10, the speaker stack drops Wilds onto the board after the tumble. Every dropped Wild replaces the symbol it lands on.',
    'rules.bassdrop.row': 'Meter {n}',
    'rules.bassdrop.wilds': '{wilds} Wild(s)',
    'rules.jukejam.title': 'JUKE JAM',
    'rules.jukejam.body':
      'End a base game round with the Groove Meter at {at} or more to trigger Juke Jam with {spins} Free Spins. The meter keeps its value for the whole feature and dropped Wilds carry a multiplier from x{min} to x{max}: a winning cluster is multiplied by the sum of the Wild multipliers in it. Reaching {superAt} during Juke Jam upgrades it to Mega Mix with {addFs} extra Free Spins.',
    'rules.megamix.title': 'MEGA MIX',
    'rules.megamix.body':
      'End a base game round with the Groove Meter at {at} or more to trigger Mega Mix with {spins} Free Spins. Dropped Wilds carry a multiplier from x{min} to x{max} and stay on the board for the rest of the feature. Every time a sticky Wild is part of a win, its multiplier grows by 1, up to x{cap}.',

    'rules.modes.bonus': 'Juke Jam feature',
    'rules.modes.super': 'Mega Mix feature',
    'rules.buy.body':
      'Juke Jam can be bought from the base game for {cost}× the current bet. It starts with {spins} Free Spins and plays exactly like a naturally triggered feature.',
    'rules.buy.super':
      'Mega Mix can be bought from the base game for {cost}× the current bet. It starts with {spins} Free Spins and plays exactly like a naturally triggered feature.',
    'buy.title': 'BUY FEATURE',
    'buy.desc': 'Instantly trigger a feature.',
    'buy.desc.bonus': 'Instantly trigger Juke Jam.',
    'buy.desc.super': 'Instantly trigger Mega Mix.',
  },
  social: {
    'rules.buy.body':
      'Juke Jam can be instantly triggered from the base game for {cost}× the current play amount. It starts with {spins} Free Spins and plays exactly like a naturally triggered feature.',
    'rules.buy.super':
      'Mega Mix can be instantly triggered from the base game for {cost}× the current play amount. It starts with {spins} Free Spins and plays exactly like a naturally triggered feature.',
    'buy.title': 'GET BONUS',
    'buy.desc': 'A feature is instantly triggered at the start of the round.',
    'buy.desc.bonus': 'Juke Jam is instantly triggered at the start of the round.',
    'buy.desc.super': 'Mega Mix is instantly triggered at the start of the round.',
  },
};
