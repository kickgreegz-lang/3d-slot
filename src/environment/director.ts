import { ENV_CHANNELS, ENV_TIMING as T, type EnvChannel, type EnvState } from './spec';

/**
 * EnvironmentDirector — the background state machine, with no Pixi in it (unit-testable,
 * reusable by any renderer: layered plates, a Spine env rig, a shader uniform block).
 *
 * The game's scene events call the entry points (LayeredEnvironment wires them); every state
 * is expressed as HOLDS (channel targets kept while a state lasts) and KICKS (impulses that
 * spring back), so overlapping states blend and nothing ever snaps:
 *
 *   round:start                  spinStart()     hold 'spin'
 *   board:reveal (anticipation)  reveal(true)    hold 'anticipation' (only when the book says so)
 *   board:land                   land(weight)    kick per column impact; releases 'spin'
 *   board:showWins               wins(colour)    hold 'connect' in the winner's colour
 *   board:tumble                 tumble()        releases 'connect'
 *   board:burst                  burst()         explode kick
 *   round:end                    roundEnd(win)   win 0 -> timed 'miss' hold; else back to idle
 *   bigwin:show                  bigWin()        hold 'bigwin' until the round ends
 *   fs:trigger                   featureTrigger  light kick in the feature colour
 *   mode:change                  mode(type)      look crossfade (base <-> feature)
 *   board:set                    reset()         resume / replay start
 *
 * Time: update(dt) takes GAME time (frozen during hit-stop, like the board), plus real ms for
 * the flash limiter (<= 3 light flashes per second whatever the game speed).
 */

interface Spring {
  x: number;
  v: number;
}

interface Hold {
  targets: Partial<Record<EnvChannel, number>>;
  pulse?: { amp: number; hz: number };
  /** game-time second the hold expires (timed holds only) */
  until?: number;
}

export interface EnvHooks {
  /** prefers-reduced-motion (fx/motion.ts) */
  reduced(): boolean;
  /** crossfade to the base or the feature look */
  look(which: 'base' | 'feature'): void;
  /** every state entry (logs, lab, tests) */
  state?(s: EnvState): void;
}

export interface EnvColors {
  anticipation: number;
  bigwin: number;
  feature: number;
}

const MOTION: ReadonlySet<EnvChannel> = new Set<EnvChannel>(['zoom', 'lift']);
/** integration substep: ω·h stays <= ~0.09 for the stiffest channel (6.5 Hz), so kicks keep their peak */
const MAX_STEP = 1 / 480;

/**
 * Peak of a unit-mass spring's impulse response, as a fraction of v0/ω: an impulse of
 * amp·ω / impulsePeak(ζ) peaks at `amp` (ζ 0.32 -> 0.66, ζ 0.7 -> 0.46, ζ >= 1 -> 1/e).
 */
const impulsePeak = (zeta: number): number => {
  if (zeta >= 1) return Math.exp(-1);
  const r = Math.sqrt(1 - zeta * zeta);
  return Math.exp((-zeta / r) * Math.atan2(r, zeta));
};

export class EnvironmentDirector {
  state: EnvState = 'idle';
  /** colour the light layers blend toward by the `tint` channel */
  color = 0xffffff;
  private springs = Object.fromEntries(ENV_CHANNELS.map((c) => [c, { x: 0, v: 0 }])) as Record<EnvChannel, Spring>;
  private holds = new Map<string, Hold>();
  private time = 0;
  private realMs = 0;
  private lastFlashMs = -1e9;
  private phase = 0;
  private pulseAmp = 0;
  private gameType: 'basegame' | 'freegame' = 'basegame';

  constructor(
    private hooks: EnvHooks,
    private colors: EnvColors,
  ) {}

  // ================================================================= entry points

  spinStart(): void {
    this.release('connect', 'anticipation', 'miss', 'bigwin');
    this.hold('spin', { targets: { zoom: T.spin.zoom, light: T.spin.light } });
    this.enter('spin');
  }

  reveal(anticipation: boolean): void {
    if (!anticipation) return;
    const A = T.anticipation;
    this.color = this.colors.anticipation;
    this.hold('anticipation', {
      targets: { dim: A.dim, light: A.light, zoom: A.zoom, tint: A.tint },
      pulse: { amp: A.pulse, hz: A.pulseHz },
    });
    this.enter('anticipation');
  }

  /** One column impact; `weight` is the land multiplier (spec LAND_WEIGHT). */
  land(weight: number): void {
    this.release('spin');
    this.kick('lift', T.land.lift * weight);
    this.kick('zoom', T.land.zoom * weight);
    this.kick('light', T.land.light * weight);
    if (this.state !== 'anticipation' && this.state !== 'connect') this.enter('land');
  }

  wins(color: number): void {
    const C = T.connect;
    this.release('spin', 'anticipation', 'miss');
    this.color = color;
    this.hold('connect', {
      targets: { light: C.light, zoom: C.zoom, tint: C.tint },
      pulse: { amp: C.pulse, hz: C.pulseHz },
    });
    this.enter('connect');
  }

  tumble(): void {
    this.release('connect');
  }

  burst(): void {
    this.kick('light', T.explode.light);
    this.kick('zoom', T.explode.zoom);
    this.kick('lift', T.explode.lift);
    this.enter('explode');
  }

  roundEnd(totalWin: number): void {
    this.release('spin', 'anticipation', 'connect', 'bigwin');
    if (totalWin > 0) {
      this.enter('idle');
      return;
    }
    this.hold('miss', { targets: { dim: T.miss.dim }, until: this.time + T.miss.holdMs / 1000 });
    this.enter('miss');
  }

  bigWin(): void {
    const B = T.bigwin;
    this.color = this.colors.bigwin;
    this.hold('bigwin', { targets: { light: B.light, zoom: B.zoom, tint: B.tint }, pulse: { amp: B.pulse, hz: B.pulseHz } });
    this.enter('bigwin');
  }

  featureTrigger(): void {
    this.color = this.colors.feature;
    this.kick('light', T.feature.light);
    this.kick('zoom', T.feature.zoom);
    this.kick('tint', 1);
    this.enter('feature');
  }

  mode(gameType: 'basegame' | 'freegame'): void {
    if (gameType === this.gameType) return;
    this.gameType = gameType;
    this.hooks.look(gameType === 'freegame' ? 'feature' : 'base');
  }

  /** Resume / replay start / board:set: drop every hold and settle at rest. */
  reset(): void {
    this.holds.clear();
    for (const c of ENV_CHANNELS) this.springs[c] = { x: 0, v: 0 };
    this.pulseAmp = 0;
    this.enter('idle');
  }

  // ================================================================= simulation

  /** Advance by `dt` game seconds (0 during hit-stop) and `realDtMs` wall milliseconds. */
  update(dt: number, realDtMs = dt * 1000): void {
    this.realMs += realDtMs;
    if (dt <= 0) return;
    this.time += dt;

    let expiredMiss = false;
    for (const [key, h] of this.holds) {
      if (h.until !== undefined && h.until <= this.time) {
        this.holds.delete(key);
        if (key === 'miss') expiredMiss = true;
      }
    }
    if (expiredMiss && this.state === 'miss') this.enter('idle');

    const target = this.targets();
    for (let left = dt; left > 1e-9; left -= MAX_STEP) {
      const h = Math.min(MAX_STEP, left);
      for (const c of ENV_CHANNELS) {
        const s = this.springs[c];
        const w = 2 * Math.PI * T.springHz[c];
        const a = w * w * (target[c] - s.x) - 2 * T.springZeta[c] * w * s.v;
        s.v += a * h;
        s.x += s.v * h;
      }
    }

    let pulse: Hold['pulse'] | undefined;
    for (const hd of this.holds.values()) if (hd.pulse && (!pulse || hd.pulse.amp > pulse.amp)) pulse = hd.pulse;
    // ease the pulse amplitude in / out instead of cutting it
    const goal = pulse?.amp ?? 0;
    this.pulseAmp += (goal - this.pulseAmp) * Math.min(1, dt * 6);
    if (pulse) this.phase = (this.phase + dt * pulse.hz) % 1;
  }

  /** Current channel value (light includes the idle breath and the held pulse). */
  value(c: EnvChannel): number {
    const x = this.springs[c].x;
    if (c !== 'light') return x;
    const breath = T.idle.breathe * (0.5 + 0.5 * Math.sin((2 * Math.PI * this.time) / T.idle.breathePeriod));
    const pulse = this.pulseAmp * (0.5 + 0.5 * Math.sin(2 * Math.PI * this.phase));
    return x + breath + pulse;
  }

  /** Scale for screen-space motion (zoom / lift / drift): 0..1. */
  motionScale(): number {
    return this.hooks.reduced() ? T.reducedMotionScale : 1;
  }

  /** Holds currently active (tests, lab readout). */
  activeHolds(): string[] {
    return [...this.holds.keys()];
  }

  // ================================================================= internals

  private targets(): Record<EnvChannel, number> {
    const out = Object.fromEntries(ENV_CHANNELS.map((c) => [c, 0])) as Record<EnvChannel, number>;
    for (const h of this.holds.values()) {
      for (const [c, v] of Object.entries(h.targets) as Array<[EnvChannel, number]>) out[c] += v;
    }
    const m = this.motionScale();
    for (const c of MOTION) out[c] *= m;
    out.dim = Math.min(out.dim, 0.6);
    out.tint = Math.min(out.tint, 1);
    return out;
  }

  private hold(key: string, h: Hold): void {
    this.holds.set(key, h);
  }

  private release(...keys: string[]): void {
    for (const k of keys) this.holds.delete(k);
  }

  /** Impulse so the channel peaks at roughly `amp` and springs back. */
  private kick(c: EnvChannel, amp: number): void {
    let a = MOTION.has(c) ? amp * this.motionScale() : amp;
    if (c === 'light' && a >= T.flashLight) {
      if (this.realMs - this.lastFlashMs < T.flashGapMs) a = T.flashLight * 0.5;
      else this.lastFlashMs = this.realMs;
    }
    if (a === 0) return;
    this.springs[c].v += (a * 2 * Math.PI * T.springHz[c]) / impulsePeak(T.springZeta[c]);
  }

  private enter(s: EnvState): void {
    this.state = s;
    this.hooks.state?.(s);
  }
}
