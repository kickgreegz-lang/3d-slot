import type { GameContext, GameModule } from '../game/context';

/** STUB — replaced by the Fx module implementation. */
export class Fx implements GameModule {
  constructor(private ctx: GameContext) {
    void this.ctx;
  }

  init(): void {}
}
