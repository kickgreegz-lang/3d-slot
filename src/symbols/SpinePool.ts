/**
 * SPINE BACKEND for symbols (spine-pixi-v8 4.3.13, Spine Editor 4.3.x frozen).
 * Binding contract: docs/ANIMATION_CONTRACT.md §2-§5 (art side: tools/spine/contract.json).
 *
 * When `ctx.art.spine(id)` returns a SpineRef, a SymbolView borrows a pooled Spine
 * instance for the duration of an animated state and returns it afterwards, so a
 * static board stays one batched Sprite per cell. Instances run with
 * autoUpdate:false and are stepped from the game clock (hit-stop aware) with
 * dt * speedScale(), so turbo speeds skeletal animation up like every GSAP tween.
 *
 * ANIMATION-NAME CONTRACT (track 0; a missing animation falls back to the procedural
 * rig for that action only, so a partial skeleton never breaks the game):
 *   idle                          loop   optional idle accent
 *   land                          once   impact reaction, ≈300-500 ms; event `impact` on the contact frame
 *   win                           once   ≤ TIMING.win.winAnimDuration (900 ms)
 *   win_loop                      loop   postWin hold after `win`
 *   anticipation_intro            once   ≈ TIMING.anticipation.introDuration
 *   anticipation_loop             loop   heartbeat, one beat ≈ TIMING.anticipation.pulsePeriod
 *                                        (alias: `anticipation`, the art-pipeline name)
 *   anticipation_out              once   ≈ TIMING.anticipation.outroDuration
 *   explode                       once   event `burst` on the frame the symbol breaks apart
 *   blur                          loop   optional fast-fall pose (else the 'blur' texture is used)
 *   bass_react                    once   TRACK 1, additive: board-wide bass reaction (optional)
 *   drop_impact                   once   heavy impact of a dropped wild (board:transform 'impact'; optional)
 * EVENTS (aliases accepted):
 *   `impact` | `land_impact`      syncs land SFX + dust + shake
 *   `burst`  | `explode_burst`    syncs the explode particles
 *   `win_peak`                    moves the win sparkle burst onto the pop apex
 *   `explode_done`                ends the explode early (instance returned sooner)
 *   `sfx` (string SfxId) · `vfx` (string fx id) · `shake` (float trauma)   generic cues
 *
 * RIG CONVENTIONS: skeleton authored on the @2x symbol canvas (360x360 px == the
 * static texture), `root` at the canvas CENTRE (the texture's anchor 0.5), y-up in
 * the editor, exported at scale 1.0 (binary + pack, PMA); squash/stretch on a
 * `squash` bone at the feet. Spine 4.2+ PHYSICS constraints on dangly parts are
 * kicked on land with `skeleton.physicsTranslate(0, -impulse)` — the runtime
 * skeleton is y-down, so "the skeleton jolted UP" and the parts keep falling past
 * the contact frame, then spring back. Container motion is inherited only after the
 * impact (setPositionInheritance(0, 0.6)), never during the fast drop.
 *
 * TRANSFORM PITFALL (why inheritance is armed by the pool, not set directly):
 * SkeletonPhysicsMovement reads `spine.worldTransform`, which Pixi v8 composes from the
 * render-group-relative transform refreshed only during RENDER. A pooled instance that was
 * just re-parented into another SymbolView therefore reports its PREVIOUS owner's
 * position on its first update, and the next frame's "movement" is the jump between the
 * two cells (hundreds of skeleton units) -> the physics bones fly off, the weighted body
 * mesh stretches then pancakes. The pool enables inheritance only after the instance has
 * been rendered once in its new place, re-baselines it, and drops any per-frame jump larger
 * than SYMBOL_TIMING.spine.maxInheritStep (teleports: re-parenting, board repositioning).
 */
import {
  type AnimationStateListener,
  type Event as SpineEvent,
  Interpolation,
  Physics,
  Spine,
} from '@esotericsoftware/spine-pixi-v8';
import type { SpineRef } from '../assets/art';
import { clock } from '../core/clock';
import { speedScale } from '../core/timing';
import { SYMBOL_TIMING } from './symbolTiming';

const keyOf = (ref: SpineRef): string => `${ref.skeleton}|${ref.atlas}|${ref.skin ?? ''}`;

interface SpineMeta {
  animations: Set<string>;
  events: Set<string>;
}

/** Deferred / guarded container-motion inheritance of one active instance. */
interface Inherit {
  factor: number;
  /** ticks to wait until the world transform is trustworthy (rendered in the new parent) */
  wait: number;
  x: number;
  y: number;
}

class SpinePoolImpl {
  private readonly free = new Map<string, Spine[]>();
  private readonly meta = new Map<string, SpineMeta>();
  private readonly active = new Set<Spine>();
  private readonly inheriting = new Map<Spine, Inherit>();
  private offTick: (() => void) | null = null;

  /** Borrow an instance (created on demand; pooled per skeleton+atlas+skin). */
  borrow(ref: SpineRef): Spine {
    const key = keyOf(ref);
    const spine = this.free.get(key)?.pop() ?? this.create(ref);
    this.active.add(spine);
    this.offTick ??= clock.onUpdate(this.tick);
    return spine;
  }

  /**
   * Physics inherit `factor` of the container's vertical motion. 0 switches it off at once;
   * > 0 is armed only after the instance has been rendered where it now lives (see header).
   */
  inherit(spine: Spine, factor: number): void {
    spine.skeletonPhysics.setPositionInheritance(0, 0);
    if (factor > 0 && this.active.has(spine)) this.inheriting.set(spine, { factor, wait: 2, x: 0, y: 0 });
    else this.inheriting.delete(spine);
  }

  /** Return an instance: tracks cleared, setup pose restored, detached. */
  release(ref: SpineRef, spine: Spine): void {
    if (!this.active.delete(spine)) return;
    this.inheriting.delete(spine);
    spine.state.clearListeners();
    spine.state.clearTracks();
    spine.state.timeScale = 1;
    spine.skeleton.setupPose();
    spine.skeletonPhysics.setPositionInheritance(0, 0);
    spine.skeletonPhysics.resetTransform();
    spine.skeleton.updateWorldTransform(Physics.reset);
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
    const mixData = spine.state.data;
    mixData.defaultMix = SYMBOL_TIMING.spine.mix;
    const names = new Set(spine.skeleton.data.animations.map((a) => a.name));
    for (const [from, to, d] of SYMBOL_TIMING.spine.mixes) {
      if (from === '*') {
        for (const f of names) if (names.has(to) && f !== to) mixData.setMix(f, to, d);
      } else if (names.has(from) && names.has(to)) mixData.setMix(from, to, d);
    }
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
    for (const spine of this.active) {
      const inh = this.inheriting.get(spine);
      if (inh) this.guard(spine, inh);
      spine.update(d);
    }
  };

  /** Arm inheritance once the transform is valid; discard teleports (re-parenting, repositioning). */
  private guard(spine: Spine, inh: Inherit): void {
    const phys = spine.skeletonPhysics;
    const wt = spine.worldTransform;
    if (inh.wait > 0) {
      inh.wait--;
      if (inh.wait === 0) {
        phys.resetTransform();
        phys.setPositionInheritance(0, inh.factor);
      }
    } else {
      // screen px per skeleton unit, so the limit is resolution / layout independent
      const unit = Math.max(1e-6, Math.hypot(wt.a, wt.b));
      if (Math.hypot(wt.tx - inh.x, wt.ty - inh.y) / unit > SYMBOL_TIMING.spine.maxInheritStep) phys.resetTransform();
    }
    inh.x = wt.tx;
    inh.y = wt.ty;
  }
}

export const spinePool = new SpinePoolImpl();

/** Contract aliases (runtime name first, art-pipeline name second). */
export const SPINE_EVENT = {
  impact: ['impact', 'land_impact'],
  burst: ['burst', 'explode_burst'],
  winPeak: ['win_peak'],
  done: ['explode_done'],
} as const;
export const SPINE_ANIM = {
  anticipationLoop: ['anticipation_loop', 'anticipation'],
} as const;

/** Generic payload events keyed in the skeleton (`sfx`, `vfx`, `shake`). */
export type SpineCue = (name: 'sfx' | 'vfx' | 'shake', ev: SpineEvent) => void;

/**
 * One borrowed Spine instance driven by a SymbolView: plays contract animations,
 * routes contract events (with aliases), kicks physics, and always resolves its
 * promises (also when interrupted) so the book player can never hang on a symbol.
 */
export class SpineRig {
  readonly spine: Spine;
  private readonly handlers = new Map<string, () => void>();
  private readonly listener: AnimationStateListener;
  private readonly meta: SpineMeta;
  private cue: SpineCue | null = null;

  constructor(private readonly ref: SpineRef) {
    this.meta = spinePool.describe(ref);
    this.spine = spinePool.borrow(ref);
    this.listener = {
      event: (_entry, ev) => {
        const name = ev.data.name;
        if (name === 'sfx' || name === 'vfx' || name === 'shake') {
          this.cue?.(name, ev);
          return;
        }
        const fn = this.handlers.get(name);
        if (fn) fn();
      },
    };
    this.spine.state.addListener(this.listener);
  }

  /** First of `names` the skeleton has (aliases), or null. */
  static pick(ref: SpineRef, names: readonly string[]): string | null {
    const anims = spinePool.describe(ref).animations;
    for (const n of names) if (anims.has(n)) return n;
    return null;
  }

  static supports(ref: SpineRef, animation: string): boolean {
    return spinePool.describe(ref).animations.has(animation);
  }

  has(animation: string): boolean {
    return this.meta.animations.has(animation);
  }

  hasEvent(names: readonly string[]): boolean {
    return names.some((n) => this.meta.events.has(n));
  }

  /** One-shot handler for the next occurrence of any of the aliased event names. */
  once(names: readonly string[], fn: () => void): void {
    const run = () => {
      for (const n of names) this.handlers.delete(n);
      fn();
    };
    for (const n of names) this.handlers.set(n, run);
  }

  /** Route `sfx` / `vfx` / `shake` payload events. */
  onCue(fn: SpineCue | null): void {
    this.cue = fn;
  }

  /** Play on track 0. Loops resolve immediately; one-shots resolve on complete OR interrupt. */
  play(animation: string, loop = false, smoothMix = false): Promise<void> {
    const entry = this.spine.state.setAnimation(0, animation, loop);
    if (smoothMix) entry.mixInterpolation = Interpolation.smooth;
    if (loop) return Promise.resolve();
    return new Promise((resolve) => {
      entry.listener = { complete: () => resolve(), interrupt: () => resolve(), end: () => resolve() };
    });
  }

  /**
   * One-shot ADDITIVE overlay on `track` (contract: overlays live on track 1, e.g. `bass_react`),
   * layered over whatever track 0 plays; the track is emptied when it ends. Resolves on
   * complete OR interrupt, like play().
   */
  playOverlay(animation: string, track = 1): Promise<void> {
    const state = this.spine.state;
    const entry = state.setAnimation(track, animation, false);
    entry.additive = true;
    return new Promise((resolve) => {
      entry.listener = {
        complete: () => {
          state.setEmptyAnimation(track, 0);
          resolve();
        },
        interrupt: () => resolve(),
        end: () => resolve(),
      };
    });
  }

  /** Queue a loop after the current one-shot. */
  queueLoop(animation: string): void {
    this.spine.state.addAnimation(0, animation, true, 0);
  }

  /** Physics ignores container motion (fast drops would fling the parts off). */
  detachPhysics(): void {
    spinePool.inherit(this.spine, 0);
  }

  /**
   * Contact frame: jolt the skeleton UP (y-down runtime) so physics parts keep falling past
   * the contact, then let the post-impact hop / squash drive them (inheritance armed by the
   * pool one rendered frame later, see header).
   */
  impact(impulse: number): void {
    spinePool.inherit(this.spine, SYMBOL_TIMING.spine.landInheritance);
    this.spine.skeleton.physicsTranslate(0, -Math.min(impulse, SYMBOL_TIMING.spine.maxImpulse));
  }

  /** Fire any pending one-shot handlers (e.g. interrupted before `burst`). */
  flushEvents(): void {
    const fns = new Set(this.handlers.values());
    this.handlers.clear();
    for (const fn of fns) fn();
  }

  release(): void {
    this.handlers.clear();
    this.cue = null;
    spinePool.release(this.ref, this.spine);
  }
}
