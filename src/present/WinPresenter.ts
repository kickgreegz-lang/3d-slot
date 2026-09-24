import { gsap } from 'gsap';
import { BitmapText, Container, Sprite } from 'pixi.js';
import type { ClusterWin } from '../book/types';
import { SYMBOLS } from '../config/game';
import { cellCenter, gridSize, type LayoutSpec } from '../config/layout';
import { s, stagger, TIMING } from '../core/timing';
import { glowTexture } from '../fx/textures';
import { lighten } from '../fx/util';
import type { GameContext, GameModule } from '../game/context';
import type { GameEvents } from '../game/events';
import { ensureLabelFont, ensureValueFont } from './common/fonts';
import { placementFor } from './common/placement';
import { Plate } from './common/Plate';
import { label } from './common/text';

/** Local choreography (ms, speed-scaled via s()). Candidates for TIMING.win. */
export const WIN_PRESENT_TIMING = {
  /** stagger between several cluster labels of one winInfo */
  labelStagger: 90,
  /** tumble plate count-up per increase */
  plateCount: 380,
  platePunch: 260,
  plateIn: 300,
  plateOut: 220,
} as const;

/** One pooled cluster-win label: symbol-coloured glow + money value + optional xN badge. */
class ClusterLabel extends Container {
  readonly glow = new Sprite({ texture: glowTexture(256), anchor: 0.5, blendMode: 'add' });
  readonly value: BitmapText;
  readonly badge: BitmapText;
  busy = false;

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

    this.plateLabel = new BitmapText({ text: label('win', 'WIN'), style: { fontFamily: labelFont, fontSize: 30 }, anchor: { x: 0, y: 0.5 } });
    this.plateValue = new BitmapText({ text: '', style: { fontFamily: this.valueFont, fontSize: 44 }, anchor: { x: 0, y: 0.52 } });
    this.plate.addChild(this.plateBg, this.plateLabel, this.plateValue);
    this.plate.visible = false;
    this.layer.addChild(this.plate);
    this.layout(ctx.layout);

    const g = ctx.game;
    this.offs.push(
      g.on('board:showWins', (p) => this.showWins(p)),
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
    lab.value.text = this.ctx.money.format(this.ctx.money.fromBook(w.win));
    lab.value.style.fontSize = 86 * k;
    const mult = w.meta?.clusterMult ?? 1;
    lab.badge.visible = mult > 1;
    if (mult > 1) {
      lab.badge.text = `x${mult}`;
      lab.badge.style.fontSize = 54 * k;
      lab.badge.position.set(lab.value.width / 2 + lab.badge.width * 0.35, -lab.value.height * 0.42);
      lab.badge.rotation = 0.14;
    }
    lab.glow.tint = lighten(color, 0.15);
    lab.glow.width = Math.max(lab.value.width * 1.9, 260 * k);
    lab.glow.height = 190 * k;

    // position: overlay cell, clamped inside the grid so wide labels never clip the frame
    const ov = w.meta?.overlay ?? w.positions[0];
    const c = cellCenter(L, ov.reel, ov.row - 1);
    const g = gridSize(L);
    const half = lab.value.width / 2 + 10 * k;
    const x = Math.min(Math.max(c.x, L.grid.x + half), L.grid.x + g.w - half);
    lab.position.set(x, c.y);
    lab.alpha = 1;
    lab.scale.set(0);
    lab.rotation = -0.12;
    lab.glow.alpha = 0;

    return new Promise((resolve) => {
      const tl = gsap.timeline({ delay: s(delayMs) });
      tl.to(lab.scale, { x: 1, y: 1, duration: s(T.clusterLabelIn), ease: 'back.out(2)' }, 0);
      tl.to(lab, { rotation: 0, duration: s(T.clusterLabelIn * 1.4), ease: 'elastic.out(1, 0.5)' }, 0);
      tl.to(lab.glow, { alpha: 1, duration: s(T.clusterLabelIn * 0.5), ease: 'power1.out' }, 0);
      tl.to(lab.glow, { alpha: 0.7, duration: s(T.clusterLabelHold), ease: 'sine.inOut' }, s(T.clusterLabelIn));
      tl.call(() => resolve(), undefined, s(T.clusterLabelIn + T.clusterLabelHold));
      const out = s(T.clusterLabelIn + T.clusterLabelHold);
      tl.to(lab, { y: c.y - T.clusterLabelFloat * k, duration: s(T.clusterLabelOut), ease: 'power1.in' }, out);
      tl.to(lab, { alpha: 0, duration: s(T.clusterLabelOut), ease: 'power2.in' }, out);
      tl.to(lab.scale, { x: 1.06, y: 1.06, duration: s(T.clusterLabelOut), ease: 'power1.out' }, out);
      tl.call(() => {
        lab.visible = false;
        lab.busy = false;
      });
    });
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
      this.plateTweens.push(gsap.to(this.plate.scale, { x: base, y: base, duration: s(P.plateIn), ease: 'back.out(2.4)' }));
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
      gsap.to(this.plateCount, {
        v: amount,
        duration: s(P.plateCount),
        ease: 'power2.out',
        onUpdate: () => this.renderPlate(this.plateCount.v),
        onComplete: () => this.renderPlate(amount),
      }),
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
      gsap.to(this.plate.scale, { x: base * 0.8, y: base * 0.8, duration: s(WIN_PRESENT_TIMING.plateOut), ease: 'power2.in' }),
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
