import { Container, FillGradient, Graphics, Rectangle, type Renderer, Sprite, type Texture } from 'pixi.js';
import type { EnvPlaceholder } from './spec';

/**
 * Procedural stand-ins for environment layers (spec.ts EnvPlaceholder), so a new game shows a
 * reacting, parallaxed background on day one, before its Higgsfield plates exist. Baked once per
 * orientation at low resolution (backgrounds are soft); the centre stays calm and low-detail like
 * the production brief asks (docs/new-slot/HIGGSFIELD_PLAYBOOK.md §4).
 */

/** Canonical bake rects (cover-fitted like a real plate; 2:1 and 1:2 like the plate masters). */
export const PLACEHOLDER_SIZE = {
  landscape: { w: 2400, h: 1200 },
  portrait: { w: 1200, h: 2400 },
} as const;

const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const paint = (p: EnvPlaceholder, w: number, h: number, glow: Texture, owned: FillGradient[]): Container => {
  const holder = new Container();
  const rand = mulberry32(p.seed ?? 0x5107);
  const colors = p.colors.length ? p.colors : [0x223344];
  switch (p.kind) {
    case 'sky': {
      const stops = colors.length === 1 ? [colors[0], colors[0]] : colors;
      const fill = new FillGradient({
        type: 'linear',
        start: { x: 0, y: 0 },
        end: { x: 0, y: 1 },
        colorStops: stops.map((color, i) => ({ offset: i / (stops.length - 1), color })),
        textureSpace: 'local',
      });
      owned.push(fill);
      holder.addChild(new Graphics().rect(0, 0, w, h).fill(fill));
      break;
    }
    case 'ridge': {
      const base = (p.y ?? 0.8) * h;
      const amp = (p.height ?? 0.25) * h;
      const n = 14;
      const g = new Graphics().moveTo(0, h);
      for (let i = 0; i <= n; i++) {
        const x = (i / n) * w;
        // calmer (lower) silhouette behind the board, taller at the edges
        const edge = Math.abs(i / n - 0.5) * 2;
        g.lineTo(x, base - amp * (0.25 + 0.75 * edge) * (0.55 + 0.45 * rand()));
      }
      g.lineTo(w, h).closePath().fill(colors[0]);
      holder.addChild(g);
      break;
    }
    case 'glow': {
      const count = 10;
      for (let i = 0; i < count; i++) {
        const s = new Sprite(glow);
        s.anchor.set(0.5);
        const left = i % 2 === 0;
        const x = left ? w * (0.02 + 0.2 * rand()) : w * (0.78 + 0.2 * rand());
        s.position.set(x, h * (0.1 + 0.75 * rand()));
        const size = Math.min(w, h) * (0.12 + 0.22 * rand());
        s.scale.set(size / glow.width);
        s.tint = colors[i % colors.length];
        s.alpha = 0.55 + 0.45 * rand();
        s.blendMode = 'add';
        holder.addChild(s);
      }
      break;
    }
    case 'fog': {
      const y = (p.y ?? 0.75) * h;
      for (let i = 0; i < 5; i++) {
        const s = new Sprite(glow);
        s.anchor.set(0.5);
        s.position.set(w * (i / 4), y + (rand() - 0.5) * h * 0.06);
        s.scale.set((w * 0.45) / glow.width, (h * (p.height ?? 0.18)) / glow.height);
        s.tint = colors[0];
        s.alpha = 0.35;
        holder.addChild(s);
      }
      break;
    }
  }
  return holder;
};

/** Bake one placeholder layer to a texture of `w x h` design px. The caller owns the texture. */
export const bakePlaceholder = (
  renderer: Renderer,
  p: EnvPlaceholder,
  w: number,
  h: number,
  glow: Texture,
  resolution: number,
): Texture => {
  const gradients: FillGradient[] = [];
  const holder = paint(p, w, h, glow, gradients);
  const tex = renderer.generateTexture({ target: holder, frame: new Rectangle(0, 0, w, h), resolution });
  holder.destroy({ children: true });
  // gradients own a texture each (pixi FillGradient docs): free them once baked
  for (const g of gradients) g.destroy();
  return tex;
};
