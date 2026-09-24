/**
 * Mascot animation state machine: book/scene cues -> glTF clips with crossfades.
 *
 * CLIP-NAME CONTRACT for production mascot GLBs (Blender actions exported with
 * export_animation_mode='ACTIONS'; names matched case-insensitively, loops authored
 * with first key == last key, 30 fps, root motion baked in place):
 *
 *   idle          3-6 s breathing/weight-shift loop                           loop
 *   idle_bored    loop after ~20 s without a cue (slouch, yawn, check claws)  loop
 *   anticipation  lean-in / hold-breath loop while reels anticipate           loop
 *   react_small   1.2-2 s nod or fist pump on a small win / tumble            once
 *   win_big       1.5-2.5 s jump or big gesture on a strong win               once
 *   celebrate     dance loop held for the whole big-win presentation          loop
 *   fs_trigger    2-3 s hype gesture when free spins are awarded              once
 *   fs_end        1.5-2.5 s wave / bow when free spins finish                 once
 *
 * Optional extras the procedural layer picks up automatically (see procedural.ts):
 *   morph targets  blink, happy, surprised, sad, angry
 *   spring bones   names containing tail / ear / jowl / belly / antenna / chain
 *
 * Missing clips fall back to FALLBACK_CLIPS (the CC0 RobotExpressive placeholder names),
 * then to idle, so an incomplete rig never breaks the game. One-shots return to the
 * current base loop (idle, anticipation or celebrate) with a crossfade that starts
 * before the clip ends, so there is never a pose pop.
 */
import { type AnimationAction, type AnimationClip, type AnimationMixer, LoopOnce, LoopRepeat } from 'three';
import { isTurbo, speedScale, TIMING } from '../core/timing';

export type ClipKey =
  | 'idle'
  | 'idle_bored'
  | 'anticipation'
  | 'react_small'
  | 'win_big'
  | 'celebrate'
  | 'fs_trigger'
  | 'fs_end';

export type BaseKey = 'idle' | 'idle_bored' | 'anticipation' | 'celebrate';

const LOOPS: ReadonlySet<ClipKey> = new Set<ClipKey>(['idle', 'idle_bored', 'anticipation', 'celebrate']);

/** One clip in a (possibly multi-step) performance. */
interface ClipStep {
  clip: string;
  /** playback-rate multiplier on top of the character tempo */
  rate?: number;
  /** start offset into the clip (s) */
  from?: number;
  /** stop this many seconds before the clip's end (trims long tails) */
  trim?: number;
}

/** Alternatives (picked by the seeded RNG), each a sequence of steps. */
type Performance = ClipStep[][];

/** Placeholder mapping onto RobotExpressive clip names. */
export const FALLBACK_CLIPS: Record<ClipKey, Performance> = {
  idle: [[{ clip: 'Idle' }]],
  idle_bored: [[{ clip: 'Idle', rate: 0.55 }]],
  anticipation: [[{ clip: 'Idle', rate: 1.8 }]],
  react_small: [[{ clip: 'Yes', rate: 1.15 }], [{ clip: 'ThumbsUp', rate: 1.1 }]],
  win_big: [[{ clip: 'Jump', rate: 0.9 }, { clip: 'ThumbsUp', rate: 1.1 }]],
  celebrate: [[{ clip: 'Dance' }]],
  fs_trigger: [[{ clip: 'Wave', rate: 1.2 }, { clip: 'Jump', rate: 0.9 }]],
  fs_end: [[{ clip: 'Wave' }]],
};

/** Local timing (seconds, animation time) — not gameplay pacing, so it stays out of TIMING. */
const LOCAL = {
  /** idle -> idle_bored after this long without a cue */
  boredAfter: 20,
  /** ignore a repeat of the same one-shot within this window (flow + scene events can double-cue) */
  dedupe: 0.3,
};

export class MascotController {
  /** logical state currently shown ('react_small' while that one-shot plays, etc.) */
  state: ClipKey = 'idle';
  /** seconds since `state` began (game time) */
  stateTime = 0;
  /** loop that one-shots return to */
  base: BaseKey = 'idle';

  private readonly clips = new Map<string, AnimationClip>();
  private readonly twins = new Map<AnimationClip, AnimationClip>();
  private current: AnimationAction | null = null;
  private queue: ClipStep[] = [];
  private stepEnd = Number.POSITIVE_INFINITY;
  private idleTime = 0;
  private lastOneShot: { key: ClipKey; at: number } = { key: 'idle', at: -1 };
  private clockTime = 0;

  constructor(
    private readonly mixer: AnimationMixer,
    clips: readonly AnimationClip[],
    private readonly tempo: number,
    private readonly rand: () => number,
    idlePhase: number,
  ) {
    for (const c of clips) this.clips.set(c.name.toLowerCase(), c);
    this.enter('idle', 0);
    if (this.current) this.current.time = idlePhase * this.current.getClip().duration;
  }

  /** Play a clip key: loops become the new base, one-shots play once then return to base. */
  play(key: ClipKey): void {
    if (!LOOPS.has(key)) {
      if (this.lastOneShot.key === key && this.clockTime - this.lastOneShot.at < LOCAL.dedupe) return;
      this.lastOneShot = { key, at: this.clockTime };
    } else {
      this.base = key as BaseKey;
      if (this.isOneShot()) return; // the running one-shot returns to the new base when done
      if (this.state === key) return;
    }
    this.enter(key, this.fade());
  }

  /** Drop a held loop (anticipation / celebrate / bored) back to idle. */
  release(): void {
    this.idleTime = 0;
    if (this.base === 'idle') return;
    this.base = 'idle';
    if (!this.isOneShot()) this.enter('idle', this.fade());
  }

  /** Any activity resets the boredom timer (and wakes a bored mascot). */
  poke(): void {
    this.idleTime = 0;
    if (this.base === 'idle_bored') this.release();
  }

  isOneShot(): boolean {
    return !LOOPS.has(this.state);
  }

  update(dt: number): void {
    this.clockTime += dt;
    this.stateTime += dt;
    if (this.state === 'idle') {
      this.idleTime += dt;
      if (this.idleTime > LOCAL.boredAfter) this.play('idle_bored');
    }
    const a = this.current;
    if (!a || !this.isOneShot()) return;
    // start the next step / return crossfade before the one-shot ends (no pose pop)
    const rate = Math.max(1e-3, Math.abs(a.getEffectiveTimeScale()));
    const remaining = (this.stepEnd - a.time) / rate; // mixer seconds, like fade()
    if (remaining <= this.fade()) this.advance();
  }

  private advance(): void {
    const next = this.queue.shift();
    if (next) this.start(next, false, this.fade());
    else this.enter(this.base, this.fade());
  }

  private enter(key: ClipKey, fade: number): void {
    const perf = this.resolve(key);
    const variant = perf[Math.floor(this.rand() * perf.length) % perf.length];
    this.state = key;
    this.stateTime = 0;
    if (key !== 'idle') this.idleTime = 0;
    const loop = LOOPS.has(key);
    this.queue = variant.slice(1);
    this.start(variant[0], loop && this.queue.length === 0, fade);
  }

  /** Production clip by contract name, else the placeholder fallback, else idle. */
  private resolve(key: ClipKey): Performance {
    if (this.clips.has(key)) return [[{ clip: key }]];
    const fb = FALLBACK_CLIPS[key].map((seq) => seq.filter((s) => this.clips.has(s.clip.toLowerCase())));
    const usable = fb.filter((seq) => seq.length > 0);
    if (usable.length) return usable;
    const idle = this.clips.has('idle') ? 'idle' : ([...this.clips.keys()][0] ?? '');
    return [[{ clip: idle }]];
  }

  private start(step: ClipStep, loop: boolean, fade: number): void {
    const clip = this.clips.get(step.clip.toLowerCase());
    if (!clip) return;
    const prev = this.current;
    const rate = this.tempo * (step.rate ?? 1);
    if (prev && loop && prev.getClip() === clip && prev.loop === LoopRepeat) {
      // same loop clip at a new rate (e.g. idle -> anticipation fallback): keep the phase
      prev.setEffectiveTimeScale(rate);
      this.stepEnd = Number.POSITIVE_INFINITY;
      return;
    }
    // restarting the clip that is playing needs a twin action so it can crossfade into itself
    const next = this.mixer.clipAction(prev?.getClip() === clip ? this.twin(clip) : clip);
    next.reset();
    next.setLoop(loop ? LoopRepeat : LoopOnce, loop ? Number.POSITIVE_INFINITY : 1);
    next.clampWhenFinished = !loop;
    next.setEffectiveTimeScale(rate);
    next.setEffectiveWeight(1);
    next.time = step.from ?? 0;
    next.play();
    this.stepEnd = loop ? Number.POSITIVE_INFINITY : clip.duration - (step.trim ?? 0);
    if (prev && prev !== next) prev.crossFadeTo(next, fade, false);
    else if (!prev) next.fadeIn(fade);
    this.current = next;
  }

  private twin(clip: AnimationClip): AnimationClip {
    let t = this.twins.get(clip);
    if (!t) {
      t = clip.clone();
      t.name = `${clip.name}~`;
      this.twins.set(clip, t);
    }
    return t;
  }

  /** Crossfade length in MIXER time (the mixer runs at speedScale), so real time = TIMING value. */
  private fade(): number {
    return (isTurbo() ? TIMING.mascot.crossFadeTurbo : TIMING.mascot.crossFade) * speedScale();
  }
}
