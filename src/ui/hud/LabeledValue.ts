import { gsap } from 'gsap';
import { Container, type Text } from 'pixi.js';
import { sUi } from '../../core/timing';
import { HUD_TIMING } from './hudTiming';
import { type TextPool, fitWidth, labelStyle, valueStyle } from './theme';

export type Align = 'left' | 'center' | 'right';

/**
 * Yellow condensed LABEL over a white VALUE (BALANCE / BET). The container origin
 * is the label's baseline: label sits above y=0, value hangs below it.
 */
export class LabeledValue extends Container {
  private readonly caption: Text;
  private readonly value: Text;
  private maxWidth = 400;
  private gap = 6;

  constructor(texts: TextPool, labelText: string, name: string) {
    super({ label: name });
    this.caption = texts.make(labelText, labelStyle(28), 0, 1);
    this.value = texts.make('', valueStyle(40), 0, 0);
    this.addChild(this.caption, this.value);
  }

  configure(opts: { align: Align; labelSize: number; valueSize: number; maxWidth: number }): void {
    this.maxWidth = opts.maxWidth;
    this.gap = Math.round(opts.labelSize * 0.12);
    this.caption.style = labelStyle(opts.labelSize);
    this.value.style = valueStyle(opts.valueSize);
    const ax = opts.align === 'left' ? 0 : opts.align === 'center' ? 0.5 : 1;
    this.caption.anchor.set(ax, 1);
    this.value.anchor.set(ax, 0);
    this.value.y = this.gap;
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
    fitWidth(this.value, this.maxWidth);
    fitWidth(this.caption, this.maxWidth);
  }
}
