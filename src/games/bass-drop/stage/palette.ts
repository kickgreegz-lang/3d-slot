import type { Graphics } from 'pixi.js';
import { GOLD, PINK, TEAL } from '../timing';

/**
 * Stage placeholder palette: the ART_BIBLE cel language (pure-black outline, one flat base,
 * hard shadow / light bands, plum extrusion toward the lower right, key light top-left, no
 * baked glow) in the colours the Groove Meter cabinet already uses, so the speaker stack
 * reads as one piece of furniture. Skin colours follow the meter trim per mode.
 */
export const INK = 0x000000;
export const PLUM = 0x4b283d;
/** Outline widths (landscape design px): outer / interior. */
export const OUTLINE = 4.6;
export const LINE = 2.6;

export const CAB = { face: 0x2c1636, light: 0x4b2858, shade: 0x1a0b21, grill: 0x2b1e36, hole: 0x0b0511, mount: 0x1b0e24 };
export const METAL = { base: 0x4a4466, light: 0x8d86ad, shade: 0x28223d, bolt: 0xcfc8df, dark: 0x1c1628 };
export const BRASS = { base: GOLD, shade: 0xe2861a, deep: 0x9a4a0c, light: 0xfff0a0 };
export const WOOD = { face: 0xd29039, grain: 0xb96e29, light: 0xda9b51, under: 0x5b261d, crack: 0x6b2c1c, dark: 0x8a4a22 };
export const CONE = { base: 0x3a2f4f, ring: 0x2a2140, light: 0x5d5078, shade: 0x1d1629 };
export const BUTTON = { base: 0xe8262e, shade: 0x9c1020, light: 0xff8a7a };

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

/** Round bolt head with a slot (metal, key light top-left). */
export const bolt = (g: Graphics, x: number, y: number, r: number, color = METAL.bolt): void => {
  g.circle(x, y, r).fill(color).stroke({ width: Math.max(1.2, r * 0.38), color: INK });
  g.moveTo(x - r * 0.55, y + r * 0.55)
    .lineTo(x + r * 0.55, y - r * 0.55)
    .stroke({ width: Math.max(1, r * 0.3), color: INK });
};
