import { Container, GraphicsPath, type Renderer, type Texture } from 'pixi.js';
import { SYMBOLS } from '../config';
import { FONTS } from '../../../assets/fonts';
import { CelCanvas, sparkle, streak } from '../../../assets/placeholder/cel';
import { chunkyText, inkBox } from '../../../assets/placeholder/chunky';
import { GOLD, INK, LINE, Light, OUTLINE, PLUM, WHITE, mix } from '../../../assets/placeholder/palette';
import { roundedPoly, seal } from '../../../assets/placeholder/shapes';

/**
 * Specials: W (turquoise neon-badge starburst with a hot-pink ribbon and the word
 * WILD set live in the title face) and S (Golden vintage capsule mic + sparkles).
 * Both are bigger than the highs (cellScale ~1.02 / 1.12) per the style bible.
 */

// ---------------------------------------------------------------------------
// W — Wild badge

export const buildWild = (renderer: Renderer, size: number): Texture => {
  const light = new Light(SYMBOLS.W.restAngle);
  const c = new CelCanvas(light, size);
  const TEAL = { base: 0x35f2e0, shade: 0x13aebd, light: 0xb4fff6, deep: 0x0b3b52 };
  const PINK = { base: 0xff3fa8, shade: 0xc41f7a, light: 0xff9ad4, back: 0x8e1558 };
  const cx = 88;
  const cy = 84;
  const badge = seal(cx, cy, 60, 80, 14, -Math.PI / 2);
  const ribbon = new GraphicsPath()
    .moveTo(14, 92)
    .bezierCurveTo(50, 82, 126, 82, 162, 92)
    .lineTo(162, 124)
    .bezierCurveTo(126, 114, 50, 114, 14, 124)
    .closePath();
  const tailL = roundedPoly([
    [4, 102, 2],
    [26, 98, 2],
    [26, 132, 2],
    [4, 134, 2],
    [12, 118, 1],
  ]);
  const tailR = roundedPoly([
    [172, 102, 2],
    [150, 98, 2],
    [150, 132, 2],
    [172, 134, 2],
    [164, 118, 1],
  ]);

  c.body([tailL, tailR, badge, ribbon], 8, OUTLINE, mix(TEAL.deep, PLUM, 0.35));
  for (const t of [tailL, tailR]) c.part({ shape: t, fill: PINK.back, shade: mix(PINK.back, INK, 0.3), shadeOff: 3 });
  c.part({
    shape: badge,
    fill: TEAL.base,
    shade: TEAL.shade,
    shadeOff: 9,
    shadeShrink: 0.03,
    rim: TEAL.light,
    rimOff: 4,
  });
  // inner disc with sunburst rays (recessed)
  c.part({
    shape: new GraphicsPath().circle(cx, cy, 50),
    fill: 0x1ccfcf,
    shade: 0x0f8f9e,
    shadeOff: -6,
    paint: (g) => {
      for (let i = 0; i < 16; i += 2) {
        const a0 = (i / 16) * Math.PI * 2 - Math.PI / 2;
        const a1 = ((i + 1) / 16) * Math.PI * 2 - Math.PI / 2;
        g.moveTo(cx, cy)
          .lineTo(cx + Math.cos(a0) * 60, cy + Math.sin(a0) * 60)
          .lineTo(cx + Math.cos(a1) * 60, cy + Math.sin(a1) * 60)
          .closePath()
          .fill({ color: 0xffffff, alpha: 0.13 });
      }
      streak(g, cx - 40, cy - 6, cx - 38, cy - 34, cx - 12, cy - 44, 2.6);
    },
  });
  // gator teeth along the top of the disc
  c.ink((g) => {
    for (const [tx, h] of [
      [cx - 20, 11],
      [cx - 7, 14],
      [cx + 7, 14],
      [cx + 20, 11],
    ] as const) {
      const y0 = cy - 44 + Math.abs(tx - cx) * 0.18;
      g.moveTo(tx - 6, y0).quadraticCurveTo(tx - 2, y0 + h, tx, y0 + h + 1).quadraticCurveTo(tx + 2, y0 + h, tx + 6, y0).closePath()
        .fill(WHITE)
        .stroke({ width: LINE * 0.8, color: INK, join: 'round' });
    }
  });
  c.part({
    shape: ribbon,
    fill: PINK.base,
    shade: PINK.shade,
    shadeOff: 6,
    rim: PINK.light,
    rimOff: 3,
  });

  // WILD word-mark
  const probe = inkBox({ text: 'WILD', fontFamily: FONTS.title, fontSize: 100 });
  const fontSize = 100 * Math.min(118 / probe.width, 40 / probe.height);
  const word = chunkyText({
    text: 'WILD',
    fontFamily: FONTS.title,
    fontSize,
    light,
    base: 0xfff27a,
    shade: 0xffb21e,
    shadeOff: 4,
    outline: OUTLINE,
    faceLine: 1.8,
    depth: 5,
    extrusion: PLUM,
    paint: (g, b) => {
      g.rect(b.x - 4, b.y + b.height * 0.56, b.width + 8, b.height).fill({ color: 0xffb21e, alpha: 0.55 });
    },
    streaks: (g, b) => {
      streak(g, b.x + b.width * 0.06, b.y + b.height * 0.2, b.x + b.width * 0.3, b.y + b.height * 0.1, b.x + b.width * 0.55, b.y + b.height * 0.16, 1.6);
    },
  });
  const holder = new Container();
  holder.addChild(word.view);
  word.view.position.set(-(word.box.x + word.box.width / 2), -(word.box.y + word.box.height / 2));
  holder.position.set(cx, 103);
  holder.rotation = -0.04;
  c.overlay(holder);
  c.ink((g) => {
    sparkle(g, 150, 30, 11, 0.2);
    sparkle(g, 26, 40, 7, 0.22);
  });
  const tex = c.bake(renderer);
  for (const t of word.textures) t.destroy(true);
  return tex;
};

// ---------------------------------------------------------------------------
// S — Golden vintage mic (scatter)

export const buildMic = (renderer: Renderer, size: number): Texture => {
  const c = new CelCanvas(new Light(SYMBOLS.S.restAngle), size);
  const EXT = mix(GOLD.deep, PLUM, 0.45);
  const head = new GraphicsPath()
    .moveTo(90, 8)
    .bezierCurveTo(122, 8, 136, 30, 136, 58)
    .bezierCurveTo(136, 90, 122, 114, 90, 116)
    .bezierCurveTo(58, 114, 44, 90, 44, 58)
    .bezierCurveTo(44, 30, 58, 8, 90, 8)
    .closePath();
  const grille = new GraphicsPath()
    .moveTo(90, 19)
    .bezierCurveTo(115, 19, 125, 36, 125, 58)
    .bezierCurveTo(125, 84, 115, 103, 90, 105)
    .bezierCurveTo(65, 103, 55, 84, 55, 58)
    .bezierCurveTo(55, 36, 65, 19, 90, 19)
    .closePath();
  const yoke = roundedPoly([
    [34, 58, 0],
    [34, 104, 30],
    [90, 140, 30],
    [146, 104, 30],
    [146, 58, 0],
    [135, 58, 0],
    [135, 100, 24],
    [90, 129, 24],
    [45, 100, 24],
    [45, 58, 0],
  ]);
  const knobs = new GraphicsPath().circle(39.5, 62, 9).circle(140.5, 62, 9);
  const neck = new GraphicsPath().roundRect(81, 132, 18, 16, 4);
  const collar = new GraphicsPath().roundRect(77, 145, 26, 12, 5);
  const pole = new GraphicsPath().roundRect(85, 154, 10, 24, 2);

  c.body([pole, collar, neck, yoke, knobs, head], 8, OUTLINE, EXT);
  c.part({ shape: pole, fill: GOLD.base, shade: GOLD.shade, shadeOff: 3.5, paint: (g) => g.rect(86.8, 157, 2.2, 18).fill(WHITE) });
  c.part({ shape: collar, fill: GOLD.base, shade: GOLD.shade, shadeOff: 4, rim: GOLD.light, rimOff: 2.5 });
  c.part({ shape: neck, fill: GOLD.base, shade: GOLD.shade, shadeOff: 4 });
  c.part({
    shape: yoke,
    fill: GOLD.base,
    shade: GOLD.shade,
    shadeOff: 5,
    rim: GOLD.light,
    rimOff: 3,
  });
  c.part({
    shape: head,
    fill: GOLD.base,
    shade: GOLD.shade,
    shadeOff: 10,
    shadeShrink: 0.04,
    rim: GOLD.light,
    rimOff: 5,
    paint: (g) => {
      streak(g, 50, 72, 49, 40, 70, 17, 2.8);
    },
  });
  // grille: deep slots with gold ribs and a centre spine
  c.part({
    shape: grille,
    fill: GOLD.deep,
    paint: (g) => {
      for (let y = 25; y < 104; y += 9) {
        g.rect(50, y, 80, 5).fill(GOLD.shade);
        g.rect(50, y, 80, 2).fill(GOLD.base);
      }
      g.rect(86, 14, 8, 96).fill(GOLD.base);
      g.rect(86, 14, 2.6, 96).fill(GOLD.light);
      g.rect(91.5, 14, 2.5, 96).fill(GOLD.shade);
      streak(g, 60, 40, 64, 28, 76, 23, 2);
    },
  });
  c.part({
    shape: knobs,
    fill: GOLD.base,
    shade: GOLD.shade,
    shadeOff: 3,
    paint: (g) => {
      g.circle(39.5, 62, 3.4).fill(GOLD.deep);
      g.circle(140.5, 62, 3.4).fill(GOLD.deep);
      g.circle(36.5, 58.5, 2).fill(WHITE);
      g.circle(137.5, 58.5, 2).fill(WHITE);
    },
  });
  c.ink((g) => {
    sparkle(g, 150, 18, 13, 0.18);
    sparkle(g, 162, 44, 6, 0.24);
    sparkle(g, 24, 26, 7, 0.22);
  });
  return c.bake(renderer);
};
