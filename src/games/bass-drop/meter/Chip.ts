import { gsap } from 'gsap';
import { BitmapText, Container, Sprite } from 'pixi.js';
import type { Rect } from '../../../config/layout';
import { followSpeed, s } from '../../../core/timing';
import { Plate } from '../../../present/common/Plate';
import { label } from '../../../present/common/text';
import type { GrooveFeature } from '../events';
import { BASS_DROP_TIMING, GOLD, PINK, TEAL } from '../timing';
import type { MeterIcons } from './art';
import { METER_LABEL_FONT, METER_NUM_FONT } from './fonts';
import { METER_LOOK as LOOK } from './geometry';

const CAPTION = 0xf8d828;
const MAX_ICONS = 4;

/** What the chip says (DESIGN §6.8); the module derives it from the meter state. */
export interface ChipModel {
  kind: 'next' | 'megaMix' | 'max';
  /** plate accent (the meter's trim colour) */
  accent: number;
  threshold: number;
  /** W icons for the next drop */
  wilds: number;
  /** Mega Mix with room in the home registry: the icons carry the clamp glyph */
  sticky: boolean;
  /** feature icon appended (base: the next threshold is 40 / 60) */
  feature: 'jj' | 'mm' | null;
  /** multiplier range tag on the W icons (features) */
  tag: string | null;
  /** Juke Jam at 50+: "60 -> MEGA MIX" */
  upgradeAt: number | null;
  /** Mega Mix at 60+: home count */
  homes: number;
  /** portrait / compact free spins: the FS plate merged in as the first line */
  fs: { feature: GrooveFeature; current: number; total: number } | null;
}

const sig = (m: ChipModel): string =>
  `${m.kind}|${m.accent}|${m.threshold}|${m.wilds}|${m.sticky}|${m.feature}|${m.tag}|${m.upgradeAt}|${m.homes}|` +
  (m.fs ? `${m.fs.feature}:${m.fs.current}/${m.fs.total}` : '-');

const text = (font: string, tint: number): BitmapText => {
  const t = new BitmapText({ text: '', style: { fontFamily: font, fontSize: 32 }, anchor: { x: 0, y: 0.5 } });
  t.tint = tint;
  return t;
};

/**
 * NEXT-DROP CHIP: a Plate pill hanging under the meter (portrait / compact: on the frame
 * beam) with live text + icons, never baked: `NEXT DROP 30 [W][W]`, `MEGA MIX!`,
 * `MAX 5 STICKY`, and in portrait / compact free spins the merged FS line `JUKE JAM 3/8`
 * above it (the layout's fsPlate === 'meterChip'). Pieces are pooled and re-flowed on
 * change; the line fits itself to the plate. Punches (1.12, back.out(3)) on a content change.
 */
export class Chip {
  readonly view = new Container({ label: 'meterChip' });
  private readonly plate = new Plate(TEAL, 0.72);
  private readonly fsLine = new Container();
  private readonly dropLine = new Container();
  private readonly caption = text(METER_LABEL_FONT, CAPTION);
  private readonly num = text(METER_NUM_FONT, 0xffffff);
  private readonly tag = text(METER_LABEL_FONT, TEAL);
  private readonly upNum = text(METER_NUM_FONT, 0xffffff);
  private readonly upLabel = text(METER_LABEL_FONT, PINK);
  private readonly extra = text(METER_LABEL_FONT, GOLD);
  private readonly fsTitle = text(METER_LABEL_FONT, GOLD);
  private readonly fsNum = text(METER_NUM_FONT, 0xffffff);
  private readonly icons: Sprite[] = [];
  private readonly arrow: Sprite;
  private rect: Rect = { x: 0, y: 0, w: 200, h: 48 };
  private key = '';
  private model: ChipModel | null = null;
  private punchTween: gsap.core.Tween | null = null;

  constructor(private readonly art: MeterIcons) {
    for (let i = 0; i < MAX_ICONS + 1; i++) this.icons.push(new Sprite({ anchor: 0.5 }));
    this.arrow = new Sprite({ texture: art.arrow, anchor: 0.5 });
    this.dropLine.addChild(this.caption, this.num, ...this.icons, this.tag, this.upNum, this.arrow, this.upLabel, this.extra);
    this.fsLine.addChild(this.fsTitle, this.fsNum);
    this.view.addChild(this.plate, this.fsLine, this.dropLine);
  }

  layout(rect: Rect): void {
    this.rect = rect;
    this.view.position.set(rect.x + rect.w / 2, rect.y + rect.h / 2);
    this.key = '';
    if (this.model) this.set(this.model, false);
  }

  set(m: ChipModel, punch = true): void {
    const key = sig(m);
    const changed = key !== this.key;
    this.model = m;
    if (!changed) return;
    const first = this.key === '';
    this.key = key;
    this.build(m);
    if (punch && !first) this.punch();
  }

  private build(m: ChipModel): void {
    const { w, h } = this.rect;
    const two = !!m.fs;
    // one line fills the rect; the merged FS plate grows around the same centre, two lines
    const plateH = two ? h * LOOK.chipFsPlate : h;
    const lineH = two ? plateH / 2 : h;
    const text = two ? LOOK.chipFsText : LOOK.chipText;
    this.plate.resize(w, plateH);
    this.plate.accentColor = m.accent;

    // --- FS line (portrait / compact free spins)
    this.fsLine.visible = two;
    if (m.fs) {
      const title = m.fs.feature === 'super' ? label('bd.meter.megaMix', 'MEGA MIX') : label('bd.meter.jukeJam', 'JUKE JAM');
      this.fsTitle.text = title;
      this.fsTitle.tint = m.fs.feature === 'super' ? PINK : GOLD;
      this.fsTitle.style.fontSize = lineH * text;
      this.fsNum.text = label('hud.fsOf', '{current}/{total}', { current: m.fs.current, total: m.fs.total });
      this.fsNum.style.fontSize = lineH * text * 0.9;
      this.flow(this.fsLine, [this.fsTitle, this.fsNum], lineH * 0.22, w - plateH * 0.5);
      this.fsLine.y = -plateH * 0.24;
    }

    // --- next-drop line
    const cap = lineH * text;
    const numPx = cap * 0.93;
    const iconPx = cap * (two ? 1.12 : 1.3);
    const parts: Container[] = [];
    for (const t of [this.caption, this.num, this.tag, this.upNum, this.upLabel, this.extra]) t.visible = false;
    for (const i of this.icons) i.visible = false;
    this.arrow.visible = false;
    const show = <T extends Container>(o: T): T => {
      o.visible = true;
      parts.push(o);
      return o;
    };
    if (m.kind === 'megaMix') {
      const c = show(this.caption);
      c.text = label('bd.meter.megaMixBang', 'MEGA MIX!');
      c.tint = PINK;
      c.style.fontSize = cap * 1.08;
    } else if (m.kind === 'max') {
      const c = show(this.caption);
      c.text = label('bd.meter.max', 'MAX');
      c.tint = PINK;
      c.style.fontSize = cap * 1.08;
      if (m.homes > 0) {
        const e = show(this.extra);
        e.text = label('bd.meter.sticky', '{n} STICKY', { n: m.homes });
        e.style.fontSize = cap;
      }
    } else if (m.upgradeAt !== null && m.upgradeAt === m.threshold) {
      // Juke Jam >= 50: the next drop IS the upgrade; `60 -> MEGA MIX` alone stays readable on
      // every chip width (with the caption, three W icons and the tag it shrank to ~13 px)
      const u = show(this.upNum);
      u.text = String(m.upgradeAt);
      u.style.fontSize = numPx * 1.08;
      const a = show(this.arrow);
      a.width = iconPx * 0.9;
      a.height = iconPx * 0.66;
      const l = show(this.upLabel);
      l.text = label('bd.meter.megaMix', 'MEGA MIX');
      l.style.fontSize = cap * 1.08;
    } else {
      const c = show(this.caption);
      c.text = label('bd.meter.nextDrop', 'NEXT DROP');
      c.tint = CAPTION;
      c.style.fontSize = cap;
      const n = show(this.num);
      n.text = String(m.threshold);
      n.style.fontSize = numPx;
      const count = Math.min(MAX_ICONS, Math.max(0, m.wilds));
      for (let i = 0; i < count; i++) {
        const ic = show(this.icons[i]);
        ic.texture = m.sticky ? this.art.sticky : this.art.w[0];
        ic.width = ic.height = iconPx;
      }
      if (m.feature) {
        const ic = show(this.icons[MAX_ICONS]);
        ic.texture = m.feature === 'jj' ? this.art.jj : this.art.mm;
        ic.width = ic.height = iconPx * 1.05;
      }
      if (m.tag) {
        const t = show(this.tag);
        t.text = m.tag;
        t.style.fontSize = cap * 0.9;
      }
      if (m.upgradeAt !== null) {
        const u = show(this.upNum);
        u.text = String(m.upgradeAt);
        u.style.fontSize = numPx;
        const a = show(this.arrow);
        a.width = iconPx * 0.9;
        a.height = iconPx * 0.66;
        const l = show(this.upLabel);
        l.text = label('bd.meter.megaMix', 'MEGA MIX');
        l.style.fontSize = cap;
      }
    }
    // keep clear of the plate's slanted ends (the taller two-line plate has wider ones)
    this.flow(this.dropLine, parts, lineH * 0.12, two ? w - plateH * 0.5 : w - h * 0.9);
    this.dropLine.y = two ? plateH * 0.24 : 0;
  }

  /** Lay `parts` out left to right (sprites are centre-anchored, texts left-anchored), centred, fitted to maxW. */
  private flow(line: Container, parts: Container[], gap: number, maxW: number): void {
    let x = 0;
    for (const p of parts) {
      const pw = p.width;
      p.x = p instanceof Sprite ? x + pw / 2 : x;
      p.y = p instanceof Sprite ? 0 : -1;
      x += pw + gap;
    }
    const total = Math.max(0, x - gap);
    for (const p of parts) p.x -= total / 2;
    line.scale.set(total > maxW ? maxW / total : 1);
  }

  private punch(): void {
    this.punchTween?.kill();
    this.view.scale.set(1.12);
    this.punchTween = followSpeed(
      gsap.to(this.view.scale, { x: 1, y: 1, duration: s(BASS_DROP_TIMING.meter.chipPunch), ease: 'back.out(3)' }),
    );
  }

  destroy(): void {
    this.punchTween?.kill();
    this.view.destroy({ children: true });
  }
}
