/**
 * SPINE BACKEND for symbols (spine-pixi-v8 4.3.13, Spine Editor 4.3.x frozen).
 *
 * When `ctx.art.spine(id)` returns a SpineRef, a SymbolView borrows a pooled Spine
 * instance for the duration of an animated state and returns it afterwards, so a
 * static board stays one batched Sprite per cell. Instances run with
 * autoUpdate:false and are stepped from the game clock (hit-stop aware) with
 * dt * speedScale(), so turbo speeds skeletal animation up like every GSAP tween.
 *
 * ANIMATION-NAME CONTRACT (all on track 0; any missing one falls back to the
 * procedural rig for that action only):
 *   idle                loop   optional idle accent
 *   land                once   impact reaction, ≈300-450 ms; event `impact` on the contact frame
 *   win                 once   ≤ TIMING.win.winAnimDuration (900 ms)
 *   win_loop            loop   postWin hold after `win`
 *   anticipation_intro  once   ≈ TIMING.anticipation.introDuration
 *   anticipation_loop   loop   heartbeat, one beat ≈ TIMING.anticipation.pulsePeriod
 *   anticipation_out    once   ≈ TIMING.anticipation.outroDuration
 *   explode             once   event `burst` on the frame the symbol breaks apart
 *   blur                loop   optional fast-fall pose (else the 'blur' texture is used)
 * EVENTS: `impact` syncs land SFX + dust; `burst` syncs the explode particles.
 *
 * RIG CONVENTIONS: skeleton authored on the @2x symbol canvas (360x360 px == the
 * static texture), root bone at the canvas CENTRE (the texture's anchor 0.5), y-up,
 * exported at scale 1.0 (binary + pack, PMA). Spine 4.2+ PHYSICS constraints on
 * dangly parts (antenna, cable, tassels) are kicked on land with
 * `skeleton.physicsTranslate(0, impulse)` so they keep moving after the impact.
 */
import { type AnimationStateListener, Spine } from '@esotericsoftware/spine-pixi-v8';
import type { SpineRef } from '../assets/art';
import { clock } from '../core/clock';
import { speedScale } from '../core/timing';
import { SYMBOL_TIMING } from './symbolTiming';

const keyOf = (ref: SpineRef): string => `${ref.skeleton}|${ref.atlas}|${ref.skin ?? ''}`;

interface SpineMeta {
  animations: Set<string>;
  events: Set<string>;
}

class SpinePoolImpl {
  private readonly free = new Map<string, Spine[]>();
  private readonly meta = new Map<string, SpineMeta>();
  private readonly active = new Set<Spine>();
  private offTick: (() => void) | null = null;

  /** Borrow an instance (created on demand; pooled per skeleton+atlas+skin). */
  borrow(ref: SpineRef): Spine {
    const key = keyOf(ref);
    const spine = this.free.get(key)?.pop() ?? this.create(ref);
    this.active.add(spine);
    this.offTick ??= clock.onUpdate(this.tick);
    return spine;
  }

  /** Return an instance: tracks cleared, setup pose restored, detached. */
  release(ref: SpineRef, spine: Spine): void {
    if (!this.active.delete(spine)) return;
    spine.state.clearListeners();
    spine.state.clearTracks();
    spine.state.timeScale = 1;
    spine.skeleton.setupPose();
    spine.removeFromParent();
    spine.alpha = 1;
    spine.visible = true;
    const key = keyOf(ref);
    let list = this.free.get(key);
    if (!list) {
      list = [];
      this.free.set(key, list);
    }
    list.push(spine);
    if (this.active.size === 0) {
      this.offTick?.();
      this.offTick = null;
    }
  }

  /** Animation / event names of a skeleton (creates and pools one instance on first ask). */
  describe(ref: SpineRef): SpineMeta {
    const key = keyOf(ref);
    let m = this.meta.get(key);
    if (!m) {
      const spine = this.create(ref);
      let list = this.free.get(key);
      if (!list) {
        list = [];
        this.free.set(key, list);
      }
      list.push(spine);
      m = this.meta.get(key) as SpineMeta;
    }
    return m;
  }

  private create(ref: SpineRef): Spine {
    const spine = new Spine({ skeleton: ref.skeleton, atlas: ref.atlas, autoUpdate: false });
    spine.label = 'symbol-spine';
    if (ref.skin) {
      spine.skeleton.setSkin(ref.skin);
      spine.skeleton.setupPoseSlots();
    }
    spine.state.data.defaultMix = SYMBOL_TIMING.spine.mix;
    const key = keyOf(ref);
    if (!this.meta.has(key)) {
      const data = spine.skeleton.data;
      this.meta.set(key, {
        animations: new Set(data.animations.map((a) => a.name)),
        events: new Set(data.events.map((e) => e.name)),
      });
    }
    return spine;
  }

  private readonly tick = (dt: number): void => {
    const d = dt * speedScale();
    for (const spine of this.active) spine.update(d);
  };
}

export const spinePool = new SpinePoolImpl();

/**
 * One borrowed Spine instance driven by a SymbolView: plays contract animations,
 * routes contract events, kicks physics, and always resolves its promises (also when
 * interrupted) so the book player can never hang on a symbol.
 */
export class SpineRig {
  readonly spine: Spine;
  private readonly handlers = new Map<string, () => void>();
  private readonly listener: AnimationStateListener;
  private readonly meta: SpineMeta;

  constructor(private readonly ref: SpineRef) {
    this.meta = spinePool.describe(ref);
    this.spine = spinePool.borrow(ref);
    this.listener = {
      event: (_entry, ev) => {
        const fn = this.handlers.get(ev.data.name);
        if (fn) {
          this.handlers.delete(ev.data.name);
          fn();
        }
      },
    };
    this.spine.state.addListener(this.listener);
  }

  static supports(ref: SpineRef, animation: string): boolean {
    return spinePool.describe(ref).animations.has(animation);
  }

  has(animation: string): boolean {
    return this.meta.animations.has(animation);
  }

  hasEvent(name: string): boolean {
    return this.meta.events.has(name);
  }

  /** One-shot handler for a Spine event on the next occurrence. */
  once(event: string, fn: () => void): void {
    this.handlers.set(event, fn);
  }

  /** Play on track 0. Loops resolve immediately; one-shots resolve on complete OR interrupt. */
  play(animation: string, loop = false): Promise<void> {
    const entry = this.spine.state.setAnimation(0, animation, loop);
    if (loop) return Promise.resolve();
    return new Promise((resolve) => {
      entry.listener = { complete: () => resolve(), interrupt: () => resolve(), end: () => resolve() };
    });
  }

  /** Queue a loop after the current one-shot. */
  queueLoop(animation: string): void {
    this.spine.state.addAnimation(0, animation, true, 0);
  }

  /** Kick physics constraints as if the skeleton had just been jolted (y-up skeleton units). */
  kick(impulse: number): void {
    this.spine.skeleton.physicsTranslate(0, impulse);
  }

  /** Fire and forget any pending event handlers (e.g. interrupted before `burst`). */
  flushEvents(): void {
    const fns = [...this.handlers.values()];
    this.handlers.clear();
    for (const fn of fns) fn();
  }

  release(): void {
    this.handlers.clear();
    spinePool.release(this.ref, this.spine);
  }
}
