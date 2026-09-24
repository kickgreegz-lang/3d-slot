import { BlurFilter, ColorMatrixFilter, Container, FillGradient, Graphics, Rectangle, type Renderer, Sprite, type Texture } from 'pixi.js';

/**
 * Derived symbol variants — work on ANY static symbol texture (procedural or a
 * production PNG/WebP that ships without its own blur/glow), so the pipeline only
 * has to deliver the static art.
 */

const DEG = Math.PI / 180;

/**
 * Vertical motion-blur variant. The symbol view rotates textures by `restAngle`,
 * so the blur is built in SCREEN space (rotate -> smear vertically -> rotate back):
 * after the view's rotation the streak is exactly vertical, like the fall.
 */
export const makeBlur = (renderer: Renderer, tex: Texture, canvas: number, restAngle: number, resolution = 1): Texture => {
  const big = Math.ceil(canvas * 1.45);
  const pass1 = new Container();
  const smear = new Container();
  smear.position.set(big / 2, big / 2);
  smear.scale.set(0.97, 1.12);
  // stacked ghost copies (heavier in the middle), then a light vertical blur
  const taps = [-14, -9, -4.5, 0, 4.5, 9, 14];
  const weights = [0.18, 0.3, 0.5, 1, 0.5, 0.3, 0.18];
  taps.forEach((dy, i) => {
    const s = new Sprite(tex);
    s.anchor.set(0.5);
    s.rotation = restAngle * DEG;
    s.y = dy;
    s.alpha = weights[i];
    smear.addChild(s);
  });
  pass1.addChild(smear);
  pass1.filters = [new BlurFilter({ strengthX: 0, strengthY: 5, quality: 3 })];
  const t1 = renderer.generateTexture({ target: pass1, frame: new Rectangle(0, 0, big, big), resolution });
  pass1.destroy({ children: true });

  const pass2 = new Container();
  const back = new Sprite(t1);
  back.anchor.set(0.5);
  back.position.set(canvas / 2, canvas / 2);
  back.rotation = -restAngle * DEG;
  pass2.addChild(back);
  const out = renderer.generateTexture({ target: pass2, frame: new Rectangle(0, 0, canvas, canvas), resolution });
  pass2.destroy({ children: true });
  t1.destroy(true);
  return out;
};

/** Radial eraser: removes glow alpha toward the canvas edge (no square clip). */
const edgeFades = new Map<string, Texture>();
const edgeFade = (renderer: Renderer, canvas: number, resolution: number): Texture => {
  const key = `${canvas}@${resolution}`;
  let t = edgeFades.get(key);
  if (t) return t;
  const g = new Graphics().rect(0, 0, canvas, canvas).fill(
    new FillGradient({
      type: 'radial',
      center: { x: 0.5, y: 0.5 },
      innerRadius: 0,
      outerCenter: { x: 0.5, y: 0.5 },
      outerRadius: 0.5,
      colorStops: [
        { offset: 0, color: 'rgba(255,255,255,0)' },
        { offset: 0.78, color: 'rgba(255,255,255,0)' },
        { offset: 1, color: 'rgba(255,255,255,1)' },
      ],
      textureSpace: 'local',
    }),
  );
  t = renderer.generateTexture({ target: g, frame: new Rectangle(0, 0, canvas, canvas), resolution });
  g.destroy();
  edgeFades.set(key, t);
  return t;
};

/**
 * Glow variant: soft WHITE silhouette (dilated + blurred ~14 px) for additive,
 * tinted win/anticipation glows. Alpha fades out before the canvas edge.
 */
export const makeGlow = (renderer: Renderer, tex: Texture, canvas: number, resolution = 1): Texture => {
  const root = new Container();
  const sil = new Container();
  // dilate: ring of copies
  const r = 3.5;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const s = new Sprite(tex);
    s.anchor.set(0.5);
    s.position.set(canvas / 2 + Math.cos(a) * r, canvas / 2 + Math.sin(a) * r);
    sil.addChild(s);
  }
  const white = new ColorMatrixFilter();
  white.matrix = [0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0];
  sil.filters = [white, new BlurFilter({ strength: 10, quality: 4 })];
  const fade = new Sprite(edgeFade(renderer, canvas, resolution));
  fade.blendMode = 'erase';
  root.addChild(sil, fade);
  const out = renderer.generateTexture({ target: root, frame: new Rectangle(0, 0, canvas, canvas), resolution });
  root.destroy({ children: true });
  return out;
};
