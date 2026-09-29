import { type Bone, Physics, type Slot, Spine, type TrackEntry } from '@esotericsoftware/spine-pixi-v8';
import { gsap } from 'gsap';
import { Container, Matrix, Sprite } from 'pixi.js';
import { followSpeed, speedScale } from '../../../core/timing';
import { glowTexture, godRaysTexture } from '../../../fx/textures';
import type { MeterMode } from '../events';
import type { RigRef } from '../stage/spineAssets';
import { BASS_DROP_TIMING, GOLD, PINK, TEAL } from '../timing';
import type { MeterArt } from './art';
import { Counter } from './Counter';
import { GEOM, METER_LOOK as LOOK, NOTCHES, type NotchDef, type NotchState, R_REF, type RigLayout } from './geometry';
import { LedArc } from './LedArc';
import type { GrooveRig, MeterLoop, NotchView } from './rig';

const M = BASS_DROP_TIMING.meter;
const FPS = 30;
/** skeleton units per rig unit: the rig is authored at 2x landscape (R 320 units), the code parts at R_REF 160 */
const U = 2;
/** `feature_trigger` pumps at f0 / f18 / f36 */
const PUMP_FRAMES = 18;
/** idle is 72 f = 4 beats at 100 BPM */
const IDLE_BEATS = 4;
const IDLE_BEAT_SEC = 18 / FPS;
/** mixes (s): into a new track-0 loop / back to the loop after a one-shot (boom ends on the idle pose) */
const LOOP_MIX = 0.2;
const RETURN_MIX = 0.1;
/** the rim glow never drops below the meter state's level (cold .. locked) x this */
const GLOW_FLOOR = 0.55;

const SKIN: Record<MeterMode, string> = { base: 'base', bonus: 'jukejam', super: 'megamix' };
/** trim colour -> `rim_trim` attachment (the three trims live in the default skin) */
const trimAttachment = (color: number): string =>
  color === GOLD ? 'trim_jukejam' : color === PINK ? 'trim_megamix' : 'trim_base';
/** notch badge attachment prefix of a notch (W gem with 1-3 pips, jukebox, crowned speaker) */
const notchKind = (d: NotchDef): string => (d.kind === 'w' ? `w${Math.min(3, Math.max(1, d.pips))}` : d.kind);

/** State looks of the code overlays on a notch badge (the Spine attachment carries the badge art). */
const NOTCH_LOOK: Record<NotchState, { glow: number; scale: number }> = {
  off: { glow: 0, scale: 1 },
  next: { glow: 0.18, scale: 1 },
  lit: { glow: 0.62, scale: 1.1 },
  spent: { glow: 0, scale: 1 },
};

interface Clip {
  entry: TrackEntry;
  /** animation seconds per game second when it started, at speed sp0 (a slam retimes it) */
  rate: number;
  sp0: number;
}

/**
 * One notch badge of the Spine rig: the `notch_N` slot shows `notch_<kind>_<state>` (the approved
 * badge art, no text), the runtime drives the `notch_N` bone scale (armed strobe, heat pulse, burst
 * punch) and an additive code glow over it (the rig has no per-notch glow slot). The burst itself is
 * the rig's `threshold_minor` / `threshold_major` on track 2 with `fx_notch` moved to this notch.
 */
class SpineNotch implements NotchView {
  state: NotchState = 'off';
  armed = false;
  solid = false;
  pulse = false;
  /** bone scale written every frame (beforeUpdateWorldTransforms) */
  scale = 1;
  readonly glow = new Sprite({ texture: glowTexture(128), anchor: 0.5, blendMode: 'add', alpha: 0 });
  private readonly punch = { s: 1, g: 0 };
  private bursting = false;
  private readonly kind: string;

  constructor(
    readonly index: number,
    readonly def: NotchDef,
    readonly bone: Bone,
    private readonly rig: MeterSpine,
  ) {
    this.kind = notchKind(def);
    this.glow.width = this.glow.height = R_REF * GEOM.notchR * 5 * U;
    this.glow.tint = def.color;
  }

  /** The badge attachment for the current state (armed = lit). */
  attach(): void {
    this.rig.setAttachment(`notch_${this.index + 1}`, `notch_${this.kind}_${this.armed ? 'lit' : this.state}`);
  }

  configure(st: NotchState, armed: boolean, solid: boolean, pulse: boolean): void {
    if (st === this.state && armed === this.armed && solid === this.solid && pulse === this.pulse) return;
    const reattach = st !== this.state || armed !== this.armed;
    this.state = st;
    this.armed = armed;
    this.solid = solid;
    this.pulse = pulse;
    if (reattach) this.attach();
  }

  burst(major: boolean, sec: number, color: number): void {
    gsap.killTweensOf(this.punch);
    this.bursting = true;
    const peak = major ? 1.4 : 1.25;
    this.glow.tint = color;
    this.punch.s = 1;
    this.punch.g = 1;
    const tl = gsap.timeline({ onComplete: () => void (this.bursting = false) });
    tl.to(this.punch, { s: peak, duration: sec * 0.12, ease: 'power2.out' }, 0)
      .to(this.punch, { s: NOTCH_LOOK.lit.scale, duration: sec * 0.5, ease: 'back.out(3)' }, sec * 0.12)
      .to(this.punch, { g: NOTCH_LOOK.lit.glow, duration: sec, ease: 'power2.out' }, 0);
    followSpeed(tl);
    this.rig.notchBurst(this, major, sec, color);
  }

  /** Per frame (before the world transforms): scale + glow of the strobe / pulse / burst. `t` game s. */
  update(t: number): void {
    const L = NOTCH_LOOK[this.state];
    let scale = L.scale;
    let glow = L.glow;
    let tint = this.def.color;
    if (this.bursting) {
      scale = this.punch.s;
      glow = this.punch.g;
      tint = this.glow.tint;
    } else if (this.armed) {
      // the crossed notch strobes gold at 2 Hz; solid while its drop charges
      const on = this.solid ? 1 : 0.5 + 0.5 * Math.cos(t * Math.PI * 2 * M.armedHz);
      scale = 1.06 + 0.06 * on;
      glow = 0.25 + 0.6 * on;
      tint = GOLD;
    } else if (this.pulse) {
      const on = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * M.heatHz);
      scale = 1 + 0.07 * on;
      glow += 0.35 * on;
    }
    this.scale = scale;
    this.glow.alpha = Math.min(1, glow);
    // pixi's tint setter allocates even for an unchanged value: write on change only
    if (this.glow.tint !== tint) this.glow.tint = tint;
  }

  /** After the world transforms: the glow sits on the badge. */
  place(): void {
    const p = this.bone.appliedPose;
    this.glow.position.set(p.worldX, p.worldY);
  }

  destroy(): void {
    gsap.killTweensOf(this.punch);
  }
}

/**
 * GROOVE METER — the `ui_groove_meter` Spine rig (ANIMATION_SET §3, tools/spine/examples/bass_drop),
 * conducted by the GrooveMeter module through the GrooveRig contract (the code rig MeterRig is the
 * fallback when the rig cannot load). Root = ring centre, authored at 2x landscape (R = 320 units):
 * the view scale is R / 320 in every design space.
 *
 *  - Skins: `base` / `jukejam` / `megamix` by mode; compact (no cabinet rect) = `bare`. The rim trim
 *    is an attachment of `rim_trim` picked from the state colour (teal / gold at 40 / pink at 60).
 *  - Mounts (live code, never baked): `led_arc` (the 60-tick LED arc, a Spine slot object under the
 *    cone), `fx_blast` (the speaker-blast star + the design-px mount of a launching wild,
 *    meter:blastSlot), `txt_count` (the counter follows the bone, i.e. rides the cone pump, and draws
 *    on winLayer), `chip_anchor` (the chip rides the cabinet squash: chipOffset()).
 *  - Notches: `notch_N` attachments `notch_<w1|w2|w3|jj|mm>_<off|next|lit|spent>`; `fx_notch` moves to
 *    the bursting notch; the strobe / pulse / punch drive the notch bones + an additive code glow.
 *  - Tracks: 0 idle / heat_loop / armed_loop / overdrive_loop / charge / charge_chained / boom /
 *    feature_trigger; 1 tick / pump / drain (additive); 2 threshold_minor / threshold_major. `idle` is
 *    phase-locked to the shared music beat (4 beats per loop at the stem's tempo); `charge`, `drain`
 *    and the bursts are stretched to the conductor's s()-scaled lengths; the other one-shots play at
 *    30 fps x speedScale(); a slam retimes every one-shot (like followSpeed). Events are garnish only
 *    and the conductor fires the gameplay beats itself, so none are listened to here.
 *  - `fx_glow` is tinted by state (trim colour, so the trigger pumps glow in the feature's colour;
 *    the rim-flash colour; the clip's own pink in overdrive) and never dims below the state's level.
 * Updated from the engine clock by the module (hit-stop freezes it); autoUpdate off.
 */
export class MeterSpine implements GrooveRig {
  readonly view = new Container({ label: 'ui_groove_meter' });
  readonly led: LedArc;
  readonly counter = new Counter();
  readonly notches: { readonly badges: readonly SpineNotch[] };
  readonly spine: Spine;
  private readonly ledMount = new Container({ label: 'led_arc' });
  private readonly ledInner = new Container();
  /** `fx_blast` slot object: the blast star (rig units) and the design-px mount */
  private readonly blastSlot = new Container({ label: 'fx_blast' });
  private readonly blastInner = new Container();
  private readonly blastMount = new Container({ label: 'fx_blast_mount' });
  private readonly blastStar = new Sprite({ texture: godRaysTexture(16, 512, 5), anchor: 0.5, blendMode: 'add', alpha: 0 });
  private readonly notchFx = new Container({ label: 'notch_fx' });
  /** follows the `txt_count` bone; the counter inside it is drawn by winLayer */
  private readonly countFollow = new Container({ label: 'txt_count' });
  private readonly countScale = new Container();
  private readonly mountM = new Matrix();
  private readonly rootM = new Matrix();
  private readonly boneM = new Matrix();
  private readonly txtBone: Bone;
  private readonly chipBone: Bone;
  private readonly cabinetBone: Bone;
  private readonly fxNotch: Bone;
  private readonly glowSlot: Slot;
  private readonly burstSlot: Slot;
  private readonly chipRest = { x: 0, y: 0 };
  private readonly clips: Array<Clip | null> = [null, null, null];
  private loopEntry: TrackEntry | null = null;
  private loop: MeterLoop = 'idle';
  private mode: MeterMode = 'base';
  private bare = false;
  private skinName = '';
  private trimColor = TEAL;
  private trimName = '';
  private glowLevel: number = LOOK.glow.cold;
  private readonly flash = { a: 0 };
  private flashColor = 0xffffff;
  private beats = 0;
  private t = 0;
  private unit = 0.5;

  constructor(
    readonly ref: RigRef,
    private readonly art: MeterArt,
    res: number,
  ) {
    this.spine = new Spine({ skeleton: ref.skeleton, atlas: ref.atlas, autoUpdate: false });
    this.spine.label = 'ui_groove_meter_spine';
    const sk = this.spine.skeleton;
    const bone = (name: string): Bone => {
      const b = sk.findBone(name);
      if (!b) throw new Error(`ui_groove_meter: bone ${name} missing`);
      return b;
    };
    const slot = (name: string): Slot => {
      const s = sk.findSlot(name);
      if (!s) throw new Error(`ui_groove_meter: slot ${name} missing`);
      return s;
    };
    this.txtBone = bone('txt_count');
    this.cabinetBone = bone('cabinet');
    this.chipBone = bone('chip_anchor');
    this.fxNotch = bone('fx_notch');
    this.glowSlot = slot('fx_glow');
    this.burstSlot = slot('fx_burst');
    this.notches = { badges: NOTCHES.map((d, i) => new SpineNotch(i, d, bone(`notch_${i + 1}`), this)) };
    for (const n of this.notches.badges) this.notchFx.addChild(n.glow);

    this.led = new LedArc(art.tick(res));
    this.ledInner.scale.set(U);
    this.ledInner.addChild(this.led.view);
    this.ledMount.addChild(this.ledInner);
    this.blastStar.width = this.blastStar.height = R_REF * 1.5;
    this.blastInner.scale.set(U);
    this.blastInner.addChild(this.blastStar);
    this.blastSlot.addChild(this.blastInner, this.blastMount);
    this.countScale.scale.set(U);
    this.countScale.addChild(this.counter.view);
    this.countFollow.addChild(this.countScale);
    this.view.addChild(this.spine, this.notchFx, this.countFollow);

    this.spine.addSlotObject('led_arc', this.ledMount);
    this.spine.addSlotObject('fx_blast', this.blastSlot);
    this.spine.beforeUpdateWorldTransforms = this.drive;
    this.spine.afterUpdateWorldTransforms = this.undrive;
    this.applySkin(true);
    sk.setupPose();
    sk.updateWorldTransform(Physics.none);
    this.chipRest.x = this.chipBone.appliedPose.worldX;
    this.chipRest.y = this.chipBone.appliedPose.worldY;
    this.startLoop(0);
    this.spine.update(0);
    this.afterUpdate();
  }

  get currentLoop(): MeterLoop {
    return this.loop;
  }

  // ---------------------------------------------------------------- look

  layout(g: RigLayout, res: number): void {
    this.led.setTexture(this.art.tick(res));
    this.view.position.set(g.cx, g.cy);
    this.unit = g.scale / U;
    this.view.scale.set(this.unit);
    this.counter.setFontSize(g.countFont);
    const bare = !g.cabinet;
    if (bare !== this.bare) {
      this.bare = bare;
      this.applySkin();
    }
  }

  setSkin(mode: MeterMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.applySkin();
  }

  /** Skin by mode (bare in compact); a skin change re-poses the slots, so the state attachments go back on. */
  private applySkin(force = false): void {
    const name = this.bare ? 'bare' : SKIN[this.mode];
    if (name === this.skinName && !force) return;
    this.skinName = name;
    const sk = this.spine.skeleton;
    sk.setSkin(name);
    sk.setupPoseSlots();
    this.trimName = '';
    this.applyTrim();
    for (const n of this.notches.badges) n.attach();
  }

  setAttachment(slot: string, name: string): void {
    this.spine.skeleton.setAttachment(slot, name);
  }

  setTrim(color: number): void {
    this.trimColor = color;
    this.applyTrim();
  }

  private applyTrim(): void {
    const name = trimAttachment(this.trimColor);
    if (name === this.trimName) return;
    this.trimName = name;
    this.setAttachment('rim_trim', name);
  }

  setGlowLevel(level: number): void {
    this.glowLevel = level;
    this.led.setGlowLevel(level);
  }

  play(loop: MeterLoop): void {
    if (loop === this.loop) return;
    this.loop = loop;
    if (this.loopEntry) this.startLoop(LOOP_MIX);
  }

  flashRim(color: number, sec: number): void {
    gsap.killTweensOf(this.flash);
    this.flashColor = color;
    this.flash.a = 1;
    followSpeed(gsap.to(this.flash, { a: 0, duration: sec, ease: 'power2.out' }));
  }

  // ---------------------------------------------------------------- tracks

  private startLoop(mix: number): void {
    const e = this.spine.state.setAnimation(0, this.loop, true);
    e.mixDuration = mix;
    this.loopEntry = e;
    this.clips[0] = null;
    this.rateLoop(e);
  }

  /** Loop timing: idle sits on the shared beat (phase-locked), the others run at their authored Hz. */
  private rateLoop(e: TrackEntry): void {
    if (e.animation?.name === 'idle') {
      e.timeScale = 0;
      const b = this.beats % IDLE_BEATS;
      e.trackTime = (b < 0 ? b + IDLE_BEATS : b) * IDLE_BEAT_SEC;
    } else e.timeScale = 1;
  }

  /** One-shot on `track`: authored length (x speed), or stretched to `sec` gameplay seconds. */
  private once(track: number, anim: string, sec: number | null, mix: number, additive = false): TrackEntry {
    const e = this.spine.state.setAnimation(track, anim, false);
    e.mixDuration = mix;
    e.additive = additive;
    const sp = speedScale();
    const rate = sec !== null && sec > 0 ? (e.animation?.duration ?? 0) / sec : sp;
    e.timeScale = rate;
    this.clips[track] = { entry: e, rate, sp0: sp };
    if (track === 0) this.loopEntry = null;
    return e;
  }

  tick(): void {
    this.once(1, 'tick', null, 0, true);
  }

  pump(scale: number = LOOK.pumpScale): void {
    // the authored pump is 1.08: bigger accents scale the additive delta
    this.once(1, 'pump', null, 0, true).alpha = Math.max(0.2, (scale - 1) / 0.08);
  }

  charge(sec: number, chained: boolean): void {
    this.once(0, chained ? 'charge_chained' : 'charge', sec, 0.06);
  }

  boom(): void {
    // charge ends on the boom's first pose: no mix
    this.once(0, 'boom', null, 0);
    this.blast(1);
  }

  featurePump(i: number): void {
    const cur = this.clips[0]?.entry;
    const e = cur && i > 0 && cur.animation?.name === 'feature_trigger' ? cur : this.once(0, 'feature_trigger', null, 0.05);
    // each pump re-syncs the clip to the conductor's beat grid (pumps at f0 / f18 / f36)
    e.trackTime = (Math.max(0, i) * PUMP_FRAMES) / FPS;
    if (i >= LOOK.triggerCone.length - 1) this.blast(1.3);
  }

  drain(sec: number): void {
    this.once(1, 'drain', Math.max(0.05, sec), 0, true);
    // whatever one-shot still runs relaxes into the loop over the drain
    if (!this.loopEntry) this.startLoop(Math.min(0.3, Math.max(0.05, sec)));
  }

  rest(): void {
    const st = this.spine.state;
    st.clearTracks();
    this.clips.fill(null);
    this.spine.skeleton.setupPose();
    this.applySkin(true);
    gsap.killTweensOf([this.flash, this.blastStar, this.blastStar.scale]);
    this.flash.a = 0;
    this.blastStar.alpha = 0;
    this.startLoop(0);
  }

  /** `fx_notch` to the bursting notch, `fx_burst` in the burst colour, the threshold clip on track 2. */
  notchBurst(n: SpineNotch, major: boolean, sec: number, color: number): void {
    const setup = n.bone.data.setupPose;
    const p = this.fxNotch.pose;
    p.x = setup.x;
    p.y = setup.y;
    const c = this.burstSlot.pose.color;
    c.r = ((color >> 16) & 255) / 255;
    c.g = ((color >> 8) & 255) / 255;
    c.b = (color & 255) / 255;
    this.once(2, major ? 'threshold_major' : 'threshold_minor', sec, 0);
  }

  /** Speaker-blast star in `fx_blast` (the unfunded `fx_speaker_blast` flipbook's live stand-in). */
  private blast(power: number): void {
    const b = this.blastStar;
    gsap.killTweensOf([b, b.scale]);
    const k = (R_REF * 1.5 * power) / b.texture.width;
    const f = (frames: number): number => (frames * 1000) / FPS / 1000 / speedScale();
    b.alpha = 0.85;
    b.rotation = 0;
    followSpeed(
      gsap
        .timeline()
        .fromTo(b.scale, { x: k * 0.2, y: k * 0.2 }, { x: k, y: k, duration: f(6), ease: 'power3.out' }, 0)
        .to(b, { rotation: 0.6, duration: f(16), ease: 'power1.out' }, 0)
        .to(b, { alpha: 0, duration: f(10), ease: 'power2.in' }, f(3)),
    );
  }

  // ---------------------------------------------------------------- fx_blast mount

  mountBlast(display: Container): void {
    if (display.destroyed) return;
    this.blastMount.addChild(display);
  }

  unmountBlast(display: Container): void {
    if (display.parent === this.blastMount) this.blastMount.removeChild(display);
  }

  /** mount = inverse(fx_blast world) x root world: the mounted display keeps root design px. */
  syncMount(root: Container): void {
    if (!this.blastMount.children.length) return;
    const m = this.blastSlot.getGlobalTransform(this.mountM, false).invert();
    m.append(root.getGlobalTransform(this.rootM, false));
    this.blastMount.setFromMatrix(m);
  }

  chipOffset(out: { x: number; y: number }): void {
    const p = this.chipBone.appliedPose;
    out.x = (p.worldX - this.chipRest.x) * this.unit;
    out.y = (p.worldY - this.chipRest.y) * this.unit;
  }

  // ---------------------------------------------------------------- per frame

  /**
   * beforeUpdateWorldTransforms: runtime channels (notch bones), the state tint of fx_glow, and the
   * cabinet squash axes. RIG DEFECT (ART_STATUS §7.3 follow-up): the `cabinet` bone points up
   * (rotation 90) and bdgen wrote the authored screen [sx, sy] keys into its bone-local scaleX /
   * scaleY, so every clip squashes the wrong axis (charge taller instead of sy 0.94, boom wider
   * instead of sy 1.08). The runtime swaps the two for the world transform and swaps them back
   * afterwards (the animation's own pose stays intact for the next frame's mixing). Remove when
   * the rig is rebuilt with the axes fixed.
   */
  private readonly drive = (): void => {
    const cab = this.cabinetBone.pose;
    const sx = cab.scaleX;
    cab.scaleX = cab.scaleY;
    cab.scaleY = sx;
    for (const n of this.notches.badges) {
      const p = n.bone.pose;
      p.scaleX = p.scaleY = n.scale;
    }
    const c = this.glowSlot.pose.color;
    const flash = this.flash.a;
    let a = Math.max(c.a, this.glowLevel * GLOW_FLOOR);
    if (flash > 0) a = Math.max(a, flash);
    c.a = Math.min(1, a);
    const name = this.clips[0]?.entry.animation?.name ?? this.loop;
    // overdrive keys its own pink; everything else glows in the state colour (the trigger pumps in
    // the feature's: gold at 40+, pink at 60+), or the rim-flash colour
    if (flash > 0.08 || name !== 'overdrive_loop') {
      const col = flash > 0.08 ? this.flashColor : this.trimColor;
      c.r = ((col >> 16) & 255) / 255;
      c.g = ((col >> 8) & 255) / 255;
      c.b = (col & 255) / 255;
    }
  };

  /** afterUpdateWorldTransforms: the cabinet's authored scale back in place (see drive). */
  private readonly undrive = (): void => {
    const cab = this.cabinetBone.pose;
    const sx = cab.scaleX;
    cab.scaleX = cab.scaleY;
    cab.scaleY = sx;
  };

  /** dt game seconds; `beats` = the shared music beat count (continuous). */
  update(dt: number, beats: number): void {
    this.t += dt;
    this.beats = beats;
    const t = this.t;
    for (const n of this.notches.badges) n.update(t);
    const sp = speedScale();
    for (let i = 0; i < this.clips.length; i++) {
      const c = this.clips[i];
      if (!c) continue;
      const e = c.entry;
      if (e.trackTime >= e.animationEnd) {
        this.clips[i] = null;
        if (i === 0) this.startLoop(RETURN_MIX);
        else this.spine.state.setEmptyAnimation(i, 0);
        continue;
      }
      e.timeScale = (c.rate * sp) / c.sp0;
    }
    if (this.loopEntry) this.rateLoop(this.loopEntry);
    this.spine.update(dt);
    this.afterUpdate();
    // LED glow shimmer (heat 1.9 Hz / armed / overdrive 1.25 Hz): the code-drawn arc
    let pulse = 1;
    if (this.loop === 'heat_loop') pulse = 0.8 + 0.35 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 * M.heatHz));
    else if (this.loop === 'armed_loop') pulse = 1.1;
    else if (this.loop === 'overdrive_loop') pulse = 0.85 + 0.4 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 * LOOK.overdriveHz));
    if (Math.abs(this.led.pulse - pulse) > 0.004) {
      this.led.pulse = pulse;
      this.led.refreshGlow();
    }
  }

  /** After the world transforms: the counter and the notch glows follow their bones. */
  private afterUpdate(): void {
    const p = this.txtBone.appliedPose;
    // the mapping Spine.updateSlotObject uses (y-down runtime)
    this.boneM.set(p.a, p.c, -p.b, -p.d, p.worldX, p.worldY);
    this.countFollow.setFromMatrix(this.boneM);
    for (const n of this.notches.badges) n.place();
  }

  destroy(): void {
    gsap.killTweensOf([this.flash, this.blastStar, this.blastStar.scale]);
    for (const n of this.notches.badges) n.destroy();
    // mounted displays belong to their owner: hand them back undestroyed
    this.blastMount.removeChildren();
    this.spine.removeSlotObjects();
    this.spine.beforeUpdateWorldTransforms = () => undefined;
    this.spine.afterUpdateWorldTransforms = () => undefined;
    this.spine.state.clearTracks();
    // the atlas is unloaded by the owner: never reuse this SkeletonData
    this.spine.unloadFromCache();
    this.led.destroy();
    this.counter.destroy();
    this.ledMount.destroy({ children: true });
    this.blastSlot.destroy({ children: true });
    this.view.destroy({ children: true });
  }
}
