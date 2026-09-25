import { gsap } from 'gsap';
import {
  Container,
  FillGradient,
  Graphics,
  NineSliceSprite,
  Rectangle,
  Sprite,
  type Texture,
} from 'pixi.js';
import { mix } from '../../../assets/placeholder/palette';
import type { LayoutSpec, Rect } from '../../../config/layout';
import { clock } from '../../../core/clock';
import type { GameContext, GameModule } from '../../../game/context';
import { buildLogo } from './frame/logo';
import { WOOD, nail, plank, ropeWrap, sillPart } from './frame/wood';
import { registerTiming } from '../../../core/timing';

/**
 * Reel frame (owns ctx.layers.panel, ctx.layers.frame, ctx.layers.logo):
 *  - glass panel behind the grid: vertical gradient #0c3149 -> #080418, faint 45°
 *    sheen top-left, beam shadow + neon spill along the top edge;
 *  - weathered cypress frame (posts, beam, sill) in the foreground cel style with
 *    rope wraps and a thin neon tube under the beam (subtle pulse);
 *  - the word-mark logo (default "SWAMP FUNK"; FrameOptions.logoText) in layout.logo with a
 *    shine sweep every few seconds.
 * Wood and logo are baked at the current display resolution (the app runs without
 * MSAA) and re-baked on 'layout:change'. Production art (env keys panel /
 * frame_post / frame_beam / frame_sill / logo) replaces the procedural parts.
 */
const LOCAL_TIMING = registerTiming('scene', {
  /** logo shine sweep: duration and gap (s, UI time) */
  shineDuration: 0.9,
  shineGap: 6,
  /** neon tube breathing period (s) */
  tubePeriod: 3.2,
  /** base <-> free-spins neon recolour (s), matches the background crossfade */
  modeCrossfade: 1.4,
});
const NEON = 0x35f2e0;
const NEON_HOT = 0xff3fa8;

interface FrameGeom {
  u: number;
  beam: Rect;
  left: Rect;
  right: Rect;
  sill: Rect;
  rope: number;
  tube: { x0: number; x1: number; y: number; w: number };
}

const geometry = (L: LayoutSpec): FrameGeom => {
  const { panel: P, frame: F, frameParts: fp } = L;
  const u = fp.post / 50;
  const lx = Math.max(F.x, P.x - fp.post + 2);
  const rx = Math.min(F.x + F.w - fp.post, P.x + P.w - 2);
  const beam = { x: F.x, y: F.y, w: F.w, h: fp.beam };
  const sillY = F.y + F.h - fp.sill;
  const over = fp.post * 0.3;
  const sill = { x: lx - over, y: sillY, w: rx + fp.post - lx + over * 2, h: fp.sill };
  const postTop = F.y + fp.beam - 6 * u;
  const postBottom = sillY + 6 * u;
  return {
    u,
    beam,
    left: { x: lx, y: postTop, w: fp.post, h: postBottom - postTop },
    right: { x: rx, y: postTop, w: fp.post, h: postBottom - postTop },
    sill,
    rope: fp.post * 0.95,
    tube: { x0: lx + fp.post + 14 * u, x1: rx - 14 * u, y: F.y + fp.beam + 5 * u, w: Math.max(2, 4 * u) },
  };
};

export interface FrameOptions {
  /** procedural word-mark text (first word lime, the rest neon bands); production art key `logo` wins */
  logoText?: string;
}

export class Frame implements GameModule {
  private panel = new Container({ label: 'panelArt' });
  private frame = new Container({ label: 'frameArt' });
  private logo = new Container({ label: 'logoArt' });
  private owned: Texture[] = [];
  private logoTex: Texture | null = null;
  private logoSprite = new Sprite();
  private shine = new Sprite();
  private shineMask = new Sprite();
  private tubeGlow: Sprite[] = [];
  /** neon-coloured sprites (tube body, halo, panel spill), re-tinted per game mode */
  private tinted: Sprite[] = [];
  private heat = { v: 0 };
  private shineTween: gsap.core.Timeline | null = null;
  private shineHolder: Container | null = null;
  private offTick: (() => void) | null = null;
  private t = 0;
  private key = '';

  constructor(
    private ctx: GameContext,
    private readonly opts: FrameOptions = {},
  ) {
    ctx.game.on('layout:change', ({ layout }) => this.layout(layout));
    ctx.game.on('mode:change', ({ gameType }) => {
      gsap.killTweensOf(this.heat);
      gsap.to(this.heat, {
        v: gameType === 'freegame' ? 1 : 0,
        duration: LOCAL_TIMING.modeCrossfade,
        ease: 'sine.inOut',
        onUpdate: () => this.applyHeat(),
      });
    });
  }

  private applyHeat(): void {
    const c = mix(NEON, NEON_HOT, this.heat.v);
    for (const s of this.tinted) s.tint = c;
  }

  init(): void {
    const { layers } = this.ctx;
    layers.panel.addChild(this.panel);
    layers.frame.addChild(this.frame);
    layers.logo.addChild(this.logo);
    this.layout(this.ctx.layout);
    this.offTick = clock.onUpdate((dt) => this.update(dt));
  }

  /** Resolution the frame is baked at (display px per design px, capped). */
  private resolution(): number {
    const { ctx } = this;
    const r = ctx.scale * ctx.app.renderer.resolution;
    return Math.min(2, Math.max(0.5, Math.ceil(r * 4) / 4));
  }

  layout(L: LayoutSpec): void {
    const res = this.resolution();
    const key = `${L.kind}@${res}`;
    if (key === this.key) return;
    this.key = key;
    for (const t of this.owned) t.destroy(true);
    this.owned.length = 0;
    this.panel.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.frame.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.tubeGlow.length = 0;
    this.tinted.length = 0;
    const g = geometry(L);
    this.buildPanel(L, g);
    this.buildFrame(g, res);
    this.buildLogo(L);
  }

  // ---------------------------------------------------------------------------

  private buildPanel(L: LayoutSpec, g: FrameGeom): void {
    const prod = this.ctx.art.env('panel');
    const P = L.panel;
    // the glass fills the whole opening (panel rect extended to the posts/sill)
    const x0 = Math.min(P.x, g.left.x + g.left.w - 4);
    const y0 = Math.min(P.y, g.beam.y + g.beam.h - 4);
    const x1 = Math.max(P.x + P.w, g.right.x + 4);
    const y1 = Math.max(P.y + P.h, g.sill.y + 4);
    if (prod) {
      const s = new Sprite(prod);
      s.position.set(x0, y0);
      s.width = x1 - x0;
      s.height = y1 - y0;
      this.panel.addChild(s);
      return;
    }
    const grad = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      colorStops: [
        { offset: 0, color: 0x0c3149 },
        { offset: 0.55, color: 0x0a1c36 },
        { offset: 1, color: 0x080418 },
      ],
      textureSpace: 'local',
    });
    const glass = new Graphics().roundRect(x0, y0, x1 - x0, y1 - y0, 18 * g.u).fill(grad);
    // faint 45° sheen, top-left
    const w = x1 - x0;
    const h = y1 - y0;
    const sheen = new Graphics()
      .poly([x0, y0 + h * 0.34, x0 + w * 0.3, y0, x0 + w * 0.42, y0, x0, y0 + h * 0.52], true)
      .fill({ color: 0xffffff, alpha: 0.035 })
      .poly([x0, y0 + h * 0.6, x0 + w * 0.5, y0, x0 + w * 0.53, y0, x0, y0 + h * 0.64], true)
      .fill({ color: 0xffffff, alpha: 0.03 });
    // beam shadow on the glass + neon spill
    const shade = new Graphics().rect(x0, y0, w, 60 * g.u).fill(
      new FillGradient({
        type: 'linear',
        start: { x: 0, y: 0 },
        end: { x: 0, y: 1 },
        colorStops: [
          { offset: 0, color: 'rgba(0,0,0,0.55)' },
          { offset: 1, color: 'rgba(0,0,0,0)' },
        ],
        textureSpace: 'local',
      }),
    );
    const edges = new Graphics().roundRect(x0, y0, w, h, 18 * g.u).stroke({ width: 10 * g.u, color: 0x000000, alpha: 0.35 });
    this.panel.addChild(glass, sheen, shade, edges);
    const spill = new Sprite(this.ctx.art.particle('glow'));
    spill.anchor.set(0.5, 0.5);
    spill.position.set((g.tube.x0 + g.tube.x1) / 2, g.tube.y);
    spill.width = g.tube.x1 - g.tube.x0 + 80 * g.u;
    spill.height = 120 * g.u;
    spill.tint = NEON;
    spill.alpha = 0.18;
    spill.blendMode = 'add';
    this.panel.addChild(spill);
    this.tubeGlow.push(spill);
    this.tinted.push(spill);
  }

  private bake(target: Container, frame: Rectangle, res: number): Sprite {
    const tex = this.ctx.app.renderer.generateTexture({ target, frame, resolution: res, antialias: true });
    target.destroy({ children: true });
    this.owned.push(tex);
    const s = new Sprite(tex);
    s.position.set(frame.x, frame.y);
    return s;
  }

  private prodPart(tex: Texture, r: Rect, vertical: boolean): Container {
    const border = vertical ? Math.round(tex.height * 0.2) : Math.round(tex.width * 0.2);
    const s = new NineSliceSprite({
      texture: tex,
      leftWidth: vertical ? 0 : border,
      rightWidth: vertical ? 0 : border,
      topHeight: vertical ? border : 0,
      bottomHeight: vertical ? border : 0,
    });
    s.position.set(r.x, r.y);
    s.width = r.w;
    s.height = r.h;
    return s;
  }

  private buildFrame(g: FrameGeom, res: number): void {
    const { art } = this.ctx;
    const u = g.u;
    const pad = 8 * u;
    const around = (r: Rect, extraBottom = 0) => new Rectangle(r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2 + extraBottom);

    // posts
    const postTex = art.env('frame_post');
    for (const [r, seed] of [
      [g.left, 11],
      [g.right, 23],
    ] as const) {
      if (postTex) {
        this.frame.addChild(this.prodPart(postTex, r, true));
        continue;
      }
      const c = new Container();
      c.addChild(plank(r, { horizontal: false, u, seed, knots: 2 }));
      this.frame.addChild(this.bake(c, around(r), res));
    }

    // sill
    const sillTex = art.env('frame_sill');
    if (sillTex) this.frame.addChild(this.prodPart(sillTex, g.sill, false));
    else {
      const c = new Container();
      c.addChild(sillPart(g.sill, u, 37));
      const n = new Graphics();
      for (const x of [g.left.x + g.left.w / 2, g.right.x + g.right.w / 2]) nail(n, x, g.sill.y + g.sill.h * 0.55, u);
      c.addChild(n);
      this.frame.addChild(this.bake(c, around(g.sill), res));
    }

    // neon tube under the beam: white body (tinted per mode) + hot core + clips
    const tw = g.tube.x1 - g.tube.x0;
    const tubeFrame = new Rectangle(g.tube.x0 - 4, g.tube.y - 16 * u, tw + 8, 32 * u);
    const body = this.bake(
      new Graphics().roundRect(g.tube.x0, g.tube.y - g.tube.w / 2, tw, g.tube.w, g.tube.w / 2).fill(0xffffff),
      tubeFrame,
      res,
    );
    this.frame.addChild(body);
    this.tinted.push(body);
    const tg = new Graphics();
    tg.roundRect(g.tube.x0 + 2, g.tube.y - g.tube.w * 0.2, tw - 4, g.tube.w * 0.4, g.tube.w * 0.2).fill({ color: 0xffffff, alpha: 0.85 });
    for (let x = g.tube.x0 + 40 * u; x < g.tube.x1 - 20 * u; x += 180 * u) {
      tg.roundRect(x - 3 * u, g.tube.y - g.tube.w - 4 * u, 6 * u, g.tube.w * 2 + 6 * u, 2 * u).fill(0x221433).stroke({ width: 1.2 * u, color: 0x000000 });
    }
    this.frame.addChild(this.bake(tg, tubeFrame, res));
    const halo = new Sprite(art.particle('glow'));
    halo.anchor.set(0.5);
    halo.position.set(g.tube.x0 + tw / 2, g.tube.y);
    halo.width = tw + 60 * u;
    halo.height = 34 * u;
    halo.tint = NEON;
    halo.alpha = 0.5;
    halo.blendMode = 'add';
    this.frame.addChild(halo);
    this.tubeGlow.push(halo);
    this.tinted.push(halo);
    this.applyHeat();

    // beam + rope wraps (baked together)
    const beamTex = art.env('frame_beam');
    if (beamTex) this.frame.addChild(this.prodPart(beamTex, g.beam, false));
    else {
      const c = new Container();
      const faceH = g.beam.h * 0.74;
      c.addChild(
        plank(
          { x: g.beam.x, y: g.beam.y + faceH - 2 * u, w: g.beam.w, h: g.beam.h - faceH + 2 * u },
          { horizontal: true, u, seed: 51, face: WOOD.under, lightBand: false, shadeBand: false, knots: 0 },
        ),
      );
      c.addChild(plank({ x: g.beam.x, y: g.beam.y, w: g.beam.w, h: faceH }, { horizontal: true, u, seed: 43, knots: 3 }));
      // plank seams + nails
      const n = new Graphics();
      for (const t of [0.3, 0.68]) {
        const sx = g.beam.x + g.beam.w * t;
        n.moveTo(sx, g.beam.y + 2).lineTo(sx + 2 * u, g.beam.y + faceH - 2).stroke({ width: 3 * u, color: WOOD.ink });
        nail(n, sx - 9 * u, g.beam.y + faceH * 0.3, u);
        nail(n, sx + 11 * u, g.beam.y + faceH * 0.7, u);
      }
      for (const px of [g.left.x + g.left.w / 2, g.right.x + g.right.w / 2]) nail(n, px, g.beam.y + faceH * 0.5, u);
      c.addChild(n);
      for (const r of [g.left, g.right]) c.addChild(ropeWrap(r.x, g.beam.y + g.beam.h - 2 * u, r.w, g.rope, u));
      this.frame.addChild(this.bake(c, around(g.beam, g.rope + 6 * u), res));
    }
  }

  private buildLogo(L: LayoutSpec): void {
    const prod = this.ctx.art.env('logo');
    if (!this.logoTex && !prod) {
      this.logoTex = buildLogo(this.ctx.app.renderer, this.opts.logoText).texture;
    }
    const tex = prod ?? this.logoTex;
    if (!tex) return;
    this.logo.removeChildren();
    const r = L.logo;
    const k = Math.min(r.w / tex.width, r.h / tex.height);
    const s = this.logoSprite;
    s.texture = tex;
    s.anchor.set(0.5);
    s.scale.set(k);
    s.position.set(r.x + r.w / 2, r.y + r.h / 2);
    this.logo.addChild(s);

    // shine sweep: additive diagonal band masked by the logo's alpha
    this.shineTween?.kill();
    this.shineTween = null;
    if (this.ctx.tier === 'low') return;
    const m = this.shineMask;
    m.texture = tex;
    m.anchor.set(0.5);
    m.scale.set(k);
    m.position.copyFrom(s.position);
    const band = this.shineBand();
    const shine = this.shine;
    shine.texture = band;
    shine.anchor.set(0.5);
    shine.height = r.h * 1.8;
    shine.width = r.h * 0.9;
    shine.angle = 18;
    shine.blendMode = 'add';
    shine.alpha = 0.85;
    shine.y = s.y;
    this.shineHolder?.destroy();
    const holder = new Container();
    this.shineHolder = holder;
    holder.addChild(shine);
    holder.setMask({ mask: m, channel: 'alpha' });
    holder.visible = false;
    this.logo.addChild(holder, m);
    const x0 = s.x - (tex.width * k) / 2 - r.h;
    const x1 = s.x + (tex.width * k) / 2 + r.h;
    this.shineTween = gsap
      .timeline({ repeat: -1, repeatDelay: LOCAL_TIMING.shineGap, delay: 1.5 })
      .set(holder, { visible: true })
      .fromTo(shine, { x: x0 }, { x: x1, duration: LOCAL_TIMING.shineDuration, ease: 'power1.inOut' })
      .set(holder, { visible: false });
  }

  private band: Texture | null = null;
  private shineBand(): Texture {
    if (this.band) return this.band;
    const g = new Graphics();
    const w = 64;
    for (let i = 0; i < w; i++) {
      const d = Math.abs(i - w / 2) / (w / 2);
      g.rect(i, 0, 1, 4).fill({ color: 0xffffff, alpha: (1 - d * d) * (d < 0.18 ? 1 : 0.55) });
    }
    this.band = this.ctx.app.renderer.generateTexture({ target: g, frame: new Rectangle(0, 0, w, 4), resolution: 1 });
    g.destroy();
    return this.band;
  }

  private update(dt: number): void {
    this.t += dt;
    const k = 0.5 + 0.5 * Math.sin((this.t / LOCAL_TIMING.tubePeriod) * Math.PI * 2);
    if (this.tubeGlow[0]) this.tubeGlow[0].alpha = 0.14 + 0.08 * k;
    if (this.tubeGlow[1]) this.tubeGlow[1].alpha = 0.42 + 0.18 * k;
  }

  destroy(): void {
    this.offTick?.();
    this.shineTween?.kill();
    gsap.killTweensOf(this.heat);
    for (const t of this.owned) t.destroy(true);
    this.logoTex?.destroy(true);
    this.band?.destroy(true);
    this.panel.destroy({ children: true });
    this.frame.destroy({ children: true });
    this.logo.destroy({ children: true });
  }
}
