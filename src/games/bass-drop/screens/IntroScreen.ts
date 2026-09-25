import type { GameContext, GameModule } from '../../../game/context';

/**
 * GAME INTRO — the three feature cards + PRESS TO CONTINUE, once after load (DESIGN.md §12).
 * (phase B stub: the owning track replaces this file.)
 */
export class IntroScreen implements GameModule {
  constructor(private readonly ctx: GameContext) {}

  init(): void {
    void this.ctx;
  }
}
