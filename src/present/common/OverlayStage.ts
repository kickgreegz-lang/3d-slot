import { gsap } from 'gsap';
import { Container, RenderLayer, Sprite, Texture } from 'pixi.js';
import type { LayoutSpec } from '../../config/layout';
import type { GameContext } from '../../game/context';
import { releaseGlyphCache } from './glyphs';
import { placementFor } from './placement';

let openStages = 0;

/**
 * Low tier only: drop the baked title glyph textures once no overlay is showing
 * (they are re-baked on demand; high tier keeps them for instant re-use).
 */
export const releaseTitlesIfIdle = (ctx: GameContext): void => {
  if (ctx.tier === 'low' && openStages === 0) releaseGlyphCache();
};

/**
 * Full-screen presentation stage used by the big win and the free-spin intro/outro:
 *
 *   overlay layer
 *     stage
 *       dimmer      oversized black sprite (covers letterbox too) — also the tap catcher
 *       under       full-screen design-space layer under the content (transition curtains)
 *       backdrop    behind-the-lift content (god rays, glows)
 *       lift        RenderLayer: the MASCOTS and FX layers are re-attached here while the
 *                   stage is open, so the characters and coin fountains read ABOVE the
 *                   dimmer (they keep their own transforms; nothing is re-parented)
 *       content     titles / counters, centred on layout.center and scaled per layout
 *       front       full-screen design-space layer above everything
 *
 * The stage is (re)appended to the overlay layer on every open(), so the most recently
 * opened stage is always on top (e.g. a big win straight after the free-spin outro).
 * Taps on the dimmer and 'ui:skip' (spacebar / skip button) are forwarded to `onTap`.
 */
export class OverlayStage {
  readonly root = new Container({ label: 'overlayStage' });
  readonly under = new Container({ label: 'under' });
  readonly backdrop = new Container({ label: 'backdrop' });
  readonly content = new Container({ label: 'content' });
  readonly front = new Container({ label: 'front' });
  private dimmer = new Sprite({ texture: Texture.WHITE, tint: 0x000000, alpha: 0 });
  private lift = new RenderLayer();
  private lifted = false;
  private tapHandler: (() => void) | null = null;
  private dimTween: gsap.core.Tween | null = null;
  private offSkip: (() => void) | null = null;

  constructor(
    private ctx: GameContext,
    label: string,
  ) {
    this.root.label = label;
    this.root.visible = false;
    this.dimmer.eventMode = 'static';
    this.dimmer.cursor = 'pointer';
    this.dimmer.on('pointertap', () => this.tapHandler?.());
    this.root.addChild(this.dimmer, this.under, this.backdrop, this.lift, this.content, this.front);
  }

  get isOpen(): boolean {
    return this.root.visible;
  }

  /** Layout-dependent overlay scale (content is authored for landscape). */
  get scale(): number {
    return placementFor(this.ctx.layout).overlayScale;
  }

  layout(L: LayoutSpec = this.ctx.layout): void {
    const pad = Math.max(L.width, L.height);
    this.dimmer.position.set(-pad, -pad);
    this.dimmer.width = L.width + pad * 2;
    this.dimmer.height = L.height + pad * 2;
    const k = placementFor(L).overlayScale;
    for (const c of [this.backdrop, this.content]) {
      c.position.set(L.center.x, L.center.y);
      c.scale.set(k);
    }
  }

  /**
   * Show the stage. `dim` is the dimmer alpha; `liftMascots` / `liftFx` re-attach
   * those layers above the dimmer for the lifetime of the stage.
   */
  open(opts: { dim: number; fadeIn: number; liftMascots?: boolean; liftFx?: boolean }): void {
    this.ctx.layers.overlay.addChild(this.root);
    this.layout();
    if (!this.root.visible) openStages++;
    this.root.visible = true;
    this.dimTween?.kill();
    this.dimTween = gsap.to(this.dimmer, { alpha: opts.dim, duration: opts.fadeIn, ease: 'power2.out' });
    const { layers } = this.ctx;
    if (opts.liftMascots) this.lift.attach(layers.mascots);
    if (opts.liftFx) this.lift.attach(layers.fx);
    this.lifted = !!(opts.liftMascots || opts.liftFx);
    this.offSkip?.();
    this.offSkip = this.ctx.ui.on('ui:skip', () => this.tapHandler?.());
  }

  /** Dim alpha tween (e.g. lighter dim for a retrigger pop). */
  setDim(alpha: number, duration: number): void {
    this.dimTween?.kill();
    this.dimTween = gsap.to(this.dimmer, { alpha, duration, ease: 'power2.out' });
  }

  onTap(handler: (() => void) | null): void {
    this.tapHandler = handler;
  }

  /** Fade the dimmer out and hide; resolves when fully closed. */
  close(fadeOut: number): Promise<void> {
    this.tapHandler = null;
    this.offSkip?.();
    this.offSkip = null;
    this.dimTween?.kill();
    return new Promise((resolve) => {
      this.dimTween = gsap.to(this.dimmer, {
        alpha: 0,
        duration: fadeOut,
        ease: 'power2.in',
        onComplete: () => {
          this.release();
          if (this.root.visible) openStages = Math.max(0, openStages - 1);
          this.root.visible = false;
          resolve();
        },
      });
    });
  }

  /** Hand the mascots / fx layers back to their normal place in the stack. */
  private release(): void {
    if (!this.lifted) return;
    const { layers } = this.ctx;
    if (layers.mascots.parentRenderLayer === this.lift) this.lift.detach(layers.mascots);
    if (layers.fx.parentRenderLayer === this.lift) this.lift.detach(layers.fx);
    this.lifted = false;
  }

  destroy(): void {
    this.release();
    this.offSkip?.();
    this.dimTween?.kill();
    this.root.destroy({ children: true });
  }
}
