import { BlurFilter, Container, FillGradient, Graphics, GraphicsPath, Rectangle, type Renderer, type Texture } from 'pixi.js';
import type { ParticleKey } from '../art';
import { CelCanvas, sparkle, streak } from './cel';
import { GOLD, INK, Light, PLUM, WHITE, mix } from './palette';
import { blob, ellipsePath, starPath } from './shapes';

/**
 * Particle textures. Anything meant to be tinted (spark, dust, star, ring, smoke,
 * shard, glow, note) is WHITE (+ black outline where it is a "physical" cel
 * object) so the FX module can colour it per symbol; the coin is full colour.
 */

const bake = (renderer: Renderer, target: Container, size: number, resolution = 2): Texture => {
  const root = new Container();
  root.addChild(new Graphics().rect(0, 0, size, size).fill({ color: 0, alpha: 0 }));
  root.addChild(target);
  const tex = renderer.generateTexture({ target: root, frame: new Rectangle(0, 0, size, size), resolution, antialias: true });
  root.destroy({ children: true });
  return tex;
};

const soft = (g: Graphics, blur: number): Container => {
  const c = new Container();
  c.addChild(g);
  c.filters = [new BlurFilter({ strength: blur, quality: 4 })];
  return c;
};

const radial = (size: number, stops: [number, number][]): FillGradient =>
  new FillGradient({
    type: 'radial',
    center: { x: 0.5, y: 0.5 },
    innerRadius: 0,
    outerCenter: { x: 0.5, y: 0.5 },
    outerRadius: 0.5,
    colorStops: stops.map(([offset, a]) => ({ offset, color: `rgba(255,255,255,${a})` })),
    textureSpace: 'local',
    textureSize: size,
  });

const builders: Record<ParticleKey, (r: Renderer) => Texture> = {
  spark: (r) => {
    const c = new Container();
    const glow = new Graphics().circle(32, 32, 12).fill(radial(64, [[0, 0.9], [0.5, 0.35], [1, 0]]));
    const g = new Graphics();
    sparkle(g, 32, 32, 28, 0.16);
    sparkle(g, 32, 32, 12, 0.5);
    c.addChild(glow, g);
    return bake(r, c, 64);
  },
  dust: (r) => {
    const g = new Graphics();
    g.path(blob([18, 40, 16, 28, 26, 18, 38, 18, 48, 26, 48, 40, 38, 46, 26, 46], 1)).fill({ color: WHITE, alpha: 0.9 });
    return bake(r, soft(g, 3), 64);
  },
  coin: (r) => {
    const c = new CelCanvas(new Light(0), 64);
    const face = new GraphicsPath().circle(30, 30, 23);
    c.body([face], 4, 3, mix(GOLD.deep, PLUM, 0.35));
    c.part({
      shape: face,
      fill: GOLD.base,
      shade: GOLD.shade,
      shadeOff: 4,
      rim: GOLD.light,
      rimOff: 2.5,
      paint: (g) => {
        g.circle(30, 30, 16).stroke({ width: 1.8, color: GOLD.shade });
        g.path(starPath(30, 30, 5, 10, 4.4)).fill(GOLD.light).stroke({ width: 1.4, color: GOLD.shade, join: 'round' });
        streak(g, 13, 32, 13, 18, 26, 11, 1.8);
      },
    });
    return c.bake(r);
  },
  star: (r) => {
    const p = starPath(32, 33, 5, 26, 12);
    const g = new Graphics().path(p).stroke({ width: 5, color: INK, join: 'round' });
    g.path(p).fill(WHITE);
    return bake(r, g, 64);
  },
  ring: (r) => {
    const g = new Graphics().circle(64, 64, 54).stroke({ width: 7, color: WHITE });
    return bake(r, soft(g, 2), 128);
  },
  smoke: (r) => {
    const g = new Graphics();
    for (const [x, y, rad, a] of [
      [52, 70, 30, 0.55],
      [78, 64, 28, 0.5],
      [64, 50, 26, 0.45],
      [66, 76, 30, 0.5],
    ] as const) {
      g.circle(x, y, rad).fill({ color: WHITE, alpha: a });
    }
    return bake(r, soft(g, 10), 128, 1);
  },
  shard: (r) => {
    const g = new Graphics();
    g.poly([10, 20, 30, 6, 40, 26, 24, 42], true).fill(WHITE).stroke({ width: 2.6, color: INK, join: 'round' });
    g.poly([14, 20, 29, 10, 32, 16], true).fill({ color: WHITE, alpha: 1 });
    return bake(r, g, 48);
  },
  glow: (r) => {
    const g = new Graphics().rect(0, 0, 128, 128).fill(radial(128, [[0, 1], [0.18, 0.72], [0.4, 0.3], [0.7, 0.07], [1, 0]]));
    return bake(r, g, 128, 1);
  },
  note: (r) => {
    const p = ellipsePath(26, 46, 11, 8, -0.45)
      .rect(30, 12, 7, 34)
      .moveTo(31, 10)
      .bezierCurveTo(44, 14, 50, 22, 46, 34)
      .bezierCurveTo(46, 26, 40, 22, 37, 22)
      .lineTo(37, 12)
      .closePath();
    const g = new Graphics().path(p).stroke({ width: 6, color: INK, join: 'round' });
    g.path(p).fill(WHITE);
    return bake(r, g, 64);
  },
};

export const buildParticle = (renderer: Renderer, key: ParticleKey): Texture => builders[key](renderer);

export const PARTICLE_KEYS = Object.keys(builders) as ParticleKey[];
