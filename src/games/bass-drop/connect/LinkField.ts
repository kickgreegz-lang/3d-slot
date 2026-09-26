import { gsap } from 'gsap';
import { Container, Mesh, MeshGeometry, Sprite, type Texture } from 'pixi.js';
import type { LayoutSpec } from '../../../config/layout';
import { followSpeed, s, speedScale, stagger } from '../../../core/timing';
import { glowTexture } from '../../../fx/textures';
import { lighten } from '../../../fx/util';
import { BASS_DROP_TIMING, physK } from '../timing';
import { WAVE_H, WAVE_W, linkTextures } from './art';
import { type XY, cellXY } from './geometry';
import type { ClusterGraph, LinkEdge } from './graph';
import { CONNECT_LOOK as LOOK } from './look';

const K = BASS_DROP_TIMING.links;
/** strip columns along a link (LOOK.taper has one entry per column) */
const COLS = 7;

/** A cluster's links while they are held: blip timing + tree depth. */
interface ClusterItem {
  /** field time (s) when the draw-on completed: blips run from here */
  holdAt: number;
  /** blip travel span along the tree (pitches) */
  span: number;
  links: LinkStrip[];
  tl: gsap.core.Timeline | null;
}

/**
 * One pooled groove link: a tinted additive waveform strip (`body`) with a white-hot `core`,
 * both short meshes of COLS x 2 vertices rebuilt in place every frame (no allocation), plus a
 * glow sprite that is the growing head during the draw-on and the travelling blip while held,
 * and a flash sprite for the snap. Local space: x from the parent end (0) to the child end
 * (len) of the link, y across it. A Spine/region swap later only replaces the textures.
 */
class LinkStrip {
  readonly view = new Container({ label: 'grooveLink' });
  /** soft tube glow around the strip (fx_glow) */
  readonly halo: Sprite;
  readonly body: Mesh;
  readonly core: Mesh;
  readonly head: Sprite;
  readonly flash: Sprite;
  private readonly bodyGeo: MeshGeometry;
  private readonly coreGeo: MeshGeometry;
  edge: LinkEdge | null = null;
  item: ClusterItem | null = null;
  color = 0xffffff;
  /** grow 0..1 (draw-on), collapse 0..1 (snap), fade 1..0 */
  p = 0;
  c = 0;
  fade = 1;
  snapped = false;

  constructor(wave: Texture, core: Texture, glow: Texture) {
    const indices = new Uint32Array((COLS - 1) * 6);
    for (let i = 0; i < COLS - 1; i++) {
      const a = i * 2;
      indices.set([a, a + 2, a + 1, a + 1, a + 2, a + 3], i * 6);
    }
    this.bodyGeo = new MeshGeometry({ positions: new Float32Array(COLS * 4), uvs: new Float32Array(COLS * 4), indices });
    this.coreGeo = new MeshGeometry({ positions: new Float32Array(COLS * 4), uvs: new Float32Array(COLS * 4), indices: indices.slice() });
    this.body = new Mesh({ geometry: this.bodyGeo, texture: wave });
    this.core = new Mesh({ geometry: this.coreGeo, texture: core });
    this.body.blendMode = this.core.blendMode = 'add';
    this.halo = new Sprite({ texture: glow, anchor: 0.5, blendMode: 'add' });
    this.head = new Sprite({ texture: glow, anchor: 0.5, blendMode: 'add' });
    this.flash = new Sprite({ texture: glow, anchor: 0.5, blendMode: 'add' });
    this.flash.visible = false;
    this.view.addChild(this.halo, this.body, this.core, this.head, this.flash);
    this.view.visible = false;
  }

  reset(edge: LinkEdge, color: number, item: ClusterItem): void {
    this.edge = edge;
    this.item = item;
    this.color = color;
    this.p = 0;
    this.c = 0;
    this.fade = 1;
    this.snapped = false;
    this.body.tint = this.halo.tint = color;
    this.core.tint = 0xffffff;
    this.head.tint = lighten(color, 0.55);
    this.flash.tint = lighten(color, 0.4);
    this.flash.visible = false;
    this.view.visible = true;
  }

  /**
   * Rebuild the strip for the current layout. `phase` = scroll phase in wavelengths, `blip` =
   * blip position along the tree (pitches, <0 = none).
   */
  draw(L: LayoutSpec, phase: number, blip: number, a: XY, b: XY): void {
    const e = this.edge;
    if (!e) return;
    const pitch = L.cell + L.gap;
    const k = physK(L);
    const len = K.lengthPitch * pitch;
    cellXY(L, e.aReel, e.aRow, a);
    cellXY(L, e.bReel, e.bRow, b);
    const dx = (b.x - a.x) / pitch;
    const dy = (b.y - a.y) / pitch;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    this.view.position.set(mx - (dx * len) / 2, my - (dy * len) / 2);
    this.view.rotation = Math.atan2(dy, dx);

    const x0 = (this.c * len) / 2;
    const x1 = Math.max(x0, Math.min(this.p * len, len - x0));
    const shown = x1 - x0 > 0.5 && this.fade > 0.01;
    this.body.visible = this.core.visible = this.halo.visible = shown;
    const w = K.width * k;
    if (shown) {
      const wc = LOOK.coreWidth * k;
      // one wavelength = the texture's aspect at the strip width; u continues along the tree
      const lambda = (WAVE_W / WAVE_H) * w;
      const s0 = (e.depth + 0.5) * pitch - len / 2;
      this.fill(this.bodyGeo, x0, x1, w / 2, s0, lambda, phase);
      this.fill(this.coreGeo, x0, x1, wc / 2, s0, lambda, phase);
    }

    // blip boost + head / blip glow
    let boost = 0;
    const head = this.head;
    head.visible = false;
    if (this.p < 1 && this.p > 0 && !this.c) {
      head.visible = true;
      head.position.set(x1, 0);
      head.width = head.height = LOOK.headSize * k;
      head.alpha = LOOK.headAlpha * this.fade;
    } else if (blip >= 0 && !this.c) {
      const s0p = e.depth + 0.5 - K.lengthPitch / 2;
      const f = (blip - s0p) / K.lengthPitch;
      if (f > 0 && f < 1) {
        const env = Math.sin(Math.PI * f);
        head.visible = true;
        head.position.set(f * len, 0);
        head.width = head.height = LOOK.blipSize * k * (0.75 + 0.25 * env);
        head.alpha = LOOK.blipAlpha * env * this.fade;
        boost = LOOK.blipBoost * env;
      }
    }
    this.body.alpha = Math.min(1, LOOK.bodyAlpha * (1 + boost)) * this.fade;
    this.core.alpha = LOOK.coreAlpha * this.fade;
    if (shown) {
      const halo = this.halo;
      halo.position.set((x0 + x1) / 2, 0);
      halo.width = (x1 - x0) * LOOK.haloLength;
      halo.height = w * LOOK.haloWidth;
      halo.alpha = LOOK.haloAlpha * (1 + boost * 2) * this.fade;
    }
    if (this.flash.visible) this.flash.position.set(len / 2, 0);
  }

  private fill(geo: MeshGeometry, x0: number, x1: number, half: number, s0: number, lambda: number, phase: number): void {
    const pos = geo.positions;
    const uv = geo.uvs;
    const taper = LOOK.taper;
    for (let i = 0; i < COLS; i++) {
      const x = x0 + ((x1 - x0) * i) / (COLS - 1);
      const h = half * (taper[i] ?? 1);
      const u = (s0 + x) / lambda - phase;
      const j = i * 4;
      pos[j] = x;
      pos[j + 1] = -h;
      pos[j + 2] = x;
      pos[j + 3] = h;
      uv[j] = u;
      uv[j + 1] = 0;
      uv[j + 2] = u;
      uv[j + 3] = 1;
    }
    geo.getBuffer('aPosition').update();
    geo.getBuffer('aUV').update();
  }

  hide(): void {
    gsap.killTweensOf(this);
    gsap.killTweensOf(this.flash);
    gsap.killTweensOf(this.flash.scale);
    this.edge = null;
    this.item = null;
    this.flash.visible = false;
    this.view.visible = false;
  }

  destroy(): void {
    this.hide();
    this.view.destroy({ children: true });
    this.bodyGeo.destroy();
    this.coreGeo.destroy();
  }
}

/**
 * GROOVE LINKS (DESIGN §7 step 3): one short MeshRope-style strip per orthogonal adjacency
 * of a winning cluster (wilds included), centred on the shared cell edge (lengthPitch x
 * pitch), tinted with the symbol colour lightened 35% (gold through a W), additive with a
 * white-hot core. Draw-on in BFS order from the overlay cell (depth x depthStagger, grow
 * each, the cluster capped at links.cap); while held the waveform scrolls outward at
 * links.scrollWaves and a blip runs root -> leaves every links.pulsePeriod. On the tumble
 * every link collapses to its edge midpoint (links.snap, arriving at the explode burst) and
 * bursts into sparks. Geometry is rebuilt from the current layout every frame.
 */
export class LinkField {
  readonly view = new Container({ label: 'grooveLinks' });
  private readonly pool: LinkStrip[] = [];
  private readonly live: LinkStrip[] = [];
  private items: ClusterItem[] = [];
  private readonly anims = new Set<gsap.core.Animation>();
  private readonly tex = linkTextures();
  private readonly glow = glowTexture(64);
  private readonly a: XY = { x: 0, y: 0 };
  private readonly b: XY = { x: 0, y: 0 };
  /** scroll / blip clock (speed-scaled game seconds) */
  private time = 0;
  private burstDone = true;

  get active(): boolean {
    return this.live.length > 0;
  }

  /** Draw on one cluster's links now; returns the draw-on length (s, 0 = no links). */
  show(graph: ClusterGraph, color: number, wildColor: number): number {
    if (!graph.edges.length) return 0;
    // finished / killed animations have left the global timeline
    for (const a of this.anims) if (!a.parent) this.anims.delete(a);
    const tint = lighten(color, LOOK.lighten);
    const grow = s(K.grow);
    const perDepth = graph.maxDepth > 0 ? Math.min(K.depthStagger, (K.cap - K.grow) / graph.maxDepth) : 0;
    const step = s(stagger(perDepth));
    const total = graph.maxDepth * step + grow;
    const item: ClusterItem = {
      holdAt: this.time + total * speedScale(),
      span: graph.maxDepth + 0.5 + K.lengthPitch / 2 + 0.25,
      links: [],
      tl: null,
    };
    const tl = gsap.timeline({
      onComplete: () => {
        this.anims.delete(tl);
        item.tl = null;
      },
    });
    for (const e of graph.edges) {
      const link = this.acquire();
      link.reset(e, e.wild ? wildColor : tint, item);
      item.links.push(link);
      tl.to(link, { p: 1, duration: grow, ease: 'power2.out' }, e.depth * step);
    }
    item.tl = tl;
    this.anims.add(followSpeed(tl));
    this.items.push(item);
    this.burstDone = false;
    return total;
  }

  /** Tumble start: every link collapses to its edge midpoint over links.snap (the burst follows). */
  snap(): void {
    if (!this.live.length) return;
    for (const it of this.items) {
      it.tl?.kill();
      if (it.tl) this.anims.delete(it.tl);
      it.tl = null;
    }
    const links = [...this.live];
    const tl = gsap.timeline({
      onComplete: () => {
        this.anims.delete(tl);
      },
    });
    tl.to(links, { c: 1, duration: s(K.snap), ease: 'power2.in' }, 0);
    this.anims.add(followSpeed(tl));
  }

  /**
   * The explode-burst frame: each link flashes at its midpoint and hands `sparks(x, y, color, n)`
   * its share of the spark budget, then leaves. Idempotent within a step.
   */
  burst(L: LayoutSpec, sparksPerLink: number, sparks: (x: number, y: number, color: number, n: number) => void): void {
    if (this.burstDone || !this.live.length) return;
    this.burstDone = true;
    const k = physK(L);
    const links = [...this.live];
    const n = Math.max(1, Math.min(sparksPerLink, Math.floor(LOOK.sparkBudget / links.length)));
    for (const link of links) {
      const e = link.edge;
      if (!e || link.snapped) continue;
      link.snapped = true;
      gsap.killTweensOf(link);
      link.c = 1;
      cellXY(L, e.aReel, e.aRow, this.a);
      cellXY(L, e.bReel, e.bRow, this.b);
      sparks((this.a.x + this.b.x) / 2, (this.a.y + this.b.y) / 2, link.color, n);
      const f = link.flash;
      f.visible = true;
      f.alpha = 1;
      const size = LOOK.snapFlash * k;
      f.width = f.height = size * 0.5;
      const sc = f.scale.x * 2.6;
      const dur = s(LOOK.snapFlashMs);
      this.anims.add(followSpeed(gsap.to(f.scale, { x: sc, y: sc, duration: dur, ease: 'power2.out' })));
      this.anims.add(
        followSpeed(gsap.to(f, { alpha: 0, duration: dur, ease: 'power1.in', onComplete: () => this.release(link) })),
      );
    }
    this.items = [];
  }

  /** No tumble snaps them (win cap, round end, new reveal): fade out. */
  fadeOut(): void {
    if (!this.live.length) return;
    for (const it of this.items) {
      it.tl?.kill();
      if (it.tl) this.anims.delete(it.tl);
    }
    this.items = [];
    this.burstDone = true;
    for (const link of [...this.live]) {
      if (link.snapped) continue;
      gsap.killTweensOf(link);
      this.anims.add(
        followSpeed(gsap.to(link, { fade: 0, duration: s(LOOK.fadeOut), ease: 'power1.in', onComplete: () => this.release(link) })),
      );
    }
  }

  /** Remove everything at once (board:set, round start, destroy). */
  clear(): void {
    for (const a of this.anims) a.kill();
    this.anims.clear();
    for (const link of [...this.live]) this.release(link);
    this.items = [];
    this.burstDone = true;
  }

  /** Per frame (game dt, s). */
  update(dt: number, L: LayoutSpec): void {
    if (!this.live.length) return;
    this.time += dt * speedScale();
    const phase = this.time * K.scrollWaves;
    const period = K.pulsePeriod / 1000;
    for (const link of this.live) {
      const it = link.item;
      let blip = -1;
      if (it && this.time >= it.holdAt) blip = (((this.time - it.holdAt) % period) / period) * it.span;
      link.draw(L, phase, blip, this.a, this.b);
    }
  }

  private acquire(): LinkStrip {
    const link = this.pool.pop() ?? new LinkStrip(this.tex.wave, this.tex.core, this.glow);
    if (!link.view.parent) this.view.addChild(link.view);
    this.live.push(link);
    return link;
  }

  private release(link: LinkStrip): void {
    const i = this.live.indexOf(link);
    if (i < 0) return;
    this.live.splice(i, 1);
    link.hide();
    this.pool.push(link);
  }

  destroy(): void {
    this.clear();
    for (const link of this.pool) link.destroy();
    this.pool.length = 0;
    this.view.destroy({ children: true });
  }
}
