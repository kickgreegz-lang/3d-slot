import type { GameContext, GameModule } from '../../../game/context';

/**
 * BASS DROP — wild:drop choreography (reticles, shockwave, flying wild proxies, impact handoff), multiplier badges, Mega Mix homes / sticky returns / mult_up, label multiplier sums (DESIGN.md §7.6, §8, §9).
 * (phase B stub: the owning track replaces this file.)
 */
export class BassDrop implements GameModule {
  constructor(private readonly ctx: GameContext) {}

  init(): void {
    void this.ctx;
  }
}
