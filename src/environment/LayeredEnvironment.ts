import { gsap } from 'gsap';
import { Assets, Container, Sprite, Texture } from 'pixi.js';
import 'pixi.js/prepare';
import { SYMBOLS } from '../config/game';
import type { LayoutSpec } from '../config/layout';
import { clock } from '../core/clock';
import { sUi } from '../core/timing';
import { reducedMotion } from '../fx/motion';
import type { GameContext, GameModule } from '../game/context';
import { EnvironmentDirector } from './director';
import { PLACEHOLDER_SIZE, bakePlaceholder } from './placeholder';
import { ENV_TIMING as T, LAND_WEIGHT, type EnvLayerSpec, type EnvOrient, type EnvironmentSpec } from './spec';

/**
 * LAYERED ENVIRONMENT — an opt-in background module for new games (docs/new-slot/ANIMATION_STATES.md §3).
 * Owns ctx.layers.background (plates) and ctx.layers.bgFx (additive light layers).
 *
 *  - Each look (base + feature variants) is a stack of depth-sorted layers: Higgsfield plates split
 *    into back / mid / front (+ an emissive light layer), or procedural placeholders until they exist.
 *  - Every frame the EnvironmentDirector's channels drive the stack: zoom (about the board centre,
 *    x depth), lift (x depth: parallax thumps), dim (plates), light + tint (light layers), plus a
 *    per-layer ambient drift. No filters, no render targets: sprite transforms, tint and alpha only,
 *    so it costs the same on a low-tier phone as a static plate (one draw per layer).
 *  - Only the orientation on screen and the looks in use are loaded; a missing plate falls back to
 *    its placeholder. Feature looks load at fs:trigger and crossfade on mode:change.
 *
 * Usage (src/games/<id>/modules.ts): `new LayeredEnvironment(ctx, ENVIRONMENT)` instead of a
 * bespoke Background; the spec lives in src/games/<id>/environment.ts.
 */

interface LayerView {
  spec: EnvLayerSpec;
  sprite: Sprite;
  /** baked placeholder (destroyed with the look); shipped plates are released through Assets */
  baked: Texture | null;
  url: string | null;
  phase: number;
  /** cover-fit scale at zoom 0 (fit()) */
  baseScale: number;
}

interface LookView {
  name: string;
  orient: EnvOrient;
  plates: Container;
  lights: Container;
  layers: LayerView[];
}

export class LayeredEnvironment implements GameModule {
  readonly director: EnvironmentDirector;
  private plates = new Container({ label: 'envPlates' });
  private lights = new Container({ label: 'envLights' });
  private looks = new Map<string, LookView>();
  private loading = new Map<string, Promise<LookView | null>>();
  /** shipped plate URL -> number of layer views holding its (shared, Assets-cached) texture */
  private urlRefs = new Map<string, number>();
  private shown = 'base';
  private orient: EnvOrient = 'landscape';
  private vis = { x: 0, y: 0, w: 1920, h: 1080, cover: 1 };
  private time = 0;
  private offs: Array<() => void> = [];

  constructor(
    private ctx: GameContext,
    private spec: EnvironmentSpec,
  ) {
    this.director = new EnvironmentDirector(
      {
        reduced: reducedMotion,
        look: (which) => void this.showLook(which === 'feature' ? (spec.featureLook ?? 'base') : 'base'),
      },
      spec.colors,
    );
    const g = ctx.game;
    const d = this.director;
    this.offs.push(
      g.on('layout:change', ({ layout }) => this.layout(layout)),
      g.on('round:start', () => d.spinStart()),
      g.on('board:reveal', ({ anticipation }) => d.reveal(anticipation.some((a) => a > 0))),
      g.on('board:land', ({ weight, tumble }) => d.land((LAND_WEIGHT[weight] ?? 1) * (tumble ? 0.8 : 1))),
      g.on('board:showWins', ({ wins }) => {
        if (!wins.length) return;
        const top = wins.reduce((a, b) => (b.win > a.win ? b : a));
        d.wins(SYMBOLS[top.symbol]?.color ?? 0xffffff);
      }),
      g.on('board:tumble', () => d.tumble()),
      g.on('board:burst', () => d.burst()),
      g.on('round:end', ({ totalWin }) => d.roundEnd(totalWin)),
      g.on('bigwin:show', () => d.bigWin()),
      g.on('fs:trigger', () => {
        d.featureTrigger();
        // build the feature look and upload it to the GPU during the trigger celebration, so the
        // crossfade at mode:change never pays a texture upload (engine delta E8)
        if (spec.featureLook) void this.ensureLook(spec.featureLook).then((v) => (v ? this.prewarm(v) : undefined));
      }),
      g.on('mode:change', ({ gameType }) => d.mode(gameType)),
      g.on('board:set', () => d.reset()),
    );
  }

  async init(): Promise<void> {
    this.ctx.layers.background.addChild(this.plates);
    this.ctx.layers.bgFx.addChild(this.lights);
    this.measure(this.ctx.layout);
    this.orient = this.orientFor(this.ctx.layout);
    const base = await this.ensureLook('base');
    if (base) this.attach(base, 1);
    this.offs.push(clock.onUpdate((dt) => this.tick(dt)));
  }

  layout(L: LayoutSpec): void {
    this.measure(L);
    const orient = this.orientFor(L);
    if (orient !== this.orient) {
      this.orient = orient;
      // looks not on screen are dropped (reloaded on demand); the shown one keeps drawing in the old
      // orientation until its replacement is built, so the swap never shows an empty frame
      const keep = this.shown;
      for (const name of [...this.looks.keys()]) if (name !== keep) this.dropLook(name);
      void this.ensureLook(keep).then((v) => {
        if (v && this.shown === keep && v.orient === this.orient) this.attach(v, 1);
      });
    }
  }

  // ================================================================ looks

  private async showLook(name: string): Promise<void> {
    if (!this.spec.looks[name] || name === this.shown) return;
    const from = this.looks.get(this.shown);
    this.shown = name;
    const to = await this.ensureLook(name);
    if (!to || this.shown !== name || to.orient !== this.orient) return;
    this.attach(to, 0);
    const dur = sUi(T.feature.crossfadeMs);
    gsap.to([to.plates, to.lights], { alpha: 1, duration: dur, ease: 'sine.inOut' });
    if (from && from !== to) {
      gsap.to([from.plates, from.lights], {
        alpha: 0,
        duration: dur,
        ease: 'sine.inOut',
        onComplete: () => {
          if (from.name !== 'base' && from.name !== this.shown) this.dropLook(from.name);
          else this.detach(from);
        },
      });
    }
  }

  /**
   * The look for the current orientation, built on demand. A build that finishes after the screen
   * turned back to the other orientation is discarded (never replacing the view on screen); the
   * caller then gets the current view, or null.
   */
  private ensureLook(name: string): Promise<LookView | null> {
    const have = this.looks.get(name);
    if (have && have.orient === this.orient) return Promise.resolve(have);
    const key = `${name}:${this.orient}`;
    let p = this.loading.get(key);
    if (!p) {
      p = this.buildLook(name, this.orient).then((v) => {
        this.loading.delete(key);
        if (v.orient !== this.orient) {
          this.disposeView(v);
          const cur = this.looks.get(name);
          return cur && cur.orient === this.orient ? cur : null;
        }
        const old = this.looks.get(name);
        if (old && old !== v) this.dropLook(name);
        this.looks.set(name, v);
        return v;
      });
      this.loading.set(key, p);
    }
    return p;
  }

  private async buildLook(name: string, orient: EnvOrient): Promise<LookView> {
    const spec = this.spec.looks[name] ?? this.spec.looks.base;
    const view: LookView = {
      name,
      orient,
      plates: new Container({ label: `env:${name}` }),
      lights: new Container({ label: `envLight:${name}` }),
      layers: [],
    };
    const sorted = [...spec.layers].sort((a, b) => a.depth - b.depth);
    const loaded = await Promise.all(sorted.map((l) => this.layerTexture(l, orient)));
    sorted.forEach((l, i) => {
      const got = loaded[i];
      if (!got) return;
      const sprite = new Sprite(got.tex);
      sprite.anchor.set(0.5);
      if (l.role === 'light') {
        sprite.blendMode = 'add';
        sprite.alpha = l.alpha?.rest ?? 0.35;
        view.lights.addChild(sprite);
      } else {
        view.plates.addChild(sprite);
      }
      view.layers.push({ spec: l, sprite, baked: got.baked ? got.tex : null, url: got.url, phase: (i * 0.618) % 1, baseScale: 1 });
    });
    return view;
  }

  private async layerTexture(l: EnvLayerSpec, orient: EnvOrient): Promise<{ tex: Texture; baked: boolean; url: string | null } | null> {
    const url = l.src?.[orient] ?? l.src?.landscape ?? null;
    if (url) {
      try {
        const tex = await Assets.load<Texture>(url);
        this.urlRefs.set(url, (this.urlRefs.get(url) ?? 0) + 1);
        return { tex, baked: false, url };
      } catch {
        // fall through to the placeholder (a broken plate never blanks the scene)
      }
    }
    if (!l.placeholder) return null;
    const size = PLACEHOLDER_SIZE[orient];
    const tex = bakePlaceholder(
      this.ctx.app.renderer,
      l.placeholder,
      size.w,
      size.h,
      this.ctx.art.particle('glow'),
      T.placeholderResolution,
    );
    return { tex, baked: true, url: null };
  }

  /** Upload a look's textures before it is first drawn (Pixi PrepareSystem, a few per frame). */
  private async prewarm(v: LookView): Promise<void> {
    const prepare = this.ctx.app.renderer.prepare;
    if (!prepare) return;
    await prepare.upload([v.plates, v.lights]).catch(() => undefined);
  }

  private attach(v: LookView, alpha: number): void {
    v.plates.alpha = alpha;
    v.lights.alpha = alpha;
    if (!v.plates.parent) this.plates.addChild(v.plates);
    if (!v.lights.parent) this.lights.addChild(v.lights);
    this.fit(v);
  }

  private detach(v: LookView): void {
    v.plates.removeFromParent();
    v.lights.removeFromParent();
  }

  private dropLook(name: string): void {
    const v = this.looks.get(name);
    if (!v) return;
    this.looks.delete(name);
    this.disposeView(v);
  }

  /**
   * Free a view: baked placeholders are its own; a shipped plate's texture is shared through the
   * Assets cache (a portrait look falling back to the landscape file, a rebuilt look), so its URL
   * is unloaded only when the last view holding it goes.
   */
  private disposeView(v: LookView): void {
    gsap.killTweensOf([v.plates, v.lights]);
    this.detach(v);
    for (const l of v.layers) {
      if (l.baked) l.baked.destroy(true);
      else if (l.url) {
        const n = (this.urlRefs.get(l.url) ?? 1) - 1;
        if (n > 0) this.urlRefs.set(l.url, n);
        else {
          this.urlRefs.delete(l.url);
          void Assets.unload(l.url).catch(() => undefined);
        }
      }
    }
    v.plates.destroy({ children: true });
    v.lights.destroy({ children: true });
  }

  // ================================================================ geometry + frame

  /** The design rect the cover-scaled background shows (render/layout.ts places the layer). */
  private measure(L: LayoutSpec): void {
    const { width: sw, height: sh } = this.ctx.app.screen;
    const cover = Math.max(sw / L.width, sh / L.height, 1e-6);
    const w = sw / cover;
    const h = sh / cover;
    Object.assign(this.vis, { x: (L.width - w) / 2, y: (L.height - h) / 2, w, h, cover });
    for (const v of this.looks.values()) this.fit(v);
  }

  private orientFor(L: LayoutSpec): EnvOrient {
    if (L.kind === 'portrait') return 'portrait';
    if (L.kind === 'tablet') return this.vis.w >= this.vis.h ? 'landscape' : 'portrait';
    return 'landscape';
  }

  private fit(v: LookView): void {
    const W = this.vis.w + T.bleed * 2;
    const H = this.vis.h + T.bleed * 2;
    for (const l of v.layers) {
      const t = l.sprite.texture;
      if (t.width > 1 && t.height > 1) l.baseScale = Math.max(W / t.width, H / t.height);
    }
  }

  private tick(dt: number): void {
    const d = this.director;
    d.update(dt, clock.realDt * 1000);
    this.time += dt;

    const L = this.ctx.layout;
    const zoom = d.value('zoom');
    const lift = d.value('lift');
    const dim = Math.max(0, Math.min(1, d.value('dim')));
    const light = Math.max(0, d.value('light'));
    const tint = Math.max(0, Math.min(1, d.value('tint')));
    const motion = d.motionScale();
    const cx = this.vis.x + this.vis.w / 2;
    const cy = this.vis.y + this.vis.h / 2;
    // the board centre lives in the contain-scaled root; map it into this cover-scaled space
    const k = this.ctx.scale / this.vis.cover;
    const px = L.width / 2 + (L.center.x - L.width / 2) * k;
    const py = L.height / 2 + (L.center.y - L.height / 2) * k;
    const grey = Math.round(255 * (1 - dim));
    const plateTint = (grey << 16) | (grey << 8) | grey;
    const lightTint = lerpColor(0xffffff, d.color, tint);

    for (const v of this.looks.values()) {
      if (!v.plates.parent) continue;
      for (const l of v.layers) {
        const s = l.sprite;
        const depth = l.spec.depth;
        const z = 1 + zoom * (0.25 + 0.75 * depth);
        let dx = 0;
        let dy = 0;
        const dr = l.spec.drift;
        if (dr && motion > 0) {
          const a = 2 * Math.PI * (this.time / Math.max(0.1, dr.period) + l.phase);
          dx = Math.sin(a) * dr.x * motion;
          dy = Math.cos(a * 0.83) * dr.y * motion;
        }
        s.scale.set(l.baseScale * z);
        s.position.set(px + (cx - px) * z + dx, py + (cy - py) * z + lift * depth + dy);
        if (l.spec.role === 'light') {
          const a = l.spec.alpha ?? { rest: 0.35, lit: 1 };
          s.alpha = Math.min(1, a.rest + (a.lit - a.rest) * Math.min(1, light));
          s.tint = lightTint;
        } else {
          s.tint = plateTint;
        }
      }
    }
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    for (const name of [...this.looks.keys()]) this.dropLook(name);
    this.plates.destroy({ children: true });
    this.lights.destroy({ children: true });
  }
}

const lerpColor = (a: number, b: number, t: number): number => {
  const ch = (shift: number): number => {
    const x = (a >> shift) & 0xff;
    const y = (b >> shift) & 0xff;
    return Math.round(x + (y - x) * t) & 0xff;
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};
