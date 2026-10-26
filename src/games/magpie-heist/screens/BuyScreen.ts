import { gsap } from 'gsap';
import { BitmapText, Container, Graphics, Sprite } from 'pixi.js';
import { FEATURES } from '../../../config/game';
import { clock } from '../../../core/clock';
import { sUi } from '../../../core/timing';
import type { GameContext, GameModule } from '../../../game/context';
import type { HudState } from '../../../game/events';
import { ensureAmountFont, ensureLabelFont } from '../../../present/common/fonts';
import { OverlayStage, releaseTitlesIfIdle } from '../../../present/common/OverlayStage';
import { Plate } from '../../../present/common/Plate';
import { label } from '../../../present/common/text';
import { Title } from '../../../present/common/Title';
import { modalState, uiBus } from '../../../ui/bus';
import { BET_MODES } from '../config';
import { glowTexture } from '../scene/textures';
import { GOLD, MOON, RUBY, VIOLET, style } from './look';

type OfferKind = 'spin' | 'buy';
interface Offer {
  mode: string;
  kind: OfferKind;
  title: string;
  desc: string;
  art: string;
  accent: number;
}

const OFFERS: Offer[] = [
  { mode: 'HUNT', kind: 'spin', title: 'buy.hunt.title', desc: 'buy.desc.hunt', art: 'S', accent: 0x4fd1d9 },
  { mode: 'STARS', kind: 'spin', title: 'buy.stars.title', desc: 'buy.desc.stars', art: 'R', accent: 0xb06cff },
  { mode: 'PROWL', kind: 'buy', title: 'heist.prowl.title', desc: 'buy.desc.prowl', art: 'W', accent: 0x4fd1d9 },
  { mode: 'VAULT', kind: 'buy', title: 'heist.vault.title', desc: 'buy.desc.vault', art: 'S', accent: 0xffc53d },
];

/** A tappable plate with a live label (UI time: hover lift, press squash). */
class Button extends Container {
  private readonly plate: Plate;
  private readonly text: BitmapText;
  private enabled = true;
  constructor(text: string, font: string, accent: number, w: number, h: number, private readonly fn: () => void) {
    super({ label: 'mhButton' });
    this.plate = new Plate(accent, 0.95, 'round');
    this.plate.resize(w, h);
    this.text = new BitmapText({ text, style: { fontFamily: font, fontSize: Math.round(h * 0.42) }, anchor: 0.5 });
    if (this.text.width > w * 0.86) this.text.scale.set((w * 0.86) / this.text.width);
    this.addChild(this.plate, this.text);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointerover', () => this.enabled && gsap.to(this.scale, { x: 1.05, y: 1.05, duration: sUi(120) }));
    this.on('pointerout', () => gsap.to(this.scale, { x: 1, y: 1, duration: sUi(120) }));
    this.on('pointertap', () => {
      if (!this.enabled) return;
      gsap.fromTo(this.scale, { x: 0.9, y: 0.9 }, { x: 1, y: 1, duration: sUi(220), ease: 'back.out(3)' });
      this.fn();
    });
  }
  setEnabled(on: boolean): void {
    this.enabled = on;
    this.alpha = on ? 1 : 0.45;
    this.cursor = on ? 'pointer' : 'default';
  }
}

/**
 * THE HEIST BOARD — the canvas buy screen (FEATURES.buyScreen 'game', opened by the bonus-buy hex):
 * four cards in a row (2 x 2 in portrait): BONUS HUNT and STAR SPINS (FEATURE SPINS: switched on with
 * 'ui:spinMode' and played by every spin until switched off) and NIGHT PROWL / VAULT RAID (one-round
 * buys, 'ui:buy'). Every choice above 2x the bet has the mandatory confirm step (Stake rule). Prices
 * are bet x cost in the live currency; a card the balance cannot cover is greyed. While FEATURE SPINS
 * are on, a pill above the spin button names them and switches them off on tap.
 * Never opens in replay, during autoplay or a round, or over another modal. UI time throughout.
 */
export class BuyScreen implements GameModule {
  private readonly stage: OverlayStage;
  private readonly cards = new Container({ label: 'heistCards' });
  private readonly confirmBox = new Container({ label: 'heistConfirm' });
  private readonly pill = new Container({ label: 'featureSpinsPill' });
  private pillText!: BitmapText;
  private pillPlate!: Plate;
  private title: Title | null = null;
  private state: HudState | null = null;
  private open = false;
  private offs: Array<() => void> = [];
  private labelFont = '';
  private amountFont = '';
  private time = 0;

  constructor(private readonly ctx: GameContext) {
    this.stage = new OverlayStage(ctx, 'heistBuy');
  }

  init(): void {
    const { ctx } = this;
    this.labelFont = ensureLabelFont(ctx.app.renderer);
    this.amountFont = ensureAmountFont(ctx.app.renderer, ctx.money);
    this.stage.content.addChild(this.cards, this.confirmBox);
    this.pillPlate = new Plate(0x4fd1d9, 0.9, 'round');
    this.pillText = new BitmapText({ text: '', style: { fontFamily: this.labelFont, fontSize: 30 }, anchor: 0.5 });
    const x = new BitmapText({ text: '✕', style: { fontFamily: this.labelFont, fontSize: 30 }, anchor: 0.5 });
    x.label = 'x';
    this.pill.addChild(this.pillPlate, this.pillText, x);
    this.pill.eventMode = 'static';
    this.pill.cursor = 'pointer';
    this.pill.visible = false;
    this.pill.on('pointertap', () => ctx.ui.broadcast('ui:spinMode', { mode: null }));
    ctx.layers.hud.addChild(this.pill);
    this.offs.push(
      uiBus.on('dialog:buy', () => this.tryOpen()),
      ctx.hud.on('hud:state', (st) => this.onState(st)),
      ctx.game.on('round:start', () => this.close()),
      ctx.game.on('layout:change', () => {
        this.placePill();
        if (this.open) this.build();
      }),
      clock.onUpdate((dt) => {
        this.time += dt;
        if (this.pill.visible) this.pillPlate.alpha = 0.8 + 0.2 * Math.sin(this.time * 4);
      }),
    );
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.stage.destroy();
    this.pill.destroy({ children: true });
  }

  private onState(st: HudState): void {
    this.state = st;
    const mode = st.spinMode ?? 'BASE';
    const on = mode !== 'BASE' && !st.replay;
    this.pill.visible = on;
    if (on) {
      const key = mode === 'HUNT' ? 'heist.huntOn' : 'heist.starsOn';
      this.pillText.text = label(key, mode, { x: st.spinModeCost ?? 1 });
      this.pillPlate.accentColor = mode === 'HUNT' ? 0x4fd1d9 : 0xb06cff;
      this.placePill();
    }
    if (this.open && (!st.buyAllowed || st.autoplayRemaining)) this.close();
    else if (this.open) this.build();
  }

  private placePill(): void {
    const L = this.ctx.layout;
    const spin = L.hud.spin;
    const w = Math.max(260, this.pillText.width + 90);
    this.pillPlate.resize(w, 58);
    this.pillText.x = -18;
    const x = this.pill.getChildByLabel('x');
    if (x) x.position.set(w / 2 - 30, 0);
    this.pill.position.set(spin.x, spin.y - spin.size * 0.62 - 40);
  }

  private tryOpen(): void {
    const st = this.state;
    if (!st || FEATURES.buyScreen !== 'game' || this.open) return;
    if (!st.buyAllowed || st.replay || st.autoplayRemaining || modalState.open) return;
    this.open = true;
    uiBus.broadcast('modal:state', { open: true });
    this.stage.open({ dim: 0.72, fadeIn: sUi(220), liftMascots: false, liftFx: false });
    this.stage.onTap(() => this.close());
    this.build();
    this.cards.scale.set(0.85);
    this.cards.alpha = 0;
    gsap.to(this.cards, { alpha: 1, duration: sUi(220) });
    gsap.to(this.cards.scale, { x: 1, y: 1, duration: sUi(360), ease: 'back.out(1.8)' });
    this.ctx.game.broadcast('sfx', { id: 'ui_click' });
  }

  private close(): void {
    if (!this.open) return;
    this.open = false;
    this.stage.onTap(null);
    void this.stage.close(sUi(200)).then(() => {
      this.clear();
      releaseTitlesIfIdle(this.ctx);
    });
    uiBus.broadcast('modal:state', { open: false });
  }

  private clear(): void {
    this.cards.visible = true;
    this.cards.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.confirmBox.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.title?.destroy();
    this.title = null;
  }

  private price(mode: string): { api: number; text: string; afford: boolean } {
    const st = this.state;
    const bet = st?.bet ?? this.ctx.money.bet();
    const api = Math.round(bet * (BET_MODES[mode]?.cost ?? 1));
    return { api, text: this.ctx.money.format(api), afford: (st?.balance ?? 0) >= api };
  }

  private build(): void {
    this.clear();
    const L = this.ctx.layout;
    const portrait = L.kind === 'portrait';
    const res = Math.min(2, this.ctx.app.renderer.resolution * this.ctx.scale * 1.1);
    this.title = new Title([{ text: label('buy.title', 'THE HEIST BOARD'), style: style(96, GOLD) }], res, { maxWidth: 900 });
    this.title.y = portrait ? -640 : -360;
    this.cards.addChild(this.title);
    const W = portrait ? 420 : 380;
    const H = portrait ? 520 : 560;
    const gap = 26;
    const spinMode = this.state?.spinMode ?? 'BASE';
    OFFERS.forEach((o, i) => {
      const col = portrait ? i % 2 : i;
      const row = portrait ? Math.floor(i / 2) : 0;
      const cols = portrait ? 2 : 4;
      const x = (col - (cols - 1) / 2) * (W + gap);
      const y = portrait ? -60 + (row - 0.5) * (H + gap) : 40;
      this.cards.addChild(this.card(o, x, y, W, H, spinMode === o.mode));
    });
    const close = new Button('✕', this.labelFont, 0xc8203a, 84, 84, () => this.close());
    close.position.set(portrait ? 420 : 860, portrait ? -640 : -360);
    this.cards.addChild(close);
  }

  private card(o: Offer, x: number, y: number, W: number, H: number, active: boolean): Container {
    const c = new Container({ label: `card:${o.mode}` });
    c.position.set(x, y);
    const plate = new Plate(o.accent, 0.92, 'round');
    plate.resize(W, H);
    const glow = new Sprite({ texture: glowTexture(), anchor: 0.5, blendMode: 'add', tint: o.accent, alpha: 0.45 });
    glow.scale.set((W * 1.1) / 256);
    glow.y = -H * 0.2;
    const art = new Sprite({ texture: this.ctx.art.symbol(o.art), anchor: 0.5 });
    art.scale.set((W * 0.62) / 180);
    art.y = -H * 0.22;
    const tag = new BitmapText({
      text: o.kind === 'spin' ? label('buy.featureSpins', 'FEATURE SPINS') : label('buy.freeSpins', 'BUY FEATURE'),
      style: { fontFamily: this.labelFont, fontSize: 26 },
      anchor: 0.5,
    });
    tag.tint = o.accent;
    tag.y = -H / 2 + 34;
    const res = Math.min(2, this.ctx.app.renderer.resolution * this.ctx.scale * 1.1);
    const pal = o.mode === 'STARS' ? VIOLET : o.mode === 'VAULT' ? GOLD : o.mode === 'HUNT' ? MOON : MOON;
    const name = new Title([{ text: label(o.title, o.mode), style: style(54, pal, 0.08) }], res, { maxWidth: W * 0.9 });
    name.y = H * 0.07;
    const desc = new BitmapText({ text: label(o.desc, ''), style: { fontFamily: this.labelFont, fontSize: 26, wordWrap: true, wordWrapWidth: W * 0.84, align: 'center' }, anchor: 0.5 });
    desc.y = H * 0.19;
    const p = this.price(o.mode);
    const cost = BET_MODES[o.mode]?.cost ?? 1;
    const priceText = new BitmapText({
      text: o.kind === 'spin' ? `${p.text} / ${label('buy.perSpin', 'SPIN')}` : p.text,
      style: { fontFamily: this.amountFont, fontSize: 48 },
      anchor: 0.5,
    });
    if (priceText.width > W * 0.86) priceText.scale.set((W * 0.86) / priceText.width);
    priceText.y = H * 0.31;
    const mult = new BitmapText({ text: `×${cost}`, style: { fontFamily: this.labelFont, fontSize: 24 }, anchor: 0.5 });
    mult.alpha = 0.7;
    mult.y = H * 0.37;
    const btnLabel = o.kind === 'spin' ? (active ? label('buy.turnOff', 'TURN OFF') : label('buy.activate', 'ACTIVATE')) : label('buy.confirm', 'BUY');
    const btn = new Button(btnLabel, this.labelFont, active ? 0xc8203a : o.accent, W * 0.7, 74, () => this.choose(o, active));
    btn.y = H / 2 - 56;
    btn.setEnabled(active || p.afford);
    c.addChild(glow, plate, art, tag, name, desc, priceText, mult, btn);
    if (active) {
      const on = new BitmapText({ text: label('buy.active', 'ACTIVE'), style: { fontFamily: this.labelFont, fontSize: 30 }, anchor: 0.5 });
      on.tint = 0x7dff9a;
      on.position.set(0, -H / 2 + 70);
      c.addChild(on);
    }
    if (!p.afford && !active) {
      const no = new BitmapText({ text: label('buy.insufficient', 'INSUFFICIENT BALANCE'), style: { fontFamily: this.labelFont, fontSize: 22 }, anchor: 0.5 });
      no.tint = 0xff8f9c;
      no.y = H / 2 - 112;
      c.addChild(no);
    }
    return c;
  }

  private choose(o: Offer, active: boolean): void {
    if (o.kind === 'spin' && active) {
      this.ctx.ui.broadcast('ui:spinMode', { mode: null });
      this.close();
      return;
    }
    this.confirm(o);
  }

  private confirm(o: Offer): void {
    this.confirmBox.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.cards.visible = false;
    const box = new Container();
    const plate = new Plate(o.accent, 0.95, 'round');
    plate.resize(820, 460);
    const res = Math.min(2, this.ctx.app.renderer.resolution * this.ctx.scale * 1.1);
    const t = new Title([{ text: label(o.title, o.mode), style: style(80, o.mode === 'STARS' ? VIOLET : o.mode === 'VAULT' ? GOLD : MOON) }], res, { maxWidth: 740 });
    t.y = -150;
    const p = this.price(o.mode);
    const q = new BitmapText({
      text: o.kind === 'spin' ? label('buy.confirmSpin', 'EVERY SPIN COSTS') : label('buy.costLabel', 'COST'),
      style: { fontFamily: this.labelFont, fontSize: 34 },
      anchor: 0.5,
    });
    q.y = -50;
    const amount = new BitmapText({ text: p.text, style: { fontFamily: this.amountFont, fontSize: 96 }, anchor: 0.5 });
    amount.y = 40;
    const yes = new Button(label('buy.confirmYes', 'CONFIRM'), this.labelFont, 0x2fbf6a, 300, 84, () => {
      this.close();
      if (o.kind === 'spin') this.ctx.ui.broadcast('ui:spinMode', { mode: o.mode });
      else this.ctx.ui.broadcast('ui:buy', { mode: o.mode });
      this.ctx.game.broadcast('sfx', { id: 'ui_click' });
    });
    yes.position.set(170, 160);
    const no = new Button(label('buy.cancel', 'CANCEL'), this.labelFont, 0x5a5478, 300, 84, () => {
      this.confirmBox.removeChildren().forEach((c) => c.destroy({ children: true }));
      this.cards.visible = true;
    });
    no.position.set(-170, 160);
    const frame = new Graphics();
    box.addChild(frame, plate, t, q, amount, yes, no);
    box.scale.set(0.8);
    gsap.to(box.scale, { x: 1, y: 1, duration: sUi(300), ease: 'back.out(2)' });
    this.confirmBox.addChild(box);
    void RUBY;
  }
}
