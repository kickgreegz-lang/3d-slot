import { slotPos } from '../../../board/model';
import type { Position } from '../../../book/types';
import { s, stagger } from '../../../core/timing';
import { pentaRate } from '../../../audio/mix';
import type { GameContext } from '../../../game/context';
import { GROOVE } from '../config';
import type { StickyWild } from '../events';
import { BASS_DROP_TIMING, GOLD, multTier, physK } from '../timing';
import type { DropFx } from './fx';
import { byCell, cellKey } from './geometry';
import { clipMs, DROP_LOOK as LOOK, W_CLIPS } from './look';
import type { Home, WildRegistry } from './registry';
import { Sched } from './sched';

const S = BASS_DROP_TIMING.sticky;
const CAP = GROOVE.super.cap;
const WILD = 'W';

interface Growth {
  home: Home;
  from: number;
  to: number;
}

/**
 * MEGA MIX sticky wilds across spins (DESIGN.md §9.1 / §9.3 / §9.4):
 *  - hold set: before every free-spin reveal (fs:update) the homes whose OWN wild stands on
 *    them are sent as board:hold, so those W stay standing through the fall-out (CR-10b);
 *  - reveal: tracked wilds that were not held leave with the fall-out (their decorations are
 *    detached by the Board), held ones keep badge + clamps;
 *  - wild:sticky: the book's registry replaces ours. Homes whose W was not held get their
 *    return (gold ring flash on the tile, badge appear, sticky_lock) staggered 90 ms in
 *    ascending (reel, row); grown multipliers play mult_up (swap at f4, sticky_mult_up by
 *    tier, cue spotUpgrade) staggered 120 ms, capped at 600 ms (turbo: together); a home at
 *    the x25 cap whose wild won last spin plays the maxed shimmer. Resolves when the last clip
 *    settles, at once when nothing changed; right after a board:set (resume) it is instant;
 *  - feature end (fs:end): clamps sticky_unlock, markers fade; mode:change basegame clears.
 */
export class StickyDirector {
  private readonly sched = new Sched();
  private readonly holdOut: Array<Position & { id: string }> = [];
  /** home keys sent in the last hold request (consumed by the next reveal) */
  private readonly held = new Set<string>();
  private holdPending = false;
  /** the next wild:sticky restores instantly (resume / replay start after board:set) */
  private instant = false;

  constructor(
    private readonly ctx: GameContext,
    private readonly fx: DropFx,
    private readonly registry: WildRegistry,
  ) {}

  armInstant(): void {
    this.instant = true;
  }

  /** fs:update (before each free-spin reveal): hold the homes whose own wild stands on them. */
  requestHold(): void {
    const cells = this.registry.holdCells(this.holdOut);
    this.held.clear();
    for (const c of cells) this.held.add(cellKey(c));
    if (!cells.length && !this.holdPending) return;
    this.holdPending = cells.length > 0;
    this.ctx.game.broadcast('board:hold', { cells: cells.map((c) => ({ reel: c.reel, row: c.row, id: c.id })) });
  }

  /** Cancel a pending hold (feature end, reset). */
  cancelHold(): void {
    this.held.clear();
    if (!this.holdPending) return;
    this.holdPending = false;
    this.ctx.game.broadcast('board:hold', { cells: [] });
  }

  /** board:reveal (the fall-out has consumed the hold): unheld tracked wilds are gone. */
  onReveal(): void {
    this.holdPending = false;
    for (const e of [...this.registry.live]) {
      const h = e.home;
      const held = !!h && this.held.has(h.key) && e.reel === h.reel && e.row === h.row;
      if (!held) this.registry.kill(e, false);
    }
    this.held.clear();
    for (const h of this.registry.homes.values()) {
      h.wonLast = h.wonNow;
      h.wonNow = false;
    }
  }

  /** wild:sticky: reconcile the home registry (see the class doc). */
  reconcile(wilds: readonly StickyWild[]): Promise<void> {
    const R = this.registry;
    const list = [...wilds].sort(byCell);
    const keys = new Set(list.map(cellKey));
    const instant = this.instant;
    this.instant = false;
    for (const h of [...R.homes.values()]) if (!keys.has(h.key)) R.removeHome(h, instant ? 0 : S.homeMarkerIn);

    if (instant) {
      for (const w of list) {
        const h = R.addHome(w.reel, w.row, w.multiplier, 0);
        h.mult = w.multiplier;
        if (R.idAt(w.reel, w.row) === WILD) R.adopt(h, w.multiplier, true);
      }
      return Promise.resolve();
    }

    const returns: Array<{ home: Home; from: number }> = [];
    const ups: Growth[] = [];
    const maxed: Home[] = [];
    for (const w of list) {
      const existed = R.homes.get(cellKey(w));
      const h = existed ?? R.addHome(w.reel, w.row, w.multiplier, S.homeMarkerIn);
      const from = existed ? existed.mult : w.multiplier;
      const e = h.entity;
      const held = !!e && e.alive && e.reel === h.reel && e.row === h.row && !!e.badge?.parent;
      if (!held && R.idAt(w.reel, w.row) === WILD) returns.push({ home: h, from });
      if (w.multiplier > from) ups.push({ home: h, from, to: w.multiplier });
      else if (w.multiplier >= CAP && h.wonLast) maxed.push(h);
      h.mult = w.multiplier;
    }
    if (!returns.length && !ups.length && !maxed.length) return Promise.resolve();

    let end = 0;
    const retGap = s(stagger(S.returnStagger));
    returns.forEach((r, i) => {
      const at = i * retGap;
      this.sched.at(at, () => this.returnHome(r.home, r.from));
      end = Math.max(end, at + s(clipMs(W_CLIPS.sticky_lock)));
    });
    // growth reads after the returns have locked (their lock_snap), one by one
    const b0 = returns.length ? (returns.length - 1) * retGap + s(clipMs(W_CLIPS.lock_snap)) : 0;
    const n = ups.length + maxed.length;
    const gap = s(stagger(n > 1 ? Math.min(S.multUpStagger, S.multUpCap / (n - 1)) : 0));
    ups.forEach((g, j) => {
      const at = b0 + j * gap;
      this.sched.at(at, () => this.multUp(g, j === 0));
      end = Math.max(end, at + s(clipMs(W_CLIPS.mult_up)));
    });
    maxed.forEach((h, j) => {
      const at = b0 + (ups.length + j) * gap;
      this.sched.at(at, () => this.shimmer(h));
      end = Math.max(end, at + s(400));
    });
    return this.sched.wait(end);
  }

  /** Return (§9.3.3): gold ring flash on the home tile, badge appear, clamps sticky_lock. */
  private returnHome(h: Home, from: number): void {
    const R = this.registry;
    const L = this.ctx.layout;
    const p = slotPos(L, h.reel, h.row);
    this.fx.ring(p.x, p.y, L.cell * 0.8, L.cell * LOOK.returnRing, LOOK.returnRingMs, GOLD, 1);
    if (R.idAt(h.reel, h.row) !== WILD) return;
    const e = R.adopt(h, from, false);
    void R.attachBadge(e).play('appear');
    void R.lock(e);
  }

  /** mult_up (§9.3.4): badge squash, text + tier swap at f4 with sticky_mult_up and tier sparks. */
  private multUp(g: Growth, first: boolean): void {
    const e = g.home.entity;
    if (!e?.alive || !e.badge) return;
    e.mult = g.to;
    const tier = multTier(g.to);
    const R = this.registry;
    void e.badge.play('mult_up', g.to, () => {
      const p = R.badgePoint(e);
      this.fx.sparks(p.x, p.y, physK(this.ctx.layout), LOOK.multSparks, tier.color, LOOK.multSparkMs);
      this.ctx.game.broadcast('sfx', { id: 'sticky_mult_up', rate: pentaRate(tier.tier - 1) });
    });
    if (first) this.ctx.game.broadcast('mascot:cue', { cue: 'spotUpgrade' });
  }

  /** Cap x25 (§9.4): the maxed shimmer instead of a number change. */
  private shimmer(h: Home): void {
    const e = h.entity;
    if (!e?.alive || !e.badge) return;
    void e.badge.play('maxed');
    this.ctx.game.broadcast('sfx', { id: 'sticky_mult_up', rate: pentaRate(5) });
  }

  /** fs:end (the outro): the clamps release, the home markers fade with the board dimmer. */
  release(): void {
    this.cancelHold();
    const R = this.registry;
    for (const h of R.homes.values()) void h.entity?.clamps?.play('sticky_unlock');
    R.clearHomes(clipMs(W_CLIPS.sticky_unlock));
  }

  /** mode:change basegame / reset: no homes, no hold. */
  endFeature(): void {
    this.cancelHold();
    this.registry.clearHomes(0);
  }

  reset(): void {
    this.sched.kill();
    this.held.clear();
    this.holdPending = false;
    this.instant = false;
  }
}
