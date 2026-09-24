import { API_MONEY_SCALE } from '../config/game';
import type { RgsConfig } from '../rgs/types';

/**
 * The bet is always an INDEX into the RGS `betLevels` (API units), so every level
 * the RGS returns is reachable with +/- (approval: "all bet levels usable") and the
 * amount sent to /wallet/play is always a valid level. Never clamp to balance.
 */

/** Fallback ladder (display units) when an RGS sends no betLevels. */
const FALLBACK_LADDER = [0.1, 0.2, 0.4, 0.6, 0.8, 1, 2, 4, 6, 8, 10, 20, 40, 60, 80, 100, 200, 400, 600, 800, 1000];

export class BetLadder {
  private index = 0;

  private constructor(readonly levels: readonly number[]) {}

  static fromConfig(config: Partial<RgsConfig> | undefined): BetLadder {
    const min = config?.minBet ?? 0;
    const max = config?.maxBet ?? Number.POSITIVE_INFINITY;
    let levels = (config?.betLevels ?? []).filter((v) => Number.isInteger(v) && v > 0);
    if (levels.length === 0) {
      const step = config?.stepBet && config.stepBet > 0 ? config.stepBet : 1;
      levels = FALLBACK_LADDER.map((v) => Math.round(v * API_MONEY_SCALE)).filter(
        (v) => v >= min && v <= max && v % step === 0,
      );
    }
    if (levels.length === 0) levels = [config?.defaultBetLevel ?? (min || API_MONEY_SCALE)];
    const ladder = new BetLadder([...new Set(levels)].sort((a, b) => a - b));
    ladder.select(config?.defaultBetLevel ?? API_MONEY_SCALE);
    return ladder;
  }

  /** Single fixed level (replay mode). */
  static fixed(amount: number): BetLadder {
    return new BetLadder([amount]);
  }

  get value(): number {
    return this.levels[this.index];
  }
  get position(): number {
    return this.index;
  }
  get count(): number {
    return this.levels.length;
  }
  get canUp(): boolean {
    return this.index < this.levels.length - 1;
  }
  get canDown(): boolean {
    return this.index > 0;
  }

  step(delta: number): boolean {
    return this.setIndex(this.index + delta);
  }

  setIndex(i: number): boolean {
    const next = Math.max(0, Math.min(this.levels.length - 1, Math.round(i)));
    if (next === this.index) return false;
    this.index = next;
    return true;
  }

  /** Select the level equal to `amount`, else the closest one (restoring a previous bet). */
  select(amount: number): void {
    let best = 0;
    for (let i = 1; i < this.levels.length; i++) {
      if (Math.abs(this.levels[i] - amount) < Math.abs(this.levels[best] - amount)) best = i;
    }
    this.index = best;
  }
}
