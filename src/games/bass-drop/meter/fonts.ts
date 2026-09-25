import { BitmapFont, type Renderer } from 'pixi.js';
import { FONTS } from '../../../assets/fonts';

/**
 * Groove Meter bitmap fonts (live text only, nothing baked into art):
 *  - `bd-meter-num`   Titan One, white, black stroke (~3 px visible at the 64 px counter), hard
 *                     plum drop shadow: the counter digits and the chip numbers;
 *  - `bd-meter-label` Bebas Neue, WHITE fill (tinted per use: #F8D828 "/60", pink "MAX",
 *                     gold / teal captions), black stroke: suffixes and chip captions.
 * BitmapText keeps per-arrival digit rolls cheap (quads, no canvas re-raster). Glyphs not
 * listed are added on demand by pixi's dynamic bitmap fonts (i18n copy).
 */
export const METER_NUM_FONT = 'bd-meter-num';
export const METER_LABEL_FONT = 'bd-meter-label';

let installed = false;

export const ensureMeterFonts = (renderer: Renderer): void => {
  if (installed) return;
  installed = true;
  const resolution = Math.min(2, Math.max(1, renderer.resolution));
  BitmapFont.install({
    name: METER_NUM_FONT,
    chars: [['0', '9'], ' /×x+-'],
    resolution,
    padding: 8,
    style: {
      fontFamily: FONTS.value,
      fontSize: 96,
      fill: 0xffffff,
      stroke: { color: 0x000000, width: 10, join: 'round' },
      dropShadow: { color: 0x4b283d, alpha: 1, blur: 0, distance: 5, angle: Math.atan2(0.83, 0.56) },
    },
  });
  BitmapFont.install({
    name: METER_LABEL_FONT,
    chars: [['A', 'Z'], ['0', '9'], ' /×x+-–!.,:'],
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
};
