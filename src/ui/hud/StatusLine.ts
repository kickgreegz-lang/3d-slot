import { Container, type Text } from 'pixi.js';
import { clock } from '../../core/clock';
import { HUD_COLORS, type TextPool, fitWidth, labelStyle } from './theme';

/**
 * Top-left status line (reference: "GAME NAME | 23:50"): title, local clock and the
 * jurisdiction widgets the flow provides (RTP, net position, session timer).
 * The clock is read from Date once per second of UI time — display only.
 * Hides itself while it has nothing to show (compact without jurisdiction extras).
 */
export class StatusLine extends Container {
  private readonly line: Text;
  private extras: string[] = [];
  private acc = 1;
  private minute = -1;
  private titleOn = true;
  private clockOn = true;
  /** extras on their own line under title | clock (keeps them clear of the landscape logo) */
  private split = false;
  private maxWidth = Number.POSITIVE_INFINITY;
  private readonly offTick: () => void;

  constructor(
    texts: TextPool,
    private readonly title: string,
  ) {
    super({ label: 'status' });
    this.line = texts.make('', labelStyle(26, HUD_COLORS.value), 0, 0);
    this.line.alpha = 0.92;
    this.addChild(this.line);
    this.offTick = clock.onUpdate(() => {
      this.acc += clock.realDt;
      if (this.acc < 1) return;
      this.acc = 0;
      const m = new Date().getMinutes();
      if (this.clockOn && m !== this.minute) this.render();
    });
  }

  configure(opts: {
    size: number;
    showTitle: boolean;
    showClock: boolean;
    split: boolean;
    maxWidth: number;
    anchorX: number;
    anchorY: number;
  }): void {
    this.line.style = { ...labelStyle(opts.size, HUD_COLORS.value), lineHeight: Math.round(opts.size * 1.15) };
    this.line.anchor.set(opts.anchorX, opts.anchorY);
    this.titleOn = opts.showTitle;
    this.clockOn = opts.showClock;
    this.split = opts.split;
    this.maxWidth = opts.maxWidth;
    this.render();
  }

  /** Jurisdiction texts (null entries are skipped). */
  setExtras(items: Array<string | null | undefined>): void {
    const next = items.filter((s): s is string => typeof s === 'string' && s.length > 0);
    if (next.join('|') === this.extras.join('|')) return;
    this.extras = next;
    this.render();
  }

  private render(): void {
    const d = new Date();
    this.minute = d.getMinutes();
    const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const head: string[] = [];
    if (this.titleOn) head.push(this.title.toUpperCase());
    if (this.clockOn) head.push(hhmm);
    const sep = '  |  ';
    const extras = this.extras.join(sep);
    this.line.text =
      this.split && head.length > 0 && extras !== '' ? `${head.join(sep)}\n${extras}` : [...head, ...this.extras].join(sep);
    this.visible = this.line.text !== '';
    fitWidth(this.line, this.maxWidth);
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.offTick();
    super.destroy(options);
  }
}
