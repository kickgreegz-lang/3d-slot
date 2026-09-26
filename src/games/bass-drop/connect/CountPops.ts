import { gsap } from 'gsap';
import { BitmapText, Container, Sprite } from 'pixi.js';
import type { LayoutSpec } from '../../../config/layout';
import { followSpeed, s } from '../../../core/timing';
import { glowTexture } from '../../../fx/textures';
import { t } from '../../../i18n';
import { BASS_DROP_TIMING, TEAL, physK } from '../timing';
import { CONNECT_POP_FONT } from './fonts';
import { type XY, cellXY, streamPoint } from './geometry';
import { CONNECT_LOOK as LOOK } from './look';

const P = BASS_DROP_TIMING.countPop;

const easeOut = (u: number): number => 1 - (1 - u) ** 3;
const smooth = (u: number): number => u * u * (3 - 2 * u);
/** pop-in scale: 0 -> overshoot at 60 %, settle 1.0 (the orbs' pop-out profile) */
const popScale = (u: number): number => {
  const o = LOOK.popOvershoot;
  return u < 0.6 ? o * easeOut(u / 0.6) : o - (o - 1) * smooth((u - 0.6) / 0.4);
};

/** One pooled "+N" pop: live BitmapText over an additive teal halo. */
class Pop {
  readonly view = new Container({ label: 'countPop' });
  readonly halo = new Sprite({ texture: glowTexture(128), anchor: 0.5, blendMode: 'add' });
  readonly text: BitmapText;
  /** centroid in fractional padded cells (re-evaluated per layout) */
  reel = 0;
  row = 0;
  /** 0..1 pop-in, 0..1 flight */
  pop = 0;
  t = 0;
  tl: gsap.core.Timeline | null = null;

  constructor() {
    this.text = new BitmapText({ text: '', style: { fontFamily: CONNECT_POP_FONT, fontSize: LOOK.popSize }, anchor: 0.5 });
    this.halo.tint = TEAL;
    this.view.addChild(this.halo, this.text);
    this.view.visible = false;
  }
}

/**
 * CONNECTION COUNT POPS (DESIGN §6.3 step 9): at the first burst of each cluster a teal
 * "+N" (N = its exploding count; Titan One 44·k, black stroke) pops at the cluster centroid
 * (countPop.in, overshoot), then rides the orb stream to the Groove Meter centre along the
 * orbs' lifted Bézier for countPop.flight (power2.in, like the orbs), fading from
 * countPop.fadeFrom of the path and shrinking into the woofer. Never holds the round.
 * Positions are evaluated from the current layout every frame.
 */
export class CountPops {
  readonly view = new Container({ label: 'countPops' });
  private readonly pool: Pop[] = [];
  private readonly live = new Set<Pop>();
  private readonly at: XY = { x: 0, y: 0 };
  private readonly p: XY = { x: 0, y: 0 };

  get active(): boolean {
    return this.live.size > 0;
  }

  /** Pop "+n" at the centroid (fractional padded cell) now. */
  spawn(n: number, reel: number, row: number): void {
    const pop = this.pool.pop() ?? new Pop();
    if (!pop.view.parent) this.view.addChild(pop.view);
    this.live.add(pop);
    pop.reel = reel;
    pop.row = row;
    pop.pop = 0;
    pop.t = 0;
    pop.text.text = t('bd.connect.plus', { n });
    pop.view.visible = true;
    pop.view.alpha = 0;
    const tl = gsap.timeline({ onComplete: () => this.release(pop) });
    tl.to(pop, { pop: 1, duration: s(P.in), ease: 'none' }, 0);
    tl.to(pop, { t: 1, duration: s(P.flight), ease: BASS_DROP_TIMING.orbs.ease }, s(P.in));
    pop.tl = followSpeed(tl);
  }

  update(L: LayoutSpec): void {
    if (!this.live.size) return;
    const k = physK(L);
    for (const pop of this.live) {
      cellXY(L, pop.reel, pop.row, this.at);
      const rise = LOOK.popRise * k;
      let x = this.at.x;
      let y = this.at.y;
      let sc: number;
      let alpha = 1;
      if (pop.t <= 0) {
        const u = Math.min(1, pop.pop);
        sc = popScale(u);
        y -= rise * easeOut(u);
        alpha = Math.min(1, u * 3);
      } else {
        streamPoint(L, x, y - rise, pop.t, 0, this.p);
        x = this.p.x;
        y = this.p.y;
        sc = 1 - (1 - LOOK.popEndScale) * pop.t * pop.t;
        if (pop.t > P.fadeFrom) alpha = 1 - (pop.t - P.fadeFrom) / (1 - P.fadeFrom);
      }
      pop.view.position.set(x, y);
      pop.view.scale.set(sc * k);
      pop.view.alpha = alpha;
      pop.halo.width = pop.halo.height = LOOK.popHalo;
      pop.halo.alpha = LOOK.popHaloAlpha;
    }
  }

  clear(): void {
    for (const pop of [...this.live]) this.release(pop);
  }

  private release(pop: Pop): void {
    if (!this.live.delete(pop)) return;
    pop.tl?.kill();
    pop.tl = null;
    pop.view.visible = false;
    this.pool.push(pop);
  }

  destroy(): void {
    this.clear();
    this.view.destroy({ children: true });
    this.pool.length = 0;
  }
}
