import type { Application, Container } from 'pixi.js';
import { type LayoutSpec, pickLayout } from '../config/layout';
import type { GameContext } from '../game/context';

/**
 * Responsive layout manager.
 *  - root: contain-scaled design space (letterboxed), centred.
 *  - background/bgFx/screenFx: cover-scaled to the full canvas, using the same design
 *    space so environment modules can author in design px and just bleed past the edges.
 * Emits 'layout:change' with the new spec + scale whenever the canvas resizes.
 */
export class LayoutManager {
  private lastKey = '';

  constructor(
    private ctx: GameContext,
    /** max renderer resolution for this device tier (see render/app.ts) */
    private dprCap = 2,
  ) {
    const app: Application = ctx.app;
    app.renderer.on('resize', () => this.update());
    this.watchPixelRatio();
  }

  /**
   * devicePixelRatio changes (browser zoom, dragging to a HiDPI monitor) don't pass a
   * resolution to Pixi's resize, so re-apply it and force a re-layout (HUD/frame/background
   * bake at ctx.scale * renderer.resolution). The media query is re-armed for each new DPR.
   */
  private watchPixelRatio(): void {
    if (typeof matchMedia !== 'function') return;
    const dpr = window.devicePixelRatio || 1;
    matchMedia(`(resolution: ${dpr}dppx)`).addEventListener(
      'change',
      () => {
        const { app } = this.ctx;
        const res = Math.min(window.devicePixelRatio || 1, this.dprCap);
        if (res !== app.renderer.resolution) {
          app.renderer.resize(app.screen.width, app.screen.height, res);
          this.update(true);
        }
        this.watchPixelRatio();
      },
      { once: true },
    );
  }

  update(force = false): void {
    const { app, layers } = this.ctx;
    const w = app.screen.width;
    const h = app.screen.height;
    const L = pickLayout(w, h);
    const contain = Math.min(w / L.width, h / L.height);
    const cover = Math.max(w / L.width, h / L.height);

    const place = (c: Container, scale: number) => {
      c.scale.set(scale);
      c.position.set((w - L.width * scale) / 2, (h - L.height * scale) / 2);
    };
    place(layers.root, contain);
    place(layers.background, cover);
    place(layers.bgFx, cover);
    place(layers.screenFx, cover);

    const key = `${L.kind}:${w}x${h}`;
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    this.ctx.layout = L;
    this.ctx.scale = contain;
    this.ctx.game.broadcast('layout:change', { layout: L, scale: contain });
  }

  get current(): LayoutSpec {
    return this.ctx.layout;
  }
}
