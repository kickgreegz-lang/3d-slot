import { type Mesh, type Object3D, Quaternion, Vector3 } from 'three';
import type { ClipKey } from './MascotController';

/**
 * Procedural layers on top of the clips — what makes a canned glTF read as alive:
 *  - breathing      chest bone scale, rate/amplitude per state
 *  - look-at        neck+head turn toward a target (grid centre, winning cluster, player)
 *                   through damped springs, clamped to a natural range
 *  - lean           spine pitch toward the reels (anticipation, spin kick)
 *  - secondary      head bobble + tail/ear/jowl spring bones driven by body acceleration
 *  - squash         volume-preserving squash/stretch of the whole body (hops, flinches)
 *  - groove         DJ head-nod on the club beat / bouncer weight sway (idle only)
 *  - expressions    morph targets (blink, happy, surprised, sad, angry) per state + flashes
 *
 * Order per frame: restore() -> mixer.update() -> model.updateMatrixWorld() -> apply().
 * restore() puts every channel this layer touches back to its pre-offset value, so offsets
 * never accumulate on channels the current clip does not animate.
 */

export type Expr = 'blink' | 'happy' | 'surprised' | 'sad' | 'angry';

const EXPR_NAMES: Record<Expr, RegExp> = {
  blink: /blink|eyes?_?closed/i,
  happy: /happy|smile|joy/i,
  surprised: /surpris|wow|shock/i,
  sad: /sad|frown/i,
  angry: /angry|mad/i,
};

export interface RigBones {
  head: Object3D | null;
  neck: Object3D | null;
  chest: Object3D | null;
  spine: Object3D | null;
  hips: Object3D | null;
  springs: Object3D[];
}

const clean = (name: string): string =>
  name
    .toLowerCase()
    .replace(/^mixamorig[:_]?/, '')
    .replace(/_\d+$/, '');

/** Find the procedural bones by common naming conventions (Blender/Mixamo/Meshy/RobotExpressive). */
export const findBones = (model: Object3D): RigBones => {
  const all: Object3D[] = [];
  model.traverse((o) => {
    if ((o as Object3D & { isBone?: boolean }).isBone) all.push(o);
  });
  const find = (re: RegExp): Object3D | null => all.find((b) => re.test(clean(b.name))) ?? null;
  return {
    head: find(/^(head|head_?jnt)$/),
    neck: find(/^neck(_?0?1)?$/),
    chest: find(/^(upper_?chest|chest|spine_?0?2|torso)$/),
    spine: find(/^(spine|spine_?0?1|abdomen)$/),
    hips: find(/^(hips|pelvis)$/),
    springs: all.filter((b) => /(tail|ear|jowl|belly|antenna|chain)/.test(clean(b.name)) && !/end$/.test(clean(b.name))),
  };
};

/** Critically-ish damped spring, sub-stepped for stability at 30 fps. */
class Spring {
  x = 0;
  v = 0;
  constructor(
    private readonly k: number,
    private readonly zeta: number,
  ) {}

  step(target: number, dt: number): number {
    const c = 2 * this.zeta * Math.sqrt(this.k);
    let left = dt;
    while (left > 1e-6) {
      const h = Math.min(left, 1 / 120);
      this.v += (this.k * (target - this.x) - c * this.v) * h;
      this.x += this.v * h;
      left -= h;
    }
    if (!Number.isFinite(this.x) || !Number.isFinite(this.v)) {
      // never let a bad frame (NaN pose, zero dt) poison the rig
      this.x = 0;
      this.v = 0;
    }
    return this.x;
  }
}

/**
 * Two-axis lag of a bone driven by the (smoothed) acceleration of its position: the tip
 * swings opposite to the body's acceleration (inertia) and springs back. Axis A/B are the
 * body-space rotation axes; drive A/B the directions whose acceleration drives each.
 */
class Secondary {
  readonly a: Spring;
  readonly b: Spring;
  private readonly last = new Vector3();
  private readonly vel = new Vector3();
  private readonly acc = new Vector3();
  private primed = false;

  constructor(
    readonly bone: Object3D,
    private readonly gain: number,
    stiffness: number,
    damping: number,
    readonly axisA: Vector3,
    readonly axisB: Vector3,
    private readonly driveA: Vector3,
    private readonly driveB: Vector3,
  ) {
    this.a = new Spring(stiffness, damping);
    this.b = new Spring(stiffness, damping);
  }

  /** `pos` = bone position in body space, normalised by body height. `biasB` adds a wag. */
  step(pos: Vector3, dt: number, limit: number, biasB = 0): void {
    if (dt <= 0) return;
    if (!this.primed) {
      this.last.copy(pos);
      this.primed = true;
    }
    _p.copy(pos); // `pos` may alias the shared temps below
    _v.subVectors(_p, this.last).divideScalar(dt);
    this.last.copy(_p);
    const s = 1 - Math.exp(-dt * 25);
    this.acc.lerp(_v2.subVectors(_v, this.vel).divideScalar(dt), s);
    this.vel.lerp(_v, s);
    const clamp = (x: number) => Math.max(-limit, Math.min(limit, x));
    this.a.step(clamp(-this.acc.dot(this.driveA) * this.gain), dt);
    this.b.step(clamp(-this.acc.dot(this.driveB) * this.gain) + biasB, dt);
  }
}

interface MorphSlot {
  mesh: Mesh;
  index: number;
}

export interface ProceduralRig {
  /** yaw-only placement group: +z is the character's forward */
  placement: Object3D;
  /** build group (non-uniform scale, squash); bones' "body space" */
  build: Object3D;
  model: Object3D;
  bones: RigBones;
  /** standing height in world units (normalises accelerations) */
  height: number;
}

export interface Personality {
  /** DJ head-nod BPM in idle (0 = none) */
  groove: number;
  /** slow weight-shift sway amplitude (rad) in idle */
  sway: number;
  /** breathing period (s) */
  breath: number;
  /** blink interval range (s) */
  blink: [number, number];
}

/** Local tuning (animation feel, not gameplay pacing). */
const P = {
  lookYaw: 0.5,
  lookPitchUp: 0.4,
  lookPitchDown: 0.35,
  neckShare: 0.35,
  lookStiffness: 70,
  lookDamping: 0.75,
  breathAmp: 0.022,
  leanStiffness: 90,
  leanDamping: 0.55,
  squashStiffness: 220,
  squashDamping: 0.32,
  headGain: 0.018,
  springGain: 0.03,
  /** idle tail wag amplitude (rad) */
  wag: 0.16,
  exprRate: 12,
};

const LEAN: Partial<Record<ClipKey, number>> = { anticipation: 0.2, idle_bored: -0.08 };

const EXPRESSIONS: Partial<Record<ClipKey, Partial<Record<Expr, number>>>> = {
  anticipation: { surprised: 0.9 },
  react_small: { happy: 0.8 },
  win_big: { happy: 1, surprised: 0.3 },
  celebrate: { happy: 1 },
  fs_trigger: { happy: 1, surprised: 0.4 },
  fs_end: { happy: 0.6 },
  idle_bored: { sad: 0.55 },
};

const _q = new Quaternion();
const _q2 = new Quaternion();
const _pq = new Quaternion();
const _v = new Vector3();
const _v2 = new Vector3();
const _p = new Vector3();
const _head = new Vector3();
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

export class ProceduralLayers {
  /** look target in PLACEMENT space (set by the owner every frame or on events) */
  readonly lookTarget = new Vector3(0, 0, 10);
  /** 0..1 how much the head follows the target */
  lookWeight = 1;
  /** vertical lift of the hips above rest, in body heights (for the blob shadow) */
  lift = 0;

  private readonly rest = new Map<Object3D, { q: Quaternion; s: Vector3 }>();
  private readonly yaw = new Spring(P.lookStiffness, P.lookDamping);
  private readonly pitch = new Spring(P.lookStiffness, P.lookDamping);
  private readonly lean = new Spring(P.leanStiffness, P.leanDamping);
  private readonly squash = new Spring(P.squashStiffness, P.squashDamping);
  private readonly nod = new Spring(160, 0.3);
  private readonly head: Secondary | null;
  private readonly springs: Secondary[];
  private readonly morphs = new Map<Expr, MorphSlot[]>();
  private readonly morphSaved: number[] = [];
  private readonly morphSlots: MorphSlot[] = [];
  private readonly expr: Record<Expr, number> = { blink: 0, happy: 0, surprised: 0, sad: 0, angry: 0 };
  private readonly flash: Record<Expr, { w: number; left: number }> = {
    blink: { w: 0, left: 0 },
    happy: { w: 0, left: 0 },
    surprised: { w: 0, left: 0 },
    sad: { w: 0, left: 0 },
    angry: { w: 0, left: 0 },
  };
  private readonly baseScale = new Vector3(1, 1, 1);
  private hipsRestY = 0;
  private time = 0;
  private nextBlink: number;
  private kick = 0;
  private groove: number;

  constructor(
    private readonly rig: ProceduralRig,
    private readonly persona: Personality,
    private readonly rand: () => number,
  ) {
    const { bones } = rig;
    for (const b of [bones.head, bones.neck, bones.chest, bones.spine, ...bones.springs]) {
      if (b) this.rest.set(b, { q: b.quaternion.clone(), s: b.scale.clone() });
    }
    // head bobble: nods on vertical acceleration (A = pitch), rolls on lateral (B = roll)
    this.head = bones.head
      ? new Secondary(bones.head, P.headGain, 140, 0.35, X, Z, new Vector3(0, -1, 0), new Vector3(1, 0, 0))
      : null;
    this.springs = bones.springs.map((b, i) => this.makeSpring(b, P.springGain * (1 + i * 0.25)));
    rig.model.traverse((o) => {
      const mesh = o as Mesh;
      const dict = mesh.morphTargetDictionary;
      if (!mesh.isMesh || !dict || !mesh.morphTargetInfluences) return;
      for (const [name, index] of Object.entries(dict)) {
        for (const key of Object.keys(EXPR_NAMES) as Expr[]) {
          if (!EXPR_NAMES[key].test(name)) continue;
          const slot = { mesh, index };
          this.morphSlots.push(slot);
          const list = this.morphs.get(key) ?? [];
          list.push(slot);
          this.morphs.set(key, list);
        }
      }
    });
    this.baseScale.copy(rig.build.scale);
    this.groove = persona.groove;
    this.nextBlink = this.blinkGap();
  }

  /** Call once after the first mixer update so the hips rest height is the idle pose. */
  calibrate(): void {
    const hips = this.rig.bones.hips;
    if (hips) this.hipsRestY = this.bodyPos(hips, _v).y;
  }

  /** Set the build scale (heavyset vs lanky); squash multiplies on top. */
  setBuild(width: number, height: number): void {
    this.baseScale.set(width, height, width);
  }

  /** Change the idle groove tempo (BPM, 0 = none), e.g. hotter in free spins. */
  setGroove(bpm: number): void {
    this.groove = bpm;
  }

  /** Short-lived expression over the state expression (e.g. a sulk after a dead spin). */
  flashExpr(e: Expr, weight: number, seconds: number): void {
    this.flash[e] = { w: weight, left: seconds };
  }

  hop(power = 1): void {
    this.squash.v += 2.4 * power;
  }

  flinch(power = 1): void {
    this.squash.v -= 1.8 * power;
  }

  nodKick(power = 1): void {
    this.nod.v += 4 * power;
  }

  leanKick(amount: number): void {
    this.kick = Math.max(this.kick, amount);
  }

  /** Undo last frame's offsets on every channel this layer drives (before mixer.update). */
  restore(): void {
    for (const [bone, r] of this.rest) {
      bone.quaternion.copy(r.q);
      bone.scale.copy(r.s);
    }
    for (let i = 0; i < this.morphSlots.length; i++) {
      const s = this.morphSlots[i];
      const inf = s.mesh.morphTargetInfluences;
      if (inf && this.morphSaved[i] !== undefined) inf[s.index] = this.morphSaved[i];
    }
  }

  /** Apply all layers (after mixer.update + model.updateMatrixWorld). */
  apply(dt: number, state: ClipKey, stateTime: number): void {
    this.time += dt;
    const { bones, height } = this.rig;
    const idle = state === 'idle';

    // secondary motion inputs: body-space positions after the clip pose
    if (this.head && bones.head) this.head.step(this.bodyPos(bones.head, _v).divideScalar(height), dt, 0.3);
    for (let i = 0; i < this.springs.length; i++) {
      const s = this.springs[i];
      const wag = idle || state === 'idle_bored' ? P.wag * Math.sin(this.time * 1.7 - i * 0.7) : 0;
      s.step(this.bodyPos(s.bone, _v).divideScalar(height), dt, 0.5, wag);
    }
    if (bones.hips) this.lift = Math.max(0, (this.bodyPos(bones.hips, _v).y - this.hipsRestY) / height);

    // lean (spine pitch forward toward the reels)
    this.kick = Math.max(0, this.kick - dt * 0.9);
    const lean = this.lean.step((LEAN[state] ?? 0) + this.kick, dt);
    const sway = idle ? this.persona.sway * Math.sin((this.time * Math.PI * 2) / 5.5) : 0;
    if (bones.spine) {
      _q.setFromAxisAngle(X, lean);
      _q2.setFromAxisAngle(Z, sway);
      this.rotateInBody(bones.spine, _q.multiply(_q2));
    }

    // breathing (held while anticipating, quick while celebrating)
    const period = state === 'celebrate' || state === 'win_big' ? this.persona.breath * 0.5 : this.persona.breath;
    const amp = state === 'anticipation' ? 0.25 : state === 'idle_bored' ? 1.4 : 1;
    const breath = Math.sin((this.time * Math.PI * 2) / period) * P.breathAmp * amp;
    if (bones.chest) bones.chest.scale.multiply(_v.set(1 + breath, 1 + breath * 0.5, 1 + breath));

    // look-at: yaw/pitch toward the target in placement space, split across neck and head
    let yawT = 0;
    let pitchT = 0;
    if (bones.head) {
      bones.head.getWorldPosition(_head);
      this.rig.placement.worldToLocal(_head);
      _v.subVectors(this.lookTarget, _head);
      yawT = Math.max(-P.lookYaw, Math.min(P.lookYaw, Math.atan2(_v.x, _v.z))) * this.lookWeight;
      pitchT = Math.atan2(_v.y, Math.hypot(_v.x, _v.z)) * this.lookWeight;
      pitchT = Math.max(-P.lookPitchDown, Math.min(P.lookPitchUp, pitchT));
      if (state === 'idle_bored') pitchT -= 0.25;
    }
    const yaw = this.yaw.step(yawT, dt);
    const pitch = this.pitch.step(pitchT, dt);

    // groove: DJ nods on the beat (idle only); nod spring carries kicks from cues
    const beat = idle && this.groove > 0 ? (this.time * this.groove) / 60 : 0;
    const pulse = beat ? Math.max(0, Math.cos(beat * Math.PI * 2)) ** 3 : 0;
    const nod = this.nod.step(0, dt) + pulse * 0.09;
    const bob = this.head ? this.head.a.x : 0;
    const roll = this.head ? this.head.b.x : 0;

    if (bones.neck) {
      _q.setFromAxisAngle(Y, yaw * P.neckShare);
      _q2.setFromAxisAngle(X, -pitch * P.neckShare);
      this.rotateInBody(bones.neck, _q.multiply(_q2));
    }
    if (bones.head) {
      const share = bones.neck ? 1 - P.neckShare : 1;
      _q.setFromAxisAngle(Y, yaw * share);
      _q2.setFromAxisAngle(X, -pitch * share + nod + bob);
      _q.multiply(_q2);
      _q2.setFromAxisAngle(Z, roll);
      this.rotateInBody(bones.head, _q.multiply(_q2));
    }
    for (const s of this.springs) {
      _q.setFromAxisAngle(s.axisA, s.a.x);
      _q2.setFromAxisAngle(s.axisB, s.b.x);
      this.rotateInBody(s.bone, _q.multiply(_q2));
    }

    // squash & stretch (volume preserving) + groove bounce
    const sq = this.squash.step(0, dt) - pulse * 0.012;
    const sy = 1 + sq;
    const sxz = 1 / Math.sqrt(Math.max(0.2, sy));
    this.rig.build.scale.set(this.baseScale.x * sxz, this.baseScale.y * sy, this.baseScale.z * sxz);

    this.applyExpressions(dt, state, stateTime);
  }

  private applyExpressions(dt: number, state: ClipKey, stateTime: number): void {
    if (!this.morphSlots.length) return;
    const targets = EXPRESSIONS[state] ?? {};
    const hasHappy = this.morphs.has('happy');
    const k = 1 - Math.exp(-dt * P.exprRate);
    for (const e of Object.keys(this.expr) as Expr[]) {
      let t = targets[e] ?? 0;
      const f = this.flash[e];
      if (f.left > 0) {
        f.left -= dt;
        t = Math.max(t, f.w);
      }
      // rigs without a smile read "excited" through wide eyes instead
      if (e === 'surprised' && !hasHappy) t = Math.max(t, (targets.happy ?? 0) * 0.55);
      this.expr[e] += (t - this.expr[e]) * k;
    }
    // blinks (rigs with a blink shape only)
    if (this.morphs.has('blink')) {
      this.nextBlink -= dt;
      if (this.nextBlink <= 0 && stateTime > 0.2) {
        this.flash.blink = { w: 1, left: 0.07 };
        this.nextBlink = this.blinkGap();
      }
      this.expr.blink = this.flash.blink.left > 0 ? 1 : this.expr.blink * (1 - k);
    }
    for (let i = 0; i < this.morphSlots.length; i++) {
      const inf = this.morphSlots[i].mesh.morphTargetInfluences;
      if (inf) this.morphSaved[i] = inf[this.morphSlots[i].index];
    }
    for (const [e, slots] of this.morphs) {
      const w = this.expr[e];
      for (const s of slots) {
        const inf = s.mesh.morphTargetInfluences;
        if (inf) inf[s.index] = Math.min(1, inf[s.index] + w);
      }
    }
  }

  /** Swing axes from the bone's rest direction (towards its first child bone) in body space. */
  private makeSpring(bone: Object3D, gain: number): Secondary {
    const child = bone.children.find((c) => (c as Object3D & { isBone?: boolean }).isBone);
    const from = this.bodyPos(bone, new Vector3());
    const dir = child
      ? this.bodyPos(child, new Vector3()).sub(from)
      : this.bodyPos(bone.localToWorld(new Vector3(0, 1, 0)), new Vector3()).sub(from);
    if (dir.lengthSq() < 1e-10) dir.set(0, 1, 0);
    dir.normalize();
    const a = new Vector3().crossVectors(dir, Y);
    if (a.lengthSq() < 1e-6) a.copy(X);
    a.normalize();
    const b = new Vector3().crossVectors(a, dir).normalize();
    const driveA = new Vector3().crossVectors(a, dir);
    const driveB = new Vector3().crossVectors(b, dir);
    return new Secondary(bone, gain, 90, 0.25, a, b, driveA, driveB);
  }

  private blinkGap(): number {
    const [a, b] = this.persona.blink;
    return a + this.rand() * (b - a);
  }

  /** Position of `o` in body (build-parent = placement) space. */
  private bodyPos(o: Object3D | Vector3, out: Vector3): Vector3 {
    if (o instanceof Vector3) out.copy(o);
    else o.getWorldPosition(out);
    return this.rig.placement.worldToLocal(out);
  }

  /** Rotate a bone by `q` expressed in body space (the bone's parent chain up to the build group). */
  private rotateInBody(bone: Object3D, q: Quaternion): void {
    _pq.identity();
    for (let o = bone.parent; o && o !== this.rig.build; o = o.parent) _pq.premultiply(o.quaternion);
    // local' = P^-1 * q * P * local
    _q2.copy(_pq).invert().multiply(q).multiply(_pq);
    bone.quaternion.premultiply(_q2);
  }
}
