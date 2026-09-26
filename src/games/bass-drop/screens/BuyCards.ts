import { gsap } from 'gsap';
import { BitmapText, Container, Graphics, Sprite } from 'pixi.js';
import { FONTS } from '../../../assets/fonts';
import type { Rect } from '../../../config/layout';
import type { GameContext } from '../../../game/context';
import { glowTexture } from '../../../fx/textures';
import type { GlyphStyle } from '../../../present/common/glyphs';
import { label } from '../../../present/common/text';
import { Title } from '../../../present/common/Title';
import { GOLD, PINK, TEAL } from '../timing';
import { cardFrame, closeIcon } from './art/chrome';
import { jukebox, speakerStack } from './art/emblems';
import { screenArt, useBaked } from './art/ScreenArt';
import { SCR_LABEL, SCR_NUM, fitText } from './fonts';
import { BUY_ACCENT, type BuyRects, CAPTION, type FeatureSkin, HOT_PINK, JAM_GOLD, SCREENS_TIMING, centreOf } from './look';
import { BUTTON_GLASS, BUTTON_PINK, ScreenButton } from './ui';

const TYPE = { family: FONTS.title, extrude: 0.1 } as const;
const B = SCREENS_TIMING.buy;
const sec = (ms: number): number => ms / 1000;
const GREY = 0x8c8aa0;

/** What a buy card shows (prices preformatted by the owner, with the live bet). */
export interface BuyOffer {
  mode: string;
  skin: FeatureSkin;
  spins: number;
  costX: number;
  priceText: string;
  affordable: boolean;
}

/**
 * One buy card: root (rect centre; moves to the confirm rect on select) -> lift (hover) ->
 * frame, glow, emblem + wild, live title / spins / price / "×100 BET", BUY button, the
 * INSUFFICIENT BALANCE line, and the confirm-step COST + big price.
 */
class BuyCard {
  readonly root = new Container({ label: 'buyCard' });
  readonly lift = new Container();
  private readonly frame = new Sprite();
  private readonly glow = new Sprite({ texture: glowTexture(256), anchor: 0.5, blendMode: 'add', alpha: 0.3 });
  private readonly hoverGlow = new Sprite({ texture: glowTexture(256), anchor: 0.5, blendMode: 'add', alpha: 0 });
  private readonly art = new Container();
  private readonly emblem = new Sprite();
  private readonly wild: Sprite;
  private readonly titleHolder = new Container();
  private title: Title | null = null;
  private readonly spins: BitmapText;
  private readonly price: BitmapText;
  private readonly costX: BitmapText;
  private readonly insufficient: BitmapText;
  private readonly costCaption: BitmapText;
  private readonly bigPrice: BitmapText;
  readonly button: ScreenButton;
  private readonly hit = new Graphics();
  private offer: BuyOffer | null = null;
  private w = 0;
  private h = 0;
  private k = 1;
  private titleY = 0;
  private hoverTween: gsap.core.Tween | null = null;
  hovered = false;
  enabled = true;

  constructor(
    ctx: GameContext,
    amountFont: string,
    private readonly skin: FeatureSkin,
    onSelect: () => void,
  ) {
    this.wild = new Sprite({ texture: ctx.art.symbol('W'), anchor: 0.5 });
    this.art.addChild(this.glow, this.emblem, this.wild);
    this.spins = new BitmapText({ text: '', style: { fontFamily: SCR_LABEL, fontSize: 40 }, anchor: 0.5 });
    this.price = new BitmapText({ text: '', style: { fontFamily: SCR_NUM, fontSize: 52 }, anchor: 0.5 });
    this.price.tint = GOLD;
    this.costX = new BitmapText({ text: '', style: { fontFamily: SCR_LABEL, fontSize: 30 }, anchor: 0.5 });
    this.costX.tint = 0xc8bfff;
    this.insufficient = new BitmapText({ text: '', style: { fontFamily: SCR_LABEL, fontSize: 32 }, anchor: 0.5 });
    this.insufficient.tint = 0xff5a6e;
    this.costCaption = new BitmapText({ text: '', style: { fontFamily: SCR_LABEL, fontSize: 34 }, anchor: 0.5 });
    this.costCaption.tint = CAPTION;
    this.bigPrice = new BitmapText({ text: '', style: { fontFamily: amountFont, fontSize: 96 }, anchor: 0.5 });
    this.button = new ScreenButton(BUTTON_PINK, () => undefined, B);
    this.button.eventMode = 'passive';
    this.lift.addChild(this.hoverGlow, this.frame, this.art, this.titleHolder, this.spins, this.price, this.costX);
    this.lift.addChild(this.insufficient, this.costCaption, this.bigPrice, this.button);
    this.root.addChild(this.hit, this.lift);
    this.root.eventMode = 'static';
    this.root.cursor = 'pointer';
    this.root.on('pointerenter', () => this.hover(true));
    this.root.on('pointerleave', () => this.hover(false));
    this.root.on('pointertap', () => {
      if (this.enabled && this.offer?.affordable) onSelect();
    });
  }

  layout(rect: Rect, k: number, res: number): void {
    this.w = rect.w;
    this.h = rect.h;
    this.k = k;
    const { w, h } = this;
    const accent = BUY_ACCENT;
    useBaked(this.frame, screenArt.get(`card:${w}x${h}:${accent}`, res, () => cardFrame(w, h, accent, k)));
    this.hit.clear().rect(-w / 2, -h / 2, w, h).fill({ color: 0xffffff, alpha: 0.001 });
    this.hoverGlow.tint = accent;
    this.hoverGlow.width = w * 1.5;
    this.hoverGlow.height = h * 1.35;
    // art: emblem + a wild (Mega Mix: clamped in spirit, the badge-less icon reads at this size)
    const top = -h / 2;
    const box = Math.min(260 * k, w * 0.6);
    this.art.position.set(0, top + 185 * k);
    const eh = box;
    const baked =
      this.skin === 'megamix'
        ? screenArt.get('emblem:megamix', res * (eh / 465), speakerStack)
        : screenArt.get('emblem:jukejam', res * (eh / 430), jukebox);
    useBaked(this.emblem, baked);
    this.emblem.scale.set(eh / this.emblem.texture.height);
    this.emblem.position.set(-box * 0.12, 0);
    const ws = box * 0.46;
    this.wild.scale.set(ws / this.wild.texture.width);
    this.wild.position.set(box * 0.46, box * 0.2);
    this.wild.rotation = this.skin === 'megamix' ? 0.12 : -0.1;
    this.glow.tint = this.skin === 'megamix' ? PINK : TEAL;
    this.glow.width = this.glow.height = box * 1.6;
    // text lines
    this.titleY = top + 365 * k;
    if (this.title) this.title.y = this.titleY;
    this.spins.style.fontSize = Math.round(40 * k);
    this.spins.y = top + 428 * k;
    this.price.style.fontSize = Math.round(50 * k);
    this.price.y = top + 482 * k;
    this.costX.style.fontSize = Math.round(28 * k);
    this.costX.y = top + 524 * k;
    this.insufficient.style.fontSize = Math.round(30 * k);
    this.insufficient.y = top + 524 * k;
    this.button.relayout(Math.round(250 * k), Math.round(76 * k), res);
    this.button.y = top + 582 * k;
    this.costCaption.style.fontSize = Math.round(34 * k);
    this.costCaption.y = top + 474 * k;
    this.bigPrice.style.fontSize = Math.round(88 * k);
    this.bigPrice.y = top + 540 * k;
    this.paintTexts();
  }

  setOffer(o: BuyOffer): void {
    this.offer = o;
    this.paintTexts();
  }

  private paintTexts(): void {
    const o = this.offer;
    if (!o || !this.w) return;
    const max = this.w - 70 * this.k;
    this.spins.text = label('bd.buy.spins', '{n} FREE SPINS', { n: o.spins });
    fitText(this.spins, max);
    this.price.text = o.priceText;
    fitText(this.price, max);
    this.costX.text = label('bd.buy.costX', '{x}× BET', { x: o.costX });
    fitText(this.costX, max);
    this.insufficient.text = label('bd.buy.insufficient', 'INSUFFICIENT BALANCE');
    fitText(this.insufficient, max);
    this.costCaption.text = label('bd.buy.cost', 'COST');
    this.bigPrice.text = o.priceText;
    fitText(this.bigPrice, max);
    this.button.setText(label('bd.buy.button', 'BUY'));
    this.button.setEnabled(o.affordable);
    this.costX.visible = o.affordable;
    this.insufficient.visible = !o.affordable;
    const grey = o.affordable ? 0xffffff : GREY;
    this.frame.tint = grey;
    this.art.alpha = o.affordable ? 1 : 0.55;
    this.emblem.tint = this.wild.tint = grey;
    this.price.tint = o.affordable ? GOLD : GREY;
    this.spins.tint = o.affordable ? 0xffffff : GREY;
    this.root.cursor = o.affordable ? 'pointer' : 'default';
    if (this.title) this.title.alpha = o.affordable ? 1 : 0.6;
  }

  buildTitle(res: number): void {
    this.title?.destroy();
    const style: GlyphStyle = {
      ...TYPE,
      size: Math.round(72 * this.k),
      palette: this.skin === 'megamix' ? HOT_PINK : JAM_GOLD,
      outline: 0.075,
      tracking: 0.03,
    };
    const key = this.skin === 'megamix' ? 'bd.feature.megaMix' : 'bd.feature.jukeJam';
    this.title = new Title([{ text: label(key, this.skin === 'megamix' ? 'MEGA MIX' : 'JUKE JAM'), style }], res, {
      maxWidth: this.w - 80 * this.k,
    });
    this.title.y = this.titleY;
    this.titleHolder.addChild(this.title);
    if (this.offer && !this.offer.affordable) this.title.alpha = 0.6;
  }

  tick(dt: number): void {
    this.title?.tick(dt);
  }

  hover(on: boolean): void {
    const can = on && this.enabled && !!this.offer?.affordable;
    if (can === this.hovered) return;
    this.hovered = can;
    this.hoverTween?.kill();
    const lift = can ? -B.hoverLift * this.k : 0;
    this.hoverTween = gsap.to(this.lift, { y: lift, duration: sec(B.hover), ease: 'power2.out' });
    gsap.to(this.hoverGlow, { alpha: can ? 0.42 : 0, duration: sec(B.hover), overwrite: true });
  }

  /** Confirm-step look: the BUY row gives way to COST + the big price. */
  setConfirm(on: boolean, duration: number): void {
    const show = on ? 1 : 0;
    const hide = on ? 0 : 1;
    gsap.to([this.button, this.price, this.costX], { alpha: hide, duration, overwrite: true });
    gsap.to([this.costCaption, this.bigPrice], { alpha: show, duration, overwrite: true });
    this.button.eventMode = on ? 'none' : 'passive';
  }

  resetConfirm(): void {
    this.button.alpha = this.price.alpha = this.costX.alpha = 1;
    this.costCaption.alpha = this.bigPrice.alpha = 0;
    this.button.eventMode = 'passive';
  }

  clearTitle(): void {
    this.title?.destroy();
    this.title = null;
  }

  kill(): void {
    this.hoverTween?.kill();
    gsap.killTweensOf([this.hoverGlow, this.button, this.price, this.costX, this.costCaption, this.bigPrice]);
    this.hovered = false;
    this.lift.y = 0;
    this.hoverGlow.alpha = 0;
    this.button.reset();
  }
}

export type BuyStep = 'choose' | 'confirm';

/**
 * BONUS BUY CARDS — placeholder for the `ui_buy_cards` rig (DESIGN §13, ANIMATION_SET §6.2):
 * title, two cards, close X, and the confirm step (CONFIRM in #F828C8 + CANCEL). UI time:
 *   in       18 f: title drops, cards rise, card_land f10 / f14 (`onLand`);
 *   hover_N   6 f: card lift + frame glow;
 *   select_N 12 f: the chosen card moves to the confirm rect at 1.08, the other fades;
 *   back     12 f: reverse; confirm_loop 1 Hz on the CONFIRM plate; out 12 f.
 */
export class BuyCards {
  readonly view = new Container({ label: 'buyCards' });
  private readonly cards: BuyCard[];
  private readonly titleHolder = new Container();
  private title: Title | null = null;
  private readonly close = new Container({ label: 'buyClose' });
  private readonly closeIcon = new Sprite();
  readonly confirm: ScreenButton;
  readonly cancel: ScreenButton;
  private readonly buttons = new Container({ label: 'buyButtons' });
  private rects: BuyRects | null = null;
  private tl: gsap.core.Timeline | null = null;
  private step: BuyStep = 'choose';
  private chosen = -1;
  private pulseT = 0;

  constructor(
    ctx: GameContext,
    amountFont: string,
    onSelect: (i: number) => void,
    onConfirm: () => void,
    onCancel: () => void,
    onClose: () => void,
  ) {
    this.cards = (['jukejam', 'megamix'] as const).map((skin, i) => new BuyCard(ctx, amountFont, skin, () => onSelect(i)));
    this.confirm = new ScreenButton(BUTTON_PINK, onConfirm, B);
    this.cancel = new ScreenButton(BUTTON_GLASS, onCancel, B);
    this.buttons.addChild(this.cancel, this.confirm);
    this.close.addChild(this.closeIcon);
    this.close.eventMode = 'static';
    this.close.cursor = 'pointer';
    this.close.on('pointertap', onClose);
    this.view.addChild(...this.cards.map((c) => c.root), this.titleHolder, this.buttons, this.close);
    this.view.visible = false;
  }

  layout(rects: BuyRects, res: number): void {
    this.rects = rects;
    const k = rects.k;
    rects.cards.forEach((r, i) => this.cards[i].layout(r, k, res));
    this.placeCards();
    this.titleHolder.position.set(rects.title.x, rects.title.y - (this.step === 'confirm' ? 34 * k : 0));
    if (this.title) this.fitTitle();
    const r = Math.round(44 * k);
    useBaked(this.closeIcon, screenArt.get(`close:${r}`, res, () => closeIcon(r)));
    this.close.position.set(rects.close.x, rects.close.y);
    this.close.hitArea = { contains: (x: number, y: number) => x * x + y * y <= r * r * 1.4 };
    const bw = Math.round(270 * k);
    const bh = Math.round(84 * k);
    this.confirm.relayout(bw, bh, res);
    this.cancel.relayout(bw, bh, res);
    const gap = 36 * k;
    this.cancel.position.set(-(bw + gap) / 2, 0);
    this.confirm.position.set((bw + gap) / 2, 0);
    this.buttons.position.set(rects.buttons.x, rects.buttons.y);
    this.confirm.setText(label('bd.buy.confirm', 'CONFIRM'));
    this.cancel.setText(label('bd.buy.cancel', 'CANCEL'));
  }

  /** Cards at their resting place for the current step (layout change mid-screen). */
  private placeCards(): void {
    const R = this.rects;
    if (!R) return;
    this.cards.forEach((c, i) => {
      const home = centreOf(R.cards[i]);
      if (this.step === 'confirm' && i === this.chosen) {
        const cc = centreOf(R.confirmCard);
        c.root.position.set(cc.x, cc.y);
      } else c.root.position.set(home.x, home.y);
    });
  }

  setOffers(offers: BuyOffer[]): void {
    offers.forEach((o, i) => this.cards[i]?.setOffer(o));
  }

  private fitTitle(): void {
    const t = this.title;
    if (!t || !this.rects) return;
    t.scale.set(1);
    const max = (this.rects.close.x - this.rects.title.x) * 2 - 140 * this.rects.k;
    if (t.width > max) t.scale.set(max / t.width);
  }

  /** `in` (UI time). */
  playIn(titleRes: number, onLand: (i: number) => void): void {
    const R = this.rects;
    if (!R) return;
    const k = R.k;
    this.tl?.kill();
    this.step = 'choose';
    this.chosen = -1;
    this.title?.destroy();
    this.title = new Title(
      [{ text: label('bd.buy.title', 'BONUS BUY'), style: { ...TYPE, size: Math.round(96 * k), palette: HOT_PINK, outline: 0.07, tracking: 0.03 } }],
      titleRes,
      { maxWidth: 10000 },
    );
    this.titleHolder.addChild(this.title);
    this.fitTitle();
    for (const c of this.cards) {
      c.buildTitle(titleRes);
      c.kill();
      c.resetConfirm();
      c.enabled = true;
      c.root.alpha = 1;
      c.root.scale.set(1);
    }
    this.placeCards();
    this.buttons.visible = false;
    this.view.visible = true;
    this.view.alpha = 1;
    const tl = gsap.timeline();
    this.titleHolder.alpha = 0;
    this.titleHolder.scale.set(1);
    this.titleHolder.y = R.title.y - 60 * k;
    tl.to(this.titleHolder, { alpha: 1, duration: sec(160) }, 0);
    tl.to(this.titleHolder, { y: R.title.y, duration: sec(B.in * 0.55), ease: 'back.out(2)' }, 0);
    this.cards.forEach((c, i) => {
      const land = sec(B.cardLand[i] ?? B.in);
      const y = c.root.y;
      c.root.alpha = 0;
      c.root.y = y + B.rise * k;
      tl.to(c.root, { alpha: 1, duration: sec(140) }, land - sec(260));
      tl.to(c.root, { y, duration: sec(260), ease: 'back.out(1.8)' }, land - sec(260));
      tl.call(() => onLand(i), undefined, land);
    });
    this.close.alpha = 0;
    tl.to(this.close, { alpha: 1, duration: sec(200) }, sec(B.in * 0.5));
    this.tl = tl;
  }

  /** `select_N`: card i to the confirm rect at 1.08, the other fades, CONFIRM / CANCEL in. */
  select(i: number): void {
    const R = this.rects;
    if (!R || this.step === 'confirm') return;
    this.tl?.progress(1);
    this.step = 'confirm';
    this.chosen = i;
    const d = sec(B.select);
    const cc = centreOf(R.confirmCard);
    const tl = gsap.timeline();
    this.cards.forEach((c, j) => {
      c.hover(false);
      c.enabled = false;
      if (j === i) {
        tl.to(c.root, { x: cc.x, y: cc.y, duration: d, ease: 'power3.inOut' }, 0);
        tl.to(c.root.scale, { x: B.confirmScale, y: B.confirmScale, duration: d, ease: 'back.out(1.6)' }, 0);
        c.setConfirm(true, d);
      } else tl.to(c.root, { alpha: 0, duration: d * 0.7 }, 0);
    });
    this.buttons.visible = true;
    this.buttons.alpha = 0;
    this.confirm.reset();
    this.cancel.reset();
    tl.to(this.buttons, { alpha: 1, duration: d * 0.6 }, d * 0.5);
    tl.to(this.titleHolder, { y: R.title.y - 34 * R.k, duration: d, ease: 'power2.inOut' }, 0);
    tl.to(this.titleHolder.scale, { x: 0.86, y: 0.86, duration: d, ease: 'power2.inOut' }, 0);
    this.pulseT = 0;
    this.tl = tl;
  }

  /** `back`: return to the choose step. */
  back(): void {
    const R = this.rects;
    if (!R || this.step !== 'confirm') return;
    this.tl?.progress(1);
    const i = this.chosen;
    this.step = 'choose';
    this.chosen = -1;
    const d = sec(B.select);
    const tl = gsap.timeline();
    this.cards.forEach((c, j) => {
      const home = centreOf(R.cards[j]);
      if (j === i) {
        tl.to(c.root, { x: home.x, y: home.y, duration: d, ease: 'power3.inOut' }, 0);
        tl.to(c.root.scale, { x: 1, y: 1, duration: d, ease: 'power2.out' }, 0);
        c.setConfirm(false, d);
      } else tl.to(c.root, { alpha: 1, duration: d * 0.7 }, d * 0.3);
    });
    tl.to(this.buttons, { alpha: 0, duration: d * 0.5 }, 0);
    tl.to(this.titleHolder, { y: R.title.y, duration: d, ease: 'power2.inOut' }, 0);
    tl.to(this.titleHolder.scale, { x: 1, y: 1, duration: d, ease: 'power2.inOut' }, 0);
    tl.call(() => {
      this.buttons.visible = false;
      for (const c of this.cards) c.enabled = true;
    }, undefined, d);
    this.confirm.scale.set(1);
    this.tl = tl;
  }

  get currentStep(): BuyStep {
    return this.step;
  }

  /** `out` (UI time); resolves when done. */
  playOut(): Promise<void> {
    this.tl?.kill();
    const d = sec(B.out);
    for (const c of this.cards) c.enabled = false;
    return new Promise((resolve) => {
      const tl = gsap.timeline({ onComplete: () => resolve() });
      tl.to(this.view, { alpha: 0, duration: d, ease: 'power1.in' }, 0);
      this.cards.forEach((c) => tl.to(c.root.scale, { x: c.root.scale.x * 0.92, y: c.root.scale.y * 0.92, duration: d }, 0));
      this.tl = tl;
    });
  }

  /** loop: title wave, confirm_loop pulse (dt seconds). */
  tick(dt: number): void {
    this.title?.tick(dt);
    for (const c of this.cards) c.tick(dt);
    if (this.step !== 'confirm') return;
    this.pulseT += dt;
    const u = 0.5 - 0.5 * Math.cos((this.pulseT * 1000 * Math.PI * 2) / B.confirmPulse);
    this.confirm.scale.set(1 + 0.035 * u);
  }

  clear(): void {
    this.tl?.kill();
    this.tl = null;
    this.title?.destroy();
    this.title = null;
    for (const c of this.cards) {
      c.clearTitle();
      c.kill();
    }
    this.view.visible = false;
    this.step = 'choose';
    this.chosen = -1;
  }

  destroy(): void {
    this.clear();
    this.view.destroy({ children: true });
  }
}
