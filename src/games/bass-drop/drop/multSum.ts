import { gsap } from 'gsap';
import { BitmapText, Container, Point } from 'pixi.js';
import type { ClusterWin, Position } from '../../../book/types';
import { toSpotRow } from '../../../config/game';
import { cellCenter, gridSize, type LayoutSpec } from '../../../config/layout';
import { TIMING, getSpeedProfile, s, stagger } from '../../../core/timing';
import { pentaRate } from '../../../audio/mix';
import type { GameContext } from '../../../game/context';
import { ensureValueFont } from '../../../present/common/fonts';
import { WIN_PRESENT_TIMING } from '../../../present/WinPresenter';
import { GROOVE } from '../config';
import { BASS_DROP_TIMING, multTier, physK } from '../timing';
import type { DropArt } from './art';
import { MultBadge } from './decor';
import type { DropFx } from './fx';
import { type Pt, p2in } from './geometry';
import { DROP_LOOK as LOOK } from './look';
import type { WildEntity, WildRegistry } from './registry';
import { Sched } from './sched';

const M = BASS_DROP_TIMING.multSum;
const S = BASS_DROP_TIMING.sticky;
const CAP = GROOVE.super.cap;

/**
 * Wild-multiplier label sums (DESIGN.md §7 step 6, FEATURES.wildMultSum 'external') and the
 * Mega Mix "+1" previews (§9.2.3), on 'board:showWins':
 *  - per cluster with meta.wildMult > 1, the multiplier wilds inside it (registry) each send a
 *    badge clone from their W into the cluster label's xN badge once the label has landed
 *    (label i lands at i x labelStagger + clusterLabelIn, WinPresenter's own timing): flight
 *    multSum.flight, stagger multSum.stagger; each arrival emits win:labelMult {mult: running
 *    sum} with wild_mult rising, then {final:true, mult: wildMult} counts the label to `win`;
 *  - turbo halves the flights (s()), super turbo skips them; a registry sum that disagrees with
 *    meta.wildMult (resume, stale tag) skips them too and emits the final directly;
 *  - the handler resolves once every final has been emitted (the WinPresenter holds the round
 *    for its count + slam);
 *  - a sticky wild in a cluster pops a teal "+1" off its badge plusOneDelay after the label
 *    lands (once per winInfo, never at the x25 cap) and marks its home "won" for the cap shimmer.
 * The label position replicates WinPresenter's: overlay cell centre, x clamped inside the grid
 * by half the value width (+10·k), badge at the value's top-right.
 */
export class MultSumDirector {
  readonly view = new Container({ label: 'bassDropSums' });
  private readonly clones: MultBadge[] = [];
  private readonly sched = new Sched();
  private readonly measureValue: BitmapText;
  private readonly measureBadge: BitmapText;
  private readonly waiting = new Set<() => void>();
  private readonly tmp = new Point();
  private readonly scratch: WildEntity[] = [];

  constructor(
    private readonly ctx: GameContext,
    private readonly art: DropArt,
    private readonly fx: DropFx,
    private readonly registry: WildRegistry,
  ) {
    const font = ensureValueFont(ctx.app.renderer, ctx.money);
    this.measureValue = new BitmapText({ text: '', style: { fontFamily: font, fontSize: 60 }, anchor: 0.5 });
    this.measureBadge = new BitmapText({ text: '', style: { fontFamily: font, fontSize: 40 }, anchor: 0.5 });
  }

  showWins(wins: readonly ClusterWin[]): Promise<void> {
    const tasks: Promise<void>[] = [];
    const plussed = new Set<WildEntity>();
    const labelGap = stagger(WIN_PRESENT_TIMING.labelStagger);
    wins.forEach((w, i) => {
      const land = s(i * labelGap) + s(TIMING.win.clusterLabelIn);
      const ents = [...this.registry.multipliersIn(w.positions, this.scratch)];
      for (const e of ents) {
        if (!e.home) continue;
        e.home.wonNow = true;
        if (plussed.has(e) || e.mult >= CAP) continue;
        plussed.add(e);
        this.sched.at(land + s(S.plusOneDelay), () => this.plusOne(e));
      }
      const wildMult = w.meta?.wildMult ?? 0;
      if (wildMult <= 1) return;
      tasks.push(this.sum(w, ents, land, wildMult));
    });
    return Promise.all(tasks).then(() => undefined);
  }

  /** One cluster's sum: flights then the final, or the final alone (super turbo / mismatch). */
  private sum(w: ClusterWin, ents: WildEntity[], land: number, wildMult: number): Promise<void> {
    const overlay: Position = { reel: (w.meta.overlay ?? w.positions[0]).reel, row: (w.meta.overlay ?? w.positions[0]).row };
    return new Promise<void>((resolve) => {
      let settled = false;
      const done = (): void => {
        if (settled) return;
        settled = true;
        this.waiting.delete(done);
        resolve();
      };
      this.waiting.add(done);
      const final = (): void => {
        this.ctx.game.broadcast('win:labelMult', { overlay, mult: wildMult, final: true });
        done();
      };
      const total = ents.reduce((a, e) => a + e.mult, 0);
      if (getSpeedProfile() === 'superTurbo' || !ents.length || total !== wildMult) {
        this.sched.at(land, final);
        return;
      }
      let running = 0;
      ents.forEach((e, j) => {
        const value = e.mult;
        this.sched.at(land + j * s(M.stagger), () =>
          this.fly(e, w, overlay, () => {
            running += value;
            this.ctx.game.broadcast('win:labelMult', { overlay, mult: running });
            this.ctx.game.broadcast('sfx', { id: 'wild_mult', rate: pentaRate(j) });
            if (j === ents.length - 1) final();
          }),
        );
      });
    });
  }

  /** A badge clone lifts off the W and flies into the label's xN badge (power2.in: sucked in). */
  private fly(e: WildEntity, w: ClusterWin, overlay: Position, arrive: () => void): void {
    const L = this.ctx.layout;
    const from = this.badgeOrigin(e);
    const to = this.labelBadge(L, w, overlay);
    const clone = this.acquire();
    clone.rest();
    clone.setValue(e.mult);
    clone.fit(L.cell, false);
    const base = clone.scale.x;
    clone.position.set(from.x, from.y);
    clone.visible = true;
    const lift = LOOK.cloneLift * L.cell;
    const cx = (from.x + to.x) / 2;
    const cy = Math.min(from.y, to.y) - lift;
    const st = { u: 0 };
    const color = multTier(e.mult).color;
    this.sched.add(
      gsap.to(st, {
        u: 1,
        duration: s(M.flight),
        ease: 'none',
        onUpdate: () => {
          const t = p2in(st.u);
          const v = 1 - t;
          clone.position.set(v * v * from.x + 2 * v * t * cx + t * t * to.x, v * v * from.y + 2 * v * t * cy + t * t * to.y);
          clone.scale.set(base * (1 + (LOOK.cloneEndScale - 1) * t));
          clone.rotation = 0.14 * t;
        },
        onComplete: () => {
          clone.visible = false;
          clone.owner = null;
          this.fx.sparks(to.x, to.y, physK(this.ctx.layout), 8, color, 300, 0.8);
          arrive();
        },
      }),
    );
  }

  /** Teal +1 off a sticky badge (§9.2.3); the badge keeps its value until the next reveal. */
  private plusOne(e: WildEntity): void {
    if (!e.alive) return;
    const L = this.ctx.layout;
    const p = this.badgeOrigin(e);
    this.fx.plusOne(p.x, p.y - L.cell * 0.12, physK(L), 1, S.plusOne, S.plusOneRise);
  }

  /** Design-space position of an entity's badge (its live transform when attached, else the cell). */
  private badgeOrigin(e: WildEntity): Pt {
    const b = e.badge;
    if (b?.parent && b.visible) {
      b.getGlobalPosition(this.tmp);
      this.view.toLocal(this.tmp, undefined, this.tmp);
      return { x: this.tmp.x, y: this.tmp.y };
    }
    return this.registry.badgePoint(e);
  }

  /**
   * Where WinPresenter puts the label's xN badge: the label sits at the overlay cell centre,
   * x clamped inside the grid by half its value width (+10·k), the badge at the value's
   * top-right (value.width / 2 + badge.width x 0.35, -value.height x 0.42). k = cell / 150.
   */
  private labelBadge(L: LayoutSpec, w: ClusterWin, overlay: Position): Pt {
    const k = L.cell / 150;
    const mv = this.measureValue;
    const mb = this.measureBadge;
    mv.style.fontSize = 86 * k;
    mv.text = this.ctx.money.format(this.ctx.money.fromBook(w.meta.winWithoutMult));
    mb.style.fontSize = 54 * k;
    mb.text = `x${w.meta.wildMult ?? 0}`;
    const c = cellCenter(L, overlay.reel, toSpotRow(overlay.row));
    const g = gridSize(L);
    const half = mv.width / 2 + 10 * k;
    const x = Math.min(Math.max(c.x, L.grid.x + half), L.grid.x + g.w - half);
    return { x: x + mv.width / 2 + mb.width * 0.35, y: c.y - mv.height * 0.42 };
  }

  private acquire(): MultBadge {
    let b = this.clones.find((x) => x.owner === null);
    if (!b) {
      b = new MultBadge(this.art);
      this.clones.push(b);
      this.view.addChild(b);
    }
    b.owner = this;
    return b;
  }

  /** board:set / round start: flights stop, every waiting sum resolves (no final: the label is gone). */
  abort(): void {
    this.sched.kill();
    for (const c of this.clones) {
      c.visible = false;
      c.owner = null;
    }
    for (const r of [...this.waiting]) r();
  }

  layout(L: LayoutSpec): void {
    for (const c of this.clones) if (c.owner) c.fit(L.cell, false);
  }

  destroy(): void {
    this.abort();
    this.measureValue.destroy();
    this.measureBadge.destroy();
    this.view.destroy({ children: true });
  }
}
