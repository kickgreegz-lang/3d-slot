import { FillGradient, Graphics, type Text } from 'pixi.js';
import type { GameContext } from '../../game/context';
import { hexEdge, hexPath } from './geometry';
import { HexButton, type HexButtonOptions } from './HexButton';
import { bonusIcon } from './icons';
import { HUD_COLORS, type TextPool, fitWidth, labelStyle } from './theme';

export type BuyLabelMode = 'edge' | 'below';

let accentRamp: FillGradient | null = null;
/** hot pink bleeding in from the lower-right, clear at the upper-left (reference) */
const accentFill = (): FillGradient =>
  (accentRamp ??= new FillGradient({
    type: 'linear',
    start: { x: 0.15, y: 0.1 },
    end: { x: 0.85, y: 0.95 },
    colorStops: [
      { offset: 0, color: 'rgba(248,40,200,0.10)' },
      { offset: 0.5, color: 'rgba(214,28,172,0.5)' },
      { offset: 1, color: 'rgba(248,40,200,0.88)' },
    ],
    textureSpace: 'local',
  }));

/**
 * Bonus-buy hex: the HUD's single hot accent. Pink rim + pink gradient fill over a
 * dark glass base, white icon, label t('bonusBuy') running along the lower-right
 * edge (large layouts) or centred under the hex (compact).
 */
export class BonusBuyButton extends HexButton {
  private readonly caption: Text;
  private labelMode: BuyLabelMode = 'edge';
  private labelSize = 28;

  constructor(ctx: GameContext, opts: Omit<HexButtonOptions, 'icon' | 'fill' | 'rim'>, texts: TextPool, text: string) {
    super(ctx, {
      ...opts,
      icon: bonusIcon,
      iconScale: 0.56,
      fill: { color: 0x000000, alpha: 1 },
      rim: { color: HUD_COLORS.accent, alpha: 0.95, width: 3.5 },
      rimHover: { color: 0xff7ae0, alpha: 1 },
    });
    this.caption = texts.make(text, labelStyle(28, HUD_COLORS.accent));
    this.face.addChild(this.caption);
  }

  setText(text: string): void {
    if (this.caption.text !== text) {
      this.caption.text = text;
      this.placeLabel();
    }
  }

  setLabelMode(mode: BuyLabelMode, size: number): void {
    this.labelMode = mode;
    this.labelSize = size;
    this.caption.style = labelStyle(size, HUD_COLORS.accent);
    this.placeLabel();
  }

  protected override drawFill(): Graphics {
    const { radius: r, tilt = 0, corner = 0.2 } = this.opts;
    const g = new Graphics();
    hexPath(g, r, tilt, corner).fill({ color: 0x0a0310, alpha: 0.55 });
    hexPath(g, r, tilt, corner).fill(accentFill());
    return g;
  }

  protected override drawRim(): Graphics {
    const { radius: r, tilt = 0, corner = 0.2, rim } = this.opts;
    const g = new Graphics();
    // faint dark keyline under the pink so it separates from busy mascot art
    hexPath(g, r, tilt, corner).stroke({ width: rim.width + 3, color: 0x000000, alpha: 0.35 });
    hexPath(g, r, tilt, corner).stroke({ width: rim.width, color: 0xffffff, alpha: 1 });
    return g;
  }

  protected override applyStatic(): void {
    super.applyStatic();
    // rim sprite carries a baked black keyline: tint only affects the white stroke visually
    this.iconSprite.tint = this.enabled ? 0xffffff : 0x9a9a9a;
  }

  private placeLabel(): void {
    const { radius: r, tilt = 0 } = this.opts;
    if (this.labelMode === 'below') {
      this.caption.rotation = 0;
      fitWidth(this.caption, r * 3);
      this.caption.position.set(0, r * 0.98 + this.labelSize * 0.55);
      return;
    }
    // edge 2 = lower-right edge of a pointy-top hex; read it bottom-left -> top-right
    const e = hexEdge(r, tilt, 2);
    let angle = e.angle;
    if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
    const nx = Math.cos(angle - Math.PI / 2);
    const ny = Math.sin(angle - Math.PI / 2);
    const out = -this.labelSize * 0.12;
    fitWidth(this.caption, r * 1.35);
    this.caption.rotation = angle;
    this.caption.position.set(e.x + nx * out, e.y + ny * out);
  }
}
