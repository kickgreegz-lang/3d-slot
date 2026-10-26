import { gsap } from 'gsap';
import { BitmapText, Container, Sprite, type Texture } from 'pixi.js';
import { BET_MODES, GAME_META } from '../../../config/game';
import { clock } from '../../../core/clock';
import { sUi } from '../../../core/timing';
import type { GameContext, GameModule } from '../../../game/context';
import type { HudState } from '../../../game/events';
import { ensureLabelFont } from '../../../present/common/fonts';
import { OverlayStage, releaseTitlesIfIdle } from '../../../present/common/OverlayStage';
import { Plate } from '../../../present/common/Plate';
import { label } from '../../../present/common/text';
import { Title } from '../../../present/common/Title';
import { uiBus } from '../../../ui/bus';
import { coinTexture, diamondTexture, nestTexture } from '../glint/art';
import { glowTexture } from '../scene/textures';
import { GOLD, MOON, VIOLET, style } from './look';

const SKIP_KEY = `${GAME_META.storagePrefix}.skipIntro`;
const readSkip = (): boolean => {
  try {
    return window.localStorage.getItem(SKIP_KEY) === '1';
  } catch {
    return false;
  }
};

interface CardDef {
  title: string;
  body: string;
  accent: number;
  art: (ctx: GameContext) => Array<{ tex: Texture; x: number; y: number; s: number }>;
}

const CARDS: CardDef[] = [
  {
    title: 'intro.card1.title',
    body: 'intro.card1.body',
    accent: 0xffc53d,
    art: (ctx) => [
      { tex: ctx.art.symbol('H1'), x: -70, y: 10, s: 0.95 },
      { tex: ctx.art.symbol('W'), x: 70, y: -10, s: 0.95 },
    ],
  },
  {
    title: 'intro.card2.title',
    body: 'intro.card2.body',
    accent: 0xb06cff,
    art: (ctx) => [
      { tex: coinTexture('gold'), x: -95, y: 30, s: 0.85 },
      { tex: diamondTexture(), x: 95, y: 30, s: 0.85 },
      { tex: nestTexture(), x: 0, y: 50, s: 0.95 },
      { tex: ctx.art.symbol('R'), x: 0, y: -55, s: 0.9 },
    ],
  },
  {
    title: 'intro.card3.title',
    body: 'intro.card3.body',
    accent: 0x4fd1d9,
    art: (ctx) => [
      { tex: ctx.art.symbol('S'), x: -95, y: 20, s: 0.8 },
      { tex: ctx.art.symbol('S'), x: 95, y: 20, s: 0.8 },
      { tex: ctx.art.symbol('S'), x: 0, y: -10, s: 1 },
    ],
  },
];

/**
 * GAME INTRO: three feature cards (glint squares / Shooting Star loot / the heists) over the dimmed
 * board, once after load, with the max-win line. Shown when the flow first reaches 'idle'; never in
 * replay, after a resume or a boot error, and skipped when the viewer opted out (same key as the
 * settings page). Taps / SPACE / ENTER continue after a short lock; a round that starts anyway closes
 * it. Cards float in with a stagger and bob; UI time throughout.
 */
export class IntroScreen implements GameModule {
  private readonly stage: OverlayStage;
  private readonly view = new Container({ label: 'heistIntro' });
  private offs: Array<() => void> = [];
  private decided = false;
  private open = false;
  private unlocked = false;
  private titles: Title[] = [];
  private cards: Container[] = [];
  private time = 0;

  constructor(private readonly ctx: GameContext) {
    this.stage = new OverlayStage(ctx, 'heistIntroStage');
  }

  init(): void {
    const { ctx } = this;
    this.stage.content.addChild(this.view);
    this.offs.push(
      ctx.hud.on('hud:state', (st) => this.onState(st)),
      ctx.game.on('round:start', () => this.close()),
      ctx.game.on('layout:change', () => {
        if (this.open) this.build();
      }),
      clock.onUpdate((dt) => {
        if (!this.open) return;
        this.time += dt;
        for (const t of this.titles) t.tick(dt);
        this.cards.forEach((c, i) => {
          const art = c.getChildByLabel('art');
          if (art) art.y = Math.sin(this.time * 1.8 + i * 1.3) * 6;
        });
      }),
    );
    const key = (e: KeyboardEvent): void => {
      if (!this.open || !this.unlocked) return;
      if (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    };
    window.addEventListener('keydown', key, true);
    this.offs.push(() => window.removeEventListener('keydown', key, true));
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.stage.destroy();
  }

  private onState(st: HudState): void {
    if (this.decided) return;
    if (st.replay || st.phase === 'resume' || st.phase === 'error') {
      this.decided = true;
      return;
    }
    if (st.phase !== 'idle') return;
    this.decided = true;
    if (readSkip() || this.ctx.params.dev) return;
    this.show();
  }

  private show(): void {
    this.open = true;
    uiBus.broadcast('modal:state', { open: true });
    this.stage.open({ dim: 0.78, fadeIn: sUi(300), liftMascots: true, liftFx: false });
    this.build();
    this.stage.onTap(() => {
      if (this.unlocked) this.close();
    });
    gsap.delayedCall(0.6, () => void (this.unlocked = true));
  }

  private close(): void {
    if (!this.open) return;
    this.open = false;
    this.stage.onTap(null);
    uiBus.broadcast('modal:state', { open: false });
    gsap.to(this.view, { alpha: 0, duration: sUi(260) });
    void this.stage.close(sUi(320)).then(() => {
      this.clear();
      this.view.alpha = 1;
      releaseTitlesIfIdle(this.ctx);
    });
  }

  private clear(): void {
    for (const t of this.titles) t.destroy();
    this.titles = [];
    this.view.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.cards = [];
  }

  private build(): void {
    this.clear();
    const { ctx } = this;
    const L = ctx.layout;
    const portrait = L.kind === 'portrait';
    const res = Math.min(2, ctx.app.renderer.resolution * ctx.scale * 1.1);
    const font = ensureLabelFont(ctx.app.renderer);
    const head = new Title(
      [
        { text: label('mh.logo.top', 'MAGPIE'), style: style(70, MOON, 0.08, 0.06) },
        { text: label('mh.logo.main', 'HEIST'), style: style(130, GOLD) },
      ],
      res,
      { maxWidth: 800, lineGap: 1.0 },
    );
    head.y = portrait ? -700 : -380;
    head.waveAmp = 3;
    this.titles.push(head);
    this.view.addChild(head);
    const W = portrait ? 760 : 470;
    const H = portrait ? 330 : 470;
    CARDS.forEach((def, i) => {
      const c = new Container({ label: `introCard${i}` });
      const x = portrait ? 0 : (i - 1) * (W + 40);
      const y = portrait ? -360 + i * (H + 30) + H / 2 : 50;
      c.position.set(x, y);
      const plate = new Plate(def.accent, 0.92, 'round');
      plate.resize(W, H);
      const glow = new Sprite({ texture: glowTexture(), anchor: 0.5, blendMode: 'add', tint: def.accent, alpha: 0.5 });
      glow.scale.set((W * 0.9) / 256);
      const art = new Container({ label: 'art' });
      for (const a of def.art(ctx)) {
        const sp = new Sprite({ texture: a.tex, anchor: 0.5 });
        const base = (portrait ? 130 : 150) / Math.max(a.tex.width, a.tex.height);
        sp.scale.set(base * a.s * (portrait ? 1 : 1.1));
        sp.position.set(a.x * (portrait ? 0.8 : 1), a.y);
        art.addChild(sp);
      }
      const artHolder = new Container();
      artHolder.addChild(art);
      artHolder.position.set(portrait ? -W * 0.27 : 0, portrait ? 0 : -H * 0.2);
      glow.position.copyFrom(artHolder.position);
      const title = new Title([{ text: label(def.title, ''), style: style(portrait ? 52 : 48, i === 1 ? VIOLET : i === 2 ? MOON : GOLD, 0.08) }], res, {
        maxWidth: portrait ? W * 0.5 : W * 0.88,
      });
      title.position.set(portrait ? W * 0.2 : 0, portrait ? -H * 0.26 : H * 0.1);
      this.titles.push(title);
      const body = new BitmapText({
        text: label(def.body, ''),
        style: { fontFamily: font, fontSize: portrait ? 28 : 27, wordWrap: true, wordWrapWidth: portrait ? W * 0.5 : W * 0.84, align: 'center' },
        anchor: 0.5,
      });
      body.position.set(portrait ? W * 0.2 : 0, portrait ? H * 0.12 : H * 0.31);
      c.addChild(glow, plate, artHolder, title, body);
      c.alpha = 0;
      c.scale.set(0.8);
      gsap.to(c, { alpha: 1, duration: sUi(300), delay: 0.15 + i * 0.12 });
      gsap.to(c.scale, { x: 1, y: 1, duration: sUi(500), delay: 0.15 + i * 0.12, ease: 'back.out(1.8)' });
      this.cards.push(c);
      this.view.addChild(c);
    });
    const max = new BitmapText({
      text: label('intro.maxWin', 'WIN UP TO {x}× THE BET', { x: (BET_MODES.BASE?.maxWinX ?? 10000).toLocaleString('en-US') }),
      style: { fontFamily: font, fontSize: 40 },
      anchor: 0.5,
    });
    max.tint = 0xffd76a;
    max.y = portrait ? 720 : 360;
    const tap = new BitmapText({ text: label('tapToContinue', 'TAP TO CONTINUE'), style: { fontFamily: font, fontSize: 32 }, anchor: 0.5 });
    tap.y = portrait ? 790 : 420;
    gsap.to(tap, { alpha: 0.4, duration: sUi(700), yoyo: true, repeat: -1, ease: 'sine.inOut' });
    this.view.addChild(max, tap);
    gsap.delayedCall(0.9, () => void head.sweep(sUi(800)));
  }
}
