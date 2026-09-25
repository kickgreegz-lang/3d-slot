import type { GameContext, GameModule } from '../../../game/context';

/**
 * STAGE — lower speaker cabinet, frame horns, DJ booth placeholders; room reactions to booms (DESIGN.md §15, §8.1 horns/lower cabinet).
 * (phase B stub: the owning track replaces this file.)
 */
export class Stage implements GameModule {
  constructor(private readonly ctx: GameContext) {}

  init(): void {
    void this.ctx;
  }
}
