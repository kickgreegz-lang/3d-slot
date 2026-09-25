/**
 * Game facts shown in the rules / paytable / buy confirm. PLACEHOLDERS until the
 * certified math is final — the lead replaces these with values exported from the
 * math-sdk config (RTP per mode, max win, pays per cluster size, bet-mode costs).
 * Nothing here is used for gameplay: outcomes always come from the RGS.
 */
export interface BetModeInfo {
  /** RGS mode key as sent to /wallet/play (matches flow/modes.ts BET_MODES) */
  mode: string;
  /** i18n key for the mode's display name */
  nameKey: string;
  /** cost as a multiple of the bet (1 = base) */
  cost: number;
  rtp: string;
  maxWinX: number;
  /** free spins awarded when bought (null for base) */
  spins: number | null;
}

export const GAME_INFO = {
  title: 'Swamp Funk',
  copyrightHolder: 'Swamp Funk',
  year: 2026,
  version: '0.1.0',
  /** min scatters for Free Spins, and awards by scatter count */
  scatterMin: 3,
  freeSpinAwards: [
    { scatters: 3, spins: 10 },
    { scatters: 4, spins: 12 },
    { scatters: 5, spins: 15 },
    { scatters: 6, spins: 20 },
    { scatters: 7, spins: 30 },
  ],
  /** highest value a multiplier spot can reach */
  maxSpot: 512,
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
  } as Record<string, number[] | null>,
  /** paytable order (highest first) */
  paySymbols: ['H1', 'H2', 'H3', 'H4', 'L1', 'L2', 'L3', 'L4', 'L5'],
};

export const buyMode = (mode: string): BetModeInfo | undefined =>
  GAME_INFO.modes.find((m) => m.mode.toUpperCase() === mode.toUpperCase());
