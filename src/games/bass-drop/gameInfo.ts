import type { BetModeInfo, GameInfo, RuleSection } from '../../ui/dom/gameInfo';
import { BET_MODES, GROOVE } from './config';
import META from './meta.json';

/**
 * Rules / paytable / buy-confirm facts for SWAMP FUNK: BASS DROP. PLACEHOLDERS for the
 * math-owned numbers (RTP, max win, pays) until the certified math is final; feature
 * numbers come from ./config.ts GROOVE. Copy lives in ./i18n.ts.
 */
const pct = (rtp: number): string => `${(rtp * 100).toFixed(2)}%`;

const FEATURE_RULES: RuleSection[] = [
  { key: 'wild', blocks: [{ text: { key: 'rules.wild.body' } }] },
  {
    key: 'groove',
    blocks: [{ text: { key: 'rules.groove.body', vars: { max: GROOVE.displayMax } } }],
  },
  {
    key: 'bassdrop',
    blocks: [
      { text: { key: 'rules.bassdrop.body' } },
      {
        table: GROOVE.thresholds.map((n) => ({
          label: { key: 'rules.bassdrop.row', vars: { n } },
          value: { key: 'rules.bassdrop.wilds', vars: { wilds: GROOVE.wildsPerDrop[n] ?? 0 } },
        })),
      },
    ],
  },
  {
    key: 'jukejam',
    blocks: [
      {
        text: {
          key: 'rules.jukejam.body',
          vars: {
            at: GROOVE.bonusAt,
            spins: GROOVE.bonus.freeSpins,
            min: GROOVE.bonus.wildMult[0],
            max: GROOVE.bonus.wildMult[1],
            superAt: GROOVE.superAt,
            addFs: GROOVE.upgradeSpins,
          },
        },
      },
    ],
  },
  {
    key: 'megamix',
    blocks: [
      {
        text: {
          key: 'rules.megamix.body',
          vars: {
            at: GROOVE.superAt,
            spins: GROOVE.super.freeSpins,
            min: GROOVE.super.wildMult[0],
            max: GROOVE.super.wildMult[1],
            cap: GROOVE.super.cap,
          },
        },
      },
    ],
  },
];

const mode = (key: 'BASE' | 'BONUS' | 'SUPER', extra: Partial<BetModeInfo>): BetModeInfo => ({
  mode: key,
  nameKey: `rules.modes.${key.toLowerCase()}`,
  cost: BET_MODES[key].cost,
  rtp: pct(BET_MODES[key].rtp),
  maxWinX: BET_MODES[key].maxWinX,
  spins: null,
  ...extra,
});

export const GAME_INFO: GameInfo = {
  title: META.title,
  copyrightHolder: 'Swamp Funk',
  year: 2026,
  version: '0.1.0',
  modes: [
    mode('BASE', {}),
    mode('BONUS', { spins: GROOVE.bonus.freeSpins, buyBodyKey: 'rules.buy.body', buyDescKey: 'buy.desc.bonus' }),
    mode('SUPER', { spins: GROOVE.super.freeSpins, buyBodyKey: 'rules.buy.super', buyDescKey: 'buy.desc.super' }),
  ],
  clusterSizes: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  pays: { H1: null, H2: null, H3: null, H4: null, L1: null, L2: null, L3: null, L4: null, L5: null },
  paySymbols: ['H1', 'H2', 'H3', 'H4', 'L1', 'L2', 'L3', 'L4', 'L5'],
  specials: [{ id: 'W', title: { key: 'paytable.wild.title' }, desc: { key: 'paytable.wild.desc.bassdrop' } }],
  featureRules: FEATURE_RULES,
};
