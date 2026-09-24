import type { GameContext, GameModule } from '../game/context';

/** STUB — replaced by the WinPresenter module implementation. */
export class WinPresenter implements GameModule {
  constructor(private ctx: GameContext) {
    void this.ctx;
  }

  init(): void {}
}
