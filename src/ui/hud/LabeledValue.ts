import { gsap } from 'gsap';
import { Container, type Text } from 'pixi.js';
import { sUi } from '../../core/timing';
import { HUD_TIMING } from './hudTiming';
import { type TextPool, fitWidth, labelStyle, valueStyle } from './theme';

/** left/center/right: label stacked over value; row: [LABEL value] on one line. */
export type Align = 'left' | 'center' | 'right' | 'row';

/**
 * Yellow condensed LABEL + white VALUE (BALANCE / BET).
 * Stacked aligns: origin = the label's baseline, the value hangs below it.
 * Row: origin = centre of the single line (compact column saves a text row).
 */
export class LabeledValue extends Container {
  private readonly caption: Text;
  private readonly value: Text;
  private align: Align = 'left';
  private maxWidth = 400;
  private gap = 6;
  private valueSize = 40;

  constructor(texts: TextPool, labelText: string, name: string) {
    super({ label: name });
    this.caption = texts.make(labelText, labelStyle(28), 0, 1);
    this.value = texts.make('', valueStyle(40), 0, 0);
    this.addChild(this.caption, this.value);
  }

  configure(opts: { align: Align; labelSize: number; valueSize: number; maxWidth: number }): void {
    this.align = opts.align;
    this.maxWidth = opts.maxWidth;
    this.valueSize = opts.valueSize;
    this.caption.style = labelStyle(opts.labelSize);
    this.value.style = valueStyle(opts.valueSize);
    if (opts.align === 'row') {
      this.gap = Math.round(opts.labelSize * 0.4);
      this.caption.anchor.set(0, 0.5);
      this.value.anchor.set(0, 0.5);
    } else {
      this.gap = Math.round(opts.labelSize * 0.12);
      const ax = opts.align === 'left' ? 0 : opts.align === 'center' ? 0.5 : 1;
      this.caption.anchor.set(ax, 1);
      this.value.anchor.set(ax, 0);
      this.caption.position.set(0, 0);
      this.value.position.set(0, this.gap);
    }
    this.refit();
  }

  setLabel(text: string): void {
    if (this.caption.text === text) return;
    this.caption.text = text;
    this.refit();
  }

  /** Set the value text; `bump` plays a small settle so changes are noticed. */
  setValue(text: string, bump = false): void {
    if (this.value.text === text) return;
    this.value.text = text;
    this.refit();
    if (bump) {
      const k = this.value.scale.x;
      gsap.fromTo(
        this.value.scale,
        { x: k * 1.08, y: k * 1.08 },
        { x: k, y: k, duration: sUi(HUD_TIMING.valueBump * 1.6), ease: 'back.out(3)', overwrite: true },
      );
    }
  }

  private refit(): void {
    gsap.killTweensOf(this.value.scale);
    if (this.align !== 'row') {
      fitWidth(this.value, this.maxWidth);
      fitWidth(this.caption, this.maxWidth);
      return;
    }
    this.caption.scale.set(1);
    this.value.scale.set(1);
    const lw = this.caption.width;
    const vw = this.value.width;
    const total = lw + this.gap + vw;
    const k = total > this.maxWidth ? this.maxWidth / total : 1;
    this.caption.scale.set(k);
    this.value.scale.set(k);
    const left = (-total * k) / 2;
    this.caption.position.set(left, this.valueSize * 0.04 * k);
    this.value.position.set(left + (lw + this.gap) * k, 0);
  }
}
