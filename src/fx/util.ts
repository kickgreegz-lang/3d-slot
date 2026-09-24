/**
 * Small allocation-free helpers shared by the FX and presentation modules:
 * colour maths (0xRRGGBB), Pixi particle colour packing, random ranges and a
 * smooth 1D gradient noise used by the camera shake.
 */

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const rand = (a: number, b: number): number => a + Math.random() * (b - a);
export const randInt = (a: number, b: number): number => Math.floor(rand(a, b + 1));
export const pick = <T>(arr: readonly T[]): T => arr[(Math.random() * arr.length) | 0];

/** Linear blend of two 0xRRGGBB colours. */
export const mixColor = (a: number, b: number, t: number): number => {
  const k = clamp01(t);
  const r = Math.round(lerp((a >> 16) & 0xff, (b >> 16) & 0xff, k));
  const g = Math.round(lerp((a >> 8) & 0xff, (b >> 8) & 0xff, k));
  const bl = Math.round(lerp(a & 0xff, b & 0xff, k));
  return (r << 16) | (g << 8) | bl;
};
export const lighten = (c: number, t: number): number => mixColor(c, 0xffffff, t);
export const darken = (c: number, t: number): number => mixColor(c, 0x000000, t);

/** 0xRRGGBB -> CSS hex string. */
export const cssColor = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/**
 * Pack tint + alpha exactly like pixi's `Particle` does (BGR + alpha<<24), so the
 * hot particle loop can write `particle.color` without going through `Color`.
 */
export const packParticleColor = (rgb: number, alpha: number): number => {
  const bgr = ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 0xff);
  return bgr + ((((alpha < 0 ? 0 : alpha > 1 ? 1 : alpha) * 255) | 0) << 24);
};

/** Deterministic hash -> [-1, 1]. */
const hash = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
};

/**
 * 1D gradient (Perlin-style) noise in roughly [-1, 1]. Smooth, no flat spots at
 * lattice points (unlike value noise), so shake reads as organic camera motion.
 * `seed` selects an independent channel.
 */
export const noise1 = (x: number, seed: number): number => {
  const i = Math.floor(x);
  const f = x - i;
  const off = seed * 71.37;
  const g0 = hash(i + off);
  const g1 = hash(i + 1 + off);
  const u = f * f * f * (f * (f * 6 - 15) + 10);
  return lerp(g0 * f, g1 * (f - 1), u) * 2;
};
