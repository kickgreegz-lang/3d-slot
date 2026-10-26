import { gsap } from 'gsap';
import { BitmapText, Container, Sprite, type Texture } from 'pixi.js';
import type { Position } from '../../../book/types';
import { GRID, toSpotRow } from '../../../config/game';
import { cellCenter, type LayoutSpec } from '../../../config/layout';
import { clock } from '../../../core/clock';
import { followSpeed, s, stagger } from '../../../core/timing';
import { reducedMotion } from '../../../fx/motion';
import type { GameContext, GameModule } from '../../../game/context';
import { ensureAmountFont, ensureLabelFont, ensureValueFont } from '../../../present/common/fonts';
import { Plate } from '../../../present/common/Plate';
import { label } from '../../../present/common/text';
import type { LootItem, LootSource, LootTarget } from '../events';
import { HEIST_LAYOUT } from '../layout';
import { glowTexture, streakTexture, twinkleTexture } from '../scene/textures';
import { GOLD, GOLD_HOT, HEIST_TIMING, LOOT_COLOR } from '../timing';
import { glintTileTexture, loadLootArt } from './art';
import { LootView } from './LootView';

const G = HEIST_TIMING.glint;
const ST = HEIST_TIMING.star;
const LT = HEIST_TIMING.loot;
const key = (p: Position): number => p.reel * GRID.paddedRows + p.row;

interface Tile {
  view: Container;
  base: Sprite;
  shine: Sprite;
  on: boolean;
  reel: number;
  row: number;
  tween: gsap.core.Timeline | null;
}

interface TrailBit {
  sp: Sprite;
  life: number;
  max: number;
  vx: number;
  vy: number;
  size: number;
}

/**
 * GLINT — the heist's core read (DESIGN §5–§6). Owns:
 *  - the GLINT SQUARES (ctx.layers.tiles, behind the symbols): gold leaf gilds a cell when its winning
 *    symbol explodes (glint:add, synced to the Board's board:burst), shimmers in a slow wave across the
 *    board with twinkles, fades on glint:reset (or stays: Vault Raid / Starfall), restores instantly
 *    on glint:state;
 *  - the SHOOTING STAR: star:activate charges every star (rig win clip, halo, hit-stop, the board dims
 *    to the star and the squares); loot:reveal round 1 launches the comet from the star on a
 *    nearest-neighbour tour of the squares, every square flipping its loot as the comet passes; later
 *    rounds re-reveal in a wave out of the nests;
 *  - the LOOT (above the symbols): coins / diamonds / nests with live values; loot:boost fires a
 *    diamond's beams into its neighbours and rolls them up; loot:collect flies every coin into the nest
 *    in arcs; loot:payout streams every value into the LOOT plate at the board centre, punches it and
 *    sends it down to the win display.
 * Everything is game time (s(), followSpeed) so turbo and slam-stop retime it.
 */
export class Glint implements GameModule {
  private readonly tilesRoot = new Container({ label: 'glintTiles' });
  private readonly lootRoot = new Container({ label: 'loot' });
  private readonly flyRoot = new Container({ label: 'lootFly' });
  private readonly tiles = new Map<number, Tile>();
  private readonly items = new Map<number, LootView>();
  private pending: Position[] = [];
  private trail: TrailBit[] = [];
  private readonly trailPool: Sprite[] = [];
  private readonly twinkles: Array<{ sp: Sprite; life: number; max: number }> = [];
  private glow!: Texture;
  private twinkle!: Texture;
  private streak!: Texture;
  private valueFont = '';
  private labelFont = '';
  private amountFont = '';
  private readonly comet = new Container({ label: 'comet' });
  private cometHead!: Sprite;
  private cometStar!: Sprite;
  private cometOn = false;
  private trailAcc = 0;
  private readonly plate = new Container({ label: 'lootPlate' });
  private plateBg!: Plate;
  private plateLabel!: BitmapText;
  private plateAmount!: BitmapText;
  private readonly plateRoll = { v: 0 };
  private plateTween: gsap.core.Timeline | null = null;
  private time = 0;
  private twinkleAcc = 0;
  private stars: Position[] = [];
  /** base game (squares never outlive a round) vs a heist */
  private base = true;
  private offs: Array<() => void> = [];
  private calls = new Set<gsap.core.Tween>();

  constructor(private readonly ctx: GameContext) {}

  async init(): Promise<void> {
    const { ctx } = this;
    const r = ctx.app.renderer;
    await loadLootArt();
    this.glow = glowTexture();
    this.twinkle = twinkleTexture();
    this.streak = streakTexture();
    this.valueFont = ensureValueFont(r, ctx.money);
    this.labelFont = ensureLabelFont(r);
    this.amountFont = ensureAmountFont(r, ctx.money);
    ctx.layers.tiles.addChild(this.tilesRoot);
    ctx.layers.board.addChild(this.lootRoot);
    ctx.layers.fx.addChild(this.flyRoot);
    this.cometHead = new Sprite({ texture: this.glow, anchor: 0.5, blendMode: 'add', tint: GOLD_HOT });
    this.cometStar = new Sprite({ texture: ctx.art.symbol('R'), anchor: 0.5 });
    const cross = new Sprite({ texture: this.twinkle, anchor: 0.5, blendMode: 'add', tint: 0xffffff });
    cross.scale.set(1.4);
    this.comet.addChild(this.cometHead, cross, this.cometStar);
    this.comet.visible = false;
    this.flyRoot.addChild(this.comet);
    this.plateBg = new Plate(GOLD, 0.86, 'round');
    this.plateLabel = new BitmapText({ text: label('heist.loot', 'LOOT'), style: { fontFamily: this.labelFont, fontSize: 40 }, anchor: 0.5 });
    this.plateAmount = new BitmapText({ text: '', style: { fontFamily: this.amountFont, fontSize: 92 }, anchor: 0.5 });
    this.plateLabel.y = -52;
    this.plateAmount.y = 18;
    this.plate.addChild(this.plateBg, this.plateLabel, this.plateAmount);
    this.plate.visible = false;
    ctx.layers.overlay.addChild(this.plate);
    this.buildTiles(ctx.layout);

    const g = ctx.game;
    this.offs.push(
      g.on('layout:change', ({ layout }) => this.layout(layout)),
      g.on('round:start', () => this.onRoundStart()),
      g.on('round:end', () => this.flushGild(true)),
      g.on('glint:add', ({ added }) => {
        this.pending.push(...added);
      }),
      g.on('board:burst', () => this.flushGild(false)),
      g.on('glint:state', ({ squares }) => this.setSquares(squares)),
      g.on('glint:reset', ({ squares, keep }) => this.reset(squares, keep)),
      g.on('mode:change', ({ gameType }) => {
        this.base = gameType === 'basegame';
        if (this.base) this.setSquares([]);
      }),
      g.on('star:activate', ({ stars, squares }) => this.activate(stars, squares)),
      g.on('loot:reveal', ({ round, items }) => this.reveal(round, items)),
      g.on('loot:boost', (p) => this.boost(p.reel, p.row, p.mult, p.targets)),
      g.on('loot:collect', (p) => this.collect(p.reel, p.row, p.to, p.sources)),
      g.on('loot:payout', ({ amount, items }) => this.payout(amount, items)),
      clock.onUpdate((dt) => this.update(dt)),
    );
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.offs = [];
    for (const c of this.calls) c.kill();
    this.tilesRoot.destroy({ children: true });
    this.lootRoot.destroy({ children: true });
    this.flyRoot.destroy({ children: true });
    this.plate.destroy({ children: true });
  }

  // ======================================================================= geometry

  private at(p: Position): { x: number; y: number } {
    return cellCenter(this.ctx.layout, p.reel, toSpotRow(p.row));
  }

  private buildTiles(L: LayoutSpec): void {
    const tex = glintTileTexture(L.cell);
    for (let reel = 0; reel < GRID.reels; reel++) {
      for (let row = GRID.firstVisibleRow; row <= GRID.lastVisibleRow; row++) {
        const k = key({ reel, row });
        let t = this.tiles.get(k);
        if (!t) {
          const view = new Container({ label: `glint${reel},${row}` });
          const base = new Sprite({ texture: tex, anchor: 0.5 });
          const shine = new Sprite({ texture: tex, anchor: 0.5, blendMode: 'add', alpha: 0 });
          view.addChild(base, shine);
          view.visible = false;
          this.tilesRoot.addChild(view);
          t = { view, base, shine, on: false, reel, row, tween: null };
          this.tiles.set(k, t);
        }
        t.base.texture = tex;
        t.shine.texture = tex;
        const c = this.at({ reel, row });
        t.view.position.set(c.x, c.y);
        const sc = (L.cell * 1.02) / tex.width;
        t.base.scale.set(sc);
        t.shine.scale.set(sc);
      }
    }
  }

  layout(L: LayoutSpec): void {
    this.buildTiles(L);
    for (const [k, v] of this.items) {
      const p = { reel: Math.floor(k / GRID.paddedRows), row: k % GRID.paddedRows };
      const c = this.at(p);
      v.position.set(c.x, c.y);
      v.fit(L.cell);
    }
    this.placePlate();
  }

  private placePlate(): void {
    const X = HEIST_LAYOUT[this.ctx.layout.kind].lootPlate;
    this.plate.position.set(X.x, X.y);
    this.plateBg.resize(Math.max(420, this.plateAmount.width + 120), 190);
  }

  // ======================================================================= squares

  private onRoundStart(): void {
    this.pending = [];
    this.clearItems();
    // a new base round never inherits squares (a heist keeps them through its own spins)
    if (this.base) this.setSquares([]);
  }

  /** Gild what the last winInfo turned into squares (on the explode burst, or at once). */
  private flushGild(instant: boolean): void {
    if (!this.pending.length) return;
    const list = this.pending;
    this.pending = [];
    const fast = instant || reducedMotion();
    list.forEach((p, i) => {
      const t = this.tiles.get(key(p));
      if (!t || t.on) return;
      const delay = fast ? 0 : Math.min(G.gildStaggerCap, i * stagger(G.gildStagger));
      this.gild(t, s(delay));
    });
    if (list.length) this.ctx.game.broadcast('sfx', { id: 'spot_mark', rate: 1.15 });
  }

  private gild(t: Tile, delayS: number): void {
    t.tween?.kill();
    t.on = true;
    t.view.visible = true;
    t.view.alpha = 0;
    t.view.scale.set(0.55);
    t.shine.alpha = 1;
    const c = this.at(t);
    t.tween = gsap
      .timeline({ delay: delayS })
      .to(t.view, { alpha: 1, duration: s(G.gild * 0.35), ease: 'sine.out' }, 0)
      .to(t.view.scale, { x: 1, y: 1, duration: s(G.gild), ease: 'back.out(2.6)' }, 0)
      .to(t.shine, { alpha: 0, duration: s(G.gild * 1.4), ease: 'sine.out' }, s(G.gild * 0.3))
      .call(() => {
        this.ctx.game.broadcast('fx:burst', { kind: 'sparkle', x: c.x, y: c.y, color: GOLD_HOT, count: 6, power: 0.7 });
      }, [], s(G.gild * 0.2));
    followSpeed(t.tween);
  }

  /** Instant set (free-spin reveal, resume): exactly these squares are gold. */
  private setSquares(squares: readonly Position[]): void {
    const want = new Set(squares.map(key));
    for (const [k, t] of this.tiles) {
      const on = want.has(k);
      t.tween?.kill();
      t.tween = null;
      t.on = on;
      t.view.visible = on;
      t.view.alpha = 1;
      t.view.scale.set(1);
      t.shine.alpha = 0;
    }
  }

  private async reset(squares: readonly Position[], _keep: boolean): Promise<void> {
    this.flushGild(true);
    const stay = new Set(squares.map(key));
    const fade: Tile[] = [];
    for (const [k, t] of this.tiles) if (t.on && !stay.has(k)) fade.push(t);
    // the loot is gone by now (payout); any left fades with the squares
    this.clearItems(true);
    if (!fade.length) return;
    fade.forEach((t, i) => {
      t.on = false;
      t.tween?.kill();
      t.tween = followSpeed(
        gsap
          .timeline({ delay: s(Math.min(300, i * stagger(G.resetStagger))) })
          .to(t.view, { alpha: 0, duration: s(G.reset), ease: 'sine.in' }, 0)
          .to(t.view.scale, { x: 0.7, y: 0.7, duration: s(G.reset), ease: 'back.in(2)' }, 0)
          .call(() => void (t.view.visible = false)),
      );
    });
    await clock.wait(G.reset * 0.6);
  }

  // ======================================================================= the star

  private async activate(stars: Position[], squares: Position[]): Promise<void> {
    const { ctx } = this;
    this.flushGild(true);
    this.stars = stars;
    ctx.game.broadcast('board:focus', { cells: [...stars], tint: 0x8a8aa8 });
    ctx.game.broadcast('mascot:cue', { cue: 'celebrate', intensity: 0.8 });
    ctx.game.broadcast('sfx', { id: 'scatter_land_3', rate: 1.25 });
    for (const st of stars) {
      ctx.game.broadcast('board:play', { reel: st.reel, row: st.row, clip: 'win', next: 'win_loop' });
      const c = this.at(st);
      const halo = new Sprite({ texture: this.glow, anchor: 0.5, blendMode: 'add', tint: GOLD_HOT, alpha: 0 });
      halo.position.set(c.x, c.y);
      this.flyRoot.addChild(halo);
      const cell = ctx.layout.cell;
      followSpeed(
        gsap
          .timeline({ onComplete: () => halo.destroy() })
          .to(halo, { alpha: 1, duration: s(ST.charge * 0.6), ease: 'sine.in' }, 0)
          .fromTo(halo.scale, { x: 0.2, y: 0.2 }, { x: (cell * 3.2) / 256, y: (cell * 3.2) / 256, duration: s(ST.charge), ease: 'power2.in' }, 0)
          .to(halo, { alpha: 0, duration: s(260) }, s(ST.charge)),
      );
      ctx.game.broadcast('fx:burst', { kind: 'sparkle', x: c.x, y: c.y, color: 0xfff2b0, count: 14, power: 1 });
    }
    // every square answers: a bright pulse wave
    squares.forEach((p, i) => {
      const t = this.tiles.get(key(p));
      if (!t) return;
      followSpeed(gsap.fromTo(t.shine, { alpha: 0 }, { alpha: 0.9, duration: s(160), delay: s(i * stagger(18)), yoyo: true, repeat: 1, ease: 'sine.inOut' }));
    });
    await clock.wait(ST.charge);
    clock.hitStop(ST.launchHitStop);
    ctx.game.broadcast('fx:shake', { trauma: 0.28 });
    ctx.game.broadcast('fx:flash', { color: 0xfff0b0, alpha: 0.18, durationMs: 160 });
  }

  /** Nearest-neighbour tour of the squares from `from` (stable, deterministic). */
  private tour(from: Position, cells: Position[]): Position[] {
    const left = [...cells];
    const out: Position[] = [];
    let cur = from;
    while (left.length) {
      let best = 0;
      let bd = Infinity;
      left.forEach((p, i) => {
        const d = (p.reel - cur.reel) ** 2 + (p.row - cur.row) ** 2 + p.row * 1e-3;
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      cur = left.splice(best, 1)[0];
      out.push(cur);
    }
    return out;
  }

  private async reveal(round: number, items: LootItem[]): Promise<void> {
    if (!items.length) return;
    const { ctx } = this;
    const L = ctx.layout;
    const byKey = new Map(items.map((it) => [key(it), it]));
    if (round === 1) {
      const from = this.stars[0] ?? items[0];
      const path = this.tour(from, items);
      const legs = path.length;
      const leg = Math.max(ST.legMin, ST.legMs - legs * 2);
      // the comet leaves the star
      const start = this.at(from);
      this.comet.position.set(start.x, start.y);
      this.comet.visible = true;
      this.comet.scale.set(0.3);
      this.cometHead.scale.set((L.cell * 1.6) / 256);
      this.cometStar.scale.set((L.cell * 0.42) / 180);
      this.cometOn = true;
      ctx.game.broadcast('sfx', { id: 'anticipation_end', rate: 1.4 });
      const tl = gsap.timeline();
      tl.to(this.comet.scale, { x: 1, y: 1, duration: s(ST.firstLeg * 0.6), ease: 'back.out(2)' }, 0);
      let t = 0;
      path.forEach((p, i) => {
        const c = this.at(p);
        const d = i === 0 ? ST.firstLeg : leg;
        tl.to(this.comet, { x: c.x, y: c.y, duration: s(d), ease: i === 0 ? 'power2.in' : 'sine.inOut' }, s(t));
        t += d;
        const it = byKey.get(key(p));
        tl.call(() => {
          if (it) this.spawnItem(it, 0);
          ctx.game.broadcast('fx:burst', { kind: 'sparkle', x: c.x, y: c.y, color: GOLD_HOT, count: 8, power: 0.9 });
          ctx.game.broadcast('sfx', { id: 'counter_tick', rate: 1 + Math.min(i, 16) * 0.05 });
        }, [], s(t));
      });
      tl.to(this.comet.scale, { x: 0, y: 0, duration: s(220), ease: 'back.in(2)' }, s(t + 60));
      tl.call(() => {
        this.comet.visible = false;
        this.cometOn = false;
      });
      followSpeed(tl);
      await clock.wait(t + 300 + LT.settle);
      return;
    }
    // re-reveal: a wave out of the nests (or the centre)
    const nests = [...this.items.entries()].filter(([, v]) => v.kind === 'nest').map(([k]) => ({ reel: Math.floor(k / GRID.paddedRows), row: k % GRID.paddedRows }));
    const origin = nests[0] ?? items[0];
    const order = [...items].sort((a, b) => Math.hypot(a.reel - origin.reel, a.row - origin.row) - Math.hypot(b.reel - origin.reel, b.row - origin.row));
    for (const n of nests) {
      const c = this.at(n);
      ctx.game.broadcast('fx:burst', { kind: 'sparkle', x: c.x, y: c.y, color: LOOT_COLOR.nest, count: 16, power: 1.2 });
      this.items.get(key(n))?.punch(1.25, 260);
    }
    ctx.game.broadcast('sfx', { id: 'spot_upgrade', rate: 1.2 });
    order.forEach((it, i) => {
      const t = this.tiles.get(key(it));
      if (t) followSpeed(gsap.fromTo(t.shine, { alpha: 0 }, { alpha: 0.8, duration: s(120), delay: s(i * stagger(LT.rerevealStagger)), yoyo: true, repeat: 1 }));
      this.spawnItem(it, s(80 + i * stagger(LT.rerevealStagger)));
    });
    await clock.wait(80 + order.length * stagger(LT.rerevealStagger) + LT.flip + LT.settle);
  }

  private spawnItem(it: LootItem, delayS: number): LootView {
    const L = this.ctx.layout;
    const k = key(it);
    this.items.get(k)?.destroy();
    const v = new LootView(it, this.glow, this.valueFont, (book) => this.ctx.money.format(this.ctx.money.fromBook(book)));
    v.fit(L.cell);
    const c = this.at(it);
    v.position.set(c.x, c.y);
    this.lootRoot.addChild(v);
    this.items.set(k, v);
    v.flipIn(delayS, LT.flip);
    if (v.kind === 'gold' || v.kind === 'diamond' || v.kind === 'nest') {
      followSpeed(
        gsap.delayedCall(delayS + s(LT.flip * 0.5), () => {
          this.ctx.game.broadcast('fx:burst', { kind: v.kind === 'nest' ? 'coins' : 'sparkle', x: c.x, y: c.y, color: LOOT_COLOR[v.kind], count: 14, power: 1.1 });
          this.ctx.game.broadcast('fx:shake', { trauma: 0.12 });
        }),
      );
    }
    return v;
  }

  // ======================================================================= diamonds

  private async boost(reel: number, row: number, mult: number, targets: LootTarget[]): Promise<void> {
    const { ctx } = this;
    const d = this.items.get(key({ reel, row }));
    const c = this.at({ reel, row });
    d?.punch(1.35, LT.boostCharge);
    ctx.game.broadcast('sfx', { id: 'spot_upgrade', rate: 0.9 + Math.min(mult, 10) * 0.04 });
    ctx.game.broadcast('fx:burst', { kind: 'sparkle', x: c.x, y: c.y, color: LOOT_COLOR.diamond, count: 18, power: 1.2 });
    await clock.wait(LT.boostCharge * 0.6);
    for (const tg of targets) {
      const tc = this.at(tg);
      const beam = new Sprite({ texture: this.streak, anchor: { x: 0.5, y: 0 }, blendMode: 'add', tint: LOOT_COLOR.diamond });
      beam.position.set(c.x, c.y);
      beam.rotation = Math.atan2(tc.y - c.y, tc.x - c.x) - Math.PI / 2;
      beam.width = this.ctx.layout.cell * 0.3;
      beam.height = 0;
      this.flyRoot.addChild(beam);
      const len = Math.hypot(tc.x - c.x, tc.y - c.y);
      followSpeed(
        gsap
          .timeline({ onComplete: () => beam.destroy() })
          .to(beam, { height: len, duration: s(LT.boostBeam * 0.5), ease: 'power3.out' })
          .call(() => {
            const v = this.items.get(key(tg));
            v?.rollTo(tg.to, LT.boostRoll);
            ctx.game.broadcast('fx:burst', { kind: 'sparkle', x: tc.x, y: tc.y, color: LOOT_COLOR.diamond, count: 10, power: 1 });
            this.floatText(`×${mult}`, tc.x, tc.y - this.ctx.layout.cell * 0.32, LOOT_COLOR.diamond);
          })
          .to(beam, { alpha: 0, duration: s(LT.boostBeam), ease: 'sine.in' }),
      );
    }
    if (targets.length) ctx.game.broadcast('fx:shake', { trauma: 0.18 });
    await clock.wait(LT.boostBeam * 0.5 + LT.boostRoll + LT.boostPause);
    // the spent diamond shatters into sparkles and leaves its square
    if (d) {
      ctx.game.broadcast('fx:burst', { kind: 'explode', x: c.x, y: c.y, color: LOOT_COLOR.diamond, count: 0, power: 0.5, light: 0.6 });
      const t = d.fadeOut(220);
      t.eventCallback('onComplete', () => d.destroy());
      this.items.delete(key({ reel, row }));
    }
  }

  private floatText(text: string, x: number, y: number, tint: number): void {
    const t = new BitmapText({ text, style: { fontFamily: this.valueFont, fontSize: Math.round(this.ctx.layout.cell * 0.28) }, anchor: 0.5 });
    t.tint = tint;
    t.position.set(x, y);
    t.scale.set(0.4);
    this.flyRoot.addChild(t);
    followSpeed(
      gsap
        .timeline({ onComplete: () => t.destroy() })
        .to(t.scale, { x: 1.2, y: 1.2, duration: s(160), ease: 'back.out(3)' })
        .to(t, { y: y - this.ctx.layout.cell * 0.3, alpha: 0, duration: s(520), ease: 'sine.in' }, s(220)),
    );
  }

  // ======================================================================= nests

  private async collect(reel: number, row: number, to: number, sources: LootSource[]): Promise<void> {
    const { ctx } = this;
    const nk = key({ reel, row });
    const nest = this.items.get(nk);
    const nc = this.at({ reel, row });
    nest?.punch(1.3, LT.nestPunch);
    ctx.game.broadcast('mascot:cue', { cue: 'reactTumble', intensity: 0.8 });
    ctx.game.broadcast('sfx', { id: 'spot_upgrade', rate: 0.8 });
    await clock.wait(LT.nestPunch);
    let acc = nest?.value ?? 0;
    const flight = LT.collectFlight;
    const n = sources.length;
    for (let i = 0; i < n; i++) {
      const src = sources[i];
      const v = this.items.get(key(src));
      if (!v) continue;
      const delay = Math.min(LT.collectStaggerCap, i * stagger(LT.collectStagger));
      const from = this.at(src);
      // a copy of the coin flies (the original drains to the nest) in an arc
      const fly = new Sprite({ texture: v.art.texture, anchor: 0.5 });
      fly.scale.copyFrom(v.art.scale);
      fly.position.set(from.x, from.y);
      fly.visible = false;
      this.flyRoot.addChild(fly);
      const lift = Math.min(260, 60 + Math.hypot(nc.x - from.x, nc.y - from.y) * 0.35);
      const mid = { x: (from.x + nc.x) / 2, y: Math.min(from.y, nc.y) - lift };
      const p = { t: 0 };
      const value = src.value;
      followSpeed(
        gsap.to(p, {
          t: 1,
          duration: s(flight),
          delay: s(delay),
          ease: 'power1.in',
          onStart: () => {
            fly.visible = true;
            v.fadeOut(140);
          },
          onUpdate: () => {
            const u = p.t;
            const x = (1 - u) ** 2 * from.x + 2 * (1 - u) * u * mid.x + u * u * nc.x;
            const y = (1 - u) ** 2 * from.y + 2 * (1 - u) * u * mid.y + u * u * nc.y;
            fly.position.set(x, y);
            fly.rotation = u * 6;
            fly.scale.set(v.art.scale.x * (1 - u * 0.55));
            this.emitTrail(x, y, LOOT_COLOR[v.kind], 0.5);
          },
          onComplete: () => {
            fly.destroy();
            acc += value;
            nest?.rollTo(Math.min(acc, to), 160);
            nest?.gulp();
            ctx.game.broadcast('sfx', { id: 'counter_tick', rate: 1.1 + Math.min(i, 12) * 0.06 });
            ctx.game.broadcast('fx:burst', { kind: 'coins', x: nc.x, y: nc.y, count: 3, power: 0.6 });
          },
        }),
      );
    }
    await clock.wait(Math.min(LT.collectStaggerCap, (n - 1) * stagger(LT.collectStagger)) + flight + 200);
    // the collected coins leave their squares
    for (const src of sources) {
      const k = key(src);
      const v = this.items.get(k);
      if (v && v.kind !== 'nest') {
        v.destroy();
        this.items.delete(k);
      }
    }
    if (nest && nest.value !== to) nest.rollTo(to, 120);
    nest?.punch(1.35, 300);
    ctx.game.broadcast('fx:shake', { trauma: 0.22 });
    ctx.game.broadcast('fx:burst', { kind: 'coins', x: nc.x, y: nc.y, count: 16, power: 1.2 });
    await clock.wait(LT.nestPause);
  }

  // ======================================================================= payout

  private async payout(amount: number, items: LootSource[]): Promise<void> {
    const { ctx } = this;
    const money = ctx.money;
    this.plateRoll.v = 0;
    this.plateAmount.text = money.format(0);
    this.placePlate();
    this.plate.visible = true;
    this.plate.alpha = 1;
    this.plate.scale.set(0);
    this.plateTween?.kill();
    this.plateTween = followSpeed(gsap.timeline().to(this.plate.scale, { x: 1, y: 1, duration: s(320), ease: 'back.out(2.2)' }));
    ctx.game.broadcast('sfx', { id: 'win_cluster', rate: 1.1 });
    const X = HEIST_LAYOUT[ctx.layout.kind].lootPlate;
    let acc = 0;
    const n = items.length;
    items.forEach((it, i) => {
      const v = this.items.get(key(it));
      const from = this.at(it);
      const delay = 200 + Math.min(LT.payStaggerCap, i * stagger(LT.payStagger));
      const fly = new Sprite({ texture: v?.art.texture ?? this.glow, anchor: 0.5 });
      fly.scale.set((v?.art.scale.x ?? 0.5) * 0.75);
      fly.position.set(from.x, from.y);
      fly.visible = false;
      this.flyRoot.addChild(fly);
      const p = { t: 0 };
      const mid = { x: (from.x + X.x) / 2 + (from.x < X.x ? -60 : 60), y: Math.min(from.y, X.y) - 120 };
      followSpeed(
        gsap.to(p, {
          t: 1,
          duration: s(LT.payFlight),
          delay: s(delay),
          ease: 'power2.in',
          onStart: () => {
            fly.visible = true;
            v?.punch(1.25, 160);
          },
          onUpdate: () => {
            const u = p.t;
            fly.position.set((1 - u) ** 2 * from.x + 2 * (1 - u) * u * mid.x + u * u * X.x, (1 - u) ** 2 * from.y + 2 * (1 - u) * u * mid.y + u * u * X.y);
            this.emitTrail(fly.x, fly.y, v ? LOOT_COLOR[v.kind] : GOLD, 0.55);
          },
          onComplete: () => {
            fly.destroy();
            acc += it.value;
            const target = i === n - 1 ? amount : Math.min(acc, amount);
            this.rollPlate(target);
            ctx.game.broadcast('sfx', { id: 'counter_tick', rate: 1.2 + Math.min(i, 14) * 0.05 });
          },
        }),
      );
      // the paid loot leaves the board after its value flew
      if (v) {
        const t = v.fadeOut(240, s(delay + 120));
        t.eventCallback('onComplete', () => v.destroy());
        this.items.delete(key(it));
      }
    });
    const land = 200 + Math.min(LT.payStaggerCap, (n - 1) * stagger(LT.payStagger)) + LT.payFlight;
    await clock.wait(land + 80);
    this.plateAmount.text = money.format(money.fromBook(amount));
    this.placePlate();
    ctx.game.broadcast('sfx', { id: 'counter_end' });
    ctx.game.broadcast('fx:burst', { kind: 'coins', x: X.x, y: X.y, count: 26, power: 1.3 });
    ctx.game.broadcast('fx:shake', { trauma: 0.3 });
    ctx.game.broadcast('mascot:cue', { cue: amount >= 2000 ? 'winBig' : 'reactSmall', intensity: Math.min(1, amount / 5000 + 0.3) });
    this.plateTween?.kill();
    this.plateTween = followSpeed(
      gsap
        .timeline()
        .to(this.plate.scale, { x: 1.25, y: 1.25, duration: s(120), ease: 'power2.out' })
        .to(this.plate.scale, { x: 1, y: 1, duration: s(420), ease: 'elastic.out(1, 0.45)' }),
    );
    await clock.wait(LT.plateHold);
    // the plate drops into the win display
    const W = HEIST_LAYOUT[ctx.layout.kind].winTarget;
    this.plateTween?.kill();
    this.plateTween = followSpeed(
      gsap
        .timeline({ onComplete: () => void (this.plate.visible = false) })
        .to(this.plate, { x: W.x, y: W.y, duration: s(380), ease: 'power2.in' }, 0)
        .to(this.plate.scale, { x: 0.3, y: 0.3, duration: s(380), ease: 'power2.in' }, 0)
        .to(this.plate, { alpha: 0, duration: s(120) }, s(300)),
    );
    await clock.wait(320);
    ctx.game.broadcast('board:focus', { cells: null });
    for (const st of this.stars) ctx.game.broadcast('board:play', { reel: st.reel, row: st.row, clip: 'idle' });
    this.stars = [];
  }

  private rollPlate(to: number): void {
    const money = this.ctx.money;
    gsap.killTweensOf(this.plateRoll);
    followSpeed(
      gsap.to(this.plateRoll, {
        v: to,
        duration: s(180),
        ease: 'power1.out',
        onUpdate: () => {
          this.plateAmount.text = money.format(money.fromBook(Math.round(this.plateRoll.v)));
          this.placePlate();
        },
      }),
    );
    this.plateAmount.scale.set(1.12);
    followSpeed(gsap.to(this.plateAmount.scale, { x: 1, y: 1, duration: s(200), ease: 'back.out(3)' }));
  }

  private clearItems(fade = false): void {
    for (const v of this.items.values()) {
      if (fade) {
        const t = v.fadeOut(200);
        t.eventCallback('onComplete', () => v.destroy());
      } else v.destroy();
    }
    this.items.clear();
  }

  // ======================================================================= frame

  private emitTrail(x: number, y: number, tint: number, size: number): void {
    const sp = this.trailPool.pop() ?? new Sprite({ texture: this.glow, anchor: 0.5, blendMode: 'add' });
    sp.tint = tint;
    sp.position.set(x, y);
    sp.alpha = 0.9;
    sp.visible = true;
    this.flyRoot.addChildAt(sp, 0);
    const max = (ST.trailLife / 1000) * (0.7 + Math.random() * 0.6);
    this.trail.push({ sp, life: 0, max, vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 40, size: (this.ctx.layout.cell * size) / 256 });
  }

  private update(dt: number): void {
    this.time += dt;
    const t = this.time;
    const calm = reducedMotion() ? 0 : 1;
    // shimmer wave across the gold
    for (const tile of this.tiles.values()) {
      if (!tile.on || tile.tween?.isActive()) continue;
      const ph = t * ((Math.PI * 2) / G.shimmerPeriod) - (tile.reel * 0.55 + tile.row * 0.35);
      tile.shine.alpha = calm * 0.45 * Math.max(0, Math.sin(ph)) ** 10;
    }
    // twinkles on random gold squares
    this.twinkleAcc += dt;
    const lit = [...this.tiles.values()].filter((x) => x.on);
    if (calm && lit.length && this.twinkleAcc > 0.18) {
      this.twinkleAcc = 0;
      const tile = lit[Math.floor(Math.random() * lit.length)];
      const cell = this.ctx.layout.cell;
      const sp = new Sprite({ texture: this.twinkle, anchor: 0.5, blendMode: 'add', tint: 0xfff6d0 });
      sp.position.set(tile.view.x + (Math.random() - 0.5) * cell * 0.8, tile.view.y + (Math.random() - 0.5) * cell * 0.8);
      sp.scale.set(0);
      this.tilesRoot.addChild(sp);
      this.twinkles.push({ sp, life: 0, max: 0.55 });
    }
    for (let i = this.twinkles.length - 1; i >= 0; i--) {
      const w = this.twinkles[i];
      w.life += dt;
      const u = w.life / w.max;
      if (u >= 1) {
        w.sp.destroy();
        this.twinkles.splice(i, 1);
        continue;
      }
      const k = Math.sin(u * Math.PI) * (this.ctx.layout.cell * 0.32) / 128;
      w.sp.scale.set(k);
      w.sp.rotation = u * 1.2;
    }
    // loot idle life
    for (const [k, v] of this.items) v.idle(t, k * 0.7);
    // comet trail
    if (this.cometOn) {
      this.trailAcc += dt * 1000;
      while (this.trailAcc > ST.trailEvery) {
        this.trailAcc -= ST.trailEvery;
        this.emitTrail(this.comet.x, this.comet.y, Math.random() < 0.5 ? GOLD_HOT : 0xc9a2ff, 0.9);
      }
      this.cometStar.rotation += dt * 7;
    }
    for (let i = this.trail.length - 1; i >= 0; i--) {
      const b = this.trail[i];
      b.life += dt;
      const u = b.life / b.max;
      if (u >= 1) {
        b.sp.visible = false;
        b.sp.removeFromParent();
        this.trailPool.push(b.sp);
        this.trail.splice(i, 1);
        continue;
      }
      b.sp.x += b.vx * dt;
      b.sp.y += b.vy * dt;
      b.sp.alpha = 0.9 * (1 - u);
      b.sp.scale.set(b.size * (1 - u * 0.7));
    }
  }
}
