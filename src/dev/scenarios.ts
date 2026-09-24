import type { Book, GameType } from '../book/types';
import { SYMBOLS, WIN_TIERS, type WinTierKey } from '../config/game';
import { cellCenter } from '../config/layout';
import { clock } from '../core/clock';
import { getSpeedProfile, TIMING } from '../core/timing';
import type { GameContext } from '../game/context';
import type { GameEvents, MascotCue } from '../game/events';
import { emptySpots, findEvent, type FixtureBooks, loadFixtures, type SceneEmit, ScenePlayer } from './fixtures';
import type { SymbolInspector } from './inspector';
import type { ProbeTarget } from './motion';

/**
 * DEV-ONLY named scenarios shared by the animation lab buttons, `__slot.scenario()`
 * and tools/qa/animation-review.mjs. Each one drives visual modules exclusively
 * through scene events (the same payloads the flow module emits) or the
 * SymbolView contract (inspector), and resolves when every awaited animation
 * has finished.
 */

export type ScenarioGroup = 'board' | 'present' | 'fx' | 'symbol';

export interface ScenarioOptions {
  /** symbol id for inspector scenarios */
  id?: string;
  /** impact velocity(ies) for inspector lands, design px/s */
  velocity?: number;
  velocities?: number[];
  /** big-win tiers to play (default: all) */
  tiers?: WinTierKey[];
  /** mascot cues to play (default: all) */
  cues?: MascotCue[];
  /** particle burst kinds to fire (default: all) */
  kinds?: Array<GameEvents['fx:burst']['kind']>;
}

export interface ScenarioEnv {
  ctx: GameContext;
  books: FixtureBooks;
  emit: SceneEmit;
  inspector: () => SymbolInspector;
  /** presentation mode the scene is currently in (tracked from mode:change) */
  mode: () => GameType;
}

export interface ScenarioDef {
  name: string;
  label: string;
  group: ScenarioGroup;
  /** default motion-probe target for QA graphs (null = no symbol motion to plot) */
  probe: (env: ScenarioEnv, opts: ScenarioOptions) => ProbeTarget | null;
  run: (env: ScenarioEnv, opts: ScenarioOptions) => Promise<void>;
}

/** Lab pacing (not gameplay timing): holds between showcase steps, in game ms. */
const PACE = {
  settle: 350,
  mascotHold: 1600,
  burstGap: 520,
  shakeGap: 750,
  flashGap: 450,
  symbolGap: 420,
  /** extra grace after a big-win count-up before the lab auto-skips it */
  bigWinGrace: 3000,
} as const;

/** Showcase payload values for fx scenarios (event parameters, not timings). */
const FX_DEMO = {
  shakes: [0.25, 0.55, 1],
  flashes: [
    { color: 0xffffff, alpha: 0.35, durationMs: 150 },
    { color: 0xffd54a, alpha: 0.5, durationMs: 320 },
    { color: 0x35f2e0, alpha: 0.4, durationMs: 220 },
  ],
} as const;

/** Big-win showcase amounts (book units: bet multiple x100). */
const BIGWIN_DEMO_X: Record<WinTierKey, number> = { big: 20, super: 40, mega: 75, epic: 150, max: 5000 };

export const MASCOT_CUES: MascotCue[] = [
  'idle',
  'spinStart',
  'anticipation',
  'reactSmall',
  'reactTumble',
  'spotUpgrade',
  'winBig',
  'celebrate',
  'fsTrigger',
  'fsEnd',
];

export const BURST_KINDS: Array<GameEvents['fx:burst']['kind']> = [
  'explode',
  'dust',
  'sparkle',
  'coins',
  'confetti',
  'spotSpark',
  'scatter',
];

const BOARD_PROBE: ProbeTarget = { reel: 3, row: 5 };

const wait = (ms: number): Promise<void> => clock.wait(ms);

/** Puts the scene into a known state (mode, spots, optional board) before a scenario. */
const prepare = async (
  env: ScenarioEnv,
  player: ScenePlayer | null,
  gameType: GameType,
  board?: string[][],
): Promise<void> => {
  if (env.mode() !== gameType) await env.emit('mode:change', { gameType });
  await env.emit('spots:reset', { grid: gameType === 'freegame' ? emptySpots() : null });
  if (board) await env.emit('board:set', { board });
  player?.sync(gameType, null);
};

const book = (env: ScenarioEnv, set: 'base' | 'bonus', key: string): Book => {
  const b = env.books[set][key];
  if (!b) throw new Error(`Missing fixture ${set}/${key}`);
  return b;
};

const names = (b: Book, nth = 0): string[][] => findEvent(b, 'reveal', nth).board.map((r) => r.map((s) => s.name));

export const SCENARIOS: ScenarioDef[] = [
  {
    name: 'spin',
    label: 'Spin + drop',
    group: 'board',
    probe: () => BOARD_PROBE,
    run: async (env) => {
      const b = book(env, 'base', 'small_win_1_tumble');
      await prepare(env, null, 'basegame');
      const reveal = findEvent(b, 'reveal');
      await env.emit('round:start', { profile: getSpeedProfile() });
      await env.emit('board:reveal', {
        board: names(b),
        anticipation: reveal.anticipation.map(() => 0),
        gameType: 'basegame',
      });
      await wait(PACE.settle);
    },
  },
  {
    name: 'anticipation',
    label: 'Anticipation',
    group: 'board',
    probe: () => ({ reel: 6, row: 5 }),
    run: async (env) => {
      const b = book(env, 'base', 'fs_trigger');
      await prepare(env, null, 'basegame');
      const reveal = findEvent(b, 'reveal');
      await env.emit('round:start', { profile: getSpeedProfile() });
      await env.emit('board:reveal', { board: names(b), anticipation: reveal.anticipation, gameType: 'basegame' });
      await wait(PACE.settle);
    },
  },
  {
    name: 'clusterWin',
    label: 'Cluster win',
    group: 'board',
    probe: () => ({ reel: 2, row: 4 }),
    run: async (env) => {
      const b = book(env, 'base', 'tumble_chain');
      await prepare(env, null, 'basegame', names(b));
      await wait(PACE.settle);
      const info = findEvent(b, 'winInfo');
      await env.emit('board:showWins', { wins: info.wins, totalWin: info.totalWin });
      await env.emit('win:tumble', { amount: info.totalWin });
      await wait(PACE.settle);
    },
  },
  {
    name: 'tumbleChain',
    label: 'Tumble chain',
    group: 'board',
    probe: () => BOARD_PROBE,
    run: async (env) => {
      const b = book(env, 'base', 'tumble_chain');
      const player = new ScenePlayer(env.emit);
      await prepare(env, player, 'basegame');
      await player.playAll(b.events);
      await env.emit('round:end', { totalWin: b.payoutMultiplier });
      await wait(PACE.settle);
    },
  },
  {
    name: 'spots',
    label: 'Spots (bonus)',
    group: 'board',
    probe: () => ({ reel: 3, row: 4 }),
    run: async (env) => {
      const b = book(env, 'bonus', 'tumble_chain');
      const player = new ScenePlayer(env.emit);
      await prepare(env, player, 'freegame');
      // second..fourth free spin: spots get marked, then upgraded by a 6-cluster
      const from = b.events.findIndex((e) => e.index === 8);
      const to = b.events.findIndex((e) => e.index === 28);
      await player.playAll(b.events.slice(Math.max(0, from), to + 1));
      await wait(PACE.settle);
      await prepare(env, null, 'basegame');
    },
  },
  {
    name: 'bigWin',
    label: 'Big win (all tiers)',
    group: 'present',
    probe: () => null,
    run: async (env, opts) => {
      const tiers = opts.tiers ?? WIN_TIERS.map((t) => t.key);
      for (const tier of tiers) {
        const shown = env.emit('bigwin:show', { amount: BIGWIN_DEMO_X[tier] * 100, tier });
        const limit = (TIMING.bigWin.tierDurations[tier] ?? 5000) + TIMING.bigWin.autoCloseDelay + PACE.bigWinGrace;
        const timedOut = await Promise.race([shown.then(() => false), clock.waitUi(limit).then(() => true)]);
        if (timedOut) env.ctx.ui.broadcast('ui:skip', undefined);
        await wait(PACE.settle);
      }
    },
  },
  {
    name: 'fsTrigger',
    label: 'Free spins trigger',
    group: 'present',
    probe: () => null,
    run: async (env) => {
      const b = book(env, 'base', 'fs_trigger');
      const player = new ScenePlayer(env.emit);
      await prepare(env, player, 'basegame');
      // reveal (with anticipation) .. first free-spin reveal
      const firstFree = b.events.findIndex((e) => e.type === 'reveal' && e.gameType === 'freegame');
      await player.playAll(b.events.slice(0, firstFree + 1));
      await wait(PACE.settle);
      await prepare(env, null, 'basegame');
    },
  },
  {
    name: 'mascots',
    label: 'Mascot cues',
    group: 'present',
    probe: () => null,
    run: async (env, opts) => {
      for (const cue of opts.cues ?? MASCOT_CUES) {
        await env.emit('mascot:cue', { cue, intensity: 1 });
        await wait(PACE.mascotHold);
      }
      await env.emit('mascot:cue', { cue: 'idle' });
    },
  },
  {
    name: 'particles',
    label: 'Particles',
    group: 'fx',
    probe: () => null,
    run: async (env, opts) => {
      const colors = Object.values(SYMBOLS).map((d) => d.color);
      for (const [i, kind] of (opts.kinds ?? BURST_KINDS).entries()) {
        const p = cellCenter(env.ctx.layout, i % 7, 1 + (i % 3));
        await env.emit('fx:burst', { kind, x: p.x, y: p.y, color: colors[i % colors.length], power: 1 });
        await wait(PACE.burstGap);
      }
      await wait(PACE.settle * 2);
    },
  },
  {
    name: 'shakeFlash',
    label: 'Shake / flash',
    group: 'fx',
    probe: () => null,
    run: async (env) => {
      for (const trauma of FX_DEMO.shakes) {
        await env.emit('fx:shake', { trauma });
        await wait(PACE.shakeGap);
      }
      for (const f of FX_DEMO.flashes) {
        await env.emit('fx:flash', { ...f });
        await wait(PACE.flashGap);
      }
      // combined impact: hit-stop + shake + flash (the "heavy land" recipe)
      clock.hitStop(TIMING.explode.hitStop);
      await Promise.all([
        env.emit('fx:shake', { trauma: 0.8 }),
        env.emit('fx:flash', { ...FX_DEMO.flashes[0] }),
      ]);
      await wait(PACE.shakeGap);
    },
  },
  {
    name: 'symbolLand',
    label: 'Symbol lands (inspector)',
    group: 'symbol',
    probe: (env, opts) => {
      const insp = env.inspector();
      if (opts.id) insp.id = opts.id;
      return insp.probeTarget();
    },
    run: async (env, opts) => {
      const insp = env.inspector();
      insp.show(opts.id ?? insp.id);
      const vs = opts.velocities ?? (opts.velocity ? [opts.velocity] : [1600, 3000, 4500]);
      for (const v of vs) {
        await insp.land(v);
        await wait(PACE.symbolGap);
      }
    },
  },
  {
    name: 'symbolStates',
    label: 'Symbol states (inspector)',
    group: 'symbol',
    probe: (env, opts) => {
      const insp = env.inspector();
      if (opts.id) insp.id = opts.id;
      return insp.probeTarget();
    },
    run: async (env, opts) => {
      const insp = env.inspector();
      insp.show(opts.id ?? insp.id);
      await insp.land(opts.velocity ?? insp.velocity);
      await wait(PACE.symbolGap);
      await insp.idleAccent();
      await wait(PACE.symbolGap * 2);
      await insp.setAnticipation(true);
      await wait(TIMING.anticipation.pulsePeriod * 2);
      await insp.setAnticipation(false);
      await wait(PACE.symbolGap);
      await insp.win();
      await wait(PACE.symbolGap);
      await insp.setDim(true);
      await wait(PACE.symbolGap);
      await insp.setDim(false);
      await wait(PACE.symbolGap);
      await insp.explode();
      await wait(PACE.symbolGap);
      await insp.reset();
    },
  },
];

export const getScenario = (name: string): ScenarioDef => {
  const def = SCENARIOS.find((d) => d.name === name);
  if (!def) throw new Error(`Unknown scenario "${name}". Known: ${SCENARIOS.map((d) => d.name).join(', ')}`);
  return def;
};

export const scenarioEnv = async (
  ctx: GameContext,
  emit: SceneEmit,
  inspector: () => SymbolInspector,
  mode: () => GameType,
): Promise<ScenarioEnv> => ({ ctx, books: await loadFixtures(), emit, inspector, mode });
