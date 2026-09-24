import type { GameContext, GameModule } from '../game/context';

/** STUB — replaced by the Background module implementation. */
export class Background implements GameModule {
  constructor(private ctx: GameContext) {
    void this.ctx;
  }

  init(): void {}
}
