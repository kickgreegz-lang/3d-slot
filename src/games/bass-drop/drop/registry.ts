import { Container } from 'pixi.js';
import { planTumble, slotPos } from '../../../board/model';
import type { Position } from '../../../book/types';
import { GRID } from '../../../config/game';
import type { LayoutSpec } from '../../../config/layout';
import { s } from '../../../core/timing';
import { pentaRate } from '../../../audio/mix';
import type { GameContext } from '../../../game/context';
import type { DroppedWild } from '../events';
import { BASS_DROP_TIMING, multTier, physK } from '../timing';
import type { DropArt } from './art';
import { HomeMarker, MultBadge, StickyClamps } from './decor';
import type { DropFx } from './fx';
import { cellKey } from './geometry';
import { DROP_LOOK as LOOK } from './look';
import { Sched } from './sched';

const T = BASS_DROP_TIMING;
const WILD = 'W';

/** A Mega Mix home (DESIGN §9.1): keyed by the cell its sticky wild dropped on. */
export interface Home {
  key: string;
  reel: number;
  row: number;
  /** multiplier the book reported (drop, then every stickyWilds) */
  mult: number;
  marker: HomeMarker;
  /** the wild that belongs to this home, while it is on the board (it may tumble away) */
  entity: WildEntity | null;
  /** its wild was part of a winInfo this spin / the previous spin (maxed shimmer at the cap) */
  wonNow: boolean;
  wonLast: boolean;
}

/** A multiplier / sticky wild on the board, tracked by its current padded cell. */
export interface WildEntity {
  id: number;
  reel: number;
  row: number;
  mult: number;
  /** Mega Mix sticky tag: travels with the view through tumbles */
  home: Home | null;
  badge: MultBadge | null;
  clamps: StickyClamps | null;
  alive: boolean;
}

/**
 * The drop's model of the board: every multiplier / sticky wild by padded cell, the Mega Mix
 * homes (DESIGN §9), and a mirror of the board ids so tumbles can be followed with the SDK
 * rule (board/model.ts planTumble: survivors slide down under the new symbols). Decorations
 * (badge 'mult', clamps 'clamp') hang on the symbol VIEW via board:decorate, so they follow
 * falls and pops by themselves; this registry only has to know which view carries what.
 *
 * Pools: badges, clamps and home markers are reused. A display leaves its entity when the
 * wild explodes / falls out / is replaced; it only returns to the pool once the Board has
 * detached it (parent null), so a fading explode is never robbed of its badge.
 */
export class WildRegistry {
  readonly homes = new Map<string, Home>();
  readonly markerLayer = new Container({ label: 'homeMarkers' });
  private readonly entities: WildEntity[] = [];
  private readonly badges: MultBadge[] = [];
  private readonly clampsPool: StickyClamps[] = [];
  private readonly markers: HomeMarker[] = [];
  /** decoration beats (slam, lock, returns): killed on board:set / reset */
  readonly sched = new Sched();
  private board: string[][] | null = null;
  private nextId = 1;
  private readonly token = {};

  constructor(
    private readonly ctx: GameContext,
    private readonly art: DropArt,
    private readonly fx: DropFx,
  ) {}

  // =========================================================================== board mirror

  /** A new board (reveal / board:set): the ids the tumbles apply to. */
  mirror(board: string[][]): void {
    this.board = board.map((col) => [...col]);
  }

  idAt(reel: number, row: number): string | undefined {
    return this.board?.[reel]?.[row];
  }

  /**
   * board:tumble: exploding wilds die (a sticky's clamps spring open first, §9.2.4), survivors
   * follow the SDK rule (combined = new ++ survivors per reel), overflow (malformed) dies.
   */
  tumble(exploding: Position[], newSymbols: string[][]): void {
    const gone = new Set(exploding.map(cellKey));
    const byCell = new Map<string, WildEntity>();
    for (const e of this.entities) {
      if (!e.alive) continue;
      if (gone.has(cellKey(e))) {
        e.clamps?.play('release');
        this.kill(e, false);
      } else byCell.set(cellKey(e), e);
    }
    if (!this.board) {
      for (const e of byCell.values()) this.kill(e, false);
      return;
    }
    let plan: ReturnType<typeof planTumble>;
    try {
      plan = planTumble(this.board, exploding, newSymbols);
    } catch {
      // malformed step (DEV assertion): lose the tags rather than the round
      for (const e of byCell.values()) this.kill(e, false);
      this.board = null;
      return;
    }
    const moved = new Set<WildEntity>();
    for (let reel = 0; reel < GRID.reels; reel++) {
      plan.columns[reel].forEach((src, row) => {
        if (src.kind !== 'survivor') return;
        const e = byCell.get(`${reel},${src.fromRow}`);
        if (!e) return;
        e.row = row;
        moved.add(e);
      });
    }
    for (const e of byCell.values()) if (!moved.has(e)) this.kill(e, false);
    this.board = plan.next;
  }

  /**
   * board:transform (any emitter): mirrors the Board's rule — a non-impact transform onto a
   * cell already showing the id is a no-op; otherwise the wild tracked there is replaced.
   */
  transform(cells: Array<Position & { id: string }>, style: string): void {
    for (const c of cells) {
      if (style !== 'impact' && this.board?.[c.reel]?.[c.row] === c.id) continue;
      const e = this.entityAt(c.reel, c.row);
      if (e) this.kill(e, false);
      if (this.board?.[c.reel]) this.board[c.reel][c.row] = c.id;
    }
  }

  // =========================================================================== entities

  entityAt(reel: number, row: number): WildEntity | null {
    for (const e of this.entities) if (e.alive && e.reel === reel && e.row === row) return e;
    return null;
  }

  /** Multiplier wilds (x2+) standing on `positions`, ascending (reel, row). */
  multipliersIn(positions: readonly Position[], out: WildEntity[]): WildEntity[] {
    out.length = 0;
    for (const p of positions) {
      const e = this.entityAt(p.reel, p.row);
      if (e && e.mult > 1 && !out.includes(e)) out.push(e);
    }
    return out.sort((a, b) => a.reel - b.reel || a.row - b.row);
  }

  get live(): readonly WildEntity[] {
    return this.entities;
  }

  private create(reel: number, row: number, mult: number): WildEntity {
    const e: WildEntity = { id: this.nextId++, reel, row, mult, home: null, badge: null, clamps: null, alive: true };
    this.entities.push(e);
    return e;
  }

  /**
   * A dropped wild took its cell (contact). Decorations follow the beat sheet: the badge slams
   * at multSlamDelay, the clamps lock at stickyLockDelay (the view exists from contact).
   * `placed` (reduced motion 'drop' transform): decorate once the Board has placed the view.
   */
  land(w: DroppedWild, placed: Promise<void> | null): WildEntity {
    const old = this.entityAt(w.reel, w.row);
    if (old) this.kill(old, false);
    if (this.board?.[w.reel]) this.board[w.reel][w.row] = WILD;
    const e = this.create(w.reel, w.row, w.multiplier);
    if (w.sticky) {
      const h = this.homes.get(cellKey(w)) ?? this.addHome(w.reel, w.row, w.multiplier, -1);
      h.mult = w.multiplier;
      h.entity = e;
      e.home = h;
    }
    const D = T.drop;
    const decorate = (slamAt: number, lockAt: number): void => {
      if (e.mult > 1) this.sched.at(slamAt, () => this.slam(e));
      if (e.home) this.sched.at(lockAt, () => this.lock(e));
    };
    if (placed) {
      void placed.then(() => {
        if (e.alive) decorate(0, s(D.stickyLockDelay - D.multSlamDelay));
      });
    } else decorate(s(D.multSlamDelay), s(D.stickyLockDelay));
    return e;
  }

  /**
   * Bind an entity to the W already standing at a home (a return after the reveal, a resume).
   * instant: badge + closed clamps at once; otherwise the caller plays the return clips.
   */
  adopt(h: Home, mult: number, instant: boolean): WildEntity {
    // whatever was tracked there (or for this home) belonged to a view that is gone
    const old = this.entityAt(h.reel, h.row);
    if (old) this.kill(old, false);
    if (h.entity) this.kill(h.entity, false);
    const e = this.create(h.reel, h.row, mult);
    e.home = h;
    h.entity = e;
    if (instant) {
      this.attachBadge(e).rest();
      this.attachClamps(e).lockNow();
    }
    return e;
  }

  /** The wild left the board (explode, fall-out, replaced): its displays free up once detached. */
  kill(e: WildEntity, undecorate: boolean): void {
    if (!e.alive) return;
    e.alive = false;
    if (undecorate) {
      if (e.badge) this.decorate(e, 'mult', null);
      if (e.clamps) this.decorate(e, 'clamp', null);
    }
    if (e.badge) e.badge.owner = null;
    if (e.clamps) e.clamps.owner = null;
    e.badge = null;
    e.clamps = null;
    if (e.home?.entity === e) e.home.entity = null;
    const i = this.entities.indexOf(e);
    if (i >= 0) this.entities.splice(i, 1);
  }

  /** Every tracked wild is gone (new round, board:set). */
  killAll(undecorate: boolean): void {
    for (const e of [...this.entities]) this.kill(e, undecorate);
  }

  // =========================================================================== decorations

  attachBadge(e: WildEntity): MultBadge {
    const b = e.badge ?? this.acquireBadge();
    b.owner = this.token;
    b.rest();
    b.setValue(e.mult);
    b.fit(this.ctx.layout.cell);
    e.badge = b;
    this.decorate(e, 'mult', b);
    return b;
  }

  attachClamps(e: WildEntity): StickyClamps {
    const c = e.clamps ?? this.acquireClamps();
    c.owner = this.token;
    c.rest();
    c.fit(this.ctx.layout.cell);
    e.clamps = c;
    this.decorate(e, 'clamp', c);
    return c;
  }

  /** Multiplier slam (DESIGN §8.1 +120): badge 2.2 -> 1 back.out(3), tier spark ring, wild_mult by tier. */
  slam(e: WildEntity): Promise<void> {
    if (!e.alive) return Promise.resolve();
    const b = this.attachBadge(e);
    const tier = multTier(e.mult).tier;
    const p = this.badgePoint(e);
    this.fx.sparks(p.x, p.y, physK(this.ctx.layout), LOOK.multSparks, multTier(e.mult).color, LOOK.multSparkMs);
    this.sfx('wild_mult', pentaRate(tier - 1));
    return b.play('slam');
  }

  /**
   * Sticky lock (DESIGN §8.1 +180 / §9.2.1): clamps snap in at f6 (`lock_snap`: sticky_lock
   * SFX, trauma 0.05, gold glints, the home marker fades in over homeMarkerIn).
   */
  lock(e: WildEntity): Promise<void> {
    if (!e.alive) return Promise.resolve();
    const c = this.attachClamps(e);
    return c.play('sticky_lock', () => {
      const L = this.ctx.layout;
      const p = slotPos(L, e.reel, e.row);
      this.sfx('sticky_lock');
      this.ctx.game.broadcast('fx:shake', { trauma: T.shake.stickyLock });
      this.fx.glints(p.x, p.y, L.cell, physK(L));
      const h = e.home;
      if (h && !h.marker.visible) h.marker.show(T.sticky.homeMarkerIn);
    });
  }

  /** Design-space centre of an entity's badge (the view may be popped / squashed: close enough). */
  badgePoint(e: WildEntity): { x: number; y: number } {
    const L = this.ctx.layout;
    const p = slotPos(L, e.reel, e.row);
    return { x: p.x, y: p.y + LOOK.badgeY * L.cell };
  }

  private decorate(e: WildEntity, key: string, display: Container | null): void {
    this.ctx.game.broadcast('board:decorate', { reel: e.reel, row: e.row, key, display });
  }

  private acquireBadge(): MultBadge {
    let b = this.badges.find((x) => x.owner === null && !x.parent);
    if (!b) {
      b = new MultBadge(this.art);
      this.badges.push(b);
    }
    return b;
  }

  private acquireClamps(): StickyClamps {
    let c = this.clampsPool.find((x) => x.owner === null && !x.parent);
    if (!c) {
      c = new StickyClamps(this.art);
      this.clampsPool.push(c);
    }
    return c;
  }

  // =========================================================================== homes

  /** New home: its marker fades in over `ms` (0 = at once, < 0 = stays hidden until the lock snap). */
  addHome(reel: number, row: number, mult: number, ms: number): Home {
    const key = `${reel},${row}`;
    let h = this.homes.get(key);
    if (h) return h;
    let marker = this.markers.find((m) => m.owner === null);
    if (!marker) {
      marker = new HomeMarker(this.art);
      this.markers.push(marker);
      this.markerLayer.addChild(marker);
    }
    marker.owner = this.token;
    marker.reel = reel;
    marker.row = row;
    this.placeMarker(marker, this.ctx.layout);
    if (ms >= 0) marker.show(ms);
    else marker.visible = false;
    h = { key, reel, row, mult, marker, entity: null, wonNow: false, wonLast: false };
    this.homes.set(key, h);
    return h;
  }

  removeHome(h: Home, ms: number): void {
    this.homes.delete(h.key);
    if (h.entity) h.entity.home = null;
    h.entity = null;
    const m = h.marker;
    m.hide(ms, () => {
      if (!this.isHomeMarker(m)) m.owner = null;
    });
    if (ms <= 0) m.owner = null;
  }

  /** Feature end / reset: every home goes (markers fade over `ms`). */
  clearHomes(ms: number): void {
    for (const h of [...this.homes.values()]) this.removeHome(h, ms);
  }

  /** Homes whose own wild stands on them (CR-10b hold set for the next fall-out). */
  holdCells(out: Array<Position & { id: string }>): Array<Position & { id: string }> {
    out.length = 0;
    for (const h of this.homes.values()) {
      const e = h.entity;
      if (e?.alive && e.reel === h.reel && e.row === h.row && e.badge?.parent) out.push({ reel: h.reel, row: h.row, id: WILD });
    }
    return out;
  }

  private isHomeMarker(m: HomeMarker): boolean {
    for (const h of this.homes.values()) if (h.marker === m) return true;
    return false;
  }

  // =========================================================================== layout / idle

  layout(L: LayoutSpec): void {
    for (const m of this.markers) if (m.owner) this.placeMarker(m, L);
    for (const b of this.badges) if (b.owner) b.fit(L.cell);
    for (const c of this.clampsPool) if (c.owner) c.fit(L.cell);
  }

  private placeMarker(m: HomeMarker, L: LayoutSpec): void {
    const p = slotPos(L, m.reel, m.row);
    m.fit(p.x, p.y, L.cell);
  }

  /** Sticky idle: badge heartbeat 1.0 -> 1.04 twice per 2 s (game time), when no clip runs. */
  heartbeat(timeMs: number): void {
    const period = LOOK.heartbeatPeriod;
    const ph = (timeMs % period) / period;
    const bump = (x: number): number => (x >= 0 && x < 0.12 ? Math.sin((Math.PI * x) / 0.12) : 0);
    const k = 1 + (LOOK.heartbeat - 1) * Math.max(bump(ph), bump(ph - 0.5));
    for (const e of this.entities) {
      if (!e.home || !e.badge) continue;
      e.badge.beat.scale.set(e.badge.clip?.isActive() ? 1 : k);
    }
  }

  private sfx(id: 'wild_mult' | 'sticky_lock', rate = 1): void {
    this.ctx.game.broadcast('sfx', { id, rate });
  }

  /** Drop every model entry (board:set, destroy); markers vanish at once. */
  reset(): void {
    this.sched.kill();
    this.killAll(false);
    this.clearHomes(0);
  }

  destroy(): void {
    this.reset();
    for (const b of this.badges) {
      b.removeFromParent();
      b.destroy();
    }
    for (const c of this.clampsPool) {
      c.removeFromParent();
      c.destroy();
    }
    this.markerLayer.destroy({ children: true });
  }
}
