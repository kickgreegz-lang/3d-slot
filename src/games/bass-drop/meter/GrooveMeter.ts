import type { GameContext, GameModule } from '../../../game/context';

/**
 * GROOVE METER — upper speaker cabinet, LED ring, counter, notches, next-drop chip, energy orbs, threshold bursts, drain, charge/boom/pump reactions (DESIGN.md §6, §8.1 meter column, §10.1 pumps).
 * (phase B stub: the owning track replaces this file.)
 */
export class GrooveMeter implements GameModule {
  constructor(private readonly ctx: GameContext) {}

  init(): void {
    void this.ctx;
  }
}
