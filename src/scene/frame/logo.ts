import { Container, Rectangle, type Renderer, type Texture } from 'pixi.js';
import { FONTS } from '../../assets/fonts';
import { streak } from '../../assets/placeholder/cel';
import { chunkyText } from '../../assets/placeholder/chunky';
import { INK, Light } from '../../assets/placeholder/palette';

/**
 * "SWAMP FUNK" word-mark in the title face: chunky letters with a thin top-left
 * outline and a heavy black extrusion to the lower-right (reference logo recipe),
 * per-word colour treatment (SWAMP two-tone lime with a hard diagonal light split,
 * FUNK hot-pink / orange / yellow bands) and a playful per-letter tilt + bob.
 * Baked once to a texture; the shine sweep is applied live by Frame.ts.
 */
interface LetterStyle {
  base: number;
  paint: 'lime' | 'bands';
}

const LIME = { light: 0xd4ff5c, base: 0x9be22d, shade: 0x5caa1e };
const BANDS = [0xff3fa8, 0xff7a1a, 0xffd21f];
const OUT = 3;
const DEPTH = 13;
const TILT = [-5, 3, -3, 4, -2, 0, 4, -4, 3, -5];
const BOB = [2, -4, 3, -3, 1, 0, -2, 3, -3, 2];

export interface LogoBake {
  texture: Texture;
}

export const buildLogo = (renderer: Renderer, text = 'SWAMP FUNK'): LogoBake => {
  const light = new Light(0);
  const fontSize = 132;
  const root = new Container();
  const temp: Texture[] = [];
  let x = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const words = text.split(' ');
  let li = 0;
  words.forEach((word, wi) => {
    const style: LetterStyle = wi === 0 ? { base: LIME.base, paint: 'lime' } : { base: BANDS[1], paint: 'bands' };
    for (const ch of word) {
      const r = chunkyText({
        text: ch,
        fontFamily: FONTS.title,
        fontSize,
        light,
        base: style.base,
        shade: style.paint === 'lime' ? LIME.shade : undefined,
        shadeOff: 6,
        outline: OUT,
        faceLine: 1.5,
        depth: DEPTH,
        extrusion: INK,
        extrusionLip: 0x2a1030,
        paint: (g, b) => {
          if (style.paint === 'lime') {
            // hard diagonal light split, top-left
            g.moveTo(b.x - 10, b.y - 10)
              .lineTo(b.x + b.width * 0.95, b.y - 10)
              .lineTo(b.x - 10, b.y + b.height * 0.62)
              .closePath()
              .fill(LIME.light);
          } else {
            const h = b.height;
            g.rect(b.x - 10, b.y - 10, b.width + 20, h * 0.36 + 10).fill(BANDS[0]);
            g.rect(b.x - 10, b.y + h * 0.68, b.width + 20, h * 0.32 + 10).fill(BANDS[2]);
            g.rect(b.x - 10, b.y + h * 0.36, b.width + 20, 3).fill(0xc41f7a);
            g.rect(b.x - 10, b.y + h * 0.68, b.width + 20, 3).fill(0xd0520e);
          }
        },
        streaks: (g, b) => streak(g, b.x + b.width * 0.18, b.y + b.height * 0.52, b.x + b.width * 0.16, b.y + b.height * 0.2, b.x + b.width * 0.42, b.y + b.height * 0.1, 3),
      });
      temp.push(...r.textures);
      const holder = new Container();
      holder.addChild(r.view);
      r.view.position.set(-(r.box.x + r.box.width / 2), -(r.box.y + r.box.height / 2));
      holder.angle = TILT[li % TILT.length];
      holder.position.set(x + r.box.width / 2, BOB[li % BOB.length]);
      root.addChild(holder);
      // visible extent: ink box + outline + extrusion, through the letter's tilt
      const ext = light.off(DEPTH);
      const hw = r.box.width / 2;
      const hh = r.box.height / 2;
      const cos = Math.cos(holder.rotation);
      const sin = Math.sin(holder.rotation);
      for (const [px, py] of [
        [-hw - OUT, -hh - OUT],
        [hw + OUT + ext.x, -hh - OUT],
        [-hw - OUT, hh + OUT + ext.y],
        [hw + OUT + ext.x, hh + OUT + ext.y],
      ]) {
        const gx = holder.x + px * cos - py * sin;
        const gy = holder.y + px * sin + py * cos;
        minX = Math.min(minX, gx);
        minY = Math.min(minY, gy);
        maxX = Math.max(maxX, gx);
        maxY = Math.max(maxY, gy);
      }
      x += r.box.width - 4;
      li++;
    }
    if (wi < words.length - 1) {
      x += fontSize * 0.22;
      li++;
    }
  });
  const frame = new Rectangle(minX - 2, minY - 2, maxX - minX + 4, maxY - minY + 4);
  const texture = renderer.generateTexture({ target: root, frame, resolution: 1.5, antialias: true });
  root.destroy({ children: true });
  for (const t of temp) t.destroy(true);
  return { texture };
};
