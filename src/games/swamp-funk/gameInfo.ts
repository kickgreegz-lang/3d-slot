import type { BetModeInfo, GameInfo, RuleSection } from '../../ui/dom/gameInfo';
import META from './meta.json';

/**
 * Game facts shown in the rules / paytable / buy confirm. PLACEHOLDERS until the
 * certified math is final — the lead replaces these with values exported from the
 * math-sdk config (RTP per mode, max win, pays per cluster size, bet-mode costs).
 * Nothing here is used for gameplay: outcomes always come from the RGS.
 * Copy (i18n keys) lives in ./i18n.ts; the page builders are engine-side (ui/dom/pages.ts).
 */

/** min scatters for Free Spins, and awards by scatter count */
const SCATTER_MIN = 3;
const FREE_SPIN_AWARDS = [
  { scatters: 3, spins: 10 },
  { scatters: 4, spins: 12 },
  { scatters: 5, spins: 15 },
  { scatters: 6, spins: 20 },
  { scatters: 7, spins: 30 },
];
/** highest value a multiplier spot can reach */
const MAX_SPOT = 512;

const FEATURE_RULES: RuleSection[] = [
  {
    key: 'spots',
    blocks: [{ text: { key: 'rules.spots.body', vars: { maxSpot: MAX_SPOT }, keyVars: { spotReset: 'rules.spots.reset' } } }],
  },
  { key: 'wild', blocks: [{ text: { key: 'rules.wild.body' } }] },
  {
    key: 'fs',
    blocks: [
      { text: { key: 'rules.fs.body', vars: { min: SCATTER_MIN } } },
      {
        table: FREE_SPIN_AWARDS.map((a, i, all) => ({
          label: { key: 'rules.fs.row', vars: { n: i === all.length - 1 ? `${a.scatters}+` : a.scatters } },
          value: { key: 'rules.fs.award', vars: { spins: a.spins } },
        })),
      },
      { text: { key: 'rules.fs.retrigger', vars: { min: SCATTER_MIN } } },
    ],
  },
];

export const GAME_INFO: GameInfo = {
  title: META.title,
  copyrightHolder: 'Swamp Funk',
  year: 2026,
  version: '0.1.0',
  modes: [
    { mode: 'BASE', nameKey: 'rules.modes.base', cost: 1, rtp: '96.20%', maxWinX: 5000, spins: null },
    { mode: 'BONUS', nameKey: 'rules.modes.bonus', cost: 100, rtp: '96.20%', maxWinX: 5000, spins: 10 },
  ] as BetModeInfo[],
  /** cluster sizes shown in the paytable (last = "n+") */
  clusterSizes: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  /**
   * Symbol pays as bet multiples per cluster size (same order as clusterSizes).
   * null = not supplied yet (rendered as "—"). Fill from the math-sdk paytable.
   */
  pays: {
    H1: null,
    H2: null,
    H3: null,
    H4: null,
    L1: null,
    L2: null,
    L3: null,
    L4: null,
    L5: null,
  },
  /** paytable order (highest first) */
  paySymbols: ['H1', 'H2', 'H3', 'H4', 'L1', 'L2', 'L3', 'L4', 'L5'],
  specials: [
    { id: 'W', title: { key: 'paytable.wild.title' }, desc: { key: 'paytable.wild.desc' } },
    { id: 'S', title: { key: 'paytable.scatter.title' }, desc: { key: 'paytable.scatter.desc', vars: { min: SCATTER_MIN } } },
  ],
  featureRules: FEATURE_RULES,
};
