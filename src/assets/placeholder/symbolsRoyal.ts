import type { Graphics, Rectangle, Renderer, Texture } from 'pixi.js';
import { FONTS } from '../fonts';
import { streak } from './cel';
import { bakeSquare, chunkyText, inkBox } from './chunky';
import { Light, OUTLINE, mix, shadeOf } from './palette';

/**
 * Royals (A K Q J 10): chunky extruded letters in the royal display face, one hue
 * per letter (SYMBOLS[id].color), plum extrusion, black outline, hard cel shadow
 * crescent and hand-placed specular streaks. A slight forward lean (skew) gives the
 * reference's dynamic "3D letter" read without any perspective filter.
 */

/** Streak placement per glyph, normalised to the glyph box (0..1): x0 y0 cx cy x1 y1 width. */
type StreakDef = [number, number, number, number, number, number, number];
const STREAKS: Record<string, StreakDef[]> = {
  A: [[0.36, 0.2, 0.28, 0.42, 0.2, 0.66, 0.034]],
  K: [[0.2, 0.2, 0.19, 0.4, 0.2, 0.6, 0.03]],
  Q: [[0.22, 0.52, 0.2, 0.28, 0.44, 0.17, 0.032]],
  J: [[0.62, 0.2, 0.63, 0.36, 0.63, 0.52, 0.03]],
  '10': [
    [0.12, 0.28, 0.14, 0.44, 0.15, 0.62, 0.025],
    [0.52, 0.52, 0.5, 0.28, 0.66, 0.19, 0.025],
  ],
};

const DEPTH = 9;

export const buildRoyal = (
  renderer: Renderer,
  glyph: string,
  color: number,
  canvas: number,
  cellScale: number,
  restAngle: number,
): Texture => {
  const light = new Light(restAngle);
  const target = 150 * cellScale - DEPTH;
  const two = glyph.length > 1;
  const probe = 100;
  const spacing = two ? -0.06 : 0;
  const box = inkBox({ text: glyph, fontFamily: FONTS.royal, fontSize: probe, letterSpacing: spacing * probe });
  const fontSize = probe * Math.min(target / box.height, (target * (two ? 1.04 : 0.98)) / box.width);
  const r = chunkyText({
    text: glyph,
    fontFamily: FONTS.royal,
    fontSize,
    letterSpacing: spacing * fontSize,
    light,
    base: color,
    shade: shadeOf(color, 0.3),
    shadeOff: 6,
    outline: OUTLINE,
    faceLine: 2.2,
    depth: DEPTH,
    extrusionLip: mix(0x6b3a57, color, 0.12),
    streaks: (g: Graphics, b: Rectangle) => {
      for (const [x0, y0, cx, cy, x1, y1, w] of STREAKS[glyph] ?? []) {
        const X = (u: number) => b.x + u * b.width;
        const Y = (v: number) => b.y + v * b.height;
        streak(g, X(x0), Y(y0), X(cx), Y(cy), X(x1), Y(y1), w * b.width);
      }
    },
  });
  r.view.skew.set(-0.06, 0);
  // centre the ink box (+ half the extrusion) on the canvas
  const off = light.off(DEPTH / 2);
  const cx = r.box.x + r.box.width / 2;
  const cy = r.box.y + r.box.height / 2;
  r.view.position.set(canvas / 2 - cx - off.x, canvas / 2 - cy - off.y);
  return bakeSquare(renderer, r.view, canvas, 2, r.textures);
};
