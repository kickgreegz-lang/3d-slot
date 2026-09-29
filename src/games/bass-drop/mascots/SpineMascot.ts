import {
  AABBRectangleBoundsProvider,
  type AnimationStateListener,
  AttachmentTimeline,
  type Bone,
  Spine,
  type TrackEntry,
} from '@esotericsoftware/spine-pixi-v8';
import { Container, Graphics } from 'pixi.js';
import type { Pt } from '../../../config/layout';
import { isTurbo, speedScale, TIMING } from '../../../core/timing';
import type { SfxId } from '../../../game/events';
import { makeRng } from '../../../mascots/characters';
import { grooveBeat } from '../stage/beat';
import type { MascotRigRef } from './assets';
import { type BodyClip, LOOP_CLIPS, type LoopClip, MASCOT_TUNING as T, type MascotDef, type OverlayClip } from './defs';

const FPS = 30;
/** one beat of the 100 BPM authoring grid (18 f) */
const BEAT_SEC = 18 / FPS;

/** A look target: a design-space point, or the player (the camera). */
export type LookTarget = Pt | 'player';

interface OneShot {
  name: BodyClip;
  entry: TrackEntry;
  /** animation seconds per game second when it started, at speed sp0 (a slam retimes it) */
  rate: number;
  sp0: number;
  /** clip queued with mix 0 behind this one (bass_drop_charge -> bass_drop) */
  next: BodyClip | null;
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
    const w = 2 * Math.PI * T.kick.hz;
    this.v += amount * w * 1.35;
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
 * ONE 2D SPINE MASCOT (chr_gumbo / chr_croak, ANIMATION_SET §5): the MascotCue state machine of
 * the 3D MascotController on a spine-pixi-v8 rig.
 *  - Track 0 body: loops (idle / idle_bored / anticipation / meter_heat / celebrate) and one-shots
 *    that return to the current loop with the TIMING.mascot crossfade (0.25 s, 0.15 s turbo)
 *    started before the clip ends (every one-shot ends on idle's first pose). Croak's
 *    bass_drop_charge is timescaled to the charge and hands over to bass_drop with mix 0.
 *    Loops authored on the 100 BPM grid (Croak's idle, both celebrates) are phase-locked to the
 *    room's music beat (stage/beat.ts); the others free-run from a seeded phase.
 *  - Track 1: additive overlays (wild_land_react, Croak's pouch_pump), no mix-in.
 *  - Track 2: runtime blink every blinkMin..blinkMax s (seeded), never across an authored eye swap.
 *  - Track 3 (runtime): `ctrl_look` aimed at a design-space point (head +5° per 100 units, clamped
 *    by the rig's `look` constraint; pupils through `look_eyes`) and procedural nod / lean kicks
 *    on the head / chest, applied in beforeUpdateWorldTransforms and undone after, so the
 *    animation's own pose stays intact for mixing.
 *  - The rig's `sfx` events (cooler_slam, button_slam, mic_drop, dj_scratch) go to `onSfx`.
 *  - Croak's additive `fx_note` slot carries a code-drawn music note (celebrate puffs).
 * Game clock only: update(dt) with the hit-stop-aware game delta; one-shots run at speedScale()
 * (retimed live on a slam), loops at 1x (the music never speeds up). autoUpdate off.
 */
export class SpineMascot {
  readonly view: Container;
  readonly spine: Spine;
  /** foley from the rig's sfx events (the owner broadcasts it) */
  onSfx: ((id: SfxId) => void) | null = null;
  /** design px per skeleton unit */
  k = 0.5;
  readonly feet: Pt = { x: 0, y: 0 };
  base: LoopClip = 'idle';

  private readonly rand: () => number;
  private readonly names: Set<string>;
  private oneShot: OneShot | null = null;
  private loop: TrackEntry | null = null;
  private loopName: LoopClip | null = null;
  private overlay: TrackEntry | null = null;
  private time = 0;
  private idleTime = 0;
  private readonly boredAfter: number;
  private blinkIn: number;
  private lastOneShot: { name: string; at: number } = { name: '', at: -1 };
  private pending: { left: number; run: () => void }[] = [];
  private acc = 0;
  private firstIdle = true;
  // look-at + kicks
  private readonly ctrlLook: Bone;
  private readonly head: Bone;
  private readonly chest: Bone;
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
  private readonly note: Graphics | null = null;
  private readonly listener: AnimationStateListener;
  /** skeleton updates per second (0 = every frame): the low tier steps at 30 Hz */
  stepHz = 0;

  constructor(
    readonly def: MascotDef,
    readonly ref: MascotRigRef,
  ) {
    this.view = new Container({ label: `mascot_${def.id}` });
    const [cw, ch] = def.canvas;
    this.spine = new Spine({
      skeleton: ref.skeleton,
      atlas: ref.atlas,
      autoUpdate: false,
      // fixed bounds (the 2x canvas, feet at the origin): nothing ever measures the mesh per frame
      boundsProvider: new AABBRectangleBoundsProvider(-cw / 2, -ch, cw, ch),
    });
    this.spine.label = `chr_${def.id}`;
    this.view.addChild(this.spine);
    this.rand = makeRng(def.seed);
    const sk = this.spine.skeleton;
    this.names = new Set(sk.data.animations.map((a) => a.name));
    const ctrl = sk.findBone('ctrl_look');
    const head = sk.findBone('head');
    const chest = sk.findBone('chest');
    const eye = sk.findSlot('eye_L');
    if (!ctrl || !head || !chest || !eye) throw new Error(`chr_${def.id}: rig parts missing`);
    this.ctrlLook = ctrl;
    this.head = head;
    this.chest = chest;
    this.eyeSlot = eye.data.index;
    this.lookSetup = { x: ctrl.data.setupPose.x, y: ctrl.data.setupPose.y };
    this.boredAfter = T.boredAfter + this.rand() * T.boredJitter;
    this.blinkIn = T.blinkMin + this.rand() * (T.blinkMax - T.blinkMin);

    if (def.fxSlot && sk.findSlot(def.fxSlot)) {
      // the note rides the fx bone (keyed translate / scale by celebrate) and the slot alpha
      const holder = new Container();
      const note = drawNote();
      note.visible = false;
      holder.addChild(note);
      this.spine.addSlotObject(def.fxSlot, holder);
      this.note = note;
    }

    this.listener = {
      event: (_entry, ev) => {
        if (ev.data.name !== 'sfx') return;
        const id = (ev.stringValue || ev.data.setupPose.stringValue) as SfxId;
        if ((def.sfx as readonly string[]).includes(id)) this.onSfx?.(id);
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

  // =================================================================== cues

  has(name: string): boolean {
    return this.names.has(name);
  }

  /** Run `fn` after `sec` game seconds (react delays; hit-stop aware, cleared by release()). */
  later(sec: number, fn: () => void): void {
    if (sec <= 0) fn();
    else this.pending.push({ left: sec, run: fn });
  }

  /**
   * Play a body clip. Loops become the new base; a one-shot plays once and returns to the base.
   * rate = animation s per game s now (default speedScale()); from = start offset (s);
   * next = a clip queued with mix 0 behind it.
   */
  play(name: BodyClip, o: { rate?: number; from?: number; mix?: number; next?: BodyClip } = {}): void {
    if (!this.has(name)) return;
    if (LOOP_CLIPS.has(name)) {
      this.setBase(name as LoopClip);
      return;
    }
    if (this.lastOneShot.name === name && this.time - this.lastOneShot.at < T.dedupe) return;
    this.lastOneShot = { name, at: this.time };
    const st = this.spine.state;
    const sp = speedScale();
    const e = st.setAnimation(0, name, false);
    e.mixDuration = o.mix ?? this.fade();
    const rate = o.rate ?? sp;
    e.timeScale = rate;
    if (o.from) e.trackTime = Math.min(o.from, e.animationEnd);
    let next: BodyClip | null = null;
    if (o.next && this.has(o.next)) {
      const q = st.addAnimation(0, o.next, false, 0);
      q.mixDuration = 0;
      q.timeScale = sp;
      next = o.next;
    }
    this.oneShot = { name, entry: e, rate, sp0: sp, next };
    this.loop = null;
    this.loopName = null;
    this.idleTime = 0;
  }

  /** Name of the track-0 clip shown now (a one-shot, else the loop). */
  get current(): BodyClip {
    return this.oneShot?.name ?? this.loopName ?? this.base;
  }

  /** Animation time (s) of the running one-shot, -1 on a loop. */
  get clipTime(): number {
    return this.oneShot ? this.oneShot.entry.trackTime : -1;
  }

  /** Retime the running one-shot to normal playback from now (e.g. after the boom). */
  normalRate(): void {
    const os = this.oneShot;
    if (!os) return;
    os.rate = speedScale();
    os.sp0 = speedScale();
  }

  /** Track-1 additive overlay (no mix-in; the overlay starts and ends on zero deltas). */
  overlayClip(name: OverlayClip): void {
    if (!this.has(name)) return;
    const st = this.spine.state;
    const e = st.setAnimation(1, name, false);
    e.additive = true;
    e.mixDuration = 0;
    e.timeScale = speedScale();
    st.addEmptyAnimation(1, 0, 0);
    this.overlay = e;
  }

  setBase(name: LoopClip): void {
    if (!this.has(name)) name = 'idle';
    this.base = name;
    if (name !== 'idle_bored') this.idleTime = 0;
    if (this.oneShot) return; // the running one-shot returns to the new base when done
    if (this.loopName === name) return;
    this.enterBase(this.fade());
  }

  /** Drop a held loop (heat / celebrate / bored) back to idle. */
  release(): void {
    this.idleTime = 0;
    if (this.base !== 'idle') this.setBase('idle');
  }

  /** Any activity resets the boredom timer (and wakes a bored mascot). */
  poke(): void {
    this.idleTime = 0;
    if (this.base === 'idle_bored') this.setBase('idle');
  }

  /** Drop every queued (react-delayed) cue. */
  clearPending(): void {
    this.pending.length = 0;
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
    const ov = this.overlay;
    if (ov) {
      if (ov.trackTime >= ov.animationEnd) this.overlay = null;
      else ov.timeScale = speedScale();
    }
    if (this.note) {
      const cur = this.spine.state.getTrack(0);
      this.note.visible = cur?.animation?.name === 'celebrate' && !cur.mixingFrom;
    }
    if (this.stepHz > 0) {
      this.acc += dt;
      if (this.acc < 1 / this.stepHz - 1e-4) return;
      dt = this.acc;
      this.acc = 0;
    }
    this.spine.update(dt);
  }

  private advanceBody(dt: number): void {
    const st = this.spine.state;
    const os = this.oneShot;
    if (os) {
      const cur = st.getTrack(0);
      if (os.next && cur && cur !== os.entry && cur.animation?.name === os.next) {
        // the queued clip took over (mix 0): it plays at normal speed
        this.oneShot = { name: os.next, entry: cur, rate: speedScale(), sp0: speedScale(), next: null };
        return;
      }
      const e = os.entry;
      e.timeScale = (os.rate * speedScale()) / os.sp0;
      if (!os.next) {
        const left = (e.animationEnd - e.trackTime) / Math.max(1e-4, e.timeScale);
        if (left <= this.fade()) this.enterBase(this.fade());
      }
      return;
    }
    if (this.base === 'idle') {
      this.idleTime += dt;
      if (this.idleTime > this.boredAfter) this.setBase('idle_bored');
    }
    const lp = this.loop;
    const beats = this.loopName ? this.def.beatLoops[this.loopName] : undefined;
    if (lp && beats) {
      // phase-locked to the music beat (hit-stops freeze it; the tempo follows the feature stem)
      const b = grooveBeat.beats % beats;
      lp.trackTime = (b < 0 ? b + beats : b) * BEAT_SEC;
    }
  }

  private enterBase(mix: number): void {
    const st = this.spine.state;
    const name = this.base;
    const e = st.setAnimation(0, name, true);
    e.mixDuration = mix;
    if (this.def.beatLoops[name]) e.timeScale = 0;
    else {
      e.timeScale = 1;
      if (name === 'idle' && this.firstIdle) e.trackTime = this.def.idlePhase * e.animationEnd;
    }
    if (name === 'idle') this.firstIdle = false;
    this.loop = e;
    this.loopName = name;
    this.oneShot = null;
  }

  /** Crossfade length (game s): TIMING.mascot 0.25 s, 0.15 s in turbo. */
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

  /** Eyes open on track 0 and no authored eye swap within blinkGuard (never over an overlay). */
  private canBlink(): boolean {
    if (!this.has('blink') || this.overlay) return false;
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
    // celebrating: at the player unless a cue aims somewhere else
    const f = this.focus ?? (this.base === 'celebrate' && !this.oneShot ? 'player' : null);
    this.lookW += ((f ? 1 : 0) - this.lookW) * (1 - Math.exp(-dt * L.blend));
    if (!f) return;
    let ox: number;
    let oy: number;
    if (f === 'player') {
      // toward the camera: pupils turn back from the facing direction, head level
      ox = -0.55 * this.def.facing * L.pupilReach;
      oy = 30;
    } else {
      // skeleton units, y up, from the head
      const hp = this.head.appliedPose;
      const hx = hp.worldX;
      const hy = -hp.worldY;
      const tx = (f.x - this.feet.x) / this.k;
      const ty = (this.feet.y - f.y) / this.k;
      const dx = tx - hx;
      const dy = ty - hy;
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
    const f = this.def.facing;
    const hp = this.head.pose;
    const cp = this.chest.pose;
    s.head = hp.rotation;
    s.chest = cp.rotation;
    // facing-normalised: a nod down / a lean toward the reels are clockwise for a right-facing rig
    hp.rotation -= this.nod.x * f;
    cp.rotation -= this.lean.x * f;
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

  /** DEV / QA snapshot of the tracks and the look. */
  stats(): Record<string, unknown> {
    const st = this.spine.state;
    const tr = (i: number) => {
      const e = st.getTrack(i);
      return e?.animation ? { name: e.animation.name, t: +e.getAnimationTime().toFixed(3), ts: +e.timeScale.toFixed(3), mixing: !!e.mixingFrom } : null;
    };
    return {
      id: this.def.id,
      base: this.base,
      current: this.current,
      t0: tr(0),
      t1: tr(1),
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

/** Croak's celebrate puff: a code-drawn eighth note (additive; the slot keys alpha / scale). */
const drawNote = (): Graphics => {
  const g = new Graphics();
  const ink = 0x1a0b24;
  const col = 0xff6fc0;
  // flag, stem, head (skeleton units, ~60 tall; the slot object frame is y-down and upright)
  g.moveTo(8, -52)
    .bezierCurveTo(26, -44, 34, -30, 24, -12)
    .bezierCurveTo(28, -28, 20, -36, 8, -38)
    .closePath()
    .fill(col)
    .stroke({ width: 4, color: ink, join: 'round' });
  g.rect(3, -54, 7, 50).fill(col).stroke({ width: 4, color: ink });
  g.ellipse(-4, 0, 14, 10).fill(col).stroke({ width: 4, color: ink });
  g.ellipse(-8, -3, 5, 3).fill({ color: 0xffffff, alpha: 0.7 });
  g.scale.set(1.35);
  g.blendMode = 'add';
  return g;
};
