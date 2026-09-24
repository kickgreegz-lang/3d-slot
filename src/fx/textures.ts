import { CanvasSource, Texture } from 'pixi.js';

/**
 * Procedural FX textures drawn once with Canvas2D (no network, no art dependency):
 * soft radial glow, god-ray bursts, confetti chips. Cached for the app lifetime —
 * they are small (<= 1024², drawn at 1x and scaled on screen because they are soft).
 */

const cache = new Map<string, Texture>();

const makeCanvas = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('Canvas2D unavailable');
  return [c, g];
};

const toTexture = (canvas: HTMLCanvasElement, resolution = 1): Texture =>
  new Texture({
    source: new CanvasSource({
      resource: canvas,
      resolution,
      width: canvas.width / resolution,
      height: canvas.height / resolution,
      transparent: true,
      scaleMode: 'linear',
    }),
  });

const cached = (key: string, make: () => Texture): Texture => {
  let t = cache.get(key);
  if (!t) {
    t = make();
    cache.set(key, t);
  }
  return t;
};

/** White radial glow with a smooth (1-r)^2 falloff. Tint + additive blend at use. */
export const glowTexture = (size = 256): Texture =>
  cached(`glow:${size}`, () => {
    const [c, g] = makeCanvas(size, size);
    const r = size / 2;
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    for (let i = 0; i <= 10; i++) {
      const u = i / 10;
      grad.addColorStop(u, `rgba(255,255,255,${((1 - u) ** 2).toFixed(3)})`);
    }
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return toTexture(c);
  });

/**
 * God-ray burst: `rays` tapered wedges fading out radially, with slightly
 * irregular widths/lengths so the rotation never looks mechanical. Additive use.
 */
export const godRaysTexture = (rays = 18, size = 1024, seed = 1): Texture =>
  cached(`rays:${rays}:${size}:${seed}`, () => {
    const [c, g] = makeCanvas(size, size);
    const r = size / 2;
    let s = seed * 9301 + 49297;
    const rnd = (): number => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    g.translate(r, r);
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2 + (rnd() - 0.5) * 0.08;
      const half = (Math.PI / rays) * (0.32 + rnd() * 0.3);
      const len = r * (0.78 + rnd() * 0.22);
      const grad = g.createRadialGradient(0, 0, r * 0.04, 0, 0, len);
      grad.addColorStop(0, 'rgba(255,255,255,0.95)');
      grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
      grad.addColorStop(0.7, 'rgba(255,255,255,0.18)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, len, a - half, a + half);
      g.closePath();
      g.fill();
    }
    return toTexture(c);
  });

/** Confetti chip: rounded white rectangle (tinted per particle). */
export const confettiTexture = (): Texture =>
  cached('confetti', () => {
    const [c, g] = makeCanvas(24, 36);
    g.fillStyle = '#fff';
    g.beginPath();
    g.roundRect(2, 2, 20, 32, 4);
    g.fill();
    // cel shade: darker lower third reads as a folded chip when it flutters
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.fillRect(2, 24, 20, 10);
    return toTexture(c);
  });

export const canvasToTexture = toTexture;
export const createCanvas = makeCanvas;
