import type { GameContext, GameModule } from '../../game/context';

/** STUB — replaced by the Hud module implementation. */
export class Hud implements GameModule {
  constructor(private ctx: GameContext) {
    void this.ctx;
  }

  init(): void {}
}
