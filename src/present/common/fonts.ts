import { BitmapFont, FillGradient, type Renderer } from 'pixi.js';
import { FONTS } from '../../assets/fonts';
import type { MoneyApi } from '../../money/format';

/**
 * Bitmap fonts for numbers that change every frame (count-ups, cluster labels,
 * counters): BitmapText re-lays out quads instead of re-rasterising a canvas.
 * Installed lazily with only the glyphs the current currency format needs
 * (missing glyphs are still added on demand by pixi's dynamic bitmap fonts).
 */
export const VALUE_FONT = 'fx-value';
export const AMOUNT_FONT = 'fx-amount';
export const LABEL_FONT = 'fx-label';

const installed = new Set<string>();

const charsFor = (money: MoneyApi, extra: string): string[] => {
  const sample = money.format(1_234_567_890) + money.format(0);
  return [...new Set([...`0123456789.,+-x×/ ${extra}`, ...sample])];
};

const resolutionFor = (renderer: Renderer): number => Math.min(2, Math.max(1, renderer.resolution));

/** White value numerals with a black outline and plum extrusion (cluster labels, plates). */
export const ensureValueFont = (renderer: Renderer, money: MoneyApi): string => {
  if (!installed.has(VALUE_FONT)) {
    BitmapFont.install({
      name: VALUE_FONT,
      chars: charsFor(money, ''),
      resolution: resolutionFor(renderer),
      padding: 6,
      style: {
        fontFamily: FONTS.value,
        fontSize: 64,
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 9, join: 'round' },
        dropShadow: { color: 0x4b283d, alpha: 1, blur: 0, distance: 5, angle: Math.atan2(0.83, 0.56) },
      },
    });
    installed.add(VALUE_FONT);
  }
  return VALUE_FONT;
};

/** Big gold count-up numerals with hard cel bands (big win / total win). */
export const ensureAmountFont = (renderer: Renderer, money: MoneyApi): string => {
  if (!installed.has(AMOUNT_FONT)) {
    const fill = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      textureSpace: 'local',
      colorStops: [
        { offset: 0, color: '#ffffff' },
        { offset: 0.3, color: '#ffffff' },
        { offset: 0.3001, color: '#fff0a8' },
        { offset: 0.56, color: '#fff0a8' },
        { offset: 0.5601, color: '#ffcd3a' },
        { offset: 0.8, color: '#ffcd3a' },
        { offset: 0.8001, color: '#f59a18' },
        { offset: 1, color: '#f59a18' },
      ],
    });
    BitmapFont.install({
      name: AMOUNT_FONT,
      chars: charsFor(money, ''),
      resolution: resolutionFor(renderer),
      padding: 10,
      style: {
        fontFamily: FONTS.value,
        fontSize: 120,
        fill,
        stroke: { color: 0x000000, width: 14, join: 'round' },
        dropShadow: { color: 0x4b283d, alpha: 1, blur: 0, distance: 10, angle: Math.atan2(0.83, 0.56) },
      },
    });
    installed.add(AMOUNT_FONT);
  }
  return AMOUNT_FONT;
};

/** Yellow condensed HUD-style labels ("FREE SPINS", "WIN"). */
export const ensureLabelFont = (renderer: Renderer): string => {
  if (!installed.has(LABEL_FONT)) {
    BitmapFont.install({
      name: LABEL_FONT,
      chars: [['A', 'Z'], ['0', '9'], ' +-/×x!.,:'],
      resolution: resolutionFor(renderer),
      padding: 4,
      style: {
        fontFamily: FONTS.labelHeavy,
        fontSize: 40,
        fill: 0xf8d828,
        stroke: { color: 0x000000, width: 6, join: 'round' },
        letterSpacing: 2,
      },
    });
    installed.add(LABEL_FONT);
  }
  return LABEL_FONT;
};
