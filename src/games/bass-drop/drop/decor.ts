import { gsap } from 'gsap';
import { BitmapText, Container, Sprite } from 'pixi.js';
import { followSpeed, s, sUi } from '../../../core/timing';
import { label } from '../../../present/common/text';
import { BASS_DROP_TIMING, multTier } from '../timing';
import { type DropArt, MULT_FONT, PLATE_SIZE } from './art';
import { clipMs, DROP_LOOK as LOOK, W_CLIPS } from './look';

/**
 * The drop's board decorations, one class per visual so the Spine W rig can replace each
 * later (ANIMATION_SET §2.6: slots `badge` / `txt_mult`, `clamp_L` / `clamp_R`; §8: the home
 * marker and the reticle are code-drawn for good). Methods are named after the rig clips they
 * stand in for. Decorations live in the symbol view's `decor` holder (design px, origin at the
 * cell centre at rest, board:decorate) or on the drop's own layers; they are pooled by the
 * owner and never destroyed while the game runs.
 *
 * All motion is GSAP on the game clock, s()-scaled (they are gameplay beats), except the t5
 * flame flicker and the sticky heartbeat, which are ambient.
 */
const REF = LOOK.ref;

type BadgeClip = 'slam' | 'appear' | 'mult_up' | 'maxed';

/** Multiplier badge: tier plate (shape + colour per tier), t5 flame crown, live "×N". */
export class MultBadge extends Container {
  /** ambient sticky heartbeat level (the module's loop drives beat.scale) */
  readonly beat = new Container({ label: 'badgeBeat' });
  /** clip motion (slam, punch, squash) */
  readonly pose = new Container({ label: 'badgePose' });
  private readonly plate = new Sprite({ anchor: 0.5 });
  private readonly flame = new Sprite({ anchor: { x: 0.5, y: 1 } });
  private readonly shine: Sprite;
  private readonly text: BitmapText;
  private flicker: gsap.core.Tween | null = null;
  private anim: gsap.core.Timeline | null = null;
  value = 0;
  tier = 0;
  /** owner token of the pool (null = free once detached) */
  owner: object | null = null;

  constructor(private readonly art: DropArt) {
    super({ label: 'multBadge' });
    this.zIndex = LOOK.badgeZ;
    this.shine = new Sprite({ texture: art.tex.glow, anchor: 0.5, blendMode: 'add', visible: false });
    this.text = new BitmapText({
      text: '',
      style: { fontFamily: MULT_FONT, fontSize: (LOOK.badgeCap * REF) / LOOK.capRatio },
      anchor: 0.5,
    });
    this.flame.texture = art.tex.flame;
    this.flame.visible = false;
    this.pose.addChild(this.flame, this.plate, this.text, this.shine);
    this.beat.addChild(this.pose);
    this.addChild(this.beat);
  }

  /** Size to a cell (design px); on a symbol the plate hangs at the bottom centre. */
  fit(cell: number, onCell = true): void {
    this.scale.set(cell / REF);
    this.position.set(0, onCell ? LOOK.badgeY * cell : 0);
  }

  /** Value + tier look (plate shape / colour, flame at t5). */
  setValue(mult: number): void {
    this.value = mult;
    const tier = multTier(mult).tier;
    this.text.text = label('bd.drop.mult', '×{n}', { n: mult });
    const w = PLATE_SIZE[tier].w * PLATE_SIZE[tier].inner;
    this.text.scale.set(1);
    const tw = this.text.width;
    this.text.scale.set(tw > w ? w / tw : 1);
    this.text.position.set(0, 1.5);
    if (tier === this.tier) return;
    this.tier = tier;
    this.plate.texture = this.art.tex.plates[tier];
    const top = -PLATE_SIZE[tier].h / 2;
    this.flame.position.set(0, top + 16);
    this.flame.visible = tier === 5;
    this.flicker?.kill();
    this.flicker = null;
    this.flame.scale.set(1);
    if (tier === 5) {
      this.flicker = gsap.to(this.flame.scale, { y: 1.1, x: 0.96, duration: sUi(170), ease: 'sine.inOut', yoyo: true, repeat: -1 });
    }
  }

  /** Clip stand-ins. `onSwap` fires on mult_up's `mult_swap` frame (f4), after the value swap. */
  play(clip: BadgeClip, next?: number, onSwap?: () => void): Promise<void> {
    this.anim?.kill();
    const p = this.pose;
    const tl = followSpeed(gsap.timeline());
    this.anim = tl;
    this.alpha = 1;
    this.shine.visible = false;
    if (clip === 'slam') {
      // drops in from 2.2 to 1.0 in multSlam (back.out(3)), alpha in over the first frames
      tl.fromTo(p.scale, { x: 2.2, y: 2.2 }, { x: 1, y: 1, duration: s(180), ease: 'back.out(3)' }, 0);
      tl.fromTo(p, { alpha: 0 }, { alpha: 1, duration: s(40), ease: 'power1.out' }, 0);
    } else if (clip === 'appear') {
      tl.fromTo(p.scale, { x: 0, y: 0 }, { x: 1, y: 1, duration: s(clipMs(W_CLIPS.appear)), ease: 'back.out(2)' }, 0);
      tl.set(p, { alpha: 1 }, 0);
    } else if (clip === 'mult_up') {
      // squash sy 0.85 f0-f3, swap f4, punch 1.35 at f5, settle by f12
      const f = (n: number): number => s(clipMs(n));
      tl.set(p, { alpha: 1 }, 0);
      tl.to(p.scale, { x: 1.1, y: 0.85, duration: f(3), ease: 'power2.in' }, 0);
      tl.call(
        () => {
          if (next !== undefined) this.setValue(next);
          onSwap?.();
        },
        undefined,
        f(W_CLIPS.mult_swap),
      );
      tl.to(p.scale, { x: 1.35, y: 1.35, duration: f(1), ease: 'power2.out' }, f(W_CLIPS.mult_swap));
      tl.to(p.scale, { x: 1, y: 1, duration: f(W_CLIPS.mult_up - 5), ease: 'back.out(2.5)' }, f(5));
    } else {
      // maxed shimmer (cap x25): a hot sweep across the plate + a small punch, no number change
      const hw = (PLATE_SIZE[this.tier || 5].w / 2) * 0.9;
      const sh = this.shine;
      sh.visible = true;
      sh.tint = 0xfff0a0;
      sh.width = 30;
      sh.height = 70;
      tl.set(p, { alpha: 1 }, 0);
      tl.fromTo(sh, { x: -hw, alpha: 0 }, { x: hw, duration: s(400), ease: 'power1.inOut' }, 0);
      tl.to(sh, { alpha: 0.9, duration: s(120), ease: 'power1.out' }, 0);
      tl.to(sh, { alpha: 0, duration: s(160), ease: 'power1.in' }, s(240));
      tl.fromTo(p.scale, { x: 1.14, y: 1.14 }, { x: 1, y: 1, duration: s(300), ease: 'back.out(2.5)' }, 0);
      tl.call(() => void (sh.visible = false));
    }
    return new Promise((resolve) => {
      tl.eventCallback('onComplete', () => resolve());
      tl.eventCallback('onInterrupt', () => resolve());
    });
  }

  /** The running clip (for followSpeed registration by the owner). */
  get clip(): gsap.core.Timeline | null {
    return this.anim;
  }

  /** Back to rest: no clip, full size, visible (called when taken from / returned to the pool). */
  rest(): void {
    this.anim?.kill();
    this.anim = null;
    this.pose.scale.set(1);
    this.pose.alpha = 1;
    this.beat.scale.set(1);
    this.alpha = 1;
    this.rotation = 0;
    this.shine.visible = false;
  }

  override destroy(): void {
    this.anim?.kill();
    this.flicker?.kill();
    super.destroy({ children: true });
  }
}

type ClampClip = 'sticky_lock' | 'sticky_unlock' | 'release';

/** Sticky clamps (clamp_L / clamp_R): gold C-jaws gripping the tooth from both sides. */
export class StickyClamps extends Container {
  private readonly left: Sprite;
  private readonly right: Sprite;
  private readonly flash: Sprite;
  private anim: gsap.core.Timeline | null = null;
  owner: object | null = null;

  constructor(art: DropArt) {
    super({ label: 'stickyClamps' });
    this.zIndex = LOOK.clampZ;
    this.left = new Sprite({ texture: art.tex.clamp, anchor: { x: 1 / 3, y: 25 / 52 } });
    this.right = new Sprite({ texture: art.tex.clamp, anchor: { x: 1 / 3, y: 25 / 52 } });
    this.right.scale.x = -1;
    this.flash = new Sprite({ texture: art.tex.glow, anchor: 0.5, blendMode: 'add', tint: 0xffd54a, visible: false });
    this.addChild(this.flash, this.left, this.right);
  }

  fit(cell: number): void {
    this.scale.set(cell / REF);
  }

  /** Closed at rest (resume / held views). */
  lockNow(): void {
    this.anim?.kill();
    this.anim = null;
    this.place(LOOK.clampX, 0, 1);
    this.flash.visible = false;
  }

  /**
   * sticky_lock (12 f): the jaws slide in from +-clampFrom f0-f6 and snap (`lock_snap`, the
   * onSnap callback), overshoot 6 units f7, settle f10; glow flash f6-f10.
   * sticky_unlock (9 f): spring open and slide out, fading. release: the explode's f0-f2 open.
   */
  play(clip: ClampClip, onSnap?: () => void): Promise<void> {
    this.anim?.kill();
    const f = (n: number): number => s(clipMs(n));
    const st: { x: number; open: number; alpha: number } = { x: LOOK.clampX, open: 0, alpha: 1 };
    const apply = (): void => this.place(st.x, st.open, st.alpha);
    const tl = followSpeed(gsap.timeline({ onUpdate: apply }));
    this.anim = tl;
    this.flash.visible = false;
    if (clip === 'sticky_lock') {
      st.x = LOOK.clampFrom;
      st.open = 0.5;
      st.alpha = 0;
      apply();
      tl.to(st, { alpha: 1, duration: f(2), ease: 'none' }, 0);
      tl.to(st, { x: LOOK.clampX, open: 0, duration: f(W_CLIPS.lock_snap), ease: 'power3.in' }, 0);
      tl.call(
        () => {
          this.flash.visible = true;
          onSnap?.();
        },
        undefined,
        f(W_CLIPS.lock_snap),
      );
      tl.to(st, { x: LOOK.clampX - 0.06, duration: f(1), ease: 'power2.out' }, f(W_CLIPS.lock_snap));
      tl.to(st, { x: LOOK.clampX, duration: f(3), ease: 'back.out(3)' }, f(7));
      tl.fromTo(this.flash, { alpha: 0.9 }, { alpha: 0, duration: f(4), ease: 'power1.in' }, f(W_CLIPS.lock_snap));
      tl.call(() => void (this.flash.visible = false), undefined, f(W_CLIPS.sticky_lock));
    } else if (clip === 'sticky_unlock') {
      tl.to(st, { open: 1, duration: f(3), ease: 'back.out(2)' }, 0);
      tl.to(st, { x: LOOK.clampFrom, alpha: 0, duration: f(W_CLIPS.sticky_unlock - 3), ease: 'power2.in' }, f(3));
    } else {
      tl.to(st, { open: 0.8, x: LOOK.clampX + 0.08, duration: f(2), ease: 'power2.out' }, 0);
    }
    return new Promise((resolve) => {
      tl.eventCallback('onComplete', () => resolve());
      tl.eventCallback('onInterrupt', () => resolve());
    });
  }

  get clip(): gsap.core.Timeline | null {
    return this.anim;
  }

  rest(): void {
    this.lockNow();
    this.alpha = 1;
  }

  /** x = jaw distance from the centre (x cell), open = jaw rotation 0..1 (springing out). */
  private place(x: number, open: number, alpha: number): void {
    const y = LOOK.clampY * REF;
    this.left.position.set(-x * REF, y);
    this.right.position.set(x * REF, y);
    this.left.rotation = -open * 0.55;
    this.right.rotation = open * 0.55;
    this.left.alpha = alpha;
    this.right.alpha = alpha;
  }

  override destroy(): void {
    this.anim?.kill();
    super.destroy({ children: true });
  }
}

/** Mega Mix home marker on the tile layer: gold rim + corner brackets, for the whole feature. */
export class HomeMarker extends Container {
  private readonly art: Sprite;
  private fade: gsap.core.Tween | null = null;
  reel = 0;
  row = 0;
  owner: object | null = null;

  constructor(art: DropArt) {
    super({ label: 'homeMarker' });
    this.art = new Sprite({ texture: art.tex.marker, anchor: 0.5 });
    this.addChild(this.art);
    this.visible = false;
  }

  fit(x: number, y: number, cell: number): void {
    this.position.set(x, y);
    this.scale.set(cell / REF);
  }

  /** Fade in (ms, s()-scaled; 0 = at once). */
  show(ms: number): void {
    this.fade?.kill();
    this.visible = true;
    if (ms <= 0) {
      this.alpha = 1;
      return;
    }
    this.alpha = 0;
    this.fade = followSpeed(gsap.to(this, { alpha: 1, duration: s(ms), ease: 'power1.out' }));
  }

  hide(ms: number, done?: () => void): void {
    this.fade?.kill();
    if (ms <= 0 || !this.visible) {
      this.visible = false;
      done?.();
      return;
    }
    this.fade = followSpeed(
      gsap.to(this, {
        alpha: 0,
        duration: s(ms),
        ease: 'power1.in',
        onComplete: () => {
          this.visible = false;
          done?.();
        },
      }),
    );
  }

  override destroy(): void {
    this.fade?.kill();
    super.destroy({ children: true });
  }
}

/** Target reticle + landing shadow on a drop target (ANIMATION_SET §8). */
export class Reticle extends Container {
  readonly ring: Sprite;
  readonly shadow: Sprite;
  private anim: gsap.core.Timeline | null = null;
  /** shadow growth 0..1 (flight progress past shadowFrom) */
  private grow = 0;
  private shown = 0;
  busy = false;
  /** the target cell (layout changes re-place it) */
  reel = 0;
  row = 0;

  constructor(art: DropArt) {
    super({ label: 'reticle' });
    this.shadow = new Sprite({ texture: art.tex.shadow, anchor: 0.5 });
    this.ring = new Sprite({ texture: art.tex.reticle, anchor: 0.5 });
    this.addChild(this.shadow, this.ring);
    this.visible = false;
  }

  /** Appear on a cell (ring pops in, the shadow starts small at 20%). */
  show(x: number, y: number, cell: number): void {
    this.anim?.kill();
    this.busy = true;
    this.visible = true;
    this.position.set(x, y);
    this.scale.set(cell / REF);
    this.grow = 0;
    this.ring.rotation = 0;
    this.ring.alpha = 0;
    const st = { t: 0 };
    this.anim = followSpeed(gsap.timeline()).to(st, {
      t: 1,
      duration: s(LOOK.reticleIn),
      ease: 'back.out(2.2)',
      onUpdate: () => {
        this.shown = st.t;
        this.ring.alpha = Math.min(1, st.t * 1.4);
        this.ring.scale.set(0.6 + 0.4 * st.t);
        this.applyShadow();
      },
    });
  }

  /** Landing shadow growth from the flight: 0 at shadowFrom of the path, 1 at contact. */
  setGrow(g: number): void {
    this.grow = g;
    this.applyShadow();
  }

  /** Re-place on a layout change (cell centre + size). */
  fit(x: number, y: number, cell: number): void {
    this.position.set(x, y);
    this.scale.set(cell / REF);
  }

  /** Contact: the ring snaps shut and fades, the shadow vanishes under the wild. */
  hit(done: () => void): void {
    this.anim?.kill();
    this.shadow.alpha = 0;
    const st = { t: 0 };
    this.anim = followSpeed(gsap.timeline({ onComplete: () => this.free(done) })).to(st, {
      t: 1,
      duration: s(LOOK.reticleOut),
      ease: 'power2.out',
      onUpdate: () => {
        this.ring.scale.set(1 + 0.3 * st.t);
        this.ring.alpha = 1 - st.t;
      },
    });
  }

  /** Spin (90 deg/s, game time). */
  spin(dt: number, degPerSec: number): void {
    this.ring.rotation += (dt * degPerSec * Math.PI) / 180;
  }

  get clip(): gsap.core.Timeline | null {
    return this.anim;
  }

  free(done?: () => void): void {
    this.anim?.kill();
    this.anim = null;
    this.visible = false;
    this.busy = false;
    done?.();
  }

  private applyShadow(): void {
    const g = this.grow;
    const sc = LOOK.shadowStart + (1 - LOOK.shadowStart) * g;
    const a = LOOK.shadowReticleAlpha + (BASS_DROP_TIMING.drop.shadowAlpha - LOOK.shadowReticleAlpha) * g;
    const d = (LOOK.shadowD * REF) / this.shadow.texture.width;
    this.shadow.scale.set(d * sc);
    this.shadow.alpha = a * this.shown;
  }

  override destroy(): void {
    this.anim?.kill();
    super.destroy({ children: true });
  }
}
