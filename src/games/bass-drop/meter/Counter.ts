import { gsap } from 'gsap';
import { BitmapText, Container, Graphics } from 'pixi.js';
import { followSpeed } from '../../../core/timing';
import { label } from '../../../present/common/text';
import { GROOVE } from '../config';
import { PINK } from '../timing';
import { METER_LABEL_FONT, METER_NUM_FONT } from './fonts';
import { GEOM, R_REF } from './geometry';

const SUFFIX = 0xf8d828;
/** widest the value group may get on the dust cap (rig units) */
const MAX_W = R_REF * GEOM.counterR * 1.86;
const MAX_LAP_PIPS = 5;

/**
 * The live counter in the rig's `txt_count` slot: "23" (Titan One) + "/60" (Bebas Neue at
 * 0.47x, #F8D828), or the real value + a pink MAX tag at 60+ (DESIGN §6.7). The fallback
 * lap pips (a book listing a threshold above 60) sit above the digits. The group re-centres
 * and fits itself to the dust cap whenever the text changes.
 */
export class Counter {
  readonly view = new Container({ label: 'txt_count' });
  private readonly group = new Container();
  private readonly num: BitmapText;
  private readonly suffix: BitmapText;
  private readonly lapText: BitmapText;
  private readonly pips = new Graphics();
  private fontPx = 64;
  private text = '';
  private suffixKey = '';
  private lap = 0;
  private punchTween: gsap.core.Tween | null = null;

  constructor() {
    this.num = new BitmapText({ text: '0', style: { fontFamily: METER_NUM_FONT, fontSize: 64 }, anchor: { x: 0, y: 0.5 } });
    this.suffix = new BitmapText({ text: '', style: { fontFamily: METER_LABEL_FONT, fontSize: 30 }, anchor: { x: 0, y: 0.5 } });
    this.lapText = new BitmapText({ text: '', style: { fontFamily: METER_LABEL_FONT, fontSize: 24 }, anchor: 0.5 });
    this.lapText.tint = PINK;
    this.lapText.visible = false;
    this.group.addChild(this.num, this.suffix);
    this.view.addChild(this.group, this.pips, this.lapText);
  }

  /** Digit size in rig units (DESIGN §6.1 sizes / rig scale). */
  setFontSize(px: number): void {
    if (Math.abs(px - this.fontPx) < 0.01) return;
    this.fontPx = px;
    this.num.style.fontSize = px;
    this.suffix.style.fontSize = px * 0.47;
    this.lapText.style.fontSize = px * 0.4;
    this.arrange();
    this.drawPips();
  }

  /** Show `value`; `max` swaps "/60" for the MAX tag; `lap` = full laps in the fallback mode. */
  set(value: number, max: boolean, lap = 0): void {
    const text = String(Math.max(0, Math.round(value)));
    const suffixKey = max ? 'max' : 'of';
    const lapChanged = lap !== this.lap;
    if (text === this.text && suffixKey === this.suffixKey && !lapChanged) return;
    this.text = text;
    this.num.text = text;
    if (suffixKey !== this.suffixKey) {
      this.suffixKey = suffixKey;
      this.suffix.text = max ? label('bd.meter.max', 'MAX') : label('bd.meter.of', '/{max}', { max: GROOVE.displayMax });
      this.suffix.tint = max ? PINK : SUFFIX;
    }
    if (lapChanged) {
      this.lap = lap;
      this.drawPips();
    }
    this.arrange();
  }

  /**
   * Inline "23/60" when it fits the cap; otherwise ("118 MAX") the tag goes under the digits so
   * the digits keep their full size (readability gate: >= 19 CSS px at Mobile S portrait).
   */
  private arrange(): void {
    const gap = this.fontPx * 0.06;
    const numW = this.num.width;
    const sufW = this.suffix.width;
    const inline = numW + gap + sufW;
    if (inline <= MAX_W) {
      this.num.position.set(-inline / 2, 0);
      // bottoms line up: the suffix sits on the digits' baseline
      this.suffix.position.set(-inline / 2 + numW + gap, this.fontPx * 0.17);
      this.group.scale.set(1);
      return;
    }
    this.num.position.set(-numW / 2, -this.fontPx * 0.14);
    this.suffix.position.set(-sufW / 2, this.fontPx * 0.44);
    const w = Math.max(numW, sufW);
    this.group.scale.set(w > MAX_W ? MAX_W / w : 1);
  }

  private drawPips(): void {
    const g = this.pips.clear();
    const n = this.lap;
    this.lapText.visible = n > MAX_LAP_PIPS;
    const y = -this.fontPx * 0.72;
    if (n <= 0) return;
    if (n > MAX_LAP_PIPS) {
      this.lapText.text = label('bd.meter.laps', '×{n}', { n });
      this.lapText.position.set(0, y);
      return;
    }
    const r = this.fontPx * 0.07;
    for (let i = 0; i < MAX_LAP_PIPS; i++) {
      const x = (i - (MAX_LAP_PIPS - 1) / 2) * r * 3;
      g.circle(x, y, r).fill(i < n ? PINK : 0x2a2440).stroke({ width: 1.5, color: 0x000000 });
    }
  }

  /** Counter punch 1.0 -> peak -> 1.0 (the caller throttles it). */
  punch(peak: number, sec: number): void {
    this.punchTween?.kill();
    this.view.scale.set(peak);
    this.punchTween = followSpeed(gsap.to(this.view.scale, { x: 1, y: 1, duration: sec, ease: 'power2.out' }));
  }

  destroy(): void {
    this.punchTween?.kill();
    this.view.destroy({ children: true });
  }
}
