import { FillGradient, type Graphics } from 'pixi.js';
import { GOLD, PINK, TEAL } from '../timing';

/**
 * Stage code-art palette. The booth and the horns stay code-drawn (their generated art is
 * unfunded, ART_STATUS §5), restyled toward formula D (STYLE_DECISION.md) so they sit with the
 * painted set: one bold dark outline (the frame's plum-black, ~3 design px like the rigs at
 * display size), thin interior lines, painterly soft gradients (key light top-left, warm bounce
 * below, a thin cool rim on the far edges), glossy highlights with crisp white speculars, no plum
 * extrusion and no baked glow. Wood is the frame's cypress, brass its bolts. The code cabinet
 * (the speaker stack's fallback) keeps these tokens too.
 */
export const INK = 0x160c14;
export const PLUM = 0x4b283d;
/** Outline widths (landscape design px): outer / interior. */
export const OUTLINE = 3.4;
export const LINE = 1.8;
/** Thin cool rim light (formula D) and the warm bounce from the floor. */
export const RIM = 0x9fe6ff;
export const BOUNCE = 0xff9a4a;

export const CAB = { face: 0x2c1636, light: 0x4b2858, shade: 0x1a0b21, grill: 0x2b1e36, hole: 0x0b0511, mount: 0x1b0e24 };
export const METAL = { base: 0x4a4466, light: 0x8d86ad, shade: 0x28223d, bolt: 0xcfc8df, dark: 0x1c1628 };
export const BRASS = { base: GOLD, shade: 0xe2861a, deep: 0x9a4a0c, light: 0xfff0a0 };
export const WOOD = { face: 0xd29039, grain: 0xb96e29, light: 0xda9b51, under: 0x5b261d, crack: 0x6b2c1c, dark: 0x8a4a22 };
export const CONE = { base: 0x3a2f4f, ring: 0x2a2140, light: 0x5d5078, shade: 0x1d1629 };
export const BUTTON = { base: 0xe8262e, shade: 0x9c1020, light: 0xff8a7a };
/** The frame's painted cypress (sampled from frame_beam: top light .. foot shadow). */
export const CYPRESS = { top: 0xa4683a, face: 0x8d5630, mid: 0x7f4d2b, low: 0x683e24, deep: 0x3a2019, grain: 0x4a2618 };

/**
 * Gradient fills of the baked parts. FillGradient owns a small texture; destroying it right after a
 * bake would pull it from under a live batch bind group, so gradients are cached by their stops for
 * the session (a few dozen: 128 px ramps, 64 px radial) and released with the Stage.
 */
const made = new Map<string, FillGradient>();

/** Linear ramp in the shape's local box (0..1), from (x0, y0) to (x1, y1); stops [offset, colour]. */
export const ramp = (stops: ReadonlyArray<readonly [number, number]>, x0 = 0.3, y0 = 0, x1 = 0.7, y1 = 1): FillGradient => {
  const key = `l${x0},${y0},${x1},${y1}|${stops.join(';')}`;
  let g = made.get(key);
  if (!g) {
    g = new FillGradient({
      type: 'linear',
      start: { x: x0, y: y0 },
      end: { x: x1, y: y1 },
      colorStops: stops.map(([offset, color]) => ({ offset, color })),
      textureSpace: 'local',
      textureSize: 128,
    });
    made.set(key, g);
  }
  return g;
};

/** Radial glossy ball / dome: hot spot at (cx, cy) of the local box, falling off to the rim. */
export const orb = (stops: ReadonlyArray<readonly [number, number]>, cx = 0.36, cy = 0.3, r = 0.78): FillGradient => {
  const key = `r${cx},${cy},${r}|${stops.join(';')}`;
  let g = made.get(key);
  if (!g) {
    g = new FillGradient({
      type: 'radial',
      center: { x: cx, y: cy },
      innerRadius: 0,
      outerCenter: { x: cx, y: cy },
      outerRadius: r,
      colorStops: stops.map(([offset, color]) => ({ offset, color })),
      textureSpace: 'local',
      textureSize: 64,
    });
    made.set(key, g);
  }
  return g;
};

/** Teardown (Stage.destroy): free the cached gradient textures. */
export const releaseGradients = (): void => {
  for (const g of made.values()) g.destroy();
  made.clear();
};

/** Mode skin -> trim / LED / glow colour (meter skins base / jukejam / megamix). */
export type StageSkin = 'base' | 'jukejam' | 'megamix';
export const SKIN_COLOR: Record<StageSkin, number> = { base: TEAL, jukejam: GOLD, megamix: PINK };

/** Gold corner protector with a bolt (the meter cabinet's corners), pointing into the corner (sx, sy). */
export const cornerCap = (g: Graphics, x: number, y: number, sx: number, sy: number, size: number): void => {
  g.poly([x, y, x - sx * size, y, x, y - sy * size], true)
    .fill(sx + sy > 0 ? BRASS.shade : BRASS.base)
    .stroke({ width: 3.5, color: INK, join: 'round' });
  const bx = x - sx * size * 0.28;
  const by = y - sy * size * 0.28;
  g.circle(bx, by, size * 0.115).fill(BRASS.light).stroke({ width: 1.8, color: INK });
  g.moveTo(bx - size * 0.065, by - size * 0.065)
    .lineTo(bx + size * 0.065, by + size * 0.065)
    .stroke({ width: 1.4, color: INK });
};

/** Round bolt head with a slot: a glossy dome lit from the top-left, one outline. */
export const bolt = (g: Graphics, x: number, y: number, r: number, color = METAL.bolt): void => {
  g.circle(x, y, r)
    .fill(orb([
      [0, 0xffffff],
      [0.35, color],
      [1, mixHex(color, 0x1a1030, 0.55)],
    ]))
    .stroke({ width: Math.max(1.1, r * 0.32), color: INK });
  g.moveTo(x - r * 0.55, y + r * 0.55)
    .lineTo(x + r * 0.55, y - r * 0.55)
    .stroke({ width: Math.max(0.9, r * 0.26), color: INK });
};

/** Linear RGB mix of two hex colours (t = 0 -> a). */
const mixHex = (a: number, b: number, t: number): number => {
  const m = (sh: number): number => Math.round(((a >> sh) & 255) * (1 - t) + ((b >> sh) & 255) * t) << sh;
  return m(16) | m(8) | m(0);
};
