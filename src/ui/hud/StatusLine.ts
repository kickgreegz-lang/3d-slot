import { Container, type Text } from 'pixi.js';
import { clock } from '../../core/clock';
import { HUD_COLORS, type TextPool, labelStyle } from './theme';

/**
 * Top-left status line (reference: "GAME NAME | 23:50"): title, local clock and the
 * jurisdiction widgets the flow provides (RTP, net position, session timer).
 * The clock is read from Date once per second of UI time — display only.
 */
export class StatusLine extends Container {
  private readonly line: Text;
  private extras: string[] = [];
  private acc = 1;
  private minute = -1;
  private clockOn = true;

  constructor(
    texts: TextPool,
    private readonly title: string,
  ) {
    super({ label: 'status' });
    this.line = texts.make('', labelStyle(26, HUD_COLORS.value), 0, 0);
    this.line.alpha = 0.92;
    this.addChild(this.line);
    clock.onUpdate(() => {
      this.acc += clock.realDt;
      if (this.acc < 1) return;
      this.acc = 0;
      const m = new Date().getMinutes();
      if (m !== this.minute) this.render();
    });
  }

  configure(size: number, showClock: boolean): void {
    this.line.style = labelStyle(size, HUD_COLORS.value);
    this.clockOn = showClock;
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
    const parts = [this.title.toUpperCase()];
    if (this.clockOn) parts.push(hhmm);
    this.line.text = [...parts, ...this.extras].join('  |  ');
  }
}
