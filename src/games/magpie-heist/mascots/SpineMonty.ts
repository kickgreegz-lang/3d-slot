import {
  AABBRectangleBoundsProvider,
  type AnimationStateListener,
  AttachmentTimeline,
  type Bone,
  Spine,
  type TrackEntry,
} from '@esotericsoftware/spine-pixi-v8';
import { Container } from 'pixi.js';
import type { Pt } from '../../../config/layout';
import { isTurbo, registerTiming, speedScale, TIMING } from '../../../core/timing';
import type { SfxId } from '../../../game/events';
import { makeRng } from '../../../mascots/characters';
import type { MontyRigRef } from './assets';

/** MONTY's rig canvas (skeleton units, 2x the landscape mascot rect); the root (feet) is its bottom centre. */
export const MONTY_CANVAS = [880, 1448] as const;

/** Track-0 body clips of chr_monty (tools/spine/contract.json characters.rigs.chr_monty). */
export type MontyClip =
  | 'idle'
  | 'idle_bored'
  | 'spin_start'
  | 'anticipation'
  | 'react_small'
  | 'react_tumble'
  | 'win_big'
  | 'celebrate'
  | 'fs_trigger'
  | 'feature_upgrade'
  | 'fs_end';

/** Loops a one-shot returns to. */
export type MontyLoop = 'idle' | 'idle_bored' | 'anticipation' | 'celebrate';
const LOOPS: ReadonlySet<MontyClip> = new Set<MontyClip>(['idle', 'idle_bored', 'anticipation', 'celebrate']);

/** A look target: a design-space point, or the player (the camera). */
export type LookTarget = Pt | 'player';

/** foley the rig's `sfx` events carry (anything else is ignored) */
const RIG_SFX: Partial<Record<string, { volume: number }>> = {
  ui_click: { volume: 0.45 },
  wild_whoosh: { volume: 0.5 },
  land_light: { volume: 0.55 },
  land_heavy: { volume: 0.6 },
};

/**
 * Presentation tuning (seconds unless noted; timing section `magpieHeistMonty` in the animation lab).
 * Gameplay never waits on MONTY: every clip is decoration over the round.
 */
export const MONTY_TUNING = registerTiming('magpieHeistMonty', {
  /** idle -> idle_bored after this long without a cue, + up to boredJitter */
  boredAfter: 18,
  boredJitter: 6,
  /** runtime blink (track 2) every blinkMin..blinkMax s, never across an authored eye swap */
  blinkMin: 3,
  blinkMax: 6,
  blinkGuard: 0.3,
  /** ignore a repeat of the same one-shot within this window (s) */
  dedupe: 0.35,
  /** start phase of the free-running idle (0..1) */
  idlePhase: 0.2,
  /** look-at (track 3) */
  look: {
    /** resting weight of the aim at the board centre (0 = the clips' own head motion only) */
    rest: 0.55,
    cluster: 1.4,
    star: 1.8,
    nest: 1.2,
    trigger: 2.0,
    player: 2.4,
    /** response of the aim (1/s) and of the blend in/out */
    follow: 8,
    blend: 6,
    /** pupils saturate at this ctrl_look x offset (skeleton units; the rig clamps at 3 units = 150) */
    pupilReach: 170,
    /** head elevation limit (deg; the rig clamps at 12) and deg per 100 units (rig: 5) */
    headMax: 13,
    degPer100: 5,
  },
  /** procedural kicks (track 3): damped springs on the head (nod) and the chest (lean), degrees */
  kick: { hz: 3.2, zeta: 0.42, nod: 6, lean: 4 },
  /** low tier: skeleton updates per second (0 = every frame) */
  lowTierHz: 30,
});
const T = MONTY_TUNING;

interface OneShot {
  name: MontyClip;
  entry: TrackEntry;
  rate: number;
  sp0: number;
}

interface EyeKey {
  t: number;
  name: string | null;
}

/** Damped spring for the procedural kicks (degrees). */
class Kick {
  x = 0;
  v = 0;
  add(amount: number): void {
    this.v += amount * 2 * Math.PI * T.kick.hz * 1.35;
  }
  step(dt: number): void {
    const w = 2 * Math.PI * T.kick.hz;
    const c = 2 * T.kick.zeta * w;
    let left = dt;
    while (left > 1e-6) {
      const h = Math.min(left, 1 / 120);
      this.v += (-w * w * this.x - c * this.v) * h;
      this.x += this.v * h;
      left -= h;
    }
    if (Math.abs(this.x) < 1e-4 && Math.abs(this.v) < 1e-3) this.x = this.v = 0;
  }
}

/**
 * MONTY on spine-pixi-v8: the MascotCue state machine of the Bass Drop 2D mascots (SpineMascot) for one
 * right-facing character.
 *  - Track 0 body: loops (idle / idle_bored / anticipation / celebrate) and one-shots that return to the
 *    current loop with the TIMING.mascot crossfade (0.25 s, 0.15 s turbo) started before the clip ends
 *    (every one-shot ends on idle's first pose, so the return never swims). idle starts at a seeded phase.
 *  - Track 2: runtime blink every blinkMin..blinkMax s (seeded), never across an authored eye swap.
 *  - Track 3 (runtime): `ctrl_look` aimed at a design-space point (head +5 deg per 100 units, clamped by
 *    the rig's `look` constraint; pupils through `look_eyes`) blended over the clips' own keyed look,
 *    with a resting aim at the board centre; procedural nod / lean kicks on the head / chest. Applied in
 *    beforeUpdateWorldTransforms and undone after, so the animation's pose stays intact for mixing.
 *  - The rig's `sfx` events (snap, whoosh, landings) go to `onSfx`.
 * Game clock only: update(dt) with the hit-stop-aware delta; one-shots run at speedScale(), loops at 1x.
 */
export class SpineMonty {
  readonly view: Container;
  readonly spine: Spine;
  onSfx: ((id: SfxId, volume: number) => void) | null = null;
  /** design px per skeleton unit */
  k = 0.5;
  readonly feet: Pt = { x: 0, y: 0 };
  base: MontyLoop = 'idle';
  /** where the resting look aims (design space; the board centre) */
  restTarget: Pt | null = null;
  /** skeleton updates per second (0 = every frame): the low tier steps at 30 Hz */
  stepHz = 0;

  private readonly rand: () => number;
  private readonly names: Set<string>;
  private oneShot: OneShot | null = null;
  private loop: TrackEntry | null = null;
  private loopName: MontyLoop | null = null;
  private time = 0;
  private idleTime = 0;
  private boredAfter: number;
  private blinkIn: number;
  private lastOneShot: { name: string; at: number } = { name: '', at: -1 };
  private pending: { left: number; run: () => void }[] = [];
  private acc = 0;
  private firstIdle = true;
  private readonly ctrlLook: Bone;
  private readonly head: Bone;
  private readonly chest: Bone;
  private readonly feetBones: Bone[];
  private readonly lookSetup: Pt;
  private focus: LookTarget | null = null;
  private focusLeft = 0;
  private lookW = 0;
  private lookX = 0;
  private lookY = 0;
  private readonly nod = new Kick();
  private readonly lean = new Kick();
  private readonly saved = { lx: 0, ly: 0, head: 0, chest: 0 };
  private readonly eyeKeys = new Map<string, EyeKey[]>();
  private readonly eyeSlot: number;
  private readonly listener: AnimationStateListener;

  constructor(
    readonly ref: MontyRigRef,
    seed = 0x3a61,
  ) {
    this.view = new Container({ label: 'monty_spine' });
    const [cw, ch] = MONTY_CANVAS;
    this.spine = new Spine({
      skeleton: ref.skeleton,
      atlas: ref.atlas,
      autoUpdate: false,
      // fixed bounds (the 2x canvas, feet at the origin): nothing measures the meshes per frame
      boundsProvider: new AABBRectangleBoundsProvider(-cw / 2, -ch, cw, ch),
    });
    this.spine.label = 'chr_monty';
    this.view.addChild(this.spine);
    this.rand = makeRng(seed);
    const sk = this.spine.skeleton;
    this.names = new Set(sk.data.animations.map((a) => a.name));
    const ctrl = sk.findBone('ctrl_look');
    const head = sk.findBone('head');
    const chest = sk.findBone('chest');
    const eye = sk.findSlot('eye_R');
    const fl = sk.findBone('ik_foot_L');
    const fr = sk.findBone('ik_foot_R');
    if (!ctrl || !head || !chest || !eye || !fl || !fr || !this.names.has('idle')) throw new Error('chr_monty: rig parts missing');
    this.ctrlLook = ctrl;
    this.head = head;
    this.chest = chest;
    this.feetBones = [fl, fr];
    this.eyeSlot = eye.data.index;
    this.lookSetup = { x: ctrl.data.setupPose.x, y: ctrl.data.setupPose.y };
    this.boredAfter = T.boredAfter + this.rand() * T.boredJitter;
    this.blinkIn = T.blinkMin + this.rand() * (T.blinkMax - T.blinkMin);
    this.listener = {
      event: (_entry, ev) => {
        if (ev.data.name !== 'sfx') return;
        const id = ev.stringValue || ev.data.setupPose.stringValue || '';
        const fx = RIG_SFX[id];
        if (fx) this.onSfx?.(id as SfxId, fx.volume);
      },
    };
    this.spine.state.addListener(this.listener);
    this.spine.beforeUpdateWorldTransforms = this.drive;
    this.spine.afterUpdateWorldTransforms = this.undrive;
    this.enterBase(0);
    this.spine.update(0);
  }

  // =================================================================== placement

  /** Feet (the rig root) at a design-space point, `k` design px per skeleton unit. */
  place(feet: Pt, k: number): void {
    this.feet.x = feet.x;
    this.feet.y = feet.y;
    this.k = k;
    this.view.position.set(feet.x, feet.y);
    this.spine.scale.set(k);
  }

  /** Height of the feet above the floor (skeleton units, 0 when standing): the jumps lift both. */
  get airborne(): number {
    let lift = 0;
    for (const b of this.feetBones) lift += Math.max(0, b.appliedPose.worldY - b.data.setupPose.y);
    return lift / this.feetBones.length;
  }

  // =================================================================== cues

  has(name: string): boolean {
    return this.names.has(name);
  }

  /** The track-0 clip shown now (a one-shot, else the loop). */
  get current(): MontyClip {
    return this.oneShot?.name ?? this.loopName ?? this.base;
  }

  get busy(): boolean {
    return this.oneShot !== null;
  }

  /** Run `fn` after `sec` game seconds (cleared by clearPending()). */
  later(sec: number, fn: () => void): void {
    if (sec <= 0) fn();
    else this.pending.push({ left: sec, run: fn });
  }

  clearPending(): void {
    this.pending.length = 0;
  }

  /** Play a body clip: loops become the new base; a one-shot plays once and returns to the base. */
  play(name: MontyClip, o: { rate?: number; mix?: number } = {}): void {
    if (!this.has(name)) return;
    if (LOOPS.has(name)) {
      this.setBase(name as MontyLoop);
      return;
    }
    if (this.lastOneShot.name === name && this.time - this.lastOneShot.at < T.dedupe) return;
    this.lastOneShot = { name, at: this.time };
    const sp = speedScale();
    const e = this.spine.state.setAnimation(0, name, false);
    e.mixDuration = o.mix ?? this.fade();
    const rate = o.rate ?? sp;
    e.timeScale = rate;
    this.oneShot = { name, entry: e, rate, sp0: sp };
    this.loop = null;
    this.loopName = null;
    this.idleTime = 0;
  }

  setBase(name: MontyLoop): void {
    if (!this.has(name)) name = 'idle';
    this.base = name;
    if (name !== 'idle_bored') this.idleTime = 0;
    if (this.oneShot) return; // the running one-shot returns to the new base when done
    if (this.loopName === name) return;
    this.enterBase(this.fade());
  }

  /** Drop a held loop (anticipation / celebrate / bored) back to idle. */
  release(): void {
    this.idleTime = 0;
    if (this.base !== 'idle') this.setBase('idle');
  }

  /** Any activity resets the boredom timer (and wakes a bored Monty). */
  poke(): void {
    this.idleTime = 0;
    if (this.base === 'idle_bored') this.setBase('idle');
  }

  lookAt(target: LookTarget, seconds: number): void {
    this.focus = target;
    this.focusLeft = seconds;
  }

  /** Procedural nod (degrees, + = down) and lean toward the reels (degrees). */
  kick(nod: number, lean = 0): void {
    if (nod) this.nod.add(nod);
    if (lean) this.lean.add(lean);
  }

  // =================================================================== per frame

  update(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;
    for (const p of this.pending) p.left -= dt;
    for (let i = 0; i < this.pending.length; ) {
      const p = this.pending[i];
      if (p.left > 0) {
        i++;
        continue;
      }
      this.pending.splice(i, 1);
      p.run();
    }
    this.advanceBody(dt);
    this.blink(dt);
    this.aim(dt);
    this.nod.step(dt);
    this.lean.step(dt);
    if (this.stepHz > 0) {
      this.acc += dt;
      if (this.acc < 1 / this.stepHz - 1e-4) return;
      dt = this.acc;
      this.acc = 0;
    }
    this.spine.update(dt);
  }

  private advanceBody(dt: number): void {
    const os = this.oneShot;
    if (os) {
      const e = os.entry;
      e.timeScale = (os.rate * speedScale()) / os.sp0;
      const left = (e.animationEnd - e.trackTime) / Math.max(1e-4, e.timeScale);
      if (left <= this.fade()) this.enterBase(this.fade());
      return;
    }
    if (this.base === 'idle') {
      this.idleTime += dt;
      if (this.idleTime > this.boredAfter) {
        this.boredAfter = T.boredAfter + this.rand() * T.boredJitter;
        this.setBase('idle_bored');
      }
    } else if (this.base === 'idle_bored') {
      // one bored routine, then back to idle (it never loops forever)
      const lp = this.loop;
      if (lp && lp.trackTime >= lp.animationEnd - this.fade()) this.setBase('idle');
    }
  }

  private enterBase(mix: number): void {
    const name = this.base;
    const e = this.spine.state.setAnimation(0, name, true);
    e.mixDuration = mix;
    e.timeScale = 1;
    if (name === 'idle' && this.firstIdle) e.trackTime = T.idlePhase * e.animationEnd;
    if (name === 'idle') this.firstIdle = false;
    this.loop = e;
    this.loopName = name;
    this.oneShot = null;
  }

  private fade(): number {
    return isTurbo() ? TIMING.mascot.crossFadeTurbo : TIMING.mascot.crossFade;
  }

  // ---------------------------------------------------------------- face (track 2)

  private blink(dt: number): void {
    if ((this.blinkIn -= dt) > 0) return;
    if (!this.canBlink()) {
      this.blinkIn = 0.4;
      return;
    }
    const st = this.spine.state;
    const e = st.setAnimation(2, 'blink', false);
    e.mixDuration = 0;
    st.addEmptyAnimation(2, 0, 0);
    this.blinkIn = T.blinkMin + this.rand() * (T.blinkMax - T.blinkMin);
  }

  /** Eyes open on track 0 and no authored eye swap within blinkGuard. */
  private canBlink(): boolean {
    if (!this.has('blink')) return false;
    const cur = this.spine.state.getTrack(0);
    const anim = cur?.animation;
    if (!cur || !anim || cur.mixingFrom) return false;
    let keys = this.eyeKeys.get(anim.name);
    if (!keys) {
      keys = [];
      for (const tl of anim.timelines) {
        if (tl instanceof AttachmentTimeline && tl.slotIndex === this.eyeSlot) {
          for (let i = 0; i < tl.getFrameCount(); i++) keys.push({ t: tl.frames[i], name: tl.attachmentNames[i] });
        }
      }
      this.eyeKeys.set(anim.name, keys);
    }
    const t = cur.getAnimationTime();
    let state: string | null = 'open';
    for (const k of keys) {
      if (Math.abs(k.t - t) < T.blinkGuard && k.t > 0) return false;
      if (k.t <= t) state = k.name;
    }
    return state === 'open';
  }

  // ---------------------------------------------------------------- look (track 3)

  private aim(dt: number): void {
    if (this.focus && (this.focusLeft -= dt) <= 0) this.focus = null;
    const L = T.look;
    const resting = this.base === 'idle_bored' && !this.oneShot ? null : this.restTarget;
    const f = this.focus ?? resting;
    const want = this.focus ? 1 : f ? L.rest : 0;
    this.lookW += (want - this.lookW) * (1 - Math.exp(-dt * L.blend));
    if (!f) return;
    let ox: number;
    let oy: number;
    if (f === 'player') {
      // toward the camera: pupils turn back a little from the facing direction, head level
      ox = -0.4 * L.pupilReach;
      oy = 30;
    } else {
      // skeleton units, y up, from the head
      const hp = this.head.appliedPose;
      const tx = (f.x - this.feet.x) / this.k;
      const ty = (this.feet.y - f.y) / this.k;
      const dx = tx - hp.worldX;
      const dy = ty - hp.worldY;
      const len = Math.hypot(dx, dy) || 1;
      const elev = (Math.atan2(dy, Math.abs(dx)) * 180) / Math.PI;
      oy = (Math.max(-L.headMax, Math.min(L.headMax, elev)) / L.degPer100) * 100;
      ox = (dx / len) * L.pupilReach;
    }
    const a = 1 - Math.exp(-dt * L.follow);
    this.lookX += (ox - this.lookX) * a;
    this.lookY += (oy - this.lookY) * a;
  }

  /** beforeUpdateWorldTransforms: the look aim and the kicks on top of the applied animation. */
  private readonly drive = (): void => {
    const s = this.saved;
    const cl = this.ctrlLook.pose;
    s.lx = cl.x;
    s.ly = cl.y;
    const w = this.lookW;
    if (w > 1e-3) {
      cl.x += (this.lookSetup.x + this.lookX - cl.x) * w;
      cl.y += (this.lookSetup.y + this.lookY - cl.y) * w;
    }
    const hp = this.head.pose;
    const cp = this.chest.pose;
    s.head = hp.rotation;
    s.chest = cp.rotation;
    // right-facing: a nod down / a lean toward the reels are clockwise
    hp.rotation -= this.nod.x;
    cp.rotation -= this.lean.x;
  };

  private readonly undrive = (): void => {
    const s = this.saved;
    const cl = this.ctrlLook.pose;
    cl.x = s.lx;
    cl.y = s.ly;
    this.head.pose.rotation = s.head;
    this.chest.pose.rotation = s.chest;
  };

  // ---------------------------------------------------------------- QA

  stats(): Record<string, unknown> {
    const st = this.spine.state;
    const tr = (i: number) => {
      const e = st.getTrack(i);
      return e?.animation ? { name: e.animation.name, t: +e.getAnimationTime().toFixed(3), ts: +e.timeScale.toFixed(3), mixing: !!e.mixingFrom } : null;
    };
    return {
      base: this.base,
      current: this.current,
      t0: tr(0),
      t2: tr(2),
      look: { w: +this.lookW.toFixed(2), x: Math.round(this.lookX), y: Math.round(this.lookY), focus: this.focus },
      kick: { nod: +this.nod.x.toFixed(2), lean: +this.lean.x.toFixed(2) },
      density: this.ref.density,
      k: this.k,
      feet: { ...this.feet },
    };
  }

  destroy(): void {
    this.pending.length = 0;
    this.spine.state.removeListener(this.listener);
    this.spine.beforeUpdateWorldTransforms = () => undefined;
    this.spine.afterUpdateWorldTransforms = () => undefined;
    this.spine.state.clearTracks();
    // the atlas is released by the owner: never reuse this SkeletonData
    this.spine.unloadFromCache();
    this.view.destroy({ children: true });
  }
}
