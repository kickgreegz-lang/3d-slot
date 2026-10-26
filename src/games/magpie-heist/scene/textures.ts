import type { Renderer, Texture } from 'pixi.js';
import { canvasToTexture, createCanvas, glowTexture as fxGlow } from '../../../fx/textures';

/** Shared procedural scene textures (Canvas2D, baked once, tinted + additive at use). */
const cache = new Map<string, Texture>();
const cached = (key: string, make: () => Texture): Texture => {
  let t = cache.get(key);
  if (!t) {
    t = make();
    cache.set(key, t);
  }
  return t;
};

/** 256 px soft radial glow (white). */
export const glowTexture = (_r?: Renderer): Texture => fxGlow(256);

/** A laser beam: a thin bright core in a soft halo, fading out toward its far end (anchor top). */
export const streakTexture = (_r?: Renderer): Texture =>
  cached('streak', () => {
    const [c, g] = createCanvas(32, 256);
    const along = g.createLinearGradient(0, 0, 0, 256);
    along.addColorStop(0, 'rgba(255,255,255,1)');
    along.addColorStop(0.75, 'rgba(255,255,255,0.45)');
    along.addColorStop(1, 'rgba(255,255,255,0)');
    for (let x = 0; x < 32; x++) {
      const d = Math.abs(x - 15.5) / 16;
      const a = d < 0.12 ? 1 : Math.max(0, (1 - d) ** 3) * 0.5;
      g.globalAlpha = a;
      g.fillStyle = along;
      g.fillRect(x, 0, 1, 256);
    }
    return canvasToTexture(c);
  });

/** A four-point twinkle star (white): sharp cross + soft core. */
export const twinkleTexture = (): Texture =>
  cached('twinkle', () => {
    const S = 128;
    const [c, g] = createCanvas(S, S);
    const r = S / 2;
    const core = g.createRadialGradient(r, r, 0, r, r, r * 0.45);
    core.addColorStop(0, 'rgba(255,255,255,1)');
    core.addColorStop(0.3, 'rgba(255,255,255,0.6)');
    core.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = core;
    g.fillRect(0, 0, S, S);
    g.translate(r, r);
    for (let i = 0; i < 4; i++) {
      g.rotate(Math.PI / 2);
      const grad = g.createLinearGradient(0, 0, r, 0);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(0, -r * 0.07);
      g.lineTo(r, 0);
      g.lineTo(0, r * 0.07);
      g.closePath();
      g.fill();
    }
    return canvasToTexture(c);
  });
