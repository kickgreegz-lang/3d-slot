import { BitmapFont, BitmapText, type Renderer } from 'pixi.js';
import { FONTS } from '../../../assets/fonts';

/**
 * Screen bitmap fonts (live text only, nothing is baked into the art):
 *  - `bd-scr-label` Bebas Neue, WHITE fill (tinted per use: caption yellow, body white,
 *                   feature gold / pink), black stroke: captions, card body copy, prompts;
 *  - `bd-scr-num`   Titan One, white, black stroke, hard plum drop shadow: counts, prices,
 *                   button labels, the "3 / 8" plate value.
 * Big display titles use the engine glyph baker (present/common/Title) and the TOTAL WIN
 * amount the engine gold amount font. Glyphs not listed are added on demand by pixi's
 * dynamic bitmap fonts (i18n copy in other languages).
 */
export const SCR_LABEL = 'bd-scr-label';
export const SCR_NUM = 'bd-scr-num';

let installed = false;

export const ensureScreenFonts = (renderer: Renderer): void => {
  if (installed) return;
  installed = true;
  const resolution = Math.min(2, Math.max(1, renderer.resolution));
  BitmapFont.install({
    name: SCR_LABEL,
    chars: [['A', 'Z'], ['a', 'z'], ['0', '9'], " /×x+-–!?.,:'’$€£%()"],
    resolution,
    padding: 6,
    style: {
      fontFamily: FONTS.label,
      fontSize: 64,
      fill: 0xffffff,
      stroke: { color: 0x000000, width: 9, join: 'round' },
      letterSpacing: 2,
    },
  });
  BitmapFont.install({
    name: SCR_NUM,
    chars: [['A', 'Z'], ['0', '9'], " /×x+-.,:$€£%'"],
    resolution,
    padding: 8,
    style: {
      fontFamily: FONTS.value,
      fontSize: 96,
      fill: 0xffffff,
      stroke: { color: 0x000000, width: 11, join: 'round' },
      dropShadow: { color: 0x4b283d, alpha: 1, blur: 0, distance: 6, angle: Math.atan2(0.83, 0.56) },
    },
  });
};

/** Centred BitmapText in one of the screen fonts. */
export const screenText = (font: string, size: number, tint = 0xffffff, anchorY = 0.5): BitmapText => {
  const t = new BitmapText({ text: '', style: { fontFamily: font, fontSize: size }, anchor: { x: 0.5, y: anchorY } });
  t.tint = tint;
  return t;
};

/** Wrapped, centred body copy (card bodies). */
export const bodyText = (size: number, wrap: number, tint = 0xffffff): BitmapText => {
  const t = new BitmapText({
    text: '',
    style: { fontFamily: SCR_LABEL, fontSize: size, wordWrap: true, wordWrapWidth: wrap, align: 'center', lineHeight: size * 1.08 },
    anchor: { x: 0.5, y: 0 },
  });
  t.tint = tint;
  return t;
};

/** Scale a text down (never up) so it fits `max` design px wide. */
export const fitText = (t: { width: number; scale: { set(v: number): void } }, max: number, base = 1): void => {
  t.scale.set(base);
  if (t.width > max) t.scale.set((base * max) / t.width);
};
