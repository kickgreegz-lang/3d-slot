import type { GameContext, GameModule } from '../../game/context';

/** STUB — replaced by the DomUi module implementation. */
export class DomUi implements GameModule {
  constructor(private ctx: GameContext) {
    void this.ctx;
  }

  init(): void {}
}
