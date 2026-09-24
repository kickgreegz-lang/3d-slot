import type { GameContext, GameModule } from '../game/context';

/** STUB — replaced by the Mascots module implementation. */
export class Mascots implements GameModule {
  constructor(private ctx: GameContext) {
    void this.ctx;
  }

  init(): void {}
}
