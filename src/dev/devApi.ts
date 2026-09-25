import type { GameType } from '../book/types';
import type { clock as Clock } from '../core/clock';
import { getSpeedProfile, setSpeedProfile, type SpeedProfile, type Timing } from '../core/timing';
import { reducedMotion, setReducedMotion } from '../fx/motion';
import type { GameContext } from '../game/context';
import type { GameEvents } from '../game/events';
import { type FixtureBooks, loadFixtures, type SceneEmit } from './fixtures';
import { SymbolInspector } from './inspector';
import { MotionProbe, type MotionTrace, type ProbeTarget } from './motion';
import {
  getScenario,
  SCENARIOS,
  type ScenarioEnv,
  type ScenarioGroup,
  type ScenarioOptions,
  scenarioEnv,
} from './scenarios';
import {
  allTimingLeaves,
  changedLeaves,
  resetTiming,
  setTimingValue,
  snapshotSections,
  snapshotTiming,
  type TimingValue,
} from './timingEdit';

/**
 * DEV-ONLY extension of `window.__slot` (installed by hooks.ts behind
 * `import.meta.env.DEV`, so none of this reaches production bundles).
 *
 *   await __slot.scenario('tumbleChain')      run a named scenario (see scenarios.ts)
 *   __slot.scenarios()                        [{name,label,group}]
 *   __slot.setTiming('land.squashX', 1.2)     live-edit one core TIMING leaf
 *   __slot.setTiming('board.blurSpeed', 2)    ...or a leaf of a registered section (registerTiming)
 *   __slot.getTiming()                        JSON snapshot of core TIMING
 *   __slot.getTimingSections()                JSON snapshot of every section {core, board, symbol, ...}
 *   __slot.timingPaths()                      every settable (qualified) path
 *   __slot.timingChanges() / resetTiming()    edits vs compiled defaults / revert all
 *   __slot.slowmo(0.25)                       global time scale (ticker.speed)
 *   __slot.speed('turbo')                     speed profile (normal|turbo|superTurbo)
 *   await __slot.fixtures()                   {base, bonus} fixture books
 *   __slot.advance(500)                       manual-step 500 ms in 60 fps frames
 *   await __slot.motion.start({scenario:'spin'}) / __slot.motion.stop()
 *                                             per-frame y/scaleX/scaleY of one symbol
 *   __slot.events(true)                       scene-event log (t in real ms), optionally cleared
 *   __slot.now()                              real ms since boot (hit-stop inclusive)
 *   __slot.gameTime()                         game-clock ms (frozen during hit-stops)
 *   __slot.hitStop(60)                        clock.hitStop (CR-11: normal profile only, <= 120 ms)
 *   __slot.reducedMotion(true|false|null)     reduced-motion override (null = OS preference)
 */

export interface LoggedEvent {
  /** real ms since boot */
  t: number;
  type: string;
  detail?: string;
}

export interface ScenarioResult {
  name: string;
  label: string;
  startMs: number;
  durationMs: number;
  events: LoggedEvent[];
}

export type MotionSpec = ProbeTarget | { scenario: string; opts?: ScenarioOptions } | 'inspector' | null;

export interface DevApi {
  /** false while the lab/gallery is still booting (only in ?dev=lab|gallery) */
  labReady: boolean;
  scenario(name: string, opts?: ScenarioOptions): Promise<ScenarioResult>;
  scenarios(): Array<{ name: string; label: string; group: ScenarioGroup }>;
  /** name of the scenario currently running, or null */
  running(): string | null;
  setTiming(path: string, value: TimingValue): void;
  getTiming(): Timing;
  getTimingSections(): Record<string, unknown>;
  timingPaths(): string[];
  timingChanges(): Array<{ path: string; from: TimingValue; to: TimingValue }>;
  resetTiming(): void;
  slowmo(x: number): number;
  speed(p?: SpeedProfile): SpeedProfile;
  fixtures(): Promise<FixtureBooks>;
  advance(ms: number): void;
  motion: { start(spec?: MotionSpec): Promise<string>; stop(): MotionTrace };
  events(clear?: boolean): LoggedEvent[];
  now(): number;
  gameTime(): number;
  hitStop(ms: number): void;
  reducedMotion(on?: boolean | null): boolean;
  inspector(): SymbolInspector;
  /** scene emitter that logs like the lab's own emits */
  emitLogged: SceneEmit;
}

const LOG_CAP = 4000;
const FRAME_MS = 1000 / 60;
const SLOWMO_RANGE = { min: 0.05, max: 4 } as const;

/** One-line summary of an event payload for the timeline (ids, cues, kinds, tiers). */
const describe = (type: string, payload: unknown): string | undefined => {
  if (!payload || typeof payload !== 'object') return undefined;
  const p = payload as Record<string, unknown>;
  const pick = ['id', 'cue', 'kind', 'tier', 'trauma', 'amount', 'gameType', 'profile'];
  const parts = pick.filter((k) => k in p && typeof p[k] !== 'object').map((k) => `${k}=${String(p[k])}`);
  if (type === 'board:showWins' && Array.isArray(p.wins)) parts.push(`clusters=${p.wins.length}`);
  if (type === 'board:tumble' && Array.isArray(p.exploding)) parts.push(`exploding=${p.exploding.length}`);
  return parts.length ? parts.join(' ') : undefined;
};

export const createDevApi = (ctx: GameContext, clock: typeof Clock): DevApi => {
  let nowMs = 0;
  let log: LoggedEvent[] = [];
  let mode: GameType = 'basegame';
  let running: string | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  let inspector: SymbolInspector | null = null;
  let env: Promise<ScenarioEnv> | null = null;
  const probe = new MotionProbe(ctx);

  clock.onUpdate(() => {
    nowMs += clock.realDt * 1000;
    probe.tick(clock.realDt);
  });

  // Log every scene event (from any module) with a timestamp — the review timeline.
  const game = ctx.game;
  /** log timestamps are rounded to 0.1 ms; comparisons use the same rounding */
  const stamp = (): number => Math.round(nowMs * 10) / 10;
  const record = (type: string, payload: unknown): void => {
    if (type === 'mode:change') mode = (payload as GameEvents['mode:change']).gameType;
    log.push({ t: stamp(), type, detail: describe(type, payload) });
    if (log.length > LOG_CAP) log = log.slice(-LOG_CAP / 2);
  };
  const rawBroadcast = game.broadcast.bind(game);
  const rawBroadcastAsync = game.broadcastAsync.bind(game);
  game.broadcast = (type, payload) => {
    record(String(type), payload);
    rawBroadcast(type, payload);
  };
  game.broadcastAsync = (type, payload) => {
    record(String(type), payload);
    return rawBroadcastAsync(type, payload);
  };

  const emit: SceneEmit = (type, payload) => game.broadcastAsync(type, payload);
  const getInspector = (): SymbolInspector => (inspector ??= new SymbolInspector(ctx));
  const getEnv = (): Promise<ScenarioEnv> => {
    env ??= scenarioEnv(ctx, emit, getInspector, () => mode).catch((err: unknown) => {
      env = null;
      throw err;
    });
    return env;
  };

  const api: DevApi = {
    labReady: true,
    scenario(name, opts = {}) {
      const def = getScenario(name);
      const run = async (): Promise<ScenarioResult> => {
        const e = await getEnv();
        running = def.name;
        const startMs = stamp();
        try {
          await def.run(e, opts);
        } finally {
          running = null;
        }
        return {
          name: def.name,
          label: def.label,
          startMs,
          durationMs: Math.round(stamp() - startMs),
          events: log.filter((l) => l.t >= startMs),
        };
      };
      const p = chain.then(run, run);
      chain = p.catch(() => undefined);
      return p;
    },
    scenarios: () => SCENARIOS.map(({ name, label, group }) => ({ name, label, group })),
    running: () => running,
    setTiming: (path, value) => setTimingValue(path, value),
    getTiming: () => snapshotTiming(),
    getTimingSections: () => snapshotSections(),
    timingPaths: () => allTimingLeaves().map((l) => l.qualified),
    timingChanges: () => changedLeaves(),
    resetTiming: () => resetTiming(),
    slowmo(x) {
      const v = Math.min(SLOWMO_RANGE.max, Math.max(SLOWMO_RANGE.min, x));
      ctx.app.ticker.speed = v;
      return v;
    },
    speed(p) {
      if (p) setSpeedProfile(p);
      return getSpeedProfile();
    },
    fixtures: () => loadFixtures(),
    advance(ms) {
      for (let left = ms; left > 0; left -= FRAME_MS) clock.step(Math.min(FRAME_MS, left));
    },
    motion: {
      async start(spec = null) {
        let target: ProbeTarget | null = null;
        if (spec === 'inspector') target = getInspector().probeTarget();
        else if (spec && 'scenario' in spec) {
          const e = await getEnv();
          target = getScenario(spec.scenario).probe(e, spec.opts ?? {});
        } else target = spec;
        probe.start(target);
        return target ? ('view' in target ? target.label : `reel ${target.reel} row ${target.row}`) : 'none';
      },
      stop: () => probe.stop(),
    },
    events(clear = false) {
      const out = log;
      if (clear) log = [];
      return out;
    },
    now: stamp,
    gameTime: () => Math.round(clock.time * 10000) / 10,
    hitStop: (ms) => clock.hitStop(ms),
    reducedMotion(on) {
      if (on !== undefined) setReducedMotion(on);
      return reducedMotion();
    },
    inspector: getInspector,
    emitLogged: emit,
  };
  return api;
};
