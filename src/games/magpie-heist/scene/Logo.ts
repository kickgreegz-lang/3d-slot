import { gsap } from 'gsap';
import { Assets, Container, Sprite, type Texture } from 'pixi.js';
import type { LayoutSpec } from '../../../config/layout';
import { clock } from '../../../core/clock';
import { sUi } from '../../../core/timing';
import { reducedMotion } from '../../../fx/motion';
import type { GameContext, GameModule } from '../../../game/context';
import { label } from '../../../present/common/text';
import { Title } from '../../../present/common/Title';
import { GOLD, MOON, style } from '../screens/look';
import { glowTexture } from './textures';

/**
 * LOGO — the live word-mark "MAGPIE / HEIST" (i18n mh.logo.top / mh.logo.main; the bundled title face
 * through the engine glyph baker: moonlight silver over polished gold) with the Bandit Mask crest
 * riding on top (the W art). No letters are baked into generated art: the typographer's word-mark
 * replaces the baked type once it exists. Owns its container in ctx.layers.logo.
 *  - lock-up: two lines in landscape / tablet / portrait, one line in compact;
 *  - life: the crest bobs and tilts, a shine sweeps the letters every few seconds, the gold
 *    letters run a slow travelling wave.
 */
export class Logo implements GameModule {
  private readonly root = new Container({ label: 'mhLogo' });
  private readonly crest = new Sprite({ anchor: 0.5 });
  private readonly halo = new Sprite({ anchor: 0.5, blendMode: 'add', tint: 0xffe7a0, alpha: 0.35 });
  private title: Title | null = null;
  private offs: Array<() => void> = [];
  private sweep: gsap.core.Tween | null = null;
  private time = 0;
  private crestY = 0;
  private crestK = 1;

  constructor(private readonly ctx: GameContext) {}

  async init(): Promise<void> {
    const { ctx } = this;
    this.halo.texture = glowTexture();
    // the plain Bandit Mask crest (no WILD text); the W board art until it ships
    try {
      this.crest.texture = await Assets.load<Texture>('./assets/magpie-heist/ui/logo_crest.webp');
    } catch {
      this.crest.texture = ctx.art.symbol('W');
    }
    this.root.addChild(this.halo, this.crest);
    ctx.layers.logo.addChild(this.root);
    this.offs.push(
      ctx.game.on('layout:change', ({ layout }) => this.layout(layout)),
      clock.onUpdate((dt) => this.update(dt)),
    );
    this.layout(ctx.layout);
    const loop = (): void => {
      this.sweep = gsap.delayedCall(6, () => {
        if (!reducedMotion()) void this.title?.sweep(sUi(900));
        loop();
      });
    };
    loop();
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.sweep?.kill();
    this.root.destroy({ children: true });
  }

  layout(L: LayoutSpec): void {
    const R = L.logo;
    this.title?.destroy();
    const res = Math.min(2, Math.max(1, this.ctx.app.renderer.resolution * this.ctx.scale));
    const top = label('mh.logo.top', 'MAGPIE');
    const main = label('mh.logo.main', 'HEIST');
    const compact = R.w / R.h > 4;
    if (compact) {
      this.title = new Title([{ text: `${top} ${main}`, style: style(Math.round(R.h * 0.9), GOLD, 0.08) }], res, { maxWidth: R.w });
      this.title.position.set(R.x + R.w / 2, R.y + R.h / 2);
      this.crest.visible = this.halo.visible = false;
    } else {
      const wide = R.w / R.h > 2.4;
      const mainSize = Math.round(R.h * (wide ? 0.56 : 0.42));
      const topSize = Math.round(mainSize * 0.56);
      this.title = new Title(
        [
          { text: top, style: style(topSize, MOON, 0.08, 0.06) },
          { text: main, style: style(mainSize, GOLD, 0.07, 0.03) },
        ],
        res,
        { maxWidth: R.w * (wide ? 0.62 : 0.94), lineGap: 1.02 },
      );
      this.crest.visible = this.halo.visible = true;
      if (wide) {
        // portrait band: crest left of the word-mark
        this.crestK = (R.h * 0.95) / Math.max(this.crest.texture.width, this.crest.texture.height);
        this.crest.position.set(R.x + R.h * 0.55, R.y + R.h / 2);
        this.title.position.set(R.x + R.h * 1.1 + (R.w - R.h * 1.1) / 2, R.y + R.h * 0.52);
      } else {
        this.crestK = (R.h * 0.5) / Math.max(this.crest.texture.width, this.crest.texture.height) * 1.6;
        this.crest.position.set(R.x + R.w / 2, R.y + R.h * 0.24);
        this.title.position.set(R.x + R.w / 2, R.y + R.h * 0.66);
      }
      this.crestY = this.crest.y;
      this.crest.scale.set(this.crestK);
      this.halo.position.copyFrom(this.crest.position);
      this.halo.scale.set((this.crestK * this.crest.texture.width * 1.1) / 256);
    }
    this.title.waveAmp = 2.5;
    this.root.addChild(this.title);
  }

  private update(dt: number): void {
    this.time += dt;
    const calm = reducedMotion() ? 0 : 1;
    this.title?.tick(dt * calm);
    if (this.crest.visible) {
      this.crest.y = this.crestY + Math.sin(this.time * 1.6) * 3 * calm;
      this.crest.rotation = Math.sin(this.time * 1.1) * 0.05 * calm;
      this.halo.alpha = 0.25 + 0.12 * Math.sin(this.time * 2.1) * calm;
    }
  }
}
