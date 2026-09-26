import { gsap } from 'gsap';
import { BitmapText, Container, Sprite } from 'pixi.js';
import { followSpeed } from '../../../core/timing';
import { GodRays } from '../../../fx/filters/GodRays';
import { glowTexture } from '../../../fx/textures';
import { CYAN, type GlyphStyle } from '../../../present/common/glyphs';
import { label } from '../../../present/common/text';
import { Title } from '../../../present/common/Title';
import { FONTS } from '../../../assets/fonts';
import { ribbon } from './art/chrome';
import { jukebox, speakerStack } from './art/emblems';
import { type Baked, screenArt, useBaked } from './art/ScreenArt';
import { type FeatureSkin, HOT_PINK, JAM_GOLD, SCREENS_TIMING, SKINS } from './look';
import { PressPrompt } from './ui';

export type BannerMode = 'intro' | 'outro';
/** Timeline events of the rig (ANIMATION_SET §6.3 / §6.5); the owner turns them into shake, FX and SFX. */
export type BannerEvent = 'title_hit' | 'count_hit' | 'shine';

const TYPE = { family: FONTS.title, extrude: 0.1 } as const;
const titleStyle = (skin: FeatureSkin, size: number): GlyphStyle => ({
  ...TYPE,
  size,
  palette: skin === 'megamix' ? HOT_PINK : JAM_GOLD,
  outline: 0.07,
  tracking: 0.03,
});
const COUNT_STYLE = (skin: FeatureSkin): GlyphStyle => ({
  ...TYPE,
  size: 230,
  palette: skin === 'megamix' ? JAM_GOLD : HOT_PINK,
  outline: 0.06,
  tracking: 0.02,
});
const SUB_STYLE: GlyphStyle = { ...TYPE, size: 88, palette: CYAN, outline: 0.075, tracking: 0.03 };

/** Content-space placement per mode (landscape design px around layout.center; the stage scales it). */
const PLACE = {
  intro: { emblemY: -178, emblemH: 390, ribbonY: 62, ribbonW: 780, ribbonH: 132, titleSize: 118, countY: 222, subY: 334, pressY: 425 },
  outro: { emblemY: -262, emblemH: 250, ribbonY: -64, ribbonW: 760, ribbonH: 128, titleSize: 112, countY: 0, subY: 62, pressY: 372 },
} as const;
const AMOUNT_Y = 196;
const AMOUNT_MAX_W = 860;

/**
 * FEATURE BANNER — placeholder for the `ui_feature_intro` and `ui_feature_outro` rigs (skins
 * jukejam / megamix): god rays + glow (backdrop), emblem, ribbon `banner_plate`, live
 * titles (engine glyph baker), the intro count "8" + "FREE SPINS" or the outro "TOTAL WIN" +
 * amount, and the pulsing prompt. `playIn()` returns the rig's `in` timeline (gameplay time,
 * registered with followSpeed) and reports `title_hit` / `count_hit` / `shine` at the
 * authored frames; `tick()` runs `loop` (emblem pump on the beat, title wave, prompt pulse);
 * `playOut()` is `out` (scale 1.1 + fade).
 *
 * Titles are built per show (their glyph textures may be released between screens) and
 * destroyed by `clear()`; every other part is kept and re-skinned.
 */
export class FeatureBanner {
  /** rays + glow: goes behind the lifted mascots (stage.backdrop) */
  readonly back = new Container({ label: 'bannerBack' });
  /** emblem, ribbon, titles, prompt (stage.content) */
  readonly front = new Container({ label: 'bannerFront' });
  private readonly rays = new GodRays({ size: 1500, color: SKINS.jukejam.rays, speed: 0.2, alpha: 0.7 });
  private readonly glow = new Sprite({ texture: glowTexture(256), anchor: 0.5, blendMode: 'add', alpha: 0.5 });
  private readonly emblemHolder = new Container();
  private readonly emblem = new Sprite();
  private readonly ribbon = new Sprite();
  private readonly ribbonHolder = new Container();
  private readonly titleHolder = new Container();
  readonly amount: BitmapText;
  readonly press: PressPrompt;
  private title: Title | null = null;
  private count: Title | null = null;
  private sub: Title | null = null;
  private mode: BannerMode = 'intro';
  private skin: FeatureSkin = 'jukejam';
  private tl: gsap.core.Timeline | null = null;
  private extra: gsap.core.Tween[] = [];
  private beat = 0;
  private beatPeriod = 0.566;
  private pump = 0;
  private looping = false;

  constructor(amountFont: string) {
    this.back.addChild(this.rays, this.glow);
    this.emblemHolder.addChild(this.emblem);
    this.ribbonHolder.addChild(this.ribbon);
    this.amount = new BitmapText({ text: '', style: { fontFamily: amountFont, fontSize: 150 }, anchor: 0.5 });
    this.press = new PressPrompt(46, 0xffffff, SCREENS_TIMING.featureIntro.pressPeriod, SKINS.jukejam.accent);
    this.front.addChild(this.emblemHolder, this.ribbonHolder, this.titleHolder, this.amount, this.press);
    this.back.visible = this.front.visible = false;
  }

  /** Emblem centre in content space (FX origin for title_hit). */
  get emblemPos(): { x: number; y: number } {
    return { x: 0, y: PLACE[this.mode].emblemY };
  }

  /** Count / amount centre in content space (FX origin for count_hit and the amount punch). */
  get countPos(): { x: number; y: number } {
    return { x: 0, y: this.mode === 'intro' ? PLACE.intro.countY : AMOUNT_Y };
  }

  private emblemTex(res: number): Baked {
    return this.skin === 'megamix'
      ? screenArt.get('emblem:megamix', res, speakerStack)
      : screenArt.get('emblem:jukejam', res, jukebox);
  }

  /**
   * Build for one show. `count` = free spins (intro); the outro's amount text is set by the
   * owner through `amount`. `bpm` phases the emblem pump.
   */
  setup(o: { mode: BannerMode; skin: FeatureSkin; res: number; count: number; bpm: number }): void {
    this.clear();
    this.mode = o.mode;
    this.skin = o.skin;
    const P = PLACE[o.mode];
    const look = SKINS[o.skin];
    this.rays.color = look.rays;
    this.rays.y = P.emblemY + 60;
    this.glow.tint = look.second;
    this.glow.width = this.glow.height = P.emblemH * 2.1;
    this.glow.y = P.emblemY;
    // emblem (baked at the display size)
    useBaked(this.emblem, this.emblemTex(o.res * (P.emblemH / 430)));
    this.fitEmblem(P.emblemH);
    this.emblemHolder.position.set(0, P.emblemY);
    // ribbon + title
    const dark = o.skin === 'megamix' ? 0x7a0f5c : 0x0f6a70;
    useBaked(this.ribbon, screenArt.get(`ribbon:${o.skin}:${P.ribbonW}`, o.res, () => ribbon(P.ribbonW, P.ribbonH, look.accent, dark)));
    this.ribbonHolder.position.set(0, P.ribbonY);
    const title = new Title([{ text: label(look.titleKey, o.skin === 'megamix' ? 'MEGA MIX' : 'JUKE JAM'), style: titleStyle(o.skin, P.titleSize) }], o.res, {
      maxWidth: P.ribbonW - 80,
    });
    title.y = P.ribbonY - 4;
    this.title = title;
    this.titleHolder.addChild(title);
    if (o.mode === 'intro') {
      const count = new Title([{ text: label('bd.feature.count', '{n}', { n: o.count }), style: COUNT_STYLE(o.skin) }], o.res, { maxWidth: 600 });
      count.y = P.countY;
      const sub = new Title([{ text: label('bd.feature.freeSpins', 'FREE SPINS'), style: SUB_STYLE }], o.res, { maxWidth: 900 });
      sub.y = P.subY;
      this.count = count;
      this.sub = sub;
      this.titleHolder.addChild(count, sub);
      this.amount.visible = false;
    } else {
      const sub = new Title([{ text: label('bd.feature.totalWin', 'TOTAL WIN'), style: { ...SUB_STYLE, size: 80 } }], o.res, { maxWidth: 800 });
      sub.y = P.subY;
      this.sub = sub;
      this.titleHolder.addChild(sub);
      this.amount.visible = true;
      this.amount.y = AMOUNT_Y;
      this.amount.alpha = 0;
    }
    this.press.y = P.pressY;
    this.press.visible = false;
    this.press.stop();
    this.beatPeriod = (15 / 30) * (120 / o.bpm);
    this.beat = 0;
    this.pump = 0;
    this.looping = false;
    this.back.visible = this.front.visible = true;
    this.back.alpha = this.front.alpha = 1;
    this.front.scale.set(1);
  }

  private fitEmblem(h: number): void {
    this.emblem.scale.set(h / this.emblem.texture.height);
  }

  /** Re-bake the emblem / ribbon for a new resolution (layout change while showing). */
  rebake(res: number): void {
    if (!this.front.visible) return;
    const P = PLACE[this.mode];
    useBaked(this.emblem, this.emblemTex(res * (P.emblemH / 430)));
    this.fitEmblem(P.emblemH);
  }

  /** Fit the outro amount to the plate width. */
  fitAmount(): void {
    this.amount.scale.set(1);
    if (this.amount.width > AMOUNT_MAX_W) this.amount.scale.set(AMOUNT_MAX_W / this.amount.width);
  }

  /** `in`: returns the (followSpeed-registered) timeline; `ms` converts authored ms to seconds (s()). */
  playIn(ms: (v: number) => number, onEvent: (e: BannerEvent) => void): gsap.core.Timeline {
    const T = this.mode === 'intro' ? SCREENS_TIMING.featureIntro : null;
    const O = SCREENS_TIMING.outro;
    const P = PLACE[this.mode];
    const tl = gsap.timeline();
    const hit = ms(T ? T.titleHit : O.titleHit);
    // rays + glow grow in
    this.rays.scale.set(0);
    this.glow.alpha = 0;
    tl.to(this.rays.scale, { x: 1, y: 1, duration: ms(700), ease: 'back.out(1.5)' }, 0);
    tl.to(this.glow, { alpha: 0.55, duration: ms(400) }, 0);
    // emblem drops and slams (squash sy 0.8), springs back
    const ey = P.emblemY;
    this.emblemHolder.y = ey - 520;
    this.emblemHolder.alpha = 0;
    this.emblemHolder.scale.set(1);
    tl.to(this.emblemHolder, { alpha: 1, duration: hit * 0.3 }, 0);
    tl.to(this.emblemHolder, { y: ey, duration: hit, ease: 'power2.in' }, 0);
    tl.set(this.emblemHolder.scale, { x: 1.16, y: 0.8 }, hit);
    tl.to(this.emblemHolder.scale, { x: 1, y: 1, duration: ms(420), ease: 'elastic.out(1.1, 0.4)' }, hit);
    tl.call(() => onEvent('title_hit'), undefined, hit);
    // banner unfurls (f10 - f18), title letters pop on it
    const bFrom = T ? ms(T.bannerFrom) : hit;
    const bTo = T ? ms(T.bannerTo) : hit + ms(270);
    this.ribbonHolder.scale.set(0, 1);
    tl.to(this.ribbonHolder.scale, { x: 1, duration: bTo - bFrom, ease: 'back.out(1.7)' }, bFrom);
    const title = this.title;
    if (title) {
      for (const g of title.glyphs) g.sprite.alpha = 0;
      tl.call(() => void this.extraTween(title.popIn({ duration: ms(360), stagger: ms(34), lineDelay: 0 })), undefined, bFrom + ms(60));
    }
    if (this.mode === 'intro' && T) {
      const count = this.count;
      const sub = this.sub;
      const cHit = ms(T.countHit);
      if (count) {
        count.alpha = 0;
        count.scale.set(2.2);
        tl.to(count, { alpha: 1, duration: ms(90) }, cHit - ms(160));
        tl.to(count.scale, { x: 1, y: 1, duration: ms(160), ease: 'power3.in' }, cHit - ms(160));
        tl.to(count.scale, { x: 1.08, y: 0.92, duration: ms(60), yoyo: true, repeat: 1, ease: 'sine.out' }, cHit);
      }
      tl.call(() => onEvent('count_hit'), undefined, cHit);
      if (sub) {
        for (const g of sub.glyphs) g.sprite.alpha = 0;
        tl.call(() => void this.extraTween(sub.popIn({ duration: ms(380), stagger: ms(30), lineDelay: 0 })), undefined, cHit + ms(60));
      }
      tl.call(() => onEvent('shine'), undefined, ms(T.shine));
      tl.to({}, { duration: ms(T.in) - ms(T.shine) }, ms(T.shine));
    } else {
      const sub = this.sub;
      if (sub) {
        for (const g of sub.glyphs) g.sprite.alpha = 0;
        tl.call(() => void this.extraTween(sub.popIn({ duration: ms(380), stagger: ms(30), lineDelay: 0 })), undefined, hit + ms(120));
      }
      tl.to(this.amount, { alpha: 1, duration: ms(200) }, hit + ms(200));
      tl.to({}, { duration: ms(O.in) - hit }, hit);
    }
    for (const t of [title, this.count, this.sub]) if (t) tl.to(t, { waveAmp: 5, duration: ms(800) }, ms(T ? T.in : O.in));
    tl.call(() => void (this.looping = true), undefined, ms(T ? T.in : O.in));
    this.tl = followSpeed(tl);
    return tl;
  }

  private extraTween<A extends gsap.core.Tween | gsap.core.Timeline>(a: A): A {
    followSpeed(a);
    this.extra.push(a as unknown as gsap.core.Tween);
    return a;
  }

  /** Title glint (`fx_title_shine`). */
  shine(duration: number): void {
    if (this.title) this.extraTween(this.title.sweep(duration));
  }

  /** `amount_punch` (outro count landed). */
  punchAmount(duration: number): void {
    const base = this.amount.scale.x;
    this.extraTween(gsap.fromTo(this.amount.scale, { x: base * 1.25, y: base * 1.25 }, { x: base, y: base, duration, ease: 'elastic.out(1, 0.5)' }));
  }

  showPress(text: string, delay: number): void {
    this.press.setText(text);
    this.press.accent = SKINS[this.skin].accent;
    this.press.visible = true;
    this.press.alpha = 0;
    this.press.start();
    this.extraTween(gsap.to(this.press, { alpha: 1, duration: 0.3, delay }));
  }

  hidePress(): void {
    this.press.visible = false;
    this.press.stop();
  }

  /** Per frame (game dt): titles, the loop's emblem pump on the beat, the prompt pulse. */
  tick(dt: number): void {
    this.title?.tick(dt);
    this.count?.tick(dt);
    this.sub?.tick(dt);
    this.press.tick(dt);
    if (!this.looping) return;
    this.beat += dt;
    if (this.beat >= this.beatPeriod) {
      this.beat -= this.beatPeriod;
      this.pump = 1;
    }
    if (this.pump > 0) {
      this.pump = Math.max(0, this.pump - dt / 0.18);
      const p = this.pump * this.pump;
      this.emblemHolder.scale.set(1 + 0.045 * p, 1 + 0.06 * p);
    }
  }

  /** `out`: scale 1.1 + fade. */
  playOut(duration: number): gsap.core.Timeline {
    this.looping = false;
    this.tl?.kill();
    const tl = gsap.timeline();
    tl.to(this.front.scale, { x: 1.1, y: 1.1, duration, ease: 'power2.out' }, 0);
    tl.to([this.front, this.back], { alpha: 0, duration, ease: 'power1.in' }, 0);
    this.tl = followSpeed(tl);
    return tl;
  }

  /** Destroy the per-show titles and hide everything. */
  clear(): void {
    this.tl?.kill();
    this.tl = null;
    for (const t of this.extra) t.kill();
    this.extra = [];
    for (const t of [this.title, this.count, this.sub]) t?.destroy();
    this.title = this.count = this.sub = null;
    this.looping = false;
    this.press.stop();
    this.back.visible = this.front.visible = false;
  }

  destroy(): void {
    this.clear();
    this.back.destroy({ children: true });
    this.front.destroy({ children: true });
  }
}
