import { gsap } from 'gsap';
import { Assets, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import { FONTS } from '../../../assets/fonts';
import type { LayoutSpec, Rect } from '../../../config/layout';
import type { GameContext, GameModule } from '../../../game/context';
import { BakedWord, type GlyphStyle } from '../../../present/common/glyphs';
import { label } from '../../../present/common/text';
import { LOGO_ART, LOGO_CYAN, LOGO_PINK, SCENE_LOOK } from './look';

/** The word-mark type: the intro logo's title face, outline and extrusion (screens/IntroCards). */
const TOP_STYLE: Omit<GlyphStyle, 'size'> = { family: FONTS.title, extrude: 0.1, palette: LOGO_CYAN, outline: 0.08, tracking: 0.03 };
const MAIN_STYLE: Omit<GlyphStyle, 'size'> = { family: FONTS.title, extrude: 0.1, palette: LOGO_PINK, outline: 0.07, tracking: 0.02 };

let measureCtx: CanvasRenderingContext2D | null = null;

/** Width (advances, as BakedWord sets them) and cap height of `text` at `size` px. */
const measure = (text: string, st: Omit<GlyphStyle, 'size'>, size: number): { w: number; cap: number } => {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  const g = measureCtx;
  if (!g) return { w: text.length * size * 0.7, cap: size * 0.72 };
  g.font = `${size}px "${st.family}"`;
  const track = size * (st.tracking ?? 0.02);
  let w = 0;
  for (const ch of text) w += ch === ' ' ? size * 0.32 : g.measureText(ch).width + track;
  return { w: w - track, cap: g.measureText('H').actualBoundingBoxAscent };
};

/**
 * A baked word sized to a cap height (design px), smaller if it would pass `maxW`. The glyphs are
 * baked at that size (a residual scale <= 1 absorbs measuring differences), so the glyph cache
 * only holds small, display-sized glyphs.
 */
const word = (text: string, st: Omit<GlyphStyle, 'size'>, cap: number, maxW: number, res: number): BakedWord => {
  const probe = measure(text, st, 100);
  let size = (100 * cap) / Math.max(1, probe.cap);
  const w = (probe.w * size) / 100;
  if (w > maxW) size *= maxW / w;
  const out = new BakedWord(text, { ...st, size: Math.max(6, Math.round(size)) }, res);
  out.scale.set(Math.min(1, maxW / Math.max(1, out.textWidth)));
  return out;
};

/** Bend a word's glyphs along a circle of `radius` design px whose top is the word's centre line. */
const bend = (w: BakedWord, radius: number): void => {
  const k = w.scale.x;
  for (const g of w.glyphs) {
    const x = g.homeX * k;
    const drop = radius - Math.sqrt(Math.max(0, radius * radius - x * x));
    g.sprite.position.set(g.homeX, g.homeY + drop / k);
    g.sprite.rotation = Math.asin(Math.max(-0.9, Math.min(0.9, x / radius)));
  }
};

/**
 * LOGO — the Bass Drop crest (art/source/ui/bass-drop/logo, tools/bdart/logo.py: speaker, horns and
 * neon arcs over a blank banner) with the live-text word-mark "SWAMP FUNK" / "BASS DROP" (i18n keys
 * bd.intro.logoTop / bd.intro.logoMain, the bundled title face through the engine glyph baker, the
 * intro logo's cyan over hot pink; no letters are baked into the art). Owns its sprite in
 * ctx.layers.logo (the Frame draws none: FrameOptions.logo false).
 *  - Crest lock-up (landscape / tablet, rect aspect < 3): the emblem contain-fitted to layout.logo, the
 *    two lines set on the banner and bent along its upward bow; BASS DROP may run past the banner face
 *    onto the ribbon ends (never past the rect).
 *  - Wide lock-up (portrait 600 x 110, compact 236 x 40): the emblem at the rect height, the two lines
 *    stacked beside it, the group centred.
 * Emblem + word-mark are baked into ONE texture per layout kind and display resolution (the shared
 * glyph cache may be released by the screens at any time, so no live glyph sprite stays on screen).
 * Motion: static + a shine sweep every few seconds (UI time; not on the low tier), as ANIMATION_SET
 * `logo_bd`. A missing crest leaves the word-mark alone.
 */
export class Logo implements GameModule {
  private readonly view = new Container({ label: 'bdLogo' });
  private readonly sprite = new Sprite();
  private readonly mask = new Sprite();
  private readonly shine = new Sprite({ anchor: 0.5, blendMode: 'add' });
  private readonly shineHolder = new Container({ label: 'bdLogoShine' });
  private emblem: Texture | null = null;
  private baked: Texture | null = null;
  private band: Texture | null = null;
  private shineTl: gsap.core.Timeline | null = null;
  private key = '';
  private offs: Array<() => void> = [];

  constructor(private readonly ctx: GameContext) {}

  async init(): Promise<void> {
    const { ctx } = this;
    try {
      this.emblem = await Assets.load<Texture>(LOGO_ART.url);
    } catch {
      this.emblem = null;
    }
    this.shineHolder.addChild(this.shine);
    this.shineHolder.visible = false;
    this.view.addChild(this.sprite, this.shineHolder, this.mask);
    ctx.layers.logo.addChildAt(this.view, 0);
    this.offs.push(ctx.game.on('layout:change', ({ layout }) => this.layout(layout)));
    this.layout(ctx.layout);
  }

  layout(L: LayoutSpec): void {
    const { ctx } = this;
    const res = Math.min(2, Math.max(1, Math.ceil(ctx.scale * ctx.app.renderer.resolution * 4) / 4));
    const key = `${L.kind}@${res}`;
    if (key === this.key) return;
    this.key = key;
    const comp = this.compose(L.logo, res);
    const frame = comp.getLocalBounds().rectangle.clone().pad(4);
    const tex = ctx.app.renderer.generateTexture({ target: comp, frame, resolution: res, antialias: true });
    comp.destroy({ children: true });
    const old = this.baked;
    this.baked = tex;
    const cx = L.logo.x + L.logo.w / 2;
    const cy = L.logo.y + L.logo.h / 2;
    for (const s of [this.sprite, this.mask]) {
      s.texture = tex;
      s.position.set(cx + frame.x, cy + frame.y);
    }
    old?.destroy(true);
    this.setupShine(frame.width, frame.height, cx + frame.x, cy + frame.y);
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.offs = [];
    this.shineTl?.kill();
    this.view.destroy({ children: true });
    this.baked?.destroy(true);
    this.band?.destroy(true);
    if (this.emblem) void Assets.unload(LOGO_ART.url).catch(() => undefined);
  }

  // ======================================================================= composition

  /** Emblem + word-mark in design px around the rect centre (0, 0); glyphs baked at `res`. */
  private compose(r: Rect, res: number): Container {
    const comp = new Container();
    const top = label('bd.intro.logoTop', 'SWAMP FUNK');
    const main = label('bd.intro.logoMain', 'BASS DROP');
    const E = LOGO_ART.size;
    const wide = r.w / r.h >= 3 || !this.emblem;

    if (!wide && this.emblem) {
      // crest lock-up: emblem contain-fitted, lines on the banner face, bent along its bow
      const k = Math.min(r.w / E.w, r.h / E.h);
      const em = new Sprite({ texture: this.emblem, anchor: 0.5 });
      em.scale.set(k);
      comp.addChild(em);
      const tb = LOGO_ART.textBox;
      const bx = (tb.x + tb.w / 2 - E.w / 2) * k;
      const by = (tb.y - E.h / 2) * k;
      const bw = tb.w * k;
      const bh = tb.h * k;
      // circle through the banner bow: sagitta `bannerRise` over the face half-width
      const half = tb.w / 2;
      const radius = ((half * half + LOGO_ART.bannerRise ** 2) / (2 * LOGO_ART.bannerRise)) * k;
      const topWord = word(top, TOP_STYLE, bh * 0.25, bw * 0.8, res);
      const mainWord = word(main, MAIN_STYLE, bh * 0.44, Math.min(r.w * 0.98, bw * 1.24), res);
      topWord.position.set(bx, by + bh * 0.3);
      mainWord.position.set(bx, by + bh * 0.68);
      bend(topWord, radius * 0.94);
      bend(mainWord, radius);
      comp.addChild(topWord, mainWord);
      return comp;
    }

    // wide lock-up: [emblem] [SWAMP FUNK / BASS DROP]
    const h = r.h;
    const em = this.emblem ? new Sprite({ texture: this.emblem, anchor: 0.5 }) : null;
    const eh = h * 1.04;
    const ew = em ? (eh * E.w) / E.h : 0;
    const gap = em ? h * 0.12 : 0;
    const textMax = r.w - ew - gap;
    const mainWord = word(main, MAIN_STYLE, h * 0.4, textMax, res);
    const mainW = mainWord.textWidth * mainWord.scale.x;
    const topWord = word(top, TOP_STYLE, h * 0.22, Math.min(textMax, mainW * 0.9), res);
    const textW = Math.max(mainW, topWord.textWidth * topWord.scale.x);
    const x0 = -(ew + gap + textW) / 2;
    if (em) {
      em.scale.set(eh / E.h);
      em.position.set(x0 + ew / 2, 0);
      comp.addChild(em);
    }
    const tx = x0 + ew + gap + textW / 2;
    topWord.position.set(tx, -h * 0.27);
    mainWord.position.set(tx, h * 0.15);
    comp.addChild(topWord, mainWord);
    return comp;
  }

  // ======================================================================= shine

  /** Additive diagonal band masked by the logo's alpha, swept every few seconds (UI time). */
  private setupShine(w: number, h: number, x: number, y: number): void {
    this.shineTl?.kill();
    this.shineTl = null;
    this.shineHolder.visible = false;
    if (this.ctx.tier === 'low') {
      this.shineHolder.mask = null;
      this.mask.visible = false;
      return;
    }
    this.mask.visible = true;
    this.shineHolder.setMask({ mask: this.mask, channel: 'alpha' });
    const shine = this.shine;
    shine.texture = this.shineBand();
    shine.height = h * 1.8;
    shine.width = Math.max(24, h * 0.55);
    shine.angle = 18;
    shine.alpha = 0.7;
    shine.y = y + h / 2;
    this.shineTl = gsap
      .timeline({ repeat: -1, repeatDelay: SCENE_LOOK.shineGap, delay: SCENE_LOOK.shineDelay })
      .set(this.shineHolder, { visible: true })
      .fromTo(shine, { x: x - h * 0.6 }, { x: x + w + h * 0.6, duration: SCENE_LOOK.shineDuration, ease: 'power1.inOut' })
      .set(this.shineHolder, { visible: false });
  }

  private shineBand(): Texture {
    if (this.band) return this.band;
    const g = new Graphics();
    const w = 64;
    for (let i = 0; i < w; i++) {
      const d = Math.abs(i - w / 2) / (w / 2);
      g.rect(i, 0, 1, 4).fill({ color: 0xffffff, alpha: (1 - d * d) * (d < 0.18 ? 1 : 0.5) });
    }
    this.band = this.ctx.app.renderer.generateTexture({ target: g, frame: new Rectangle(0, 0, w, 4), resolution: 1 });
    g.destroy();
    return this.band;
  }
}
