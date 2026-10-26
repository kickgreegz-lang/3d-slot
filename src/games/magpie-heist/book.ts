import type { GameBookHandlers, GameEventEnv } from '../../book/gameEvents';
import type { RoundPlayback } from '../../book/handlers';
import type { BookEvent, Position } from '../../book/types';
import type { HeistFeature } from './config';
import type { LootItem, LootSource, LootTarget } from './events';

/**
 * MAGPIE HEIST book events (on top of the engine's core events), played by the engine through
 * book/gameEvents.ts. Contract: mock/games/magpie-heist/README.md. Amounts are bet multiples x100,
 * positions use padded rows (visible 1..5 of 0..6).
 *
 * Order per spin:
 *   reveal · glintState? · [winInfo · glintSquares · updateTumbleWin · tumbleBoard]*
 *   · [starActivate · (glintReveal · diamondBoost* · nestCollect*)+ · glintPayout · updateTumbleWin]?
 *   · glintReset? · setWin? · setTotalWin
 * Base round end: featureTrigger. Free spins: featureRetrigger / featureUpgrade after a spin.
 *
 * Scene mapping (the feature modules subscribe to the game events, see ./events.ts):
 *   glintSquares -> glint:add      glintState -> glint:state     glintReset -> glint:reset
 *   starActivate -> star:activate  glintReveal -> loot:reveal    diamondBoost -> loot:boost
 *   nestCollect -> loot:collect    glintPayout -> loot:payout
 *   featureTrigger -> heist:trigger, then mode:change freegame (behind the intro screen)
 *   featureRetrigger -> heist:retrigger + fs:update; featureUpgrade -> heist:upgrade + fs:update
 */
export interface GlintSquaresEvent {
  index: number;
  type: 'glintSquares';
  added: Position[];
  squares: Position[];
}
export interface GlintStateEvent {
  index: number;
  type: 'glintState';
  squares: Position[];
}
export interface GlintResetEvent {
  index: number;
  type: 'glintReset';
  squares: Position[];
  keep: boolean;
}
export interface StarActivateEvent {
  index: number;
  type: 'starActivate';
  stars: Position[];
  squares: Position[];
}
export interface GlintRevealEvent {
  index: number;
  type: 'glintReveal';
  round: number;
  items: LootItem[];
}
export interface DiamondBoostEvent extends Position {
  index: number;
  type: 'diamondBoost';
  mult: number;
  targets: LootTarget[];
}
export interface NestCollectEvent extends Position {
  index: number;
  type: 'nestCollect';
  from: number;
  to: number;
  sources: LootSource[];
}
export interface GlintPayoutEvent {
  index: number;
  type: 'glintPayout';
  amount: number;
  items: LootSource[];
}
export interface FeatureTriggerEvent {
  index: number;
  type: 'featureTrigger';
  feature: HeistFeature;
  scatters: number;
  totalFs: number;
  positions: Position[];
}
export interface FeatureRetriggerEvent {
  index: number;
  type: 'featureRetrigger';
  feature: HeistFeature;
  addFs: number;
  total: number;
  positions: Position[];
}
export interface FeatureUpgradeEvent {
  index: number;
  type: 'featureUpgrade';
  from: HeistFeature;
  to: HeistFeature;
  addFs: number;
  total: number;
  positions: Position[];
}

export type GameBookEvent =
  | GlintSquaresEvent
  | GlintStateEvent
  | GlintResetEvent
  | StarActivateEvent
  | GlintRevealEvent
  | DiamondBoostEvent
  | NestCollectEvent
  | GlintPayoutEvent
  | FeatureTriggerEvent
  | FeatureRetriggerEvent
  | FeatureUpgradeEvent;

/** Per-round extras (resume restores the squares and the feature look from these). */
export interface GameRoundState {
  squares: Position[];
  feature: HeistFeature | null;
}

export const createGameRoundState = (): GameRoundState => ({ squares: [], feature: null });

const copy = (ps: readonly Position[]): Position[] => ps.map((p) => ({ reel: p.reel, row: p.row }));

export const gameBookHandlers: GameBookHandlers<GameBookEvent> = {
  glintSquares: async (e, env) => {
    env.state.game.squares = copy(e.squares);
    await env.emit('glint:add', { added: copy(e.added), squares: copy(e.squares) });
  },
  glintState: async (e, env) => {
    env.state.game.squares = copy(e.squares);
    await env.emit('glint:state', { squares: copy(e.squares) });
  },
  glintReset: async (e, env) => {
    env.state.game.squares = copy(e.squares);
    await env.emit('glint:reset', { squares: copy(e.squares), keep: e.keep });
  },
  starActivate: async (e, env) => {
    await env.emit('star:activate', { stars: copy(e.stars), squares: copy(e.squares) });
  },
  glintReveal: async (e, env) => {
    await env.emit('loot:reveal', { round: e.round, items: e.items.map((it) => ({ ...it })) });
  },
  diamondBoost: async (e, env) => {
    await env.emit('loot:boost', { reel: e.reel, row: e.row, mult: e.mult, targets: e.targets.map((t) => ({ ...t })) });
  },
  nestCollect: async (e, env) => {
    await env.emit('loot:collect', { reel: e.reel, row: e.row, from: e.from, to: e.to, sources: e.sources.map((s) => ({ ...s })) });
  },
  glintPayout: async (e, env) => {
    await env.emit('loot:payout', { amount: e.amount, items: e.items.map((s) => ({ ...s })) });
  },
  featureTrigger: async (e, env) => {
    const { state } = env;
    state.game.feature = e.feature;
    state.game.squares = [];
    state.freeSpins = { current: 0, total: e.totalFs };
    env.hudChanged();
    // the heist intro holds this until it is dismissed; the free-game switch happens behind its curtain
    await env.emit('heist:trigger', {
      feature: e.feature,
      scatters: e.scatters,
      totalFs: e.totalFs,
      positions: copy(e.positions),
      bought: state.betMode !== 'BASE' && state.betMode !== 'HUNT' && state.betMode !== 'STARS',
    });
    await env.setGameType('freegame');
    await env.emit('heist:mode', { feature: e.feature });
  },
  featureRetrigger: async (e, env) => {
    const { state } = env;
    const current = state.freeSpins?.current ?? 0;
    state.freeSpins = { current, total: e.total };
    env.hudChanged();
    await env.emit('heist:retrigger', { feature: e.feature, addFs: e.addFs, total: e.total, positions: copy(e.positions) });
    await env.emit('fs:update', { current, total: e.total });
  },
  featureUpgrade: async (e, env) => {
    const { state } = env;
    const current = state.freeSpins?.current ?? 0;
    state.game.feature = e.to;
    state.freeSpins = { current, total: e.total };
    env.hudChanged();
    await env.emit('heist:upgrade', { from: e.from, to: e.to, addFs: e.addFs, total: e.total, positions: copy(e.positions) });
    await env.emit('heist:mode', { feature: e.to });
    await env.emit('fs:update', { current, total: e.total });
  },
};

/** Resume / replay: fold every already-played event into the state (no presentation). */
export const foldGameEvent = (state: RoundPlayback, e: BookEvent): void => {
  const g = state.game;
  switch (e.type) {
    case 'glintSquares':
    case 'glintState':
    case 'glintReset':
      g.squares = copy(e.squares);
      break;
    case 'featureTrigger':
      g.feature = e.feature;
      g.squares = [];
      state.freeSpins = { current: state.freeSpins?.current ?? 0, total: e.totalFs };
      state.gameType = 'freegame';
      break;
    case 'featureRetrigger':
      state.freeSpins = { current: state.freeSpins?.current ?? 0, total: e.total };
      break;
    case 'featureUpgrade':
      g.feature = e.to;
      state.freeSpins = { current: state.freeSpins?.current ?? 0, total: e.total };
      break;
    case 'freeSpinEnd':
      state.game = createGameRoundState();
      break;
    default:
      break;
  }
};

/** Resume / replay start (after board:set): feature look and the persisting squares, instantly. */
export const restoreGameScene = async (env: Pick<GameEventEnv, 'emit' | 'state'>): Promise<void> => {
  const g = env.state.game;
  await env.emit('heist:mode', { feature: g.feature });
  await env.emit('glint:state', { squares: copy(g.squares) });
};
