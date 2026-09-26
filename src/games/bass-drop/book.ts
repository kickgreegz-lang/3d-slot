import type { GameBookHandlers, GameEventEnv } from '../../book/gameEvents';
import type { RoundPlayback } from '../../book/handlers';
import type { BookEvent, Position } from '../../book/types';
import type { DroppedWild, GrooveFeature, MeterMode, StickyWild } from './events';

/**
 * SWAMP FUNK: BASS DROP book events (on top of the engine's core events), played by the
 * engine through book/gameEvents.ts. Amounts are bet multiples x100, positions use padded
 * rows (visible 1..6 of 0..7). Contract: docs/games/bass-drop/DESIGN.md §3.
 *
 * Order per tumble step:
 *   winInfo -> meterUpdate -> updateTumbleWin -> tumbleBoard -> wildDrop x crossed thresholds -> winInfo ...
 * Mega Mix: stickyWilds after each free-spin reveal. Base round end: featureTrigger.
 * 60 reached during Juke Jam: featureUpgrade.
 *
 * Scene mapping (the feature modules subscribe to the game events, see ./events.ts):
 *   meterUpdate    -> meter:update
 *   wildDrop       -> wild:drop, then board:transform 'drop' as reconcile (each wild REPLACES its cell)
 *   stickyWilds    -> wild:sticky, then board:transform 'morph' as reconcile
 *   featureTrigger -> feature:trigger (screens/FeatureScreens: trigger, wipe, feature intro), mode:change freegame
 *   featureUpgrade -> feature:upgrade (upgrade screen), fs:update (+addFs on the plate / meter chip)
 * The reconcile transforms are the minimal-boot presentation: once the Bass Drop modules own
 * the drop, the reconcile is a no-op (cells already hold the wild).
 */
export interface MeterUpdateEvent {
  index: number;
  type: 'meterUpdate';
  /** connected (exploded) symbols this round so far */
  value: number;
  /** exploding symbols of this tumble step (0 = silent set, CR-2) */
  delta: number;
  /** multiples of 10 newly crossed by this step */
  thresholds: number[];
}

export interface WildDropEvent {
  index: number;
  type: 'wildDrop';
  threshold: number;
  wilds: DroppedWild[];
}

export interface StickyWildsEvent {
  index: number;
  type: 'stickyWilds';
  wilds: StickyWild[];
}

export interface FeatureTriggerEvent {
  index: number;
  type: 'featureTrigger';
  feature: GrooveFeature;
  meter: number;
  totalFs: number;
}

export interface FeatureUpgradeEvent {
  index: number;
  type: 'featureUpgrade';
  from: 'bonus';
  to: 'super';
  addFs: number;
}

export type GameBookEvent = MeterUpdateEvent | WildDropEvent | StickyWildsEvent | FeatureTriggerEvent | FeatureUpgradeEvent;

/** Per-round extras (resume restores the meter and the sticky set from these). */
export interface GameRoundState {
  meter: number;
  meterMode: MeterMode;
  stickies: StickyWild[];
  feature: GrooveFeature | null;
  /** wild drops since the last meterUpdate (wild:drop chainIndex) */
  chain: number;
}

export const createGameRoundState = (): GameRoundState => ({ meter: 0, meterMode: 'base', stickies: [], feature: null, chain: 0 });

const WILD = 'W';

/** Mirror wild placements into the playback board (the next tumble applies to it). */
const placeWilds = (state: RoundPlayback, cells: readonly Position[]): void => {
  for (const c of cells) {
    const reel = state.board?.[c.reel];
    if (reel && c.row >= 0 && c.row < reel.length) reel[c.row] = WILD;
  }
};

const mergeStickies = (state: RoundPlayback, wilds: readonly DroppedWild[]): void => {
  for (const w of wilds) {
    if (!w.sticky) continue;
    const at = state.game.stickies.findIndex((s) => s.reel === w.reel && s.row === w.row);
    const next = { reel: w.reel, row: w.row, multiplier: w.multiplier };
    if (at >= 0) state.game.stickies[at] = next;
    else state.game.stickies.push(next);
  }
};

const wildCells = (wilds: readonly Position[]) => wilds.map((w) => ({ reel: w.reel, row: w.row, id: WILD }));

/**
 * The math restarts the meter at 0 at featureTrigger and at featureUpgrade (DESIGN.md [M-1] /
 * [M-2], mock/games/bass-drop/README.md "Groove meter") and no event says so: the live handler
 * and the resume fold both apply it, so a resume before the feature's first meterUpdate shows 0.
 */
const enterFeature = (g: GameRoundState, feature: GrooveFeature): void => {
  g.feature = feature;
  g.meterMode = feature;
  g.meter = 0;
  g.chain = 0;
};

export const gameBookHandlers: GameBookHandlers<GameBookEvent> = {
  meterUpdate: async (e, env) => {
    env.state.game.meter = e.value;
    env.state.game.chain = 0;
    await env.emit('meter:update', { value: e.value, delta: e.delta, thresholds: [...e.thresholds] });
  },

  wildDrop: async (e, env) => {
    const chainIndex = env.state.game.chain++;
    await env.emit('wild:drop', { threshold: e.threshold, wilds: e.wilds.map((w) => ({ ...w })), chainIndex });
    await env.emit('board:transform', { cells: wildCells(e.wilds), style: 'drop' });
    placeWilds(env.state, e.wilds);
    mergeStickies(env.state, e.wilds);
  },

  stickyWilds: async (e, env) => {
    env.state.game.stickies = e.wilds.map((w) => ({ ...w }));
    await env.emit('wild:sticky', { wilds: e.wilds.map((w) => ({ ...w })) });
    await env.emit('board:transform', { cells: wildCells(e.wilds), style: 'morph' });
    placeWilds(env.state, e.wilds);
  },

  featureTrigger: async (e, env) => {
    const { state } = env;
    enterFeature(state.game, e.feature);
    state.freeSpins = { current: 0, total: e.totalFs };
    env.hudChanged();
    // FeatureScreens holds this until the feature intro is dismissed (the curtain still covers the
    // screen), so the free-game switch below happens behind it
    await env.emit('feature:trigger', { feature: e.feature, meter: e.meter, totalFs: e.totalFs, bought: state.betMode !== 'BASE' });
    await env.setGameType('freegame');
  },

  featureUpgrade: async (e, env) => {
    const { state } = env;
    const current = state.freeSpins?.current ?? 0;
    const total = (state.freeSpins?.total ?? 0) + e.addFs;
    enterFeature(state.game, e.to);
    state.freeSpins = { current, total };
    env.hudChanged();
    await env.emit('feature:upgrade', { from: e.from, to: e.to, addFs: e.addFs });
    await env.emit('fs:update', { current, total });
  },
};

/** Resume / replay: fold every already-played event into the state (no presentation). */
export const foldGameEvent = (state: RoundPlayback, e: BookEvent): void => {
  const g = state.game;
  switch (e.type) {
    case 'meterUpdate':
      g.meter = e.value;
      g.chain = 0;
      break;
    case 'wildDrop':
      g.chain++;
      placeWilds(state, e.wilds);
      mergeStickies(state, e.wilds);
      break;
    case 'stickyWilds':
      g.stickies = e.wilds.map((w) => ({ ...w }));
      placeWilds(state, e.wilds);
      break;
    case 'featureTrigger':
      enterFeature(g, e.feature);
      state.freeSpins = { current: state.freeSpins?.current ?? 0, total: e.totalFs };
      state.gameType = 'freegame';
      break;
    case 'featureUpgrade':
      enterFeature(g, e.to);
      state.freeSpins = { current: state.freeSpins?.current ?? 0, total: (state.freeSpins?.total ?? 0) + e.addFs };
      break;
    case 'freeSpinEnd':
      state.game = createGameRoundState();
      break;
    default:
      break;
  }
};

/** Resume / replay start (after board:set): meter and sticky set, instantly. */
export const restoreGameScene = async (env: Pick<GameEventEnv, 'emit' | 'state'>): Promise<void> => {
  const g = env.state.game;
  await env.emit('meter:set', { value: g.meter, mode: g.meterMode, animate: false });
  if (!g.stickies.length) return;
  await env.emit('board:transform', { cells: wildCells(g.stickies), style: 'set' });
  await env.emit('wild:sticky', { wilds: g.stickies.map((w) => ({ ...w })) });
};
