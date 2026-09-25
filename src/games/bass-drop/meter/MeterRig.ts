import { gsap } from 'gsap';
import { Container, Sprite } from 'pixi.js';
import { followSpeed, s } from '../../../core/timing';
import { glowTexture, godRaysTexture } from '../../../fx/textures';
import { BASS_DROP_TIMING, TEAL } from '../timing';
import type { MeterArt, MeterTextures } from './art';
import { Counter } from './Counter';
import { GEOM, METER_LOOK as LOOK, R_REF, type RigLayout } from './geometry';
import { LedArc } from './LedArc';
import { Notches } from './Notches';

const M = BASS_DROP_TIMING.meter;
const FPS = 30;
/** authored frames (30 fps) -> gameplay seconds */
const f = (frames: number): number => s((frames * 1000) / FPS);

export type MeterLoop = 'idle' | 'heat_loop' | 'armed_loop' | 'overdrive_loop';

/**
 * UI_GROOVE_METER placeholder rig: the upper speaker cabinet with the woofer gauge, drawn
 * in code until the Spine rig of ANIMATION_SET §3 lands. The class mirrors that rig so the
 * swap is local: the containers are its slots (`cabinet`, `ring`, `led_arc`, `cone`,
 * `txt_count`, `notch_1..6`, `fx_swirl`, `fx_glow`, `fx_blast`), the loops are its track-0
 * loops (`idle`, `heat_loop`, `armed_loop`, `overdrive_loop`) and the methods are its clips
 * (`tick`, `pump`, `charge`, `charge_chained`, `boom`, `feature_trigger` pumps, `drain`).
 * The GrooveMeter module conducts it; nothing here reads game state.
 *
 * Poses compose multiplicatively: cone scale = clip pose x overlay (tick / pump) x loop
 * (beat breath, heat flutter), so a boom never fights the idle breathing.
 */
export class MeterRig {
  readonly view = new Container({ label: 'ui_groove_meter' });
  readonly led: LedArc;
  readonly counter = new Counter();
  readonly notches: Notches;
  /** `fx_blast`: above the cone and the swirl, below txt_count and the notches */
  readonly blastSlot = new Container({ label: 'fx_blast' });
  private readonly cabinet = new Container({ label: 'cabinet' });
  private readonly cabSprite = new Sprite();
  private readonly cabTrim = new Sprite();
  private readonly ring = new Container({ label: 'ring' });
  private readonly rim = new Sprite({ anchor: 0.5, label: 'rim' });
  private readonly trim = new Sprite({ anchor: 0.5, label: 'rim_trim' });
  private readonly coneRoot = new Container({ label: 'cone' });
  private readonly cone = new Sprite({ anchor: 0.5 });
  private readonly cap = new Sprite({ anchor: 0.5 });
  private readonly capFlash = new Sprite({ texture: glowTexture(128), anchor: 0.5, blendMode: 'add', alpha: 0 });
  private readonly swirl: Sprite;
  private readonly glow: Sprite;
  private readonly blastStar = new Sprite({ texture: godRaysTexture(16, 512, 5), anchor: 0.5, blendMode: 'add', alpha: 0 });

  /** clip pose (track 0 one-shots): cone scale, cabinet sy, swirl, glow flash, cap flash */
  private readonly pose = { cone: 1, cab: 1, swirlA: 0, swirlSpin: 0, glow: 0, cap: 0 };
  /** overlay pose (track 1: tick / pump): cone scale and dust-cap flash */
  private readonly shot = { cone: 1, cap: 0 };
  private poseTl: gsap.core.Timeline | null = null;
  private shotTl: gsap.core.Timeline | null = null;
  /** rim ring flash (threshold bursts): alpha + colour */
  private readonly rimFlash = { a: 0 };
  private rimFlashColor = 0xffffff;
  private trimColor = TEAL;
  private loop: MeterLoop = 'idle';
  private hasCabinet = true;
  /** state glow of the rim / LED arc (cold .. locked) */
  private glowLevel: number = LOOK.glow.cold;
  private t = 0;
  private beat = 0;

  constructor(art: MeterArt, tex: MeterTextures) {
    const icons = art.icons;
    this.led = new LedArc(tex.tick);
    this.notches = new Notches(tex.notchPlate, tex.notchRing, (d) => art.notchIcon(d.kind, d.pips));
    this.swirl = new Sprite({ texture: icons.swirl, anchor: 0.5, blendMode: 'add', alpha: 0, tint: TEAL, label: 'fx_swirl' });
    this.swirl.width = this.swirl.height = R_REF * 1.34;
    this.glow = new Sprite({ texture: icons.glowRing, anchor: 0.5, blendMode: 'add', alpha: 0, label: 'fx_glow' });
    this.glow.width = this.glow.height = (R_REF * 2.05) / 0.82;
    this.capFlash.width = this.capFlash.height = R_REF * GEOM.counterR * 2.6;
    this.blastStar.width = this.blastStar.height = R_REF * 1.5;
    this.coneRoot.addChild(this.cone, this.cap);
    this.blastSlot.addChild(this.blastStar);
    this.ring.addChild(
      this.glow,
      this.rim,
      this.trim,
      this.led.view,
      this.coneRoot,
      this.capFlash,
      this.swirl,
      this.blastSlot,
      this.counter.view,
      this.notches.view,
    );
    this.cabinet.addChild(this.cabSprite, this.cabTrim, this.ring);
    this.view.addChild(this.cabinet);
    this.setTextures(tex);
  }

  private setTextures(tex: MeterTextures): void {
    this.hasCabinet = !!tex.cabinet;
    this.cabSprite.visible = this.cabTrim.visible = this.hasCabinet;
    if (tex.cabinet) this.cabSprite.texture = tex.cabinet;
    if (tex.cabinetTrim) this.cabTrim.texture = tex.cabinetTrim;
    this.cabSprite.position.set(tex.cabinetAt.x, tex.cabinetAt.y);
    this.cabTrim.position.set(tex.cabinetAt.x, tex.cabinetAt.y);
    this.rim.texture = tex.rim;
    this.trim.texture = tex.trim;
    this.cone.texture = tex.cone;
    this.cap.texture = tex.cap;
    this.led.setTexture(tex.tick);
    this.notches.setTextures(tex.notchPlate, tex.notchRing);
  }

  /** Place the rig for a design space (ring centre, scale, cabinet pivot at its bottom centre). */
  layout(rig: RigLayout, tex: MeterTextures): void {
    this.setTextures(tex);
    this.view.position.set(rig.cx, rig.cy);
    this.view.scale.set(rig.scale);
    const c = rig.cabinet;
    const pivotY = c ? c.y + c.h : 0;
    this.cabinet.pivot.set(0, pivotY);
    this.cabinet.position.set(0, pivotY);
    this.counter.setFontSize(rig.countFont);
  }

  /** Skin trim (base teal / jukejam gold / megamix pink; also the locked 40 / 60 trims). */
  setTrim(color: number): void {
    this.trimColor = color;
    this.trim.tint = color;
    this.cabTrim.tint = color;
  }

  setGlowLevel(level: number): void {
    this.glowLevel = level;
    this.led.setGlowLevel(level);
  }

  /** Track-0 loop (the runtime picks it from the meter state). */
  play(loop: MeterLoop): void {
    this.loop = loop;
  }

  get currentLoop(): MeterLoop {
    return this.loop;
  }

  // ---------------------------------------------------------------- overlays (track 1)

  /** Ring flash around the rim (threshold bursts: `fx_glow` flash in the notch colour). */
  flashRim(color: number, sec: number): void {
    gsap.killTweensOf(this.rimFlash);
    this.rimFlashColor = color;
    this.rimFlash.a = 1;
    followSpeed(gsap.to(this.rimFlash, { a: 0, duration: sec, ease: 'power2.out' }));
  }

  private overlay(peak: number, frames: number, flash: number): void {
    this.shotTl?.kill();
    const up = Math.max(1, Math.round(frames / 3));
    this.shotTl = followSpeed(
      gsap
        .timeline()
        .to(this.shot, { cone: peak, duration: f(up), ease: 'power2.out' })
        .to(this.shot, { cone: 1, duration: f(frames - up), ease: 'power2.inOut' }),
    );
    if (flash > 0) {
      this.shotTl.fromTo(this.shot, { cap: Math.max(this.shot.cap, flash) }, { cap: 0, duration: f(frames + 2), ease: 'power2.out' }, 0);
    }
  }

  /** `tick` (4 f): an orb arrived: cone 1.00 -> 1.03 -> 1.00, dust-cap flash. */
  tick(): void {
    this.overlay(LOOK.tickScale, LOOK.tickFrames, LOOK.capFlash);
  }

  /** `pump` (6 f): big-win tier punch / accents: cone 1.08. */
  pump(scale: number = LOOK.pumpScale): void {
    this.overlay(scale, LOOK.pumpFrames, 0.5);
  }

  // ---------------------------------------------------------------- clips (track 0)

  private clip(build: (tl: gsap.core.Timeline) => void): gsap.core.Timeline {
    this.poseTl?.kill();
    const tl = gsap.timeline();
    build(tl);
    this.poseTl = followSpeed(tl);
    return tl;
  }

  /**
   * `charge` (15 f) / `charge_chained` (6 f), stretched to `sec`: the cone pulls back to 0.88,
   * the cabinet squashes to sy 0.94, the swirl spins up to 720°/s, the glow ramps up. The
   * last frame is the boom's first pose.
   */
  charge(sec: number, chained: boolean): void {
    const p = this.pose;
    this.clip((tl) => {
      tl.to(p, { cone: LOOK.coneCharge, cab: LOOK.cabSquash, duration: sec, ease: 'power2.in' }, 0)
        .to(p, { swirlA: 0.9, swirlSpin: LOOK.swirlSpin, duration: chained ? sec * 0.5 : sec, ease: 'power1.in' }, 0)
        .to(p, { glow: 0.55, duration: sec, ease: 'power1.in' }, 0);
    });
  }

  /**
   * `boom` (18 f): cone 1.20 at f1, 0.96 f5, 1.04 f8, 1.00 f14; cabinet sy 1.08 at f1 settling by
   * f12; glow + cap flash; the speaker blast star in `fx_blast`; the swirl spins down.
   */
  boom(): void {
    const p = this.pose;
    this.clip((tl) => {
      let at = 0;
      for (const [frame, v] of LOOK.boomCone) {
        tl.to(p, { cone: v, duration: f(frame) - at, ease: frame === 1 ? 'power4.out' : 'sine.inOut' }, at);
        at = f(frame);
      }
      at = 0;
      for (const [frame, v] of LOOK.boomCab) {
        tl.to(p, { cab: v, duration: f(frame) - at, ease: frame === 1 ? 'power4.out' : 'sine.inOut' }, at);
        at = f(frame);
      }
      tl.fromTo(p, { glow: 1, cap: 1 }, { glow: 0, cap: 0, duration: f(12), ease: 'power2.out' }, 0)
        .to(p, { swirlA: 0, swirlSpin: 0, duration: f(14), ease: 'power2.out' }, 0);
    });
    this.blast(1);
  }

  /** Speaker-blast star in `fx_blast` (the `fx_speaker_blast` flipbook stands in here). */
  private blast(power: number): void {
    const b = this.blastStar;
    gsap.killTweensOf([b, b.scale]);
    const k = (R_REF * 1.5 * power) / b.texture.width;
    b.alpha = 0.85;
    b.rotation = 0;
    b.tint = 0xffffff;
    followSpeed(
      gsap
        .timeline()
        .fromTo(b.scale, { x: k * 0.2, y: k * 0.2 }, { x: k, y: k, duration: f(6), ease: 'power3.out' }, 0)
        .to(b, { rotation: 0.6, duration: f(16), ease: 'power1.out' }, 0)
        .to(b, { alpha: 0, duration: f(10), ease: 'power2.in' }, f(3)),
    );
  }

  /**
   * One `feature_trigger` pump (54 f total, pumps at f0 / f18 / f36): cone 1.12 / 1.16 / 1.30,
   * the big one also stretches the cabinet (1.12) and fires the blast.
   */
  featurePump(i: number): void {
    const p = this.pose;
    const peak = LOOK.triggerCone[Math.min(i, LOOK.triggerCone.length - 1)];
    const big = i >= LOOK.triggerCone.length - 1;
    this.clip((tl) => {
      tl.to(p, { cone: peak, duration: f(2), ease: 'power4.out' }, 0)
        .to(p, { cone: 1, duration: f(10), ease: 'back.out(2)' }, f(2))
        .fromTo(p, { glow: big ? 1 : 0.6 }, { glow: big ? 0.35 : 0, duration: f(12), ease: 'power2.out' }, 0);
      if (big) {
        tl.to(p, { cab: LOOK.triggerCab, duration: f(2), ease: 'power4.out' }, 0).to(p, { cab: 1, duration: f(12), ease: 'back.out(2)' }, f(2));
      }
    });
    if (big) this.blast(1.3);
  }

  /** `drain` (track 1, 12 f): cone relax + glow fade (the LEDs drain in code over the same time). */
  drain(sec: number): void {
    const p = this.pose;
    this.clip((tl) => {
      tl.to(p, { cone: 1, cab: 1, swirlA: 0, swirlSpin: 0, glow: 0, cap: 0, duration: Math.max(0.05, sec), ease: 'power2.out' });
    });
  }

  /** Snap every clip pose back to rest (resume, board:set). */
  rest(): void {
    this.poseTl?.kill();
    this.shotTl?.kill();
    this.poseTl = this.shotTl = null;
    Object.assign(this.pose, { cone: 1, cab: 1, swirlA: 0, swirlSpin: 0, glow: 0, cap: 0 });
    this.shot.cone = 1;
    this.shot.cap = 0;
  }

  // ---------------------------------------------------------------- per frame

  /** dt game seconds; beatMs = beat period of the current music stem. */
  update(dt: number, beatMs: number): void {
    this.t += dt;
    this.beat = (this.beat + (dt * 1000) / beatMs) % 1;
    const t = this.t;
    const env = (1 - this.beat) ** 3;
    let loopCone = 1 + (LOOK.breathScale - 1) * env;
    let pulse = 1;
    let swirlA = 0;
    let spin = 0;
    let vx = 0;
    let vy = 0;
    switch (this.loop) {
      case 'heat_loop':
        loopCone += 0.012 * Math.sin(t * Math.PI * 2 * M.heatHz * 4);
        pulse = 0.8 + 0.35 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 * M.heatHz));
        break;
      case 'armed_loop':
        vx = LOOK.armedVibrate * Math.sin(t * Math.PI * 2 * 23);
        vy = LOOK.armedVibrate * Math.cos(t * Math.PI * 2 * 19);
        swirlA = 0.32;
        spin = 110;
        pulse = 1.1;
        break;
      case 'overdrive_loop':
        loopCone = 1 + (LOOK.heatFlutter - 1) * env;
        pulse = 0.85 + 0.4 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 * LOOK.overdriveHz));
        swirlA = 0.18;
        spin = 60;
        break;
      default:
        break;
    }
    const p = this.pose;
    const cone = p.cone * this.shot.cone * loopCone;
    this.coneRoot.scale.set(cone);
    this.coneRoot.position.set(vx, vy);
    this.cabinet.scale.set(1 + (1 - p.cab) * 0.5, p.cab);
    this.swirl.alpha = Math.max(p.swirlA, swirlA);
    this.swirl.rotation += (((p.swirlSpin + spin) * Math.PI) / 180) * dt;
    const flash = this.rimFlash.a;
    this.glow.alpha = Math.min(1, Math.max(this.glowLevel * 0.55 * pulse + p.glow * 0.6, flash));
    this.glow.tint = flash > 0.08 ? this.rimFlashColor : this.trimColor;
    this.capFlash.alpha = Math.min(1, Math.max(this.shot.cap, p.cap * 0.8));
    if (Math.abs(this.led.pulse - pulse) > 0.004) {
      this.led.pulse = pulse;
      this.led.refreshGlow();
    }
    this.notches.update(t, M.armedHz, M.heatHz);
  }

  destroy(): void {
    this.poseTl?.kill();
    this.shotTl?.kill();
    gsap.killTweensOf([this.blastStar, this.blastStar.scale, this.rimFlash]);
    this.led.destroy();
    this.notches.destroy();
    this.counter.destroy();
    this.view.destroy({ children: true });
  }
}
