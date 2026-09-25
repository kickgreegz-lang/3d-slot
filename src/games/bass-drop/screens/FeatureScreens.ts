import type { GameContext, GameModule } from '../../../game/context';

/**
 * FEATURE SCREENS — feature trigger dim + wipe, JUKE JAM / MEGA MIX intros, upgrade, outro, feature plate (free-spin counter) (DESIGN.md §10, §14).
 * (phase B stub: the owning track replaces this file.)
 */
export class FeatureScreens implements GameModule {
  constructor(private readonly ctx: GameContext) {}

  init(): void {
    void this.ctx;
  }
}
