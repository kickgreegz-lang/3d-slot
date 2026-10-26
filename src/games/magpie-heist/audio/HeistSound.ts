import type { GameContext, GameModule } from '../../../game/context';

/**
 * HEIST SOUND — maps the heist scene events onto the engine's SFX ids (procedural placeholder voices;
 * production files swap in through src/audio/manifest.ts): glint gilds, star charge and comet ticks,
 * loot flips, diamond boosts, nest gulps, payout counts, heist stings. The glint / loot modules already
 * fire their per-step SFX; this module adds the stings around them and the scatter (Safe) landings.
 */
export class HeistSound implements GameModule {
  private offs: Array<() => void> = [];

  constructor(private readonly ctx: GameContext) {}

  init(): void {
    const g = this.ctx.game;
    this.offs.push(
      g.on('star:activate', () => g.broadcast('sfx', { id: 'bigwin_tier', volume: 0.7, rate: 1.3 })),
      g.on('loot:payout', ({ amount }) => g.broadcast('sfx', { id: amount >= 2000 ? 'bigwin_start' : 'win_cluster', volume: 0.8 })),
      g.on('heist:upgrade', () => g.broadcast('sfx', { id: 'bigwin_tier', rate: 0.9 })),
    );
  }

  destroy(): void {
    for (const off of this.offs) off();
  }
}
