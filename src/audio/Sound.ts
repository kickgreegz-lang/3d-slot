import type { GameContext, GameModule } from '../game/context';

/** STUB — replaced by the Sound module implementation. */
export class Sound implements GameModule {
  constructor(private ctx: GameContext) {
    void this.ctx;
  }

  init(): void {}
}
