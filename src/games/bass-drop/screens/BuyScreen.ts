import type { GameContext, GameModule } from '../../../game/context';

/**
 * BUY SCREEN — 2-card canvas bonus buy with confirm step (DESIGN.md §13).
 * (phase B stub: the owning track replaces this file.)
 */
export class BuyScreen implements GameModule {
  constructor(private readonly ctx: GameContext) {}

  init(): void {
    void this.ctx;
  }
}
