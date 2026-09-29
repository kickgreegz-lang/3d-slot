import { BitmapText, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import { label } from '../../../../present/common/text';
import { SCR_NUM, fitText } from '../fonts';
import { INK } from '../look';
import { type UiArtKey, uiArt } from './uiArt';

export type CardArtKey = 'meter' | 'jukejam' | 'megamix';

interface Plate {
  /** blank badge plate on the 1024 master (the art carries no text) */
  x: number;
  y: number;
  w: number;
  h: number;
  /** the live "×N" printed on it */
  mult: number;
}

interface CardDef {
  tex: UiArtKey;
  /** the illustration's subject on the 1024 master (x0, y0, x1, y1), margin included */
  subject: readonly [number, number, number, number];
  plates: readonly Plate[];
}

/** Master canvas of the card illustrations (shipped at 768). */
const MASTER = 1024;

/**
 * Card illustrations (ART_STATUS §4.4 / §7.6 `card_N_art`): the Groove Meter firing a wild, the
 * jukebox with multiplier wilds, the crowned speaker wall with clamped sticky wilds. Plates were
 * measured on the masters (their tier colours: Juke Jam teal / lime / teal = ×2 / ×5 / ×3, Mega Mix
 * gold / flame-crowned pink / gold = ×6 / ×25 / ×8, DESIGN §9 tiers).
 */
const CARDS: Record<CardArtKey, CardDef> = {
  meter: { tex: 'cardMeter', subject: [110, 150, 914, 900], plates: [] },
  jukejam: {
    tex: 'cardJukeJam',
    subject: [190, 150, 834, 972],
    plates: [
      { x: 224, y: 811, w: 133, h: 85, mult: 2 },
      { x: 423, y: 854, w: 177, h: 98, mult: 5 },
      { x: 656, y: 799, w: 133, h: 86, mult: 3 },
    ],
  },
  megamix: {
    tex: 'cardMegaMix',
    subject: [186, 136, 852, 972],
    plates: [
      { x: 210, y: 818, w: 129, h: 80, mult: 6 },
      { x: 409, y: 854, w: 177, h: 98, mult: 25 },
      { x: 661, y: 808, w: 129, h: 81, mult: 8 },
    ],
  },
};

/**
 * One card illustration in a rounded window of any size: the square master is cropped live to the
 * window's aspect around its subject ("tall crop" in the landscape cards, "wide crop" in the
 * portrait ones), clipped to the window, framed with one bold outline and a thin light rim, and
 * the blank badge plates of the art get their live "×N" (BitmapText, never baked). `layout()`
 * returns false while the texture is not loaded (the owner draws its code art instead).
 * The crop is a sub-texture of the shared source; clear() drops it before the source is released.
 */
export class CardArt extends Container {
  private readonly def: CardDef;
  private readonly sprite = new Sprite();
  private readonly mask0 = new Graphics();
  private readonly frame = new Graphics();
  private readonly badges: BitmapText[] = [];
  private crop: Texture | null = null;

  constructor(key: CardArtKey) {
    super({ label: `cardArt:${key}` });
    this.def = CARDS[key];
    this.sprite.anchor.set(0.5);
    this.sprite.mask = this.mask0;
    this.addChild(this.sprite, this.mask0, this.frame);
    for (const p of this.def.plates) {
      const t = new BitmapText({
        text: label('bd.intro.mult', '×{n}', { n: p.mult }),
        style: { fontFamily: SCR_NUM, fontSize: 40 },
        anchor: 0.5,
      });
      this.badges.push(t);
      this.addChild(t);
    }
  }

  /** Fit the illustration into a w x h window (local px, centred on 0, 0), corner radius r. */
  layout(w: number, h: number, r: number, k: number): boolean {
    const src = uiArt.get(this.def.tex);
    if (!src) {
      this.clear();
      return false;
    }
    // crop: the subject contained in the window's aspect, clamped inside the master
    const [x0, y0, x1, y1] = this.def.subject;
    const aspect = w / h;
    let cw = Math.max(x1 - x0, (y1 - y0) * aspect);
    let ch = cw / aspect;
    if (ch > MASTER) {
      ch = MASTER;
      cw = ch * aspect;
    }
    if (cw > MASTER) {
      cw = MASTER;
      ch = cw / aspect;
    }
    const cx = Math.min(MASTER - cw / 2, Math.max(cw / 2, (x0 + x1) / 2));
    const cy = Math.min(MASTER - ch / 2, Math.max(ch / 2, (y0 + y1) / 2));
    const left = cx - cw / 2;
    const top = cy - ch / 2;
    const px = src.width / MASTER;
    const old = this.crop;
    this.crop = new Texture({
      source: src.source,
      frame: new Rectangle(Math.round(left * px), Math.round(top * px), Math.round(cw * px), Math.round(ch * px)),
    });
    this.sprite.texture = this.crop;
    this.sprite.width = w;
    this.sprite.height = h;
    old?.destroy(false);
    this.mask0.clear().roundRect(-w / 2, -h / 2, w, h, r).fill(0xffffff);
    this.frame
      .clear()
      .roundRect(-w / 2, -h / 2, w, h, r)
      .stroke({ width: 4.5 * k, color: INK })
      .roundRect(-w / 2 + 3.5 * k, -h / 2 + 3.5 * k, w - 7 * k, h - 7 * k, Math.max(1, r - 3 * k))
      .stroke({ width: 1.6 * k, color: 0xffffff, alpha: 0.28 });
    // live multipliers on the blank plates
    const s = w / cw;
    this.def.plates.forEach((p, i) => {
      const t = this.badges[i];
      const bx = (p.x + p.w / 2 - left) * s - w / 2;
      const by = (p.y + p.h / 2 - top) * s - h / 2;
      t.visible = Math.abs(bx) < w / 2 - 4 && Math.abs(by) < h / 2 - 4;
      t.position.set(bx, by - p.h * s * 0.04);
      t.style.fontSize = Math.max(8, Math.round(p.h * s * 0.66));
      fitText(t, p.w * s * 0.86);
    });
    this.visible = true;
    return true;
  }

  /** Unaffordable (buy card): greyed. */
  setGrey(tint: number): void {
    this.sprite.tint = tint;
    for (const b of this.badges) b.tint = tint;
  }

  /** Drop the crop (before the source texture is released). */
  clear(): void {
    this.sprite.texture = Texture.EMPTY;
    this.crop?.destroy(false);
    this.crop = null;
    this.visible = false;
  }

  override destroy(): void {
    this.clear();
    super.destroy({ children: true });
  }
}
