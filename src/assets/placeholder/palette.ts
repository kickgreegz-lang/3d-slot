/**
 * Style-bible tokens shared by every procedural placeholder (symbols, particles,
 * frame, logo). Mirrors the production art formula so placeholder and final art
 * sit together without a seam:
 *   - ONE outline system: pure black, ~3% of the 150 px cell (4.6 design px, 9 px @2x);
 *     interior lines thinner (2.6 design px).
 *   - ONE key light, top-left. Hard-edged 2-3 tone cel shading, no airbrush gradients.
 *   - Dark-plum extrusion toward the lower-right.
 *   - Crisp white specular streak.
 */
export const INK = 0x000000;
export const PLUM = 0x4b283d;
export const PLUM_LIGHT = 0x6b3a57;
export const WHITE = 0xffffff;

/** Outer outline width (design px on the 150 px cell). */
export const OUTLINE = 4.6;
/** Interior line width. */
export const LINE = 2.6;

export interface Vec {
  x: number;
  y: number;
}

const DEG = Math.PI / 180;

export const rotateVec = (v: Vec, rad: number): Vec => ({
  x: v.x * Math.cos(rad) - v.y * Math.sin(rad),
  y: v.x * Math.sin(rad) + v.y * Math.cos(rad),
});

/**
 * Key light for one piece of art. The symbol view rotates textures by the symbol's
 * `restAngle`, so light-dependent offsets are authored in ART space: the screen-space
 * vector is counter-rotated so that after the view's rotation the extrusion still
 * points lower-right and shadows still fall away from the top-left key light.
 */
export class Light {
  /** unit vector from the lit side toward the shadow side, in art space */
  readonly dir: Vec;

  constructor(restAngleDeg = 0) {
    const len = Math.hypot(0.56, 0.83);
    this.dir = rotateVec({ x: 0.56 / len, y: 0.83 / len }, -restAngleDeg * DEG);
  }

  /** offset of length k toward the shadow side */
  off(k: number): Vec {
    return { x: this.dir.x * k, y: this.dir.y * k };
  }
}

// ---------------------------------------------------------------------------
// colour helpers (0xRRGGBB numbers)

const ch = (c: number, s: number): number => (c >> s) & 0xff;
const pack = (r: number, g: number, b: number): number =>
  (Math.round(Math.min(255, Math.max(0, r))) << 16) |
  (Math.round(Math.min(255, Math.max(0, g))) << 8) |
  Math.round(Math.min(255, Math.max(0, b)));

/** Linear blend a -> b by t. */
export const mix = (a: number, b: number, t: number): number =>
  pack(
    ch(a, 16) + (ch(b, 16) - ch(a, 16)) * t,
    ch(a, 8) + (ch(b, 8) - ch(a, 8)) * t,
    ch(a, 0) + (ch(b, 0) - ch(a, 0)) * t,
  );

/** Cel shadow tone: darker and hue-shifted toward warm plum (never grey/black). */
export const shadeOf = (c: number, t = 0.34): number => mix(mix(c, 0x6a1030, t), 0x000000, t * 0.25);

/** Cel light tone: toward warm cream. */
export const lightOf = (c: number, t = 0.32): number => mix(c, 0xfff6d8, t);

/** A symbol's cel ramp. */
export interface Ramp {
  base: number;
  shade: number;
  deep: number;
  light: number;
}

export const ramp = (base: number, shadeT = 0.34, lightT = 0.32): Ramp => ({
  base,
  shade: shadeOf(base, shadeT),
  deep: shadeOf(base, Math.min(0.85, shadeT * 2)),
  light: lightOf(base, lightT),
});

/** Gold ramp shared by the boombox, mic and coins (molten gold for specials). */
export const GOLD: Ramp = { base: 0xffc629, shade: 0xe2861a, deep: 0x9a4a0c, light: 0xfff0a0 };
