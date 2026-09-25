import type { GameContext, GameModule } from '../../../game/context';

/**
 * CONNECTIONS — groove links between connected symbols, link snap at the burst, connection count pops (DESIGN.md §7.3, §6.3 step 9).
 * (phase B stub: the owning track replaces this file.)
 */
export class Connections implements GameModule {
  constructor(private readonly ctx: GameContext) {}

  init(): void {
    void this.ctx;
  }
}
