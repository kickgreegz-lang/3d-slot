import type { GameContext, GameModule } from '../game/context';

/** STUB — replaced by the Frame module implementation. */
export class Frame implements GameModule {
  constructor(private ctx: GameContext) {
    void this.ctx;
  }

  init(): void {}
}
