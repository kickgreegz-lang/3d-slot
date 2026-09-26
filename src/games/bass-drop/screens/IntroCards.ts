import { gsap } from 'gsap';
import { BitmapText, Container, Graphics, Sprite } from 'pixi.js';
import { FONTS } from '../../../assets/fonts';
import type { Rect } from '../../../config/layout';
import type { GameContext } from '../../../game/context';
import { GodRays } from '../../../fx/filters/GodRays';
import { reducedMotion } from '../../../fx/motion';
import { glowTexture } from '../../../fx/textures';
import { CYAN, type GlyphPalette, type GlyphStyle } from '../../../present/common/glyphs';
import { Plate } from '../../../present/common/Plate';
import { label } from '../../../present/common/text';
import { Title } from '../../../present/common/Title';
import { GROOVE } from '../config';
import { GOLD, PINK, TEAL, multTier } from '../timing';
import { badgePlate, cardFrame } from './art/chrome';
import { clamp, jukebox, speakerStack, woofer } from './art/emblems';
import { screenArt, useBaked } from './art/ScreenArt';
import { SCR_NUM, bodyText, fitText } from './fonts';
import { HOT_PINK, type IntroRects, JAM_GOLD, SCREENS_TIMING, centreOf } from './look';
import { PressPrompt, Toggle } from './ui';

type CardKey = 'meter' | 'jukeJam' | 'megaMix';

interface CardDef {
  key: CardKey;
  accent: number;
  palette: GlyphPalette;
  title: [string, string];
  body: [string, string, Record<string, string | number>];
}

const CARDS: CardDef[] = [
  {
    key: 'meter',
    accent: TEAL,
    palette: CYAN,
    title: ['bd.intro.meter.title', 'GROOVE METER'],
    body: ['bd.intro.meter.body', 'EVERY {n} CONNECTED SYMBOLS DROP WILDS ON THE BOARD', { n: GROOVE.thresholds[0] }],
  },
  {
    key: 'jukeJam',
    accent: GOLD,
    palette: JAM_GOLD,
    title: ['bd.intro.jukeJam.title', 'JUKE JAM'],
    body: [
      'bd.intro.jukeJam.body',
      'CONNECT {at} SYMBOLS IN ONE SPIN FOR {spins} FREE SPINS WITH MULTIPLIER WILDS',
      { at: GROOVE.bonusAt, spins: GROOVE.bonus.freeSpins },
    ],
  },
  {
    key: 'megaMix',
    accent: PINK,
    palette: HOT_PINK,
    title: ['bd.intro.megaMix.title', 'MEGA MIX'],
    body: [
      'bd.intro.megaMix.body',
      'CONNECT {at} FOR {spins} FREE SPINS WITH STICKY MULTIPLIER WILDS THAT GROW UP TO ×{cap}',
      { at: GROOVE.superAt, spins: GROOVE.super.freeSpins, cap: GROOVE.super.cap },
    ],
  },
];

const TYPE = { family: FONTS.title, extrude: 0.1 } as const;

/** A "×N" badge (live number on a baked tier plate). */
class Badge extends Container {
  private readonly plate = new Sprite();
  private readonly text: BitmapText;

  constructor(private readonly mult: number) {
    super({ label: 'badge' });
    this.text = new BitmapText({ text: label('bd.intro.mult', '×{n}', { n: mult }), style: { fontFamily: SCR_NUM, fontSize: 30 }, anchor: 0.5 });
    this.addChild(this.plate, this.text);
  }

  paint(res: number): void {
    const color = multTier(this.mult).color;
    useBaked(this.plate, screenArt.get(`badge:${color}`, res, () => badgePlate(70, 42, color)));
    this.text.y = -2;
    fitText(this.text, 58);
  }
}

/**
 * One intro card: root (rect centre) -> bob (loop) -> motion (in / out) -> frame, glow,
 * illustration, live title and body, shine sweep (masked to the panel).
 */
class IntroCard {
  readonly root = new Container({ label: 'introCard' });
  readonly bob = new Container();
  readonly motion = new Container();
  private readonly frame = new Sprite();
  private readonly glow = new Sprite({ texture: glowTexture(256), anchor: 0.5, blendMode: 'add', alpha: 0.35 });
  private readonly art = new Container();
  private readonly emblem = new Sprite();
  private readonly extras = new Container();
  private readonly wilds: Sprite[] = [];
  private readonly badges: Badge[] = [];
  private readonly clamps: Sprite[] = [];
  private readonly orbs: Sprite[] = [];
  private readonly orbBase: number[] = [];
  private readonly wildBaseY: number[] = [];
  private readonly body: BitmapText;
  private readonly titleHolder = new Container();
  private readonly shineMask = new Graphics();
  private readonly shine = new Sprite({ texture: glowTexture(256), anchor: 0.5, blendMode: 'add', alpha: 0 });
  title: Title | null = null;
  private w = 0;
  private h = 0;
  private k = 1;
  private titleY = 0;
  private titleMax = 0;

  constructor(
    readonly def: CardDef,
    private readonly ctx: GameContext,
  ) {
    this.body = bodyText(34, 380);
    this.art.addChild(this.glow, this.emblem, this.extras);
    this.shine.mask = this.shineMask;
    this.motion.addChild(this.frame, this.art, this.titleHolder, this.body, this.shineMask, this.shine);
    this.bob.addChild(this.motion);
    this.root.addChild(this.bob);
    this.buildExtras();
  }

  private wild(x: number, y: number, size: number, rot: number): Sprite {
    const s = new Sprite({ texture: this.ctx.art.symbol('W'), anchor: 0.5 });
    s.position.set(x, y);
    s.rotation = rot;
    s.scale.set(size / s.texture.width);
    this.extras.addChild(s);
    this.wilds.push(s);
    this.wildBaseY.push(y);
    return s;
  }

  private badge(mult: number, x: number, y: number): void {
    const b = new Badge(mult);
    b.position.set(x, y);
    this.extras.addChild(b);
    this.badges.push(b);
  }

  /** Illustration extras in art-box units (box ~ 320 x 320 around 0, 0). */
  private buildExtras(): void {
    switch (this.def.key) {
      case 'meter': {
        for (const [x, y, r] of [
          [-138, -96, 30],
          [-156, -18, 24],
          [-124, 70, 19],
        ] as const) {
          const o = new Sprite({ texture: glowTexture(256), anchor: 0.5, blendMode: 'add', tint: TEAL });
          o.position.set(x, y);
          o.width = o.height = r * 2.4;
          this.extras.addChild(o);
          this.orbs.push(o);
          this.orbBase.push(o.scale.x);
        }
        this.wild(96, -86, 140, 0.22);
        break;
      }
      case 'jukeJam': {
        this.wild(-112, 92, 118, -0.16);
        this.wild(118, 80, 118, 0.14);
        this.badge(3, -112, 150);
        this.badge(5, 118, 138);
        break;
      }
      case 'megaMix': {
        const w = this.wild(106, 86, 128, 0.1);
        const half = 58;
        for (let i = 0; i < 4; i++) {
          const c = new Sprite();
          const a = (i * Math.PI) / 2;
          const sx = i === 0 || i === 3 ? -1 : 1;
          const sy = i < 2 ? -1 : 1;
          c.position.set(w.x + sx * half, w.y + sy * half);
          c.rotation = a;
          this.extras.addChild(c);
          this.clamps.push(c);
        }
        this.badge(8, 106, 146);
        break;
      }
    }
  }

  /** Place in `rect` (design px) at type scale `k`, baking at `res`. */
  layout(rect: Rect, k: number, res: number): void {
    const c = centreOf(rect);
    this.root.position.set(c.x, c.y);
    this.w = rect.w;
    this.h = rect.h;
    this.k = k;
    const { w, h } = this;
    const def = this.def;
    useBaked(this.frame, screenArt.get(`card:${w}x${h}:${def.accent}`, res, () => cardFrame(w, h, def.accent, k)));
    const pad = 22 * k;
    const horizontal = w / h > 1.6;
    // art box
    let box: number;
    if (horizontal) {
      box = h - pad * 2 - 64 * k;
      this.art.position.set(-w / 2 + pad + box / 2 + 12 * k, 0);
    } else {
      box = Math.min(w - pad * 2 - 40 * k, h * 0.46);
      this.art.position.set(0, -h / 2 + h * 0.29);
    }
    const artScale = box / 330;
    this.art.scale.set(artScale);
    const artRes = res * artScale;
    const emblemH = def.key === 'meter' ? 250 : 300;
    const baked =
      def.key === 'meter'
        ? screenArt.get('emblem:woofer', artRes * (emblemH / 250), () => woofer(125))
        : def.key === 'jukeJam'
          ? screenArt.get('emblem:jukejam', artRes * (emblemH / 430), jukebox)
          : screenArt.get('emblem:megamix', artRes * (emblemH / 465), speakerStack);
    useBaked(this.emblem, baked);
    this.emblem.scale.set(emblemH / this.emblem.texture.height);
    this.emblem.position.set(def.key === 'meter' ? -24 : 0, def.key === 'meter' ? 18 : -12);
    this.glow.tint = def.accent;
    this.glow.width = this.glow.height = 420;
    for (const b of this.badges) b.paint(artRes);
    for (const cl of this.clamps) useBaked(cl, screenArt.get('clamp', artRes, clamp));
    // text
    const bodySize = Math.round((horizontal ? 42 : 33) * k);
    let wrap: number;
    if (horizontal) {
      const x0 = -w / 2 + pad + box + 40 * k;
      const x1 = w / 2 - pad - 22 * k;
      wrap = x1 - x0;
      const cx = (x0 + x1) / 2;
      this.titleY = -h * 0.24;
      this.titleHolder.position.set(cx, 0);
      this.body.position.set(cx, -h * 0.11);
    } else {
      wrap = w - pad * 2 - 44 * k;
      this.titleY = -h / 2 + h * 0.605;
      this.titleHolder.position.set(0, 0);
      this.body.position.set(0, -h / 2 + h * 0.675);
    }
    this.titleMax = wrap;
    this.body.style.fontSize = bodySize;
    this.body.style.lineHeight = bodySize * 1.1;
    this.body.style.wordWrapWidth = wrap;
    this.body.text = label(def.body[0], def.body[1], def.body[2]);
    if (this.title) {
      this.title.y = this.titleY;
      this.fitTitle();
    }
    // shine sweep lane, masked to the inner panel
    const inner = pad + 4 * k;
    this.shineMask.clear().roundRect(-w / 2 + inner, -h / 2 + inner, w - inner * 2, h - inner * 2, 16 * k).fill(0xffffff);
    this.shine.width = 90 * k;
    this.shine.height = Math.max(w, h) * 1.5;
    this.shine.rotation = 0.42;
  }

  /** Build the live title for a show (glyph textures may have been released since the last). */
  buildTitle(res: number): void {
    this.title?.destroy();
    const size = Math.round((this.w / this.h > 1.6 ? 76 : 60) * this.k);
    const style: GlyphStyle = { ...TYPE, size, palette: this.def.palette, outline: 0.075, tracking: 0.03 };
    this.title = new Title([{ text: label(this.def.title[0], this.def.title[1]), style }], res, { maxWidth: 10000 });
    this.title.y = this.titleY;
    this.titleHolder.addChild(this.title);
    this.fitTitle();
  }

  private fitTitle(): void {
    const t = this.title;
    if (!t) return;
    t.scale.set(1);
    const w = t.width;
    if (w > this.titleMax) t.scale.set(this.titleMax / w);
  }

  clearTitle(): void {
    this.title?.destroy();
    this.title = null;
  }

  /** Shine position 0..1 across the card (negative / >1 = off). */
  setShine(u: number): void {
    const vis = u > -0.2 && u < 1.2;
    this.shine.visible = vis;
    if (!vis) return;
    this.shine.alpha = 0.28 * Math.sin(Math.max(0, Math.min(1, u)) * Math.PI);
    this.shine.x = -this.w / 2 + u * this.w;
  }

  /** Idle life of the illustration (orbs drift into the woofer, wilds breathe); t in seconds. */
  tickArt(t: number, still: boolean): void {
    for (let i = 0; i < this.orbs.length; i++) {
      const o = this.orbs[i];
      const u = (t * 0.6 + i * 0.33) % 1;
      o.alpha = Math.sin(u * Math.PI) * 0.9;
      o.scale.set(this.orbBase[i] * (1 - u * 0.5));
    }
    for (let i = 0; i < this.wilds.length; i++) {
      this.wilds[i].y = this.wildBaseY[i] + (still ? 0 : Math.sin(t * 2.6 + i * 1.7) * 4);
    }
  }

}

/**
 * GAME INTRO CARDS — placeholder for the `ui_intro_cards` rig (DESIGN §12, ANIMATION_SET §6.1):
 * logo, three cards (GROOVE METER / JUKE JAM / MEGA MIX) with illustrations and live copy, the
 * max-win footer, PRESS TO CONTINUE and the don't-show-again toggle. UI time (sUi):
 *   in    27 f: cards drop from -150 px 4 f apart and settle from -4 / +3 / -2 deg, card_land
 *         f12 / f16 / f20 (`onLand`), logo 0.6 -> 1.05 -> 1.0 (f6 - f18, `onTitleHit` f18);
 *   loop  cards bob out of phase (2 s), one shine sweep per card per loop;
 *   press_loop  1 Hz;
 *   out   12 f: cards lift and fade, logo last.
 */
export class IntroCards {
  readonly view = new Container({ label: 'introCards' });
  private readonly cards: IntroCard[];
  private readonly logo = new Container({ label: 'introLogo' });
  private readonly logoRays = new GodRays({ size: 560, color: PINK, speed: 0.18, alpha: 0.4 });
  private logoTop: Title | null = null;
  private logoMain: Title | null = null;
  private readonly footer = new Container({ label: 'introFooter' });
  private readonly footerPlate = new Plate(PINK, 0.82);
  private readonly footerText: BitmapText;
  readonly press: PressPrompt;
  readonly toggle: Toggle;
  private rects: IntroRects | null = null;
  private tl: gsap.core.Timeline | null = null;
  private t = 0;
  private looping = false;

  constructor(
    ctx: GameContext,
    private readonly maxWinX: number,
    onToggle: (on: boolean) => void,
  ) {
    this.cards = CARDS.map((d) => new IntroCard(d, ctx));
    this.footerText = new BitmapText({ text: '', style: { fontFamily: SCR_NUM, fontSize: 34 }, anchor: 0.5 });
    this.footerText.tint = GOLD;
    this.footer.addChild(this.footerPlate, this.footerText);
    this.press = new PressPrompt(40, 0xffffff, SCREENS_TIMING.introCards.pressPeriod);
    this.toggle = new Toggle(TEAL, onToggle);
    this.logo.addChild(this.logoRays);
    this.view.addChild(this.logo, ...this.cards.map((c) => c.root), this.footer, this.press, this.toggle);
    this.view.visible = false;
  }

  layout(rects: IntroRects, res: number): void {
    this.rects = rects;
    const k = rects.k;
    rects.cards.forEach((r, i) => this.cards[i].layout(r, k, res));
    const lc = centreOf(rects.logo);
    this.logo.position.set(lc.x, lc.y);
    this.placeLogoTitles();
    // footer ribbon straddles the bottom edge of the lowest card
    let low = rects.cards[0];
    for (const r of rects.cards) if (r.y + r.h > low.y + low.h) low = r;
    this.footerText.text = label('bd.intro.footer', 'WIN UP TO {x}×', { x: this.maxWinX.toLocaleString('en-US') });
    this.footerText.style.fontSize = Math.round(36 * k);
    const fw = Math.max(360 * k, this.footerText.width + 90 * k);
    this.footerPlate.resize(fw, 60 * k);
    this.footer.position.set(low.x + low.w / 2, low.y + low.h + 2 * k);
    this.press.text.style.fontSize = Math.round(42 * k);
    this.press.setText(label('bd.intro.press', 'PRESS TO CONTINUE'));
    this.press.position.set(rects.press.x, rects.press.y);
    this.toggle.text.text = label('bd.intro.dontShow', "DON'T SHOW AGAIN");
    const wide = rects.cards[0].w > rects.cards[0].h * 1.6;
    this.toggle.relayout(Math.round((wide ? 38 : 30) * k), res);
    this.toggle.position.set(rects.toggle.x + 15 * k, rects.toggle.y);
  }

  private placeLogoTitles(): void {
    const r = this.rects?.logo;
    if (!r) return;
    this.logoRays.resize(Math.min(r.w, r.h) * 2.2);
    const fit = (t: Title | null, max: number): void => {
      if (!t) return;
      t.scale.set(1);
      if (t.width > max) t.scale.set(max / t.width);
    };
    fit(this.logoTop, r.w * 0.8);
    fit(this.logoMain, r.w * 0.98);
    if (this.logoTop) this.logoTop.y = -r.h * 0.2;
    if (this.logoMain) this.logoMain.y = r.h * 0.14;
  }

  /** Build the per-show titles (glyphs) at `res`. */
  private buildTitles(res: number): void {
    const k = this.rects?.k ?? 1;
    this.logoTop?.destroy();
    this.logoMain?.destroy();
    this.logoTop = new Title(
      [{ text: label('bd.intro.logoTop', 'SWAMP FUNK'), style: { ...TYPE, size: Math.round(62 * k), palette: CYAN, outline: 0.08 } }],
      res,
      { maxWidth: 10000 },
    );
    this.logoMain = new Title(
      [{ text: label('bd.intro.logoMain', 'BASS DROP'), style: { ...TYPE, size: Math.round(128 * k), palette: HOT_PINK, outline: 0.07 } }],
      res,
      { maxWidth: 10000 },
    );
    this.logo.addChild(this.logoTop, this.logoMain);
    this.placeLogoTitles();
    for (const c of this.cards) c.buildTitle(res);
  }

  /** `in` (UI time). Returns the timeline; `onLand(i)` = card_land, `onTitleHit` = title_hit. */
  playIn(onLand: (i: number) => void, onTitleHit: () => void, titleRes: number): gsap.core.Timeline {
    const I = SCREENS_TIMING.introCards;
    const k = this.rects?.k ?? 1;
    const sec = (ms: number): number => ms / 1000;
    const still = reducedMotion();
    this.buildTitles(titleRes);
    this.view.visible = true;
    this.view.alpha = 1;
    this.looping = false;
    this.t = 0;
    this.tl?.kill();
    const tl = gsap.timeline();
    this.cards.forEach((c, i) => {
      const at = sec(i * I.cardStagger);
      const m = c.motion;
      m.alpha = 0;
      // reduced motion: a short straight drop, no tilt
      m.y = -I.dropFrom * k * (still ? 0.25 : 1);
      m.rotation = still ? 0 : ((I.settle[i] ?? 0) * Math.PI) / 180;
      m.scale.set(1);
      c.bob.y = 0;
      c.setShine(-1);
      tl.to(m, { alpha: 1, duration: sec(90) }, at);
      tl.to(m, { y: 0, duration: sec(I.cardDrop), ease: 'power2.in' }, at);
      tl.to(m, { rotation: 0, duration: sec(I.cardDrop + 260), ease: 'back.out(2.2)' }, at + sec(I.cardDrop * 0.55));
      const land = at + sec(I.cardDrop);
      tl.set(m.scale, { x: 1.035, y: 0.96 }, land);
      tl.to(m.scale, { x: 1, y: 1, duration: sec(220), ease: 'back.out(3)' }, land);
      tl.call(() => onLand(i), undefined, land);
      const title = c.title;
      if (title) {
        // the title slams in as whole words on card_land (never letter by letter: any frame
        // mid-animation still reads as a clean word), settled 260 ms after the land
        for (const g of title.glyphs) {
          g.sprite.alpha = 1;
          g.sprite.scale.set(1);
          g.dx = g.dy = 0;
        }
        for (const w of title.words) {
          w.alpha = 0;
          w.scale.set(still ? 1 : I.titleFrom);
          tl.to(w, { alpha: 1, duration: sec(90) }, land);
          if (!still) tl.to(w.scale, { x: 1, y: 1, duration: sec(I.titleSlam), ease: 'back.out(2.2)' }, land);
        }
      }
    });
    // logo 0.6 -> 1.05 -> 1.0 over f6 - f18
    this.logo.alpha = 0;
    this.logo.scale.set(0.6);
    const lf = sec(I.logoFrom);
    const lt = sec(I.logoTo);
    tl.to(this.logo, { alpha: 1, duration: sec(120) }, lf);
    tl.to(this.logo.scale, { x: 1.05, y: 1.05, duration: (lt - lf) * 0.7, ease: 'power2.out' }, lf);
    tl.to(this.logo.scale, { x: 1, y: 1, duration: (lt - lf) * 0.3, ease: 'sine.inOut' }, lf + (lt - lf) * 0.7);
    tl.call(onTitleHit, undefined, lt);
    for (const t of [this.logoTop, this.logoMain]) if (t) tl.to(t, { waveAmp: 4, duration: sec(700) }, lt);
    // footer, prompt and toggle after the last card
    const after = sec(I.in);
    this.footer.alpha = 0;
    this.footer.scale.set(0.6);
    tl.to(this.footer, { alpha: 1, duration: sec(160) }, after - sec(160));
    tl.to(this.footer.scale, { x: 1, y: 1, duration: sec(320), ease: 'back.out(2.4)' }, after - sec(160));
    this.press.alpha = 0;
    this.toggle.alpha = 0;
    tl.to([this.press, this.toggle], { alpha: 1, duration: sec(250) }, after);
    tl.call(() => {
      this.looping = true;
      this.press.start();
    }, undefined, after);
    this.tl = tl;
    return tl;
  }

  /** `out` (UI time): cards lift and fade, logo last. */
  playOut(): gsap.core.Timeline {
    const I = SCREENS_TIMING.introCards;
    const k = this.rects?.k ?? 1;
    const d = I.out / 1000;
    this.tl?.kill();
    this.looping = false;
    this.press.stop();
    const tl = gsap.timeline();
    this.cards.forEach((c, i) => {
      tl.to(c.motion, { y: -I.outLift * k, alpha: 0, duration: d, ease: 'power2.in' }, i * 0.03);
    });
    tl.to([this.footer, this.press, this.toggle], { alpha: 0, duration: d * 0.7 }, 0);
    tl.to(this.logo, { alpha: 0, duration: d * 0.8, ease: 'power1.in' }, d * 0.4);
    tl.to(this.logo.scale, { x: 1.08, y: 1.08, duration: d * 0.8 }, d * 0.4);
    this.tl = tl;
    return tl;
  }

  /** loop / press_loop (dt in seconds). */
  tick(dt: number): void {
    this.logoTop?.tick(dt);
    this.logoMain?.tick(dt);
    for (const c of this.cards) c.title?.tick(dt);
    this.press.tick(dt);
    if (!this.looping) return;
    const I = SCREENS_TIMING.introCards;
    const k = this.rects?.k ?? 1;
    this.t += dt;
    const period = I.loop / 1000;
    const still = reducedMotion();
    for (let i = 0; i < this.cards.length; i++) {
      const c = this.cards[i];
      c.bob.y = still ? 0 : Math.sin(((this.t / period) * 2 + i * 0.66) * Math.PI) * I.bob * k;
      // one sweep per card per loop, staggered
      const u = ((this.t / period + i * 0.22) % 1) * 1.8 - 0.3;
      c.setShine(u);
      c.tickArt(this.t, still);
    }
  }

  /** Destroy the per-show titles and hide. */
  clear(): void {
    this.tl?.kill();
    this.tl = null;
    this.looping = false;
    this.press.stop();
    this.logoTop?.destroy();
    this.logoMain?.destroy();
    this.logoTop = this.logoMain = null;
    for (const c of this.cards) c.clearTitle();
    this.view.visible = false;
  }

  destroy(): void {
    this.clear();
    this.view.destroy({ children: true });
  }
}
