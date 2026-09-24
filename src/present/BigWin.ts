import type { GameContext, GameModule } from '../game/context';

/** STUB — replaced by the BigWin module implementation. */
export class BigWin implements GameModule {
  constructor(private ctx: GameContext) {
    void this.ctx;
  }

  init(): void {}
}
