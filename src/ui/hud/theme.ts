import { Text, type TextStyleOptions } from 'pixi.js';
import { FONTS } from '../../assets/fonts';

/**
 * HUD visual language (reference "UI KIT"): small, translucent, low-chroma hex
 * controls so the art dominates; ONE hot accent (bonus pink) plus the saturated
 * yellow HUD labels. All values are design px at the layout's base font sizes.
 */
export const HUD_COLORS = {
  label: 0xfcd828,
  value: 0xffffff,
  ink: 0x000000,
  /** small hex: near-black fill at 85 % with a 2 px grey rim */
  smallFill: 0x0c0a10,
  smallFillAlpha: 0.85,
  smallRim: 0x8a8a8a,
  smallRimHover: 0xd6d6d6,
  /** spin: black at 30 % with a 2 px white rim at 60 % */
  spinFill: 0x000000,
  spinFillAlpha: 0.3,
  spinRim: 0xffffff,
  spinRimAlpha: 0.6,
  spinIcon: 0xededed,
  /** icon grey ramp (key light from the top-left) */
  iconTop: 0xeeeeee,
  iconBottom: 0x8e8e8e,
  iconDisabled: 0x5a5a5a,
  /** the single hot accent */
  accent: 0xf828c8,
  accentDeep: 0x7a0a62,
  turboOn: 0xfcd828,
  replay: 0xff3b4e,
} as const;

export const HUD_FONTS = {
  label: FONTS.labelHeavy,
  value: FONTS.value,
} as const;

/** stroke width as a fraction of the font size (reference: ~2-3 px at 23 px caps) */
const LABEL_STROKE = 0.2;

export const labelStyle = (size: number, color: number = HUD_COLORS.label): TextStyleOptions => ({
  fontFamily: HUD_FONTS.label,
  fontSize: size,
  fill: color,
  letterSpacing: size * 0.04,
  stroke: { color: HUD_COLORS.ink, width: Math.max(2, size * LABEL_STROKE), join: 'round' },
  padding: Math.ceil(size * 0.25),
});

export const valueStyle = (size: number, color: number = HUD_COLORS.value): TextStyleOptions => ({
  fontFamily: [HUD_FONTS.value, 'sans-serif'],
  fontSize: size,
  fill: color,
  stroke: { color: HUD_COLORS.ink, width: Math.max(1.5, size * 0.07), join: 'round' },
  dropShadow: { color: HUD_COLORS.ink, alpha: 0.6, blur: size * 0.06, distance: size * 0.06, angle: Math.PI / 3 },
  padding: Math.ceil(size * 0.3),
});

/**
 * Text registry: every HUD Text is re-rasterised at the exact device resolution on
 * layout change (contain-scale x renderer resolution), so small layouts such as the
 * 400x225 popout get hinted, crisp glyphs instead of a minified bitmap.
 */
export class TextPool {
  private items = new Set<Text>();
  private resolution = 1;

  make(text: string, style: TextStyleOptions, anchorX = 0.5, anchorY = 0.5): Text {
    const t = new Text({ text, style, resolution: this.resolution });
    t.anchor.set(anchorX, anchorY);
    this.items.add(t);
    return t;
  }

  setResolution(res: number): void {
    this.resolution = res;
    for (const t of this.items) t.resolution = res;
  }

  get current(): number {
    return this.resolution;
  }
}

/** Scale `t` down (never up) so it fits `maxWidth` design px. */
export const fitWidth = (t: Text, maxWidth: number, base = 1): void => {
  t.scale.set(base);
  const w = t.width;
  if (w > maxWidth && w > 0) t.scale.set((base * maxWidth) / w);
};
