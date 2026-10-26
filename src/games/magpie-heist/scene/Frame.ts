import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { LayoutSpec } from '../../../config/layout';
import { clock } from '../../../core/clock';
import { reducedMotion } from '../../../fx/motion';
import type { GameContext, GameModule } from '../../../game/context';
import { canvasToTexture, createCanvas } from '../../../fx/textures';
import { shineTexture } from '../glint/art';
import { CRIMSON, GOLD_HOT } from '../timing';

/**
 * GILDED FRAME — the reels hang in the museum like a masterpiece (owns ctx.layers.panel and
 * ctx.layers.frame):
 *  - the panel behind the grid: deep midnight velvet with a soft vignette and a faint damask sheen;
 *  - an ornate gold picture frame around it: a thick bevelled moulding (key light upper left, warm
 *    bounce, cool rim), an inner crimson velvet liner, carved corner rosettes with a ruby each and a
 *    pearl bead run along the inner lip, all painted with Canvas2D at the display resolution and
 *    re-baked on layout:change;
 *  - a light sweep runs across the gold every few seconds (additive), the corner rubies breathe.
 * The env keys frame_beam / frame_post / frame_sill replace the painted moulding once generated
 * pieces ship (ART_PLAN §3).
 */
export class Frame implements GameModule {
  private readonly panel = new Sprite();
  private readonly frame = new Sprite();
  private readonly sweep = new Sprite({ blendMode: 'add', alpha: 0 });
  private readonly sweepMask = new Graphics();
  private readonly rubies = new Container({ label: 'rubies' });
  private offs: Array<() => void> = [];
  private time = 0;
  private texPanel: Texture | null = null;
  private texFrame: Texture | null = null;

  constructor(private readonly ctx: GameContext) {}

  init(): void {
    const { ctx } = this;
    ctx.layers.panel.addChild(this.panel);
    ctx.layers.frame.addChild(this.frame, this.sweep, this.sweepMask, this.rubies);
    this.sweep.texture = shineTexture();
    this.sweep.mask = this.sweepMask;
    this.offs.push(
      ctx.game.on('layout:change', ({ layout }) => this.layout(layout)),
      clock.onUpdate((dt) => this.update(dt)),
    );
    this.layout(ctx.layout);
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.texPanel?.destroy(true);
    this.texFrame?.destroy(true);
    this.panel.destroy();
    this.frame.destroy();
    this.sweep.destroy();
    this.sweepMask.destroy();
    this.rubies.destroy({ children: true });
  }

  private res(): number {
    return Math.min(2, Math.max(1, this.ctx.app.renderer.resolution * this.ctx.scale));
  }

  layout(L: LayoutSpec): void {
    const res = this.res();
    this.texPanel?.destroy(true);
    this.texFrame?.destroy(true);
    this.texPanel = paintPanel(L.panel.w, L.panel.h, res);
    this.panel.texture = this.texPanel;
    this.panel.position.set(L.panel.x, L.panel.y);
    const f = paintFrame(L, res);
    this.texFrame = f.tex;
    this.frame.texture = f.tex;
    this.frame.position.set(L.frame.x - f.pad, L.frame.y - f.pad);
    // the sweep runs only over the gold moulding
    this.sweepMask.clear();
    const F = L.frame;
    const P = L.panel;
    this.sweepMask.rect(F.x, F.y, F.w, F.h).fill(0xffffff).rect(P.x, P.y, P.w, P.h).cut();
    this.sweep.height = F.h * 1.4;
    this.sweep.width = F.h * 0.9;
    this.sweep.y = F.y - F.h * 0.2;
    // corner rubies
    this.rubies.removeChildren().forEach((c) => c.destroy());
    const u = L.frameParts.post / 54;
    for (const [x, y] of [
      [F.x + 30 * u, F.y + 30 * u],
      [F.x + F.w - 30 * u, F.y + 30 * u],
      [F.x + 30 * u, F.y + F.h - 30 * u],
      [F.x + F.w - 30 * u, F.y + F.h - 30 * u],
    ]) {
      const g = new Sprite({ texture: shineTexture(), anchor: 0.5, blendMode: 'add', tint: CRIMSON });
      g.position.set(x, y);
      g.scale.set(0.5 * u);
      g.rotation = Math.PI / 4;
      this.rubies.addChild(g);
    }
  }

  private update(dt: number): void {
    this.time += dt;
    const L = this.ctx.layout;
    const F = L.frame;
    const calm = reducedMotion() ? 0 : 1;
    const period = 5.5;
    const u = (this.time % period) / period;
    const k = Math.min(1, u / 0.28);
    this.sweep.alpha = calm * (k < 1 ? 0.55 * Math.sin(k * Math.PI) : 0);
    this.sweep.x = F.x - F.h * 0.5 + (F.w + F.h) * k;
    this.rubies.children.forEach((c, i) => (c.alpha = calm * (0.25 + 0.2 * Math.sin(this.time * 2.2 + i * 1.7))));
    void GOLD_HOT;
  }
}

/** Midnight velvet panel: vertical gradient, vignette, a faint diamond damask. */
const paintPanel = (w: number, h: number, res: number): Texture => {
  const [c, g] = createCanvas(Math.ceil(w * res), Math.ceil(h * res));
  g.scale(res, res);
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#1a1f4e');
  grad.addColorStop(0.55, '#121638');
  grad.addColorStop(1, '#0b0d26');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  // damask lattice
  g.strokeStyle = 'rgba(120,140,255,0.06)';
  g.lineWidth = 2;
  const step = 70;
  for (let x = -h; x < w + h; x += step) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + h, h);
    g.stroke();
    g.beginPath();
    g.moveTo(x + h, 0);
    g.lineTo(x, h);
    g.stroke();
  }
  const vig = g.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.75);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = vig;
  g.fillRect(0, 0, w, h);
  return canvasToTexture(c, res);
};

/** The ornate gilded moulding around the panel (one texture, `pad` px of drop shadow outside). */
const paintFrame = (L: LayoutSpec, res: number): { tex: Texture; pad: number } => {
  const F = L.frame;
  const P = L.panel;
  const u = L.frameParts.post / 54;
  const pad = Math.round(24 * u);
  const W = F.w + pad * 2;
  const H = F.h + pad * 2;
  const [c, g] = createCanvas(Math.ceil(W * res), Math.ceil(H * res));
  g.scale(res, res);
  g.translate(pad, pad);
  const ox = P.x - F.x;
  const oy = P.y - F.y;
  const R = 26 * u;
  const outer = (): void => {
    g.beginPath();
    g.roundRect(0, 0, F.w, F.h, R);
  };
  const inner = (inset: number, r = 10 * u): void => {
    g.roundRect(ox - inset, oy - inset, P.w + inset * 2, P.h + inset * 2, r);
  };
  // drop shadow
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.75)';
  g.shadowBlur = 26 * u;
  g.shadowOffsetY = 10 * u;
  outer();
  g.fillStyle = '#3a2206';
  g.fill();
  g.restore();
  // the moulding: concentric bands of gold, each with its own bevel gradient
  const band = (insetOut: number, insetIn: number, stops: Array<[number, string]>, angle = 1): void => {
    g.save();
    g.beginPath();
    g.roundRect(insetOut, insetOut, F.w - insetOut * 2, F.h - insetOut * 2, Math.max(4, R - insetOut * 0.5));
    inner(insetIn);
    g.clip('evenodd');
    const gr = g.createLinearGradient(0, 0, F.w * angle, F.h);
    for (const [o, col] of stops) gr.addColorStop(o, col);
    g.fillStyle = gr;
    g.fillRect(0, 0, F.w, F.h);
    g.restore();
  };
  const t = (n: number): number => n * u;
  const outerBand = Math.min(ox, oy);
  // outer rail
  band(0, outerBand - t(2), [
    [0, '#fff3c0'],
    [0.18, '#ffd25a'],
    [0.5, '#d18f17'],
    [0.82, '#8a5208'],
    [1, '#5c3304'],
  ]);
  // carved middle cove (darker, reads as depth)
  band(t(14), outerBand - t(16), [
    [0, '#c98b1a'],
    [0.5, '#7a4606'],
    [1, '#4a2802'],
  ]);
  // bright inner bead rail
  band(t(22), outerBand - t(24), [
    [0, '#fff8d8'],
    [0.3, '#ffcf4a'],
    [0.7, '#c17c0e'],
    [1, '#7a4504'],
  ]);
  // carved leaf pattern on the cove (repeating scallops)
  g.save();
  g.beginPath();
  g.roundRect(t(14), t(14), F.w - t(28), F.h - t(28), R);
  inner(outerBand - t(22));
  g.clip('evenodd');
  g.strokeStyle = 'rgba(255,236,170,0.55)';
  g.lineWidth = t(2);
  const step = t(26);
  for (let x = t(20); x < F.w; x += step) {
    for (const y of [t(17), F.h - t(17)]) {
      g.beginPath();
      g.arc(x, y, t(7), Math.PI * 0.15, Math.PI * 0.85, y > F.h / 2);
      g.stroke();
    }
  }
  for (let y = t(20); y < F.h; y += step) {
    for (const x of [t(17), F.w - t(17)]) {
      g.beginPath();
      g.arc(x, y, t(7), Math.PI * 0.65, Math.PI * 1.35, x > F.w / 2);
      g.stroke();
    }
  }
  g.restore();
  // crimson velvet liner
  g.save();
  g.beginPath();
  inner(outerBand - t(24));
  inner(t(2), t(8));
  g.clip('evenodd');
  const vel = g.createLinearGradient(0, oy - t(20), 0, oy + P.h + t(20));
  vel.addColorStop(0, '#8a1024');
  vel.addColorStop(0.5, '#5a0816');
  vel.addColorStop(1, '#3a040e');
  g.fillStyle = vel;
  g.fillRect(0, 0, F.w, F.h);
  g.restore();
  // pearl beads on the inner lip
  const beadR = t(3.4);
  const lip = t(5);
  g.fillStyle = '#fff4dc';
  const beads = (x0: number, y0: number, x1: number, y1: number): void => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.floor(len / (beadR * 3.2));
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      g.beginPath();
      g.arc(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, beadR, 0, Math.PI * 2);
      g.fill();
    }
  };
  beads(ox - lip, oy - lip, ox + P.w + lip, oy - lip);
  beads(ox - lip, oy + P.h + lip, ox + P.w + lip, oy + P.h + lip);
  beads(ox - lip, oy - lip, ox - lip, oy + P.h + lip);
  beads(ox + P.w + lip, oy - lip, ox + P.w + lip, oy + P.h + lip);
  // corner rosettes with a ruby
  const rosette = (x: number, y: number): void => {
    const r = t(26);
    const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    gr.addColorStop(0, '#fff6c8');
    gr.addColorStop(0.5, '#e7a92a');
    gr.addColorStop(1, '#7a4504');
    g.fillStyle = gr;
    g.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const rr = i % 2 ? r * 0.78 : r;
      g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
    g.lineWidth = t(2.2);
    g.strokeStyle = '#2a1402';
    g.stroke();
    const rg = g.createRadialGradient(x - r * 0.15, y - r * 0.18, r * 0.05, x, y, r * 0.42);
    rg.addColorStop(0, '#ffd0d6');
    rg.addColorStop(0.4, '#e8233f');
    rg.addColorStop(1, '#6a0414');
    g.fillStyle = rg;
    g.beginPath();
    g.arc(x, y, r * 0.42, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.beginPath();
    g.arc(x - r * 0.14, y - r * 0.16, r * 0.09, 0, Math.PI * 2);
    g.fill();
  };
  rosette(t(30), t(30));
  rosette(F.w - t(30), t(30));
  rosette(t(30), F.h - t(30));
  rosette(F.w - t(30), F.h - t(30));
  // top centre cartouche: a small gold shield with a black mask silhouette
  const cx = F.w / 2;
  const cy = t(6);
  g.save();
  g.fillStyle = '#e9b23a';
  g.strokeStyle = '#2a1402';
  g.lineWidth = t(2.4);
  g.beginPath();
  g.moveTo(cx - t(56), cy);
  g.quadraticCurveTo(cx, cy - t(30), cx + t(56), cy);
  g.quadraticCurveTo(cx + t(40), cy + t(34), cx, cy + t(44));
  g.quadraticCurveTo(cx - t(40), cy + t(34), cx - t(56), cy);
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = '#111018';
  g.beginPath();
  g.ellipse(cx - t(14), cy + t(12), t(16), t(9), 0.15, 0, Math.PI * 2);
  g.ellipse(cx + t(14), cy + t(12), t(16), t(9), -0.15, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#e9b23a';
  g.beginPath();
  g.ellipse(cx - t(15), cy + t(12), t(6), t(3.5), 0.15, 0, Math.PI * 2);
  g.ellipse(cx + t(15), cy + t(12), t(6), t(3.5), -0.15, 0, Math.PI * 2);
  g.fill();
  g.restore();
  // the reel window: cut clean through every layer (the frame draws ABOVE the symbols)
  g.save();
  g.globalCompositeOperation = 'destination-out';
  g.beginPath();
  inner(t(1), t(8));
  g.fillStyle = '#000';
  g.fill();
  g.restore();
  // final outline
  g.lineWidth = t(3);
  g.strokeStyle = '#1a0c02';
  outer();
  g.stroke();
  g.beginPath();
  inner(t(2), t(8));
  g.stroke();
  return { tex: canvasToTexture(c, res), pad };
};
