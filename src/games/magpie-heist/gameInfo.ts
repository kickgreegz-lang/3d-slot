import type { BetModeInfo, GameInfo, RuleSection } from '../../ui/dom/gameInfo';
import { BET_MODES, HEIST } from './config';
import META from './meta.json';

/**
 * Rules / paytable / buy-confirm facts for MAGPIE HEIST. The pays are the MOCK paytable
 * (tools/mockmath/magpie-heist/config.mjs, bet multiples per cluster size 5..13+) until the
 * certified math is final; RTPs are placeholders. Copy lives in ./i18n.ts.
 */
const pct = (rtp: number): string => `${(rtp * 100).toFixed(2)}%`;
const F = HEIST.features;

const FEATURE_RULES: RuleSection[] = [
  { key: 'cascade', blocks: [{ text: { key: 'rules.cascade.body', vars: { n: HEIST.minCluster } } }] },
  { key: 'glint', blocks: [{ text: { key: 'rules.glint.body' } }] },
  {
    key: 'star',
    blocks: [
      { text: { key: 'rules.star.body' } },
      {
        table: [
          { label: { key: 'rules.loot.bronze' }, value: { key: 'rules.loot.range', vars: { lo: '0.2', hi: '4' } } },
          { label: { key: 'rules.loot.silver' }, value: { key: 'rules.loot.range', vars: { lo: '5', hi: '20' } } },
          { label: { key: 'rules.loot.gold' }, value: { key: 'rules.loot.range', vars: { lo: '25', hi: '500' } } },
          { label: { key: 'rules.loot.diamond' }, value: { key: 'rules.loot.diamondValue' } },
          { label: { key: 'rules.loot.nest' }, value: { key: 'rules.loot.nestValue' } },
        ],
      },
    ],
  },
  { key: 'diamond', blocks: [{ text: { key: 'rules.diamond.body' } }] },
  { key: 'nest', blocks: [{ text: { key: 'rules.nest.body', vars: { rounds: HEIST.maxRounds } } }] },
  {
    key: 'prowl',
    blocks: [{ text: { key: 'rules.prowl.body', vars: { n: F.prowl.scatters, spins: F.prowl.freeSpins, r2: F.prowl.retrigger[2], r3: F.prowl.retrigger[3], up: F.prowl.upgradeAt, add: F.prowl.upgradeAddFs } } }],
  },
  {
    key: 'vault',
    blocks: [{ text: { key: 'rules.vault.body', vars: { n: F.vault.scatters, spins: F.vault.freeSpins, r2: F.vault.retrigger[2], r3: F.vault.retrigger[3] } } }],
  },
  {
    key: 'starfall',
    blocks: [{ text: { key: 'rules.starfall.body', vars: { n: F.starfall.scatters, spins: F.starfall.freeSpins, r2: F.starfall.retrigger[2], r3: F.starfall.retrigger[3] } } }],
  },
  { key: 'featurespins', blocks: [{ text: { key: 'rules.featurespins.body', vars: { hunt: BET_MODES.HUNT.cost, stars: BET_MODES.STARS.cost } } }] },
];

type ModeKey = 'BASE' | 'HUNT' | 'STARS' | 'PROWL' | 'VAULT';
const mode = (key: ModeKey, extra: Partial<BetModeInfo>): BetModeInfo => ({
  mode: key,
  nameKey: `rules.modes.${key.toLowerCase()}`,
  cost: BET_MODES[key].cost,
  rtp: pct(BET_MODES[key].rtp),
  maxWinX: BET_MODES[key].maxWinX,
  spins: null,
  ...extra,
});

/** mock paytable, bet multiples per cluster size 5, 6, ... 13+ */
const PAYS: Record<string, number[]> = {
  H1: [2, 3, 5, 8, 12, 20, 40, 75, 100],
  H2: [1.5, 2, 3, 5, 8, 12, 25, 40, 50],
  H3: [1.2, 1.5, 2.5, 4, 6, 10, 20, 30, 50],
  H4: [0.8, 1.2, 2, 3, 5, 8, 15, 25, 30],
  H5: [0.6, 1, 1.5, 2.5, 4, 6, 12, 20, 25],
  L1: [0.3, 0.4, 0.6, 1, 1.5, 2.5, 5, 10, 15],
  L2: [0.25, 0.35, 0.5, 0.8, 1.2, 2, 4, 8, 12],
  L3: [0.2, 0.3, 0.4, 0.6, 1, 1.5, 3, 6, 10],
  L4: [0.2, 0.25, 0.35, 0.5, 0.8, 1.2, 2.5, 5, 10],
  L5: [0.15, 0.2, 0.3, 0.45, 0.7, 1, 2, 4, 8],
};

export const GAME_INFO: GameInfo = {
  title: META.title,
  copyrightHolder: 'Magpie Heist',
  year: 2026,
  version: '0.1.0',
  modes: [
    mode('BASE', {}),
    mode('HUNT', { buyBodyKey: 'rules.buy.hunt', buyDescKey: 'buy.desc.hunt' }),
    mode('STARS', { buyBodyKey: 'rules.buy.stars', buyDescKey: 'buy.desc.stars' }),
    mode('PROWL', { spins: F.prowl.freeSpins, buyBodyKey: 'rules.buy.prowl', buyDescKey: 'buy.desc.prowl' }),
    mode('VAULT', { spins: F.vault.freeSpins, buyBodyKey: 'rules.buy.vault', buyDescKey: 'buy.desc.vault' }),
  ],
  clusterSizes: [5, 6, 7, 8, 9, 10, 11, 12, 13],
  pays: PAYS,
  paySymbols: ['H1', 'H2', 'H3', 'H4', 'H5', 'L1', 'L2', 'L3', 'L4', 'L5'],
  specials: [
    { id: 'W', title: { key: 'paytable.wild.title' }, desc: { key: 'paytable.wild.desc.heist' } },
    { id: 'R', title: { key: 'paytable.star.title' }, desc: { key: 'paytable.star.desc' } },
    { id: 'S', title: { key: 'paytable.safe.title' }, desc: { key: 'paytable.safe.desc' } },
  ],
  featureRules: FEATURE_RULES,
};
