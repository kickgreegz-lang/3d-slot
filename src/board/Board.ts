import type { GameContext, GameModule } from '../game/context';

/** STUB — replaced by the Board module implementation. */
export class Board implements GameModule {
  constructor(private ctx: GameContext) {
    void this.ctx;
  }

  init(): void {}
}
