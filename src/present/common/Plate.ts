import { Container, Graphics, Sprite } from 'pixi.js';
import { glowTexture } from '../../fx/textures';

/**
 * Translucent hex-cut plate matching the HUD language (black glass, one black
 * outline, a thin accent rim, a faint top sheen) with an optional soft accent
 * glow behind it. Redraws only when its size actually changes.
 */
export class Plate extends Container {
  private bg = new Graphics();
  private glow: Sprite;
  private w = 0;
  private h = 0;

  constructor(
    private accent: number,
    private fillAlpha = 0.66,
    private shape: 'hex' | 'round' = 'hex',
  ) {
    super({ label: 'plate' });
    this.glow = new Sprite({ texture: glowTexture(256), anchor: 0.5, blendMode: 'add', tint: accent, alpha: 0.28 });
    this.addChild(this.glow, this.bg);
  }

  resize(w: number, h: number): void {
    const W = Math.round(w);
    const H = Math.round(h);
    if (W === this.w && H === this.h) return;
    this.w = W;
    this.h = H;
    const cut = H * 0.34;
    const hex = (inset: number): number[] => {
      const x0 = -W / 2 + inset;
      const x1 = W / 2 - inset;
      const y0 = -H / 2 + inset;
      const y1 = H / 2 - inset;
      const c = Math.max(2, cut - inset * 0.4);
      return [x0 + c, y0, x1 - c, y0, x1, 0, x1 - c, y1, x0 + c, y1, x0, 0];
    };
    const g = this.bg.clear();
    if (this.shape === 'round') {
      const r = Math.min(40, H * 0.14);
      g.roundRect(-W / 2, -H / 2, W, H, r).fill({ color: 0x05030f, alpha: this.fillAlpha }).stroke({ width: 4, color: 0x000000 });
      g.roundRect(-W / 2 + 6, -H / 2 + 6, W - 12, H * 0.42, r - 4).fill({ color: 0xffffff, alpha: 0.05 });
      g.roundRect(-W / 2 + 6, -H / 2 + 6, W - 12, H - 12, r - 4).stroke({ width: 2.5, color: this.accent, alpha: 0.95 });
    } else {
      g.poly(hex(0)).fill({ color: 0x05030f, alpha: this.fillAlpha }).stroke({ width: 3.5, color: 0x000000, join: 'round' });
      // top sheen (flat, hard-edged — no gradient)
      const s = hex(4);
      g.poly([s[0], s[1], s[2], s[3], s[4] - 2, -H * 0.06, s[10] + 2, -H * 0.06]).fill({ color: 0xffffff, alpha: 0.07 });
      g.poly(hex(4.5)).stroke({ width: 2, color: this.accent, alpha: 0.95, join: 'round' });
    }
    this.glow.width = W * 1.5;
    this.glow.height = H * 2.6;
  }

  get plateWidth(): number {
    return this.w;
  }

  set accentColor(c: number) {
    if (c === this.accent) return;
    this.accent = c;
    this.glow.tint = c;
    const w = this.w;
    this.w = 0;
    this.resize(w, this.h);
  }
}
