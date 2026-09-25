import { gsap } from 'gsap';
import { BitmapText, Container, Sprite } from 'pixi.js';
import type { ClusterWin, Position } from '../book/types';
import { FEATURES, SYMBOLS, toSpotRow } from '../config/game';
import { cellCenter, gridSize, type LayoutSpec } from '../config/layout';
import { clock } from '../core/clock';
import { followSpeed, registerTiming, s, stagger, TIMING } from '../core/timing';
import { glowTexture } from '../fx/textures';
import { lighten } from '../fx/util';
import type { GameContext, GameModule } from '../game/context';
import type { GameEvents } from '../game/events';
import { ensureLabelFont, ensureValueFont } from './common/fonts';
import { placementFor } from './common/placement';
import { scaleTo } from './common/anim';
import { Plate } from './common/Plate';
import { label } from './common/text';

/** Local choreography (ms, speed-scaled via s()). Candidates for TIMING.win. */
export const WIN_PRESENT_TIMING = registerTiming('winPresent', {
  /** stagger between several cluster labels of one winInfo */
  labelStagger: 90,
  /** tumble plate count-up per increase */
  plateCount: 380,
  platePunch: 260,
  plateIn: 300,
  plateOut: 220,
  /**
   * Wild-multiplier label sum (clusters with meta.wildMult > 1, DESIGN bass-drop §7 step 6):
   * badge punch per bump, value count winWithoutMult -> win, slam, hold before the float-out.
   * `autoGap`: 'auto' mode pause between the badge punch and the count. `timeout`: 'external'
   * mode safety net (game ms after the label landed) before the auto sequence takes over.
   */
  multSum: {
    badgePunch: 180,
    badgePunchFrom: 1.7,
    count: 250,
    slam: 220,
    slamScale: 1.25,
    slamEase: 'back.out(3)',
    holdAfter: 320,
    autoGap: 120,
    timeout: 2500,
  },
} as const);

/** Wild-multiplier sum state of one label (null on labels without meta.wildMult > 1). */
interface MultSum {
  overlay: Position;
  /** meta.wildMult: the badge's value when the sum is done */
  target: number;
  /** label value before / after the multiplier (book units) */
  from: number;
  to: number;
  /** badge value on screen (0 = hidden) */
  shown: number;
  /** a bump that arrived before the pop-in finished */
  pendingMult: number;
  /** pop-in done: bumps and the final may animate */
  ready: boolean;
  wantFinal: boolean;
  finalized: boolean;
  /** resolves when the slam has settled */
  settled: () => void;
  timers: gsap.core.Animation[];
}

/** One pooled cluster-win label: symbol-coloured glow + money value + optional xN badge. */
class ClusterLabel extends Container {
  readonly glow = new Sprite({ texture: glowTexture(256), anchor: 0.5, blendMode: 'add' });
  readonly value: BitmapText;
  readonly badge: BitmapText;
  busy = false;
  sum: MultSum | null = null;
  /** label width reference for the badge (the value text changes while counting) */
  k = 1;

  constructor(font: string) {
    super({ label: 'clusterLabel' });
    this.value = new BitmapText({ text: '', style: { fontFamily: font, fontSize: 60 }, anchor: 0.5 });
    this.badge = new BitmapText({ text: '', style: { fontFamily: font, fontSize: 40 }, anchor: 0.5 });
    this.badge.tint = 0xffd54a;
    this.addChild(this.glow, this.value, this.badge);
  }
}

/**
 * On-board win presentation (small wins; the HUD owns the win counter):
 *  - cluster labels on 'board:showWins': money value popping out of the cluster's
 *    overlay cell, holding, then floating away while the symbols explode;
 *  - a running tumble-win plate on the frame sill fed by 'win:tumble', counting up
 *    with a punch on every increase, hidden on round start/end and on a new reveal.
 *
 * Wild-multiplier sums (clusters with meta.wildMult > 1): the label pops in with
 * meta.winWithoutMult and its xN badge hidden, holds, then the badge shows the multiplier
 * and the value counts to `win` and slams (scale 1.25, back.out(3)); the round is held
 * until that has settled. FEATURES.wildMultSum picks the driver:
 *   'auto' (default)  WinPresenter plays a compact sequence by itself (badge punch, count);
 *   'external'        a game module drives it with 'win:labelMult' {overlay, mult} (show /
 *                     bump the badge, one punch each) and {overlay, mult?, final:true}
 *                     (count + slam); labels are matched by overlay cell. Without a final
 *                     within multSum.timeout game ms the auto sequence takes over.
 * Swamp Funk's clusterMult badge (no wildMult) is unchanged.
 */
export class WinPresenter implements GameModule {
  private layer = new Container({ label: 'winPresenter' });
  private labels: ClusterLabel[] = [];
  private plate = new Container({ label: 'tumblePlate' });
  private plateBg = new Plate(0xffd54a, 0.7);
  private plateLabel!: BitmapText;
  private plateValue!: BitmapText;
  private plateShown = false;
  private plateBaseScale = 1;
  private plateAmount = 0;
  private plateCount = { v: 0 };
  private plateTweens: gsap.core.Tween[] = [];
  private valueFont = '';
  private offs: Array<() => void> = [];

  constructor(private ctx: GameContext) {}

  init(): void {
    const { ctx } = this;
    const renderer = ctx.app.renderer;
    this.valueFont = ensureValueFont(renderer, ctx.money);
    const labelFont = ensureLabelFont(renderer);
    ctx.layers.overlay.addChild(this.layer);

    this.plateLabel = new BitmapText({
      text: label('win', 'WIN'),
      style: { fontFamily: labelFont, fontSize: 30 },
      anchor: { x: 0, y: 0.5 },
    });
    this.plateValue = new BitmapText({
      text: '',
      style: { fontFamily: this.valueFont, fontSize: 44 },
      anchor: { x: 0, y: 0.52 },
    });
    this.plate.addChild(this.plateBg, this.plateLabel, this.plateValue);
    this.plate.visible = false;
    this.layer.addChild(this.plate);
    this.layout(ctx.layout);

    const g = ctx.game;
    this.offs.push(
      g.on('board:showWins', (p) => this.showWins(p)),
      g.on('win:labelMult', (p) => this.onLabelMult(p)),
      g.on('win:tumble', ({ amount }) => this.setTumble(amount)),
      g.on('round:start', () => this.hidePlate()),
      g.on('board:reveal', () => this.hidePlate()),
      g.on('round:end', () => this.hidePlate()),
      g.on('layout:change', ({ layout }) => this.layout(layout)),
    );
  }

  layout(L: LayoutSpec): void {
    const p = placementFor(L).tumblePlate;
    this.plate.position.set(p.x, p.y);
    this.plate.scale.set(this.plateShown ? p.scale : this.plate.scale.x);
    this.plateBaseScale = p.scale;
  }

  // ── cluster labels ───────────────────────────────────────────────────────

  private acquireLabel(): ClusterLabel {
    let l = this.labels.find((x) => !x.busy);
    if (!l) {
      l = new ClusterLabel(this.valueFont);
      this.labels.push(l);
      this.layer.addChildAt(l, 0);
    }
    l.busy = true;
    l.visible = true;
    return l;
  }

  private showWins(p: GameEvents['board:showWins']): Promise<void> {
    const L = this.ctx.layout;
    const jobs = p.wins.map((w, i) => this.showLabel(w, L, i * stagger(WIN_PRESENT_TIMING.labelStagger)));
    // hold the round only for pop-in + hold; the float-out overlaps the explode
    return Promise.all(jobs).then(() => undefined);
  }

  private showLabel(w: ClusterWin, L: LayoutSpec, delayMs: number): Promise<void> {
    const T = TIMING.win;
    const k = L.cell / 150;
    const lab = this.acquireLabel();
    const def = SYMBOLS[w.symbol];
    const color = def?.color ?? 0xffd54a;
    const wildMult = w.meta?.wildMult ?? 0;
    const summing = wildMult > 1;
    lab.k = k;
    lab.value.text = this.money(summing ? w.meta.winWithoutMult : w.win);
    lab.value.style.fontSize = 86 * k;
    lab.badge.style.fontSize = 54 * k;
    lab.badge.scale.set(1);
    const mult = w.meta?.clusterMult ?? 1;
    lab.badge.visible = !summing && mult > 1;
    if (lab.badge.visible) {
      lab.badge.text = `x${mult}`;
      this.placeBadge(lab);
    }
    lab.glow.tint = lighten(color, 0.15);
    lab.glow.width = Math.max(lab.value.width * 1.9, 260 * k);
    lab.glow.height = 190 * k;

    // position: overlay cell, clamped inside the grid so wide labels never clip the frame
    const ov = w.meta?.overlay ?? w.positions[0];
    const c = cellCenter(L, ov.reel, toSpotRow(ov.row));
    const g = gridSize(L);
    const half = lab.value.width / 2 + 10 * k;
    const x = Math.min(Math.max(c.x, L.grid.x + half), L.grid.x + g.w - half);
    lab.position.set(x, c.y);
    lab.alpha = 1;
    lab.scale.set(0);
    lab.rotation = -0.12;
    lab.glow.alpha = 0;

    return new Promise((resolve) => {
      const tl = followSpeed(gsap.timeline({ delay: s(delayMs) }));
      tl.to(lab.scale, { x: 1, y: 1, duration: s(T.clusterLabelIn), ease: 'back.out(2)' }, 0);
      tl.to(lab, { rotation: 0, duration: s(T.clusterLabelIn * 1.4), ease: 'elastic.out(1, 0.5)' }, 0);
      tl.to(lab.glow, { alpha: 1, duration: s(T.clusterLabelIn * 0.5), ease: 'power1.out' }, 0);
      tl.to(lab.glow, { alpha: 0.7, duration: s(T.clusterLabelHold), ease: 'sine.inOut' }, s(T.clusterLabelIn));
      if (!summing) {
        tl.call(() => resolve(), undefined, s(T.clusterLabelIn + T.clusterLabelHold));
        this.labelOut(tl, lab, c.y, s(T.clusterLabelIn + T.clusterLabelHold));
        return;
      }
      // multiplier sum: hold until the slam has settled (never before the normal hold ends)
      const minHold = new Promise<void>((r) => tl.call(r, undefined, s(T.clusterLabelIn + T.clusterLabelHold)));
      const settled = new Promise<void>((r) => {
        lab.sum = {
          overlay: { reel: ov.reel, row: ov.row },
          target: wildMult,
          from: w.meta.winWithoutMult,
          to: w.win,
          shown: 0,
          pendingMult: 0,
          ready: false,
          wantFinal: false,
          finalized: false,
          settled: r,
          timers: [],
        };
      });
      tl.call(() => this.sumReady(lab), undefined, s(T.clusterLabelIn));
      void Promise.all([minHold, settled.then(() => clock.wait(WIN_PRESENT_TIMING.multSum.holdAfter))]).then(() => {
        resolve();
        const out = followSpeed(gsap.timeline());
        this.labelOut(out, lab, c.y, 0);
      });
    });
  }

  /** Float-out + release at `at` (timeline seconds). */
  private labelOut(tl: gsap.core.Timeline, lab: ClusterLabel, y0: number, at: number): void {
    const T = TIMING.win;
    tl.to(lab, { y: y0 - T.clusterLabelFloat * lab.k, duration: s(T.clusterLabelOut), ease: 'power1.in' }, at);
    tl.to(lab, { alpha: 0, duration: s(T.clusterLabelOut), ease: 'power2.in' }, at);
    tl.to(lab.scale, { x: 1.06, y: 1.06, duration: s(T.clusterLabelOut), ease: 'power1.out' }, at);
    tl.call(() => {
      lab.visible = false;
      lab.busy = false;
      lab.sum = null;
    });
  }

  private money(book: number): string {
    return this.ctx.money.format(this.ctx.money.fromBook(book));
  }

  /** xN badge at the value's top-right corner. */
  private placeBadge(lab: ClusterLabel): void {
    lab.badge.position.set(lab.value.width / 2 + lab.badge.width * 0.35, -lab.value.height * 0.42);
    lab.badge.rotation = 0.14;
  }

  // ── wild-multiplier label sum ────────────────────────────────────────────

  /** Pop-in finished: apply what arrived early, start the auto sequence or the safety net. */
  private sumReady(lab: ClusterLabel): void {
    const sum = lab.sum;
    if (!sum) return;
    sum.ready = true;
    if (sum.pendingMult > 0) this.bump(lab, sum.pendingMult);
    if (sum.wantFinal) {
      this.finalize(lab);
      return;
    }
    const M = WIN_PRESENT_TIMING.multSum;
    const auto = (FEATURES.wildMultSum ?? 'auto') === 'auto';
    const run = (): void => {
      if (sum.finalized || lab.sum !== sum) return;
      if (sum.shown !== sum.target) this.bump(lab, sum.target, auto || sum.shown === 0);
      sum.timers.push(followSpeed(gsap.delayedCall(s(M.badgePunch + M.autoGap), () => this.finalize(lab))));
    };
    if (auto) run();
    else sum.timers.push(followSpeed(gsap.delayedCall(s(M.timeout), run)));
  }

  /** 'win:labelMult': show / bump the badge of the label at `overlay`; `final` counts + slams. */
  private onLabelMult({ overlay, mult, final }: GameEvents['win:labelMult']): void {
    const lab = this.labels.find(
      (l) => l.busy && l.sum && !l.sum.finalized && l.sum.overlay.reel === overlay.reel && l.sum.overlay.row === overlay.row,
    );
    const sum = lab?.sum;
    if (!lab || !sum) return;
    if (mult > 0 && mult !== sum.shown) {
      if (sum.ready) this.bump(lab, mult);
      else sum.pendingMult = mult;
    }
    if (final) {
      sum.wantFinal = true;
      if (sum.ready) this.finalize(lab);
    }
  }

  /** Badge shows xN with a punch (one per bump). */
  private bump(lab: ClusterLabel, mult: number, sfx = false): void {
    const sum = lab.sum;
    if (!sum) return;
    const M = WIN_PRESENT_TIMING.multSum;
    sum.shown = mult;
    sum.pendingMult = 0;
    const b = lab.badge;
    b.text = `x${mult}`;
    b.visible = true;
    this.placeBadge(lab);
    gsap.killTweensOf(b.scale);
    followSpeed(gsap.fromTo(b.scale, { x: M.badgePunchFrom, y: M.badgePunchFrom }, { x: 1, y: 1, duration: s(M.badgePunch), ease: 'back.out(3)' }));
    if (sfx) this.ctx.game.broadcast('sfx', { id: 'wild_mult' });
  }

  /** Count winWithoutMult -> win, then slam; settles the label's hold. */
  private finalize(lab: ClusterLabel): void {
    const sum = lab.sum;
    if (!sum || sum.finalized) return;
    sum.finalized = true;
    for (const t of sum.timers) t.kill();
    sum.timers = [];
    if (sum.shown === 0) this.bump(lab, sum.target);
    const M = WIN_PRESENT_TIMING.multSum;
    const v = { n: sum.from };
    const tl = followSpeed(gsap.timeline());
    tl.to(v, {
      n: sum.to,
      duration: s(M.count),
      ease: 'power1.out',
      onUpdate: () => {
        lab.value.text = this.money(Math.round(v.n));
        this.placeBadge(lab);
      },
    });
    tl.call(() => {
      lab.value.text = this.money(sum.to);
      this.placeBadge(lab);
      lab.glow.width = Math.max(lab.value.width * 1.9, 260 * lab.k);
    });
    tl.fromTo(lab.scale, { x: M.slamScale, y: M.slamScale }, { x: 1, y: 1, duration: s(M.slam), ease: M.slamEase, immediateRender: false });
    tl.fromTo(lab.glow, { alpha: 1 }, { alpha: 0.7, duration: s(M.slam), ease: 'power2.out', immediateRender: false }, '<');
    tl.call(() => sum.settled());
  }

  // ── tumble plate ─────────────────────────────────────────────────────────

  private renderPlate(amountBook: number): void {
    this.plateValue.text = this.ctx.money.format(this.ctx.money.fromBook(amountBook));
    const gap = 14;
    const lw = this.plateLabel.width;
    const vw = this.plateValue.width;
    const total = lw + gap + vw;
    this.plateLabel.x = -total / 2;
    this.plateValue.x = -total / 2 + lw + gap;
    this.plateBg.resize(Math.max(240, total + 90), 64);
  }

  private setTumble(amount: number): void {
    const P = WIN_PRESENT_TIMING;
    if (amount <= 0) return;
    const prev = this.plateAmount;
    this.plateAmount = amount;
    for (const t of this.plateTweens) t.kill();
    this.plateTweens = [];
    const base = this.plateBaseScale;
    if (!this.plateShown) {
      this.plateShown = true;
      this.plate.visible = true;
      this.plate.alpha = 1;
      this.plateCount.v = 0;
      this.renderPlate(0);
      this.plate.scale.set(base * 0.4);
      this.plateTweens.push(scaleTo(this.plate.scale, base, { duration: s(P.plateIn), ease: 'back.out(2.4)' }));
    } else if (amount > prev) {
      this.plateTweens.push(
        gsap.fromTo(
          this.plate.scale,
          { x: base * 1.16, y: base * 1.16 },
          { x: base, y: base, duration: s(P.platePunch), ease: 'back.out(3)' },
        ),
      );
    }
    this.plateTweens.push(
      followSpeed(
        gsap.to(this.plateCount, {
          v: amount,
          duration: s(P.plateCount),
          ease: 'power2.out',
          onUpdate: () => this.renderPlate(this.plateCount.v),
          onComplete: () => this.renderPlate(amount),
        }),
      ),
    );
    if (amount > prev) {
      this.ctx.game.broadcast('fx:burst', {
        kind: 'sparkle',
        x: this.plate.x + (this.plateValue.x + this.plateValue.width / 2) * base,
        y: this.plate.y,
        count: 6,
        color: 0xffe27a,
      });
    }
  }

  private hidePlate(): void {
    if (!this.plateShown) return;
    this.plateShown = false;
    this.plateAmount = 0;
    for (const t of this.plateTweens) t.kill();
    const base = this.plateBaseScale;
    this.plateTweens = [
      scaleTo(this.plate.scale, base * 0.8, { duration: s(WIN_PRESENT_TIMING.plateOut), ease: 'power2.in' }),
      gsap.to(this.plate, {
        alpha: 0,
        duration: s(WIN_PRESENT_TIMING.plateOut),
        ease: 'power2.in',
        onComplete: () => {
          this.plate.visible = false;
        },
      }),
    ];
  }

  destroy(): void {
    for (const off of this.offs) off();
    for (const t of this.plateTweens) t.kill();
    this.layer.destroy({ children: true });
  }
}
