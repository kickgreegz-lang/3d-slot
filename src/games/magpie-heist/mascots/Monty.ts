import { gsap } from 'gsap';
import { Assets, Container, Sprite, type Texture } from 'pixi.js';
import type { LayoutSpec } from '../../../config/layout';
import { clock } from '../../../core/clock';
import { s } from '../../../core/timing';
import { reducedMotion } from '../../../fx/motion';
import type { GameContext, GameModule } from '../../../game/context';
import type { MascotCue } from '../../../game/events';
import { glowTexture } from '../scene/textures';

const URL = './assets/magpie-heist/mascot/monty_static.webp';

/**
 * MONTY — the magpie burglar beside the reels (layout.mascots.left; none in compact). Until the 2D Spine
 * rig ships this is the cut-out of his approved three-quarter view with code-driven acting on the feet
 * pivot: breathing, a weight shift, a tail flick, and a reaction per mascot cue (hop on small wins,
 * a crouch-and-leap on big wins and triggers, a lean toward the board on anticipation / the star).
 */
export class Monty implements GameModule {
  private readonly root = new Container({ label: 'monty' });
  private readonly body = new Sprite({ anchor: { x: 0.5, y: 1 } });
  private readonly shadow = new Sprite({ anchor: 0.5, tint: 0x000000, alpha: 0.35 });
  private tex: Texture | null = null;
  private offs: Array<() => void> = [];
  private time = 0;
  private readonly pose = { x: 0, y: 0, sx: 1, sy: 1, rot: 0, lean: 0 };
  private act: gsap.core.Timeline | null = null;
  private k = 1;

  constructor(private readonly ctx: GameContext) {}

  async init(): Promise<void> {
    const { ctx } = this;
    this.shadow.texture = glowTexture();
    try {
      this.tex = await Assets.load<Texture>(URL);
      this.body.texture = this.tex;
    } catch {
      this.tex = null;
    }
    this.root.addChild(this.shadow, this.body);
    ctx.layers.mascots.addChild(this.root);
    this.offs.push(
      ctx.game.on('layout:change', ({ layout }) => this.layout(layout)),
      ctx.game.on('mascot:cue', ({ cue, intensity }) => this.cue(cue, intensity ?? 1)),
      clock.onUpdate((dt) => this.update(dt)),
    );
    this.layout(ctx.layout);
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.act?.kill();
    this.root.destroy({ children: true });
  }

  layout(L: LayoutSpec): void {
    const R = L.mascots?.left;
    this.root.visible = !!R && !!this.tex;
    if (!R || !this.tex) return;
    this.k = Math.min(R.w / this.tex.width, R.h / this.tex.height);
    this.root.position.set(R.x + R.w / 2, R.y + R.h);
    this.shadow.scale.set((this.tex.width * this.k * 0.9) / 256, (this.tex.width * this.k * 0.18) / 256);
  }

  private cue(cue: MascotCue, intensity: number): void {
    const p = this.pose;
    const tl = gsap.timeline();
    const i = Math.max(0.3, Math.min(1, intensity));
    switch (cue) {
      case 'reactSmall':
      case 'reactTumble':
        tl.to(p, { sy: 0.92, sx: 1.05, duration: s(90), ease: 'power2.out' })
          .to(p, { sy: 1.06, sx: 0.96, y: -26 * i, duration: s(180), ease: 'power2.out' })
          .to(p, { sy: 1, sx: 1, y: 0, duration: s(260), ease: 'bounce.out' });
        break;
      case 'winBig':
      case 'celebrate':
      case 'fsTrigger':
      case 'featureUpgrade':
      case 'fsEnd':
        tl.to(p, { sy: 0.84, sx: 1.1, duration: s(140), ease: 'power2.out' })
          .to(p, { sy: 1.1, sx: 0.92, y: -90 * i, rot: -0.12, duration: s(260), ease: 'power2.out' })
          .to(p, { rot: 0.1, duration: s(200), ease: 'sine.inOut' })
          .to(p, { sy: 0.9, sx: 1.08, y: 0, rot: 0, duration: s(240), ease: 'power2.in' })
          .to(p, { sy: 1, sx: 1, duration: s(320), ease: 'elastic.out(1, 0.4)' });
        break;
      case 'anticipation':
        tl.to(p, { lean: 0.09, duration: s(260), ease: 'sine.out' }).to(p, { lean: 0, duration: s(900), ease: 'sine.inOut' }, '+=0.8');
        break;
      case 'spinStart':
        tl.to(p, { sy: 0.96, duration: s(80) }).to(p, { sy: 1, duration: s(200), ease: 'back.out(3)' });
        break;
      default:
        return;
    }
    this.act?.kill();
    this.act = tl;
  }

  private update(dt: number): void {
    if (!this.root.visible || !this.tex) return;
    this.time += dt;
    const t = this.time;
    const calm = reducedMotion() ? 0.2 : 1;
    const p = this.pose;
    const breathe = 1 + Math.sin(t * 2.1) * 0.012 * calm;
    const sway = Math.sin(t * 0.9) * 0.018 * calm;
    this.body.scale.set(this.k * p.sx * (2 - breathe), this.k * p.sy * breathe);
    this.body.rotation = sway + p.rot + p.lean;
    this.body.position.set(p.x, p.y);
    this.shadow.alpha = 0.35 * (1 + p.y / 300);
  }
}
