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

  constructor(private ctx: GameContext) {
    const app: Application = ctx.app;
    app.renderer.on('resize', () => this.update());
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
