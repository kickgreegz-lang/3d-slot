import { gsap } from 'gsap';
import { Assets, Container, RenderTexture, type Renderer, Sprite, Texture } from 'pixi.js';
import type { LayoutSpec } from '../../../config/layout';
import { clock } from '../../../core/clock';
import { followSpeed, s, sUi } from '../../../core/timing';
import { onReducedMotion, reducedMotion } from '../../../fx/motion';
import type { GameContext, GameModule } from '../../../game/context';
import type { MeterMode } from '../events';
import { BASS_DROP_TIMING } from '../timing';
import { PLATE_BACKDROP, PLATE_SIZE, type PlateLook, type PlateOrient, SCENE_LOOK, lookOf, plateUrl } from './look';

const F = BASS_DROP_TIMING.feature;
/** design px past the visible edge (shake never shows a seam) */
const BLEED = 24;
/**
 * Halve a plate on the GPU once when the screen shows it at <= this many display px per plate
 * texel (phones): a quarter of the texture memory for no visible loss. Hysteresis: a halved set
 * is reloaded at full size once the need passes the limit x 1.15 (window grown, DPR change).
 */
const HALF_LIMIT = { low: 0.75, high: 0.6 } as const;
const HALF_HYSTERESIS = 1.15;
/** network warm-up of the other looks' files (bytes only, no decode), s (UI) after boot */
const PREFETCH_DELAY = 4;

interface Layer {
  tex: Texture;
  bytes: number;
  release(): void;
}

/** One look of one orientation: the opaque plate + its additive neon layer. */
interface PlateSet {
  key: string;
  orient: PlateOrient;
  look: PlateLook;
  half: boolean;
  plate: Layer;
  neon: Layer | null;
}

/**
 * Assets ops on one URL run one after another: a halved load unloads its source after the bake,
 * which must never land on a texture a later full-size load of the same URL holds.
 */
const urlQueue = new Map<string, Promise<unknown>>();
const serial = <T>(url: string, job: () => Promise<T>): Promise<T> => {
  const run = (urlQueue.get(url) ?? Promise.resolve()).then(job, job);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  urlQueue.set(url, tail);
  void tail.then(() => {
    if (urlQueue.get(url) === tail) urlQueue.delete(url);
  });
  return run;
};

/** A shipped layer as a texture: full size, or halved once on the GPU (the source is unloaded). */
const loadLayer = (renderer: Renderer, url: string, half: boolean): Promise<Layer | null> =>
  serial(url, async () => {
    let src: Texture;
    try {
      src = await Assets.load<Texture>(url);
    } catch {
      return null;
    }
    const unload = (): void => void serial(url, () => Assets.unload(url)).catch(() => undefined);
    if (!half) return { tex: src, bytes: src.source.pixelWidth * src.source.pixelHeight * 4, release: unload };
    const w = Math.ceil(src.width / 2);
    const h = Math.ceil(src.height / 2);
    const rt = RenderTexture.create({ width: w, height: h, resolution: 1 });
    const blit = new Sprite(src);
    blit.scale.set(w / src.width, h / src.height);
    renderer.render({ container: blit, target: rt, clear: true });
    blit.destroy();
    await Assets.unload(url).catch(() => undefined);
    return { tex: rt, bytes: w * h * 4, release: () => rt.destroy(true) };
  });

/**
 * BACKGROUND — the painted juke-joint room (DESIGN §15, ART_STATUS §7.2; owns ctx.layers.background
 * and ctx.layers.bgFx):
 *  - one plate per look (base / Juke Jam after-hours / Mega Mix party lights), cover-fitted to the
 *    visible design rect (+ bleed): landscape and compact show the 2:1 plate, portrait the 1:2 plate,
 *    the tablet the one that fits its visible aspect best (>= 1: 2:1, else 1:2);
 *  - the look's additive neon layer (bulbs, jars, the gator sign; Mega Mix's beams and specks) pulses
 *    on the music beat: alpha rest + beat x (1 - phase)^3 at 600 / 566 / 536 ms (base / Juke Jam /
 *    Mega Mix, the grid the meter and the stage pump on). Reduced motion: the neon holds still;
 *  - looks crossfade (1.4 s, UI time) behind the feature curtain: feature:trigger at the wipe's
 *    cover (triggerTotal + 620, or 620 for a round that starts with the trigger), feature:upgrade on
 *    the Mega Mix slam (933), fs:end at the outro wipe's cover, mode:change basegame as the backstop;
 *    meter:set (resume / replay) switches at once. Schedules are game time (s(), followSpeed).
 * The reel area stays calm: the plates are graded darker behind the reels and nothing moves there
 * (the neon lives on the side walls and the ceiling).
 *
 * Memory: only the orientation on screen is loaded, and only the looks in use (the shown one plus
 * the incoming one during a crossfade; the next feature look is loaded when its trigger arrives, the
 * files are network-prefetched after boot). A phone that shows a plate at <= 0.6 display px per texel
 * (0.75 on the low tier) gets it halved on the GPU once. A plate that fails to load leaves the
 * plum backdrop (and the previous look), never a console message.
 */
export class Background implements GameModule {
  private readonly root = new Container({ label: 'bdBackground' });
  private readonly glow = new Container({ label: 'bdNeon' });
  private readonly backdrop = new Sprite({ texture: Texture.WHITE, tint: PLATE_BACKDROP });
  /** the shown look (opaque) and the incoming one (alpha = fade) */
  private readonly plateA = new Sprite({ anchor: 0.5 });
  private readonly plateB = new Sprite({ anchor: 0.5 });
  private readonly neonA = new Sprite({ anchor: 0.5, blendMode: 'add' });
  private readonly neonB = new Sprite({ anchor: 0.5, blendMode: 'add' });
  private readonly sets = new Map<string, PlateSet>();
  private readonly loading = new Map<string, Promise<PlateSet | null>>();
  private readonly calls = new Set<gsap.core.Tween>();
  private offs: Array<() => void> = [];
  private orient: PlateOrient = 'landscape';
  private shown: PlateLook = 'base';
  private incoming: PlateLook | null = null;
  /** the look the scene is heading to (a crossfade may still be waiting for its plate) */
  private target: PlateLook = 'base';
  /** a look a scheduled switch will ask for (loaded ahead, kept by prune) */
  private upcoming: PlateLook | null = null;
  private prefetchCall: gsap.core.Tween | null = null;
  private readonly fade = { t: 0 };
  private fadeTween: gsap.core.Tween | null = null;
  private beatMode: MeterMode = 'base';
  private beat = 0;
  private still = false;
  private revealed = false;
  private dead = false;
  private syncEpoch = 0;
  private lookEpoch = 0;
  private readonly vis = { x: 0, y: 0, w: 0, h: 0, cover: 1 };

  constructor(private readonly ctx: GameContext) {}

  async init(): Promise<void> {
    const { ctx } = this;
    this.plateB.visible = this.neonA.visible = this.neonB.visible = false;
    this.root.addChild(this.backdrop, this.plateA, this.plateB);
    this.glow.addChild(this.neonA, this.neonB);
    ctx.layers.background.addChild(this.root);
    ctx.layers.bgFx.addChild(this.glow);
    // DEV / QA: captures read what is loaded (tools read `bdStats` off the layer's first child)
    if (import.meta.env.DEV) Object.defineProperty(this.root, 'bdStats', { get: () => this.stats });
    this.still = reducedMotion();
    this.measure(ctx.layout);
    this.orient = this.orientFor(ctx.layout);
    this.fit();

    const g = ctx.game;
    this.offs.push(
      g.on('layout:change', ({ layout }) => this.layout(layout)),
      g.on('round:start', () => void (this.revealed = false)),
      g.on('board:reveal', () => void (this.revealed = true)),
      g.on('board:set', () => this.cancelCalls()),
      g.on('feature:trigger', ({ feature }) => {
        const look = lookOf(feature);
        this.preload(look);
        if (!this.revealed) {
          // [M-7] the round starts with the trigger: straight to the wipe (the meter / stage switch now)
          this.beatMode = feature;
          this.later(SCENE_LOOK.wipeCover, () => this.show(look));
          return;
        }
        this.later(F.triggerTotal + SCENE_LOOK.wipeCover, () => {
          this.beatMode = feature;
          this.show(look);
        });
      }),
      g.on('feature:upgrade', () => {
        this.preload('megamix');
        this.later(SCENE_LOOK.upgradeAt, () => {
          this.beatMode = 'super';
          this.show('megamix');
        });
      }),
      g.on('fs:end', () => {
        this.preload('base');
        this.later(SCENE_LOOK.wipeCover, () => this.show('base'));
      }),
      g.on('mode:change', ({ gameType }) => {
        if (gameType !== 'basegame') return;
        this.beatMode = 'base';
        if (this.target !== 'base') this.show('base');
      }),
      g.on('meter:set', ({ mode }) => {
        this.beatMode = mode;
        this.show(lookOf(mode), true);
      }),
      onReducedMotion((on) => void (this.still = on)),
      clock.onUpdate((dt) => this.update(dt)),
    );

    // the first frame shows the plate: wait for the base look of this orientation
    await this.sync();
    this.prefetchCall = gsap.delayedCall(PREFETCH_DELAY, () => this.prefetch());
  }

  layout(L: LayoutSpec): void {
    this.measure(L);
    const orient = this.orientFor(L);
    const shownSet = this.sets.get(this.key(orient, this.shown));
    const regrow = !!shownSet?.half && this.need01(orient) > this.halfLimit() * HALF_HYSTERESIS;
    this.fit();
    if (orient !== this.orient || regrow || !shownSet) {
      this.orient = orient;
      void this.sync();
    }
  }

  destroy(): void {
    this.dead = true;
    for (const off of this.offs) off();
    this.offs = [];
    this.cancelCalls();
    this.prefetchCall?.kill();
    this.fadeTween?.kill();
    this.root.destroy({ children: true });
    this.glow.destroy({ children: true });
    for (const set of this.sets.values()) this.release(set);
    this.sets.clear();
  }

  // ======================================================================= looks

  /** Switch to `look`: crossfade (UI time), or at once. Waits for the plate if it is not loaded. */
  private show(look: PlateLook, instant = false): void {
    this.target = look;
    this.upcoming = null;
    const ep = ++this.lookEpoch;
    void this.need(this.orient, look).then((set) => {
      if (this.dead || ep !== this.lookEpoch || !set || set.orient !== this.orient) return;
      if (instant) {
        this.fadeTween?.progress(1);
        this.fadeTween = null;
        this.shown = look;
        this.incoming = null;
        this.fade.t = 0;
        this.apply();
        this.prune();
        return;
      }
      this.crossfade(look);
    });
  }

  private crossfade(to: PlateLook): void {
    // a crossfade still running lands first (they sit behind curtains: never visible)
    this.fadeTween?.progress(1);
    this.fadeTween = null;
    if (to === this.shown) {
      this.prune();
      return;
    }
    this.incoming = to;
    this.fade.t = 0;
    this.apply();
    this.fadeTween = gsap.to(this.fade, {
      t: 1,
      duration: sUi(SCENE_LOOK.modeCrossfade),
      ease: 'sine.inOut',
      onComplete: () => {
        this.fadeTween = null;
        this.shown = to;
        this.incoming = null;
        this.fade.t = 0;
        this.apply();
        this.prune();
      },
    });
  }

  /** Load a look a scheduled switch will need (decode now, show later). */
  private preload(look: PlateLook): void {
    this.upcoming = look;
    void this.need(this.orient, look);
  }

  /** Load (or reuse) one look of one orientation at the resolution the screen needs. */
  private need(orient: PlateOrient, look: PlateLook): Promise<PlateSet | null> {
    const key = this.key(orient, look);
    const half = this.need01(orient) <= this.halfLimit();
    const have = this.sets.get(key);
    // never downgrade a loaded set; a halved one is reloaded only past the hysteresis
    if (have && (!have.half || half || this.need01(orient) <= this.halfLimit() * HALF_HYSTERESIS)) {
      return Promise.resolve(have);
    }
    const job = `${key}/${half ? 'half' : 'full'}`;
    const running = this.loading.get(job);
    if (running) return running;
    const r = this.ctx.app.renderer;
    const p = Promise.all([loadLayer(r, plateUrl(look, orient, false), half), loadLayer(r, plateUrl(look, orient, true), half)]).then(
      ([plate, neon]) => {
        this.loading.delete(job);
        if (this.dead || !plate) {
          plate?.release();
          neon?.release();
          return null;
        }
        const set: PlateSet = { key, orient, look, half, plate, neon };
        const old = this.sets.get(key);
        this.sets.set(key, set);
        if (old) {
          // a sharper copy replaces a halved one on screen, then the old one goes
          this.apply();
          this.release(old);
        }
        return set;
      },
    );
    this.loading.set(job, p);
    return p;
  }

  /** Show the current orientation's shown (+ incoming) look once it is loaded. */
  private async sync(): Promise<void> {
    const ep = ++this.syncEpoch;
    const orient = this.orient;
    const set = await this.need(orient, this.shown);
    if (this.dead || ep !== this.syncEpoch || orient !== this.orient) return;
    if (this.incoming) await this.need(orient, this.incoming);
    if (this.dead || ep !== this.syncEpoch) return;
    if (set) {
      this.apply();
      this.prune();
    }
  }

  /** Put the loaded textures of (orient, shown / incoming) on the sprites; keeps what is there otherwise. */
  private apply(): void {
    const a = this.sets.get(this.key(this.orient, this.shown));
    const b = this.incoming ? this.sets.get(this.key(this.orient, this.incoming)) : undefined;
    if (a) {
      this.plateA.texture = a.plate.tex;
      this.neonA.texture = a.neon?.tex ?? Texture.EMPTY;
    }
    if (b) {
      this.plateB.texture = b.plate.tex;
      this.neonB.texture = b.neon?.tex ?? Texture.EMPTY;
    } else if (!this.incoming) {
      this.plateB.texture = Texture.EMPTY;
      this.neonB.texture = Texture.EMPTY;
    }
    this.fit();
    this.paint();
  }

  /** Release every set the sprites do not show and the scene is not heading to. */
  private prune(): void {
    const keep = new Set([this.shown, this.incoming, this.target, this.upcoming].filter(Boolean).map((l) => this.key(this.orient, l as PlateLook)));
    const onScreen = new Set<Texture>([this.plateA.texture, this.plateB.texture, this.neonA.texture, this.neonB.texture]);
    for (const [key, set] of this.sets) {
      if (keep.has(key) || onScreen.has(set.plate.tex) || (set.neon && onScreen.has(set.neon.tex))) continue;
      this.sets.delete(key);
      this.release(set);
    }
  }

  private release(set: PlateSet): void {
    set.plate.release();
    set.neon?.release();
  }

  /** Network warm-up of the other looks of this orientation (the browser caches the bytes; no decode). */
  private prefetch(): void {
    if (this.dead || typeof fetch !== 'function') return;
    for (const look of ['jukejam', 'megamix'] as const) {
      for (const neon of [false, true]) {
        void fetch(plateUrl(look, this.orient, neon))
          .then((r) => r.arrayBuffer())
          .catch(() => undefined);
      }
    }
  }

  // ======================================================================= geometry

  /** The design rect the cover-scaled background layer shows (render/layout.ts places it). */
  private measure(L: LayoutSpec): void {
    const { width: sw, height: sh } = this.ctx.app.screen;
    const cover = Math.max(sw / L.width, sh / L.height, 1e-6);
    const w = sw / cover;
    const h = sh / cover;
    Object.assign(this.vis, { x: (L.width - w) / 2, y: (L.height - h) / 2, w, h, cover });
  }

  private orientFor(L: LayoutSpec): PlateOrient {
    if (L.kind === 'portrait') return 'portrait';
    if (L.kind === 'tablet') return this.vis.w >= this.vis.h ? 'landscape' : 'portrait';
    return 'landscape';
  }

  /** Display px per plate texel of a full-size plate of `orient` on this screen. */
  private need01(orient: PlateOrient): number {
    const P = PLATE_SIZE[orient];
    const k = Math.max((this.vis.w + BLEED * 2) / P.w, (this.vis.h + BLEED * 2) / P.h);
    return k * this.vis.cover * this.ctx.app.renderer.resolution;
  }

  private halfLimit(): number {
    return HALF_LIMIT[this.ctx.tier];
  }

  private fit(): void {
    const v = this.vis;
    const cx = v.x + v.w / 2;
    const cy = v.y + v.h / 2;
    const W = v.w + BLEED * 2;
    const H = v.h + BLEED * 2;
    this.backdrop.position.set(v.x - BLEED, v.y - BLEED);
    this.backdrop.width = W;
    this.backdrop.height = H;
    for (const sp of [this.plateA, this.plateB, this.neonA, this.neonB]) {
      const t = sp.texture;
      sp.position.set(cx, cy);
      if (t.width > 1 && t.height > 1) sp.scale.set(Math.max(W / t.width, H / t.height));
    }
  }

  // ======================================================================= frame

  private update(dt: number): void {
    this.beat = (this.beat + (dt * 1000) / SCENE_LOOK.beatMs[this.beatMode]) % 1;
    this.paint();
  }

  private paint(): void {
    const t = this.incoming ? this.fade.t : 0;
    const kick = this.still ? SCENE_LOOK.neonStill : (1 - this.beat) ** 3;
    const neonOf = (look: PlateLook): number => {
      const n = SCENE_LOOK.neon[look];
      return n.rest + n.beat * kick;
    };
    this.plateA.visible = this.plateA.texture !== Texture.EMPTY;
    this.plateB.visible = !!this.incoming && t > 0.001 && this.plateB.texture !== Texture.EMPTY;
    this.plateB.alpha = t;
    const a = (1 - t) * neonOf(this.shown);
    this.neonA.alpha = a;
    this.neonA.visible = a > 0.004 && this.neonA.texture !== Texture.EMPTY;
    const b = this.incoming ? t * neonOf(this.incoming) : 0;
    this.neonB.alpha = b;
    this.neonB.visible = b > 0.004 && this.neonB.texture !== Texture.EMPTY;
  }

  // ======================================================================= scheduling

  /** Call `fn` `ms` of game time from now (s(); a slam-stop retimes it). */
  private later(ms: number, fn: () => void): void {
    const call = followSpeed(
      gsap.delayedCall(s(ms), () => {
        this.calls.delete(call);
        fn();
      }),
    );
    this.calls.add(call);
  }

  private cancelCalls(): void {
    for (const c of this.calls) c.kill();
    this.calls.clear();
  }

  private key(orient: PlateOrient, look: PlateLook): string {
    return `${orient}/${look}`;
  }

  /** DEV / QA: what is loaded (texture memory estimate in MiB). */
  get stats(): { orient: PlateOrient; shown: PlateLook; incoming: PlateLook | null; sets: string[]; mib: number } {
    let bytes = 0;
    const sets: string[] = [];
    for (const set of this.sets.values()) {
      bytes += set.plate.bytes + (set.neon?.bytes ?? 0);
      sets.push(`${set.key}${set.half ? '@half' : ''}`);
    }
    return { orient: this.orient, shown: this.shown, incoming: this.incoming, sets, mib: Math.round((bytes / 1048576) * 10) / 10 };
  }
}
