/**
 * Stake.us SOCIAL-CASINO wording (engine-docs reference/social-mode).
 *
 * When `social=true` the game must use English with every restricted phrase
 * replaced — in the UI, the rules, the replay screen and images — whatever
 * `lang` says. Two layers:
 *   1. EN_SOCIAL: hand-written overrides for keys whose automatic rewrite
 *      would read badly (button labels, the buy/autoplay confirms, errors).
 *   2. socialize(): the official restricted-phrase table applied to EVERY
 *      string as a safety net (case-preserving, whole words, longest first).
 * `findRestricted()` is the QA scan used to prove no restricted word survives.
 */

/**
 * Official table, verbatim order from the docs (restricted -> replacement).
 * Where the docs offer alternatives ("bonus / feature", "win / won",
 * "come and play / join in the game") the first option is used.
 */
export const RESTRICTED_PHRASES: ReadonlyArray<readonly [string, string]> = [
  ['bet', 'play'],
  ['bets', 'plays'],
  ['bet/s', 'play/s'],
  ['betting', 'playing'],
  ['bonus buy', 'bonus'],
  ['bought', 'instantly triggered'],
  ['buy', 'play'],
  ['buy bonus', 'get bonus'],
  ['cash', 'coins'],
  ['cost of', 'can be played for'],
  ['at the cost of', 'for'],
  ['credit', 'coins'],
  ['currency', 'token'],
  ['deposit', 'get coins'],
  ['gamble', 'play'],
  ['loss limit', 'stop limit'],
  ['loss streak', 'miss streak'],
  ['money', 'coins'],
  ['paid', 'won'],
  ['paid out', 'won'],
  ['pay', 'win'],
  ['pay out', 'win'],
  ['pay table', 'win table'],
  ['payer', 'winner'],
  ['pays', 'wins'],
  ['pays out', 'win'],
  ['place your bets', 'come and play'],
  ['profit', 'net gain'],
  ['purchase', 'play'],
  ['rebet', 'respin'],
  ['stake', 'play amount'],
  ['total bet', 'total play'],
  ['wager', 'play'],
  ['win feature', 'play feature'],
  ['withdraw', 'redeem'],
  ["be awarded to player's accounts", "appear in player's accounts"],
];

/**
 * Inflections / compounds the official table implies but does not spell out.
 * Keeps the safety net from leaking e.g. "PAYTABLE", "payouts" or "AutoBet".
 */
export const RESTRICTED_EXTRA: ReadonlyArray<readonly [string, string]> = [
  ['paytable', 'win table'],
  ['paytables', 'win tables'],
  ['pay tables', 'win tables'],
  ['payout', 'win'],
  ['payouts', 'wins'],
  ['paying', 'winning'],
  ['payline', 'win line'],
  ['paylines', 'win lines'],
  ['autobet', 'autoplay'],
  ['bet size', 'play amount'],
  ['bet amount', 'play amount'],
  ['bettor', 'player'],
  ['buys', 'plays'],
  ['buying', 'playing'],
  ['purchased', 'played'],
  ['purchases', 'plays'],
  ['purchasing', 'playing'],
  ['wagered', 'played'],
  ['wagers', 'plays'],
  ['wagering', 'playing'],
  ['gambling', 'playing'],
  ['credits', 'coins'],
  ['currencies', 'tokens'],
  ['deposits', 'get coins'],
  ['withdrawal', 'redemption'],
  ['withdrawals', 'redemptions'],
  ['profits', 'net gains'],
  ['stakes', 'play amounts'],
  ['rebets', 'respins'],
];

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** phrase (lower case) -> replacement */
const TABLE = new Map<string, string>();
for (const [k, v] of [...RESTRICTED_PHRASES, ...RESTRICTED_EXTRA]) TABLE.set(k.toLowerCase(), v);

/** one alternation, longest phrases first so "total bet" wins over "bet"; spaces match any whitespace */
const PATTERN = new RegExp(
  `(?<![A-Za-z])(${[...TABLE.keys()]
    .sort((a, b) => b.length - a.length)
    .map((p) => escapeRe(p).replace(/ /g, '\\s+'))
    .join('|')})(?![A-Za-z])`,
  'gi',
);

/** Apply the replacement with the casing of the matched text (ALL CAPS / Title / lower). */
const matchCase = (match: string, replacement: string): string => {
  const letters = match.replace(/[^A-Za-z]/g, '');
  if (letters.length > 1 && letters === letters.toUpperCase()) return replacement.toUpperCase();
  if (match[0] && match[0] === match[0].toUpperCase() && match[0] !== match[0].toLowerCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
};

/** Rewrite every restricted phrase in `text` (idempotent). */
export const socialize = (text: string): string =>
  text.replace(PATTERN, (m: string) => matchCase(m, TABLE.get(m.toLowerCase().replace(/\s+/g, ' ')) ?? m));

/** QA: the restricted phrases still present in `text` (empty = compliant). */
export const findRestricted = (text: string): string[] => {
  const out: string[] = [];
  for (const m of text.matchAll(PATTERN)) out.push(m[0]);
  return out;
};

/**
 * Hand-tuned social copy. Anything not listed here is EN run through socialize().
 * Rules: never "bet", "buy", "pay", "cost", "purchase", "stake" or "$" — the checklist
 * tests the spin button, the play-amount field, autoplay, the bonus button, the bonus
 * confirm step, the insufficient-funds error and the replay screen.
 */
export const EN_SOCIAL: Record<string, string> = {
  bet: 'PLAY',
  betSize: 'PLAY AMOUNT',
  bonusBuy: 'GET BONUS',
  'hud.buyShort': 'BONUS',

  'guide.bet.title': 'PLAY AMOUNT − / +',
  'guide.bet.desc': 'Lower or raise the play amount. Every available play level can be selected.',
  'guide.buy.title': 'GET BONUS',
  'guide.buy.desc':
    'Instantly triggers the Free Spins feature for a fixed multiple of the play amount. A confirmation is always shown first.',
  'guide.spin.desc':
    'Starts a round with the current play amount. While symbols are moving, press again to skip ahead. Keyboard: SPACE or ENTER.',

  'buy.title': 'GET BONUS',
  'buy.desc': 'Free Spins are instantly triggered at the start of the round.',
  'buy.costLabel': 'PLAY AMOUNT',
  'buy.multiple': '{x}× the current play amount',
  'buy.confirm': 'PLAY',

  'autoplay.lossLimit': 'STOP LIMIT',
  'autoplay.lossLimitHint': 'Stop when the balance drops by',

  'paytable.intro':
    'Clusters of 5 or more identical symbols connected horizontally or vertically win. Values are multiples of the play amount for each cluster size.',
  'paytable.symbols': 'SYMBOL WINS',
  'paytable.pending': 'Win values are supplied by the certified math model of this game version.',
  'rules.overview.body':
    '{title} is played on a grid of 7 reels and 5 rows. Wins are awarded for clusters of identical symbols. All wins are multiplied by the play amount.',
  'rules.cluster.title': 'CLUSTER WINS',
  'rules.fs.retrigger':
    'During the feature, {min} or more Scatters award additional Free Spins. Free Spins use the play amount of the triggering round.',
  'rules.maxWin.body':
    'The maximum win is {maxWin}× the play amount per round in every game mode. When it is reached, the round ends immediately and the maximum win is awarded.',
  'guide.menu.desc': 'Opens the win table, the game rules, this guide and the settings.',
  'rules.buy.title': 'GET BONUS',
  'rules.buy.body':
    'The Free Spins feature can be instantly triggered from the base game for {cost}× the current play amount. It starts with {spins} Free Spins and plays exactly like a naturally triggered feature.',
  'rules.modes.cost': 'PLAY AMOUNT',

  'err.ERR_IPB': 'Your balance is too low for this play amount. Lower the play amount to continue.',
  'err.ERR_GLE': 'A play limit has been reached.',

  'replay.cost': '{mode} · {bet} · {real} TOTAL',
};
