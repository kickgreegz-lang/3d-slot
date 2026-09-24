import type { RgsBetModeInfo } from '../rgs/types';

/**
 * Bet modes of the math package. Mode keys must match the math-sdk bet modes
 * (they are sent verbatim to /wallet/play). The live RGS currently returns
 * `config.betModes: {}`, so the local table is the source of truth and any
 * `costMultiplier` the RGS does send overrides it.
 *
 * TODO(math): RTP values are placeholders until the 7x5 math is final.
 */
export interface BetModeDef {
  key: string;
  /** debit = base bet x cost */
  cost: number;
  /** bought feature (bonus buy button + confirm step when cost > 2) */
  buy: boolean;
  /** theoretical RTP (0..1), shown when jurisdiction.displayRTP */
  rtp: number;
  /** max win as a bet multiple (rules / replay info) */
  maxWinX: number;
}

export const BASE_MODE = 'BASE';

export const BET_MODES: Record<string, BetModeDef> = {
  BASE: { key: 'BASE', cost: 1, buy: false, rtp: 0.962, maxWinX: 5000 },
  BONUS: { key: 'BONUS', cost: 100, buy: true, rtp: 0.962, maxWinX: 5000 },
};

/** Merge the RGS-provided betModes (if any) over the local table. */
export const resolveBetModes = (rgs: Record<string, RgsBetModeInfo> | undefined): Record<string, BetModeDef> => {
  const out: Record<string, BetModeDef> = {};
  for (const [k, def] of Object.entries(BET_MODES)) out[k] = { ...def };
  for (const [k, info] of Object.entries(rgs ?? {})) {
    const key = k.toUpperCase();
    const cost = typeof info?.costMultiplier === 'number' && info.costMultiplier > 0 ? info.costMultiplier : undefined;
    const base = out[key] ?? { key, cost: 1, buy: key !== BASE_MODE, rtp: BET_MODES.BASE.rtp, maxWinX: BET_MODES.BASE.maxWinX };
    out[key] = { ...base, cost: cost ?? base.cost };
  }
  return out;
};

export const modeCost = (modes: Record<string, BetModeDef>, mode: string): number => modes[mode]?.cost ?? 1;
