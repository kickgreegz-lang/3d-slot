import type { GameContext, GameModule } from '../game/context';

/** STUB — replaced by the FreeSpins module implementation. */
export class FreeSpins implements GameModule {
  constructor(private ctx: GameContext) {
    void this.ctx;
  }

  init(): void {}
}
