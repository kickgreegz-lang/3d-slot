import { gsap } from 'gsap';
import { BitmapFont, BitmapText, Container, Sprite } from 'pixi.js';
import { FONTS } from '../assets/fonts';
import type { Position } from '../book/types';
import { GRID, SPOT_BANDS, isVisibleRow, spotTier, toSpotRow } from '../config/game';
import { type LayoutSpec, cellCenter } from '../config/layout';
import { TIMING, s, sUi, stagger } from '../core/timing';
import type { GameContext } from '../game/context';
import { BOARD_TIMING } from './boardTiming';
import { type SpotTier, overlayTexture, tileTexture } from './tileArt';

/**
 * Tiles + multiplier spots. One rounded heat-tier tile per visible cell (layer
 * `tiles`) and its "x" + value BitmapTexts (layer `spotText`, BEHIND the symbols,
 * spilling slightly past the tile like the reference). Values are UNPADDED
 * [reel][visibleRow]; any integer maps to a tier through config SPOT_BANDS.
 *
 *  - update(grid): animates ONLY cells whose value changed
 *      0 -> n   payframe ignite (scale-in + glow ring + spark), then roll if n > 1
 *      n -> m   number roll through intermediate values + punch (+ flash on tier change)
 *  - reset(grid): sets everything without fanfare
 *  - highlight(): additive glow on winning cells (cleared by the Board on tumble)
 */
const FONT = 'BoardSpot';
const FONT_INSTALL_SIZE = 84;
/**
 * Number layout (fractions of the cell): "x" hugs the tile's left edge and the value its
 * right edge, both INSIDE the tile, so they peek out either side of the symbol (reference
 * look) and never pair up with a neighbour's glyphs across the seam.
 */
const NUM_SIZE = 0.46;
const X_SIZE = 0.34;
const NUM_INSET = 0.045;

const TIER_TEXT: Record<SpotTier, [number, number]> = {
  0: [0xffffff, 0xffffff],
  1: [0xffffff, 0xffffff],
  2: [0x67400d, 0x833206],
  3: [0xb02800, 0xb02800],
  4: [0xffcc00, 0xffcc00],
  5: [0xffcc00, 0xffe14a],
};
/** Additive flash colour when a cell ENTERS a tier. */
const TIER_FLASH: Record<SpotTier, number> = {
  0: 0xffffff,
  1: 0x7ff8ee,
  2: 0xffa04a,
  3: 0xff6a3a,
  4: 0xffb050,
  5: 0xffffc8,
};

/** Ambient heat shimmer for T4 / T5 tiles (alpha range + period in ms). */
const HEAT = [
  { color: 0xff6a20, lo: 0.04, hi: 0.2, period: 1500 },
  { color: 0xffa030, lo: 0.1, hi: 0.36, period: 1100 },
] as const;

const lerpColor = (a: number, b: number, t: number): number => {
  const ch = (sh: number) => {
    const x = (a >> sh) & 0xff;
    const y = (b >> sh) & 0xff;
    return Math.round(x + (y - x) * t) << sh;
  };
  return ch(16) | ch(8) | ch(0);
};

/** Text tint for a value inside its tier band (T2 ramps #67400d -> #833206). */
const textTint = (value: number): number => {
  const tier = spotTier(value);
  const [a, b] = TIER_TEXT[tier];
  const idx = SPOT_BANDS.findIndex((band) => band.tier === tier);
  const lo = SPOT_BANDS[idx]?.min ?? value;
  const hi = (SPOT_BANDS[idx + 1]?.min ?? lo + 1) - 1;
  const t = hi > lo ? Math.min(1, (value - lo) / (hi - lo)) : 0;
  return lerpColor(a, b, t);
};

interface SpotCell {
  reel: number;
  row: number;
  tile: Sprite;
  /** additive inner glow breathing on hot (T4+) tiles; level 0 off, 1 hot, 2 blazing */
  heat: Sprite;
  heatLevel: number;
  fx: Sprite;
  wash: Sprite;
  num: Container;
  xText: BitmapText;
  vText: BitmapText;
  value: number;
  tl: gsap.core.Timeline | null;
}

export class SpotGrid {
  private readonly tileRoot = new Container({ label: 'spotTiles' });
  private readonly heatRoot = new Container({ label: 'spotHeat' });
  private readonly washRoot = new Container({ label: 'spotWash' });
  private readonly fxRoot = new Container({ label: 'spotFx' });
  private readonly textRoot = new Container({ label: 'spotNumbers' });
  private readonly cells: SpotCell[][] = [];
  private readonly res: number;
  private cell = 0;

  constructor(private ctx: GameContext) {
    this.res = ctx.tier === 'low' ? 1 : 2;
    BitmapFont.install({
      name: FONT,
      style: {
        fontFamily: FONTS.royal,
        fontSize: FONT_INSTALL_SIZE,
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 10, join: 'round' },
      },
      chars: [['0', '9'], 'x'],
      resolution: this.res,
      padding: 6,
    });
    ctx.layers.tiles.addChild(this.tileRoot, this.heatRoot, this.washRoot, this.fxRoot);
    ctx.layers.spotText.addChild(this.textRoot);

    for (let reel = 0; reel < GRID.reels; reel++) {
      const col: SpotCell[] = [];
      for (let row = 0; row < GRID.rows; row++) {
        const tile = new Sprite();
        tile.anchor.set(0.5);
        const heat = new Sprite();
        heat.anchor.set(0.5);
        heat.blendMode = 'add';
        heat.alpha = 0;
        const wash = new Sprite();
        wash.anchor.set(0.5);
        wash.blendMode = 'add';
        wash.alpha = 0;
        const fx = new Sprite();
        fx.anchor.set(0.5);
        fx.blendMode = 'add';
        fx.alpha = 0;
        const num = new Container({ label: `spot${reel}${row}` });
        const xText = new BitmapText({ text: 'x', style: { fontFamily: FONT, fontSize: 60 } });
        xText.anchor.set(0, 0.5);
        const vText = new BitmapText({ text: '2', style: { fontFamily: FONT, fontSize: 60 } });
        vText.anchor.set(1, 0.5);
        num.addChild(xText, vText);
        num.visible = false;
        this.tileRoot.addChild(tile);
        this.heatRoot.addChild(heat);
        this.washRoot.addChild(wash);
        this.fxRoot.addChild(fx);
        this.textRoot.addChild(num);
        col.push({ reel, row, tile, heat, heatLevel: 0, fx, wash, num, xText, vText, value: 0, tl: null });
      }
      this.cells.push(col);
    }
    this.layout(ctx.layout);
  }

  /** Current values (unpadded [reel][row]). */
  get values(): number[][] {
    return this.cells.map((col) => col.map((c) => c.value));
  }

  layout(L: LayoutSpec): void {
    this.cell = L.cell;
    const fontSize = L.cell * NUM_SIZE;
    const edge = L.cell / 2 - L.cell * NUM_INSET;
    for (const col of this.cells) {
      for (const c of col) {
        const p = cellCenter(L, c.reel, c.row);
        c.tile.position.set(p.x, p.y);
        c.heat.position.set(p.x, p.y);
        c.heat.texture = overlayTexture('wash', L.cell, this.res);
        c.wash.position.set(p.x, p.y);
        c.fx.position.set(p.x, p.y);
        c.num.position.set(p.x, p.y + L.cell * 0.01);
        c.xText.style.fontSize = L.cell * X_SIZE;
        c.vText.style.fontSize = fontSize;
        c.xText.y = L.cell * 0.035;
        c.xText.x = -edge;
        c.vText.x = edge;
        c.wash.texture = overlayTexture('wash', L.cell, this.res);
        this.applyValue(c, c.value);
      }
    }
  }

  /** Instant set (mode change / resume / new round). null => all empty. */
  reset(grid: number[][] | null): void {
    for (const col of this.cells) {
      for (const c of col) {
        this.kill(c);
        this.applyValue(c, grid?.[c.reel]?.[c.row] ?? 0);
        c.fx.alpha = 0;
      }
    }
  }

  /** Animate every cell whose value differs from what is displayed. */
  async update(grid: number[][]): Promise<void> {
    const changes: { c: SpotCell; from: number; to: number }[] = [];
    for (let row = 0; row < GRID.rows; row++) {
      for (let reel = 0; reel < GRID.reels; reel++) {
        const c = this.cells[reel][row];
        const to = grid[reel]?.[row] ?? 0;
        if (to !== c.value) changes.push({ c, from: c.value, to });
      }
    }
    if (!changes.length) return;

    let marks = 0;
    let upgrades = 0;
    const jobs: Promise<void>[] = [];
    const gap = Math.min(BOARD_TIMING.spotStagger, BOARD_TIMING.spotStaggerMax / Math.max(1, changes.length - 1));
    changes.forEach(({ c, from, to }, i) => {
      const delay = i * stagger(gap);
      if (to <= 0 || to < from) {
        this.kill(c);
        this.applyValue(c, to);
        return;
      }
      if (from === 0) marks++;
      if (to > 1 && to > Math.max(1, from)) upgrades++;
      jobs.push(this.animateCell(c, from, to, delay));
    });

    if (marks) this.ctx.game.broadcast('sfx', { id: 'spot_mark', volume: Math.min(1, 0.6 + marks * 0.08) });
    if (upgrades) {
      this.ctx.game.broadcast('sfx', { id: 'spot_upgrade', delayMs: marks ? TIMING.spots.markDuration : 0 });
      this.ctx.game.broadcast('mascot:cue', { cue: 'spotUpgrade', intensity: Math.min(1, upgrades / 6) });
    }
    await Promise.all(jobs);
  }

  /** Additive glow on winning cells (padded positions), tinted with the cluster colour. */
  highlight(positions: Position[], color: number): void {
    for (const p of positions) {
      if (!isVisibleRow(p.row)) continue;
      const c = this.cells[p.reel]?.[toSpotRow(p.row)];
      if (!c) continue;
      c.wash.tint = color;
      gsap.to(c.wash, { alpha: 0.5, duration: s(BOARD_TIMING.tileHighlightIn), ease: 'power1.out', overwrite: true });
    }
  }

  clearHighlights(animate = true): void {
    for (const col of this.cells) {
      for (const c of col) {
        if (c.wash.alpha === 0) continue;
        if (animate) {
          gsap.to(c.wash, { alpha: 0, duration: s(BOARD_TIMING.tileHighlightOut), ease: 'power1.in', overwrite: true });
        } else {
          gsap.killTweensOf(c.wash);
          c.wash.alpha = 0;
        }
      }
    }
  }

  /** Column glow used by the Board's anticipation beam (0 = off). */
  setColumnWash(reel: number, color: number, alpha: number, durationMs: number): void {
    for (const c of this.cells[reel] ?? []) {
      c.wash.tint = color;
      gsap.to(c.wash, { alpha, duration: s(durationMs), ease: 'sine.inOut', overwrite: true });
    }
  }

  destroy(): void {
    for (const col of this.cells) {
      for (const c of col) {
        this.kill(c);
        gsap.killTweensOf(c.heat);
      }
    }
    this.tileRoot.destroy({ children: true });
    this.heatRoot.destroy({ children: true });
    this.washRoot.destroy({ children: true });
    this.fxRoot.destroy({ children: true });
    this.textRoot.destroy({ children: true });
  }

  // -------------------------------------------------------------------------

  /** Stop a running cell animation and snap to its final static state. */
  private kill(c: SpotCell): void {
    if (!c.tl) return;
    c.tl.kill();
    c.tl = null;
    c.tile.scale.set(1);
    c.num.scale.set(1);
    c.num.alpha = 1;
    c.fx.alpha = 0;
    this.applyValue(c, c.value);
  }

  /** Static skin for a value (texture, number text, tint, visibility). */
  private applyValue(c: SpotCell, value: number): void {
    c.value = value;
    const tier = spotTier(value);
    c.tile.texture = tileTexture(tier, this.cell, this.res);
    this.setHeat(c, tier);
    this.showNumber(c, value);
  }

  /** Hot tiles breathe: slow additive inner-glow shimmer, phase offset per cell (ambient, unscaled). */
  private setHeat(c: SpotCell, tier: SpotTier): void {
    const level = tier >= 5 ? 2 : tier >= 4 ? 1 : 0;
    if (level === c.heatLevel) return;
    c.heatLevel = level;
    gsap.killTweensOf(c.heat);
    if (!level) {
      c.heat.alpha = 0;
      return;
    }
    const H = HEAT[level - 1];
    c.heat.tint = H.color;
    const phase = ((c.reel * 5 + c.row) * 0.37) % 1;
    gsap.fromTo(
      c.heat,
      { alpha: H.lo },
      { alpha: H.hi, duration: sUi(H.period / 2), ease: 'sine.inOut', yoyo: true, repeat: -1, delay: sUi(H.period * phase) },
    );
  }

  private showNumber(c: SpotCell, value: number): void {
    const tier = spotTier(value);
    c.num.visible = tier >= 2;
    if (!c.num.visible) return;
    c.vText.text = String(value);
    const tint = textTint(value);
    c.xText.tint = tint;
    c.vText.tint = tint;
  }

  private animateCell(c: SpotCell, from: number, to: number, delayMs: number): Promise<void> {
    this.kill(c);
    c.value = to;
    const tl = gsap.timeline({ delay: s(delayMs) });
    c.tl = tl;
    const p = { x: c.tile.x, y: c.tile.y };
    let at = 0;

    if (from === 0) {
      // ---- mark: payframe ignite -----------------------------------------
      const mark = TIMING.spots.markDuration;
      tl.call(() => {
        c.tile.texture = tileTexture(1, this.cell, this.res);
        c.tile.scale.set(0.7);
        c.fx.texture = overlayTexture('ring', this.cell, this.res);
        c.fx.tint = 0xffd36a;
        c.fx.alpha = 0;
        c.fx.scale.set(0.85);
        this.ctx.game.broadcast('fx:burst', { kind: 'spotSpark', x: p.x, y: p.y, color: 0xffd36a, count: 10, power: 0.55 });
      }, [], 0);
      tl.to(c.tile.scale, { x: 1, y: 1, duration: s(mark), ease: 'back.out(2.4)' }, 0);
      tl.to(c.fx, { alpha: 1, duration: s(mark * 0.25), ease: 'power2.out' }, 0);
      tl.to(c.fx.scale, { x: 1.14, y: 1.14, duration: s(mark + BOARD_TIMING.markGlowHold), ease: 'power2.out' }, 0);
      tl.to(c.fx, { alpha: 0, duration: s(mark * 1.1), ease: 'power1.in' }, s(mark * 0.25 + BOARD_TIMING.markGlowHold));
      at = s(mark * 0.8);
    }

    if (to > 1) {
      // ---- upgrade: number roll + punch (+ tier flash) ---------------------
      const start = Math.max(1, from);
      const steps = this.rollSteps(start, to);
      const numWasHidden = spotTier(start) < 2;
      steps.forEach((v, i) => {
        const tAt = at + s(i * BOARD_TIMING.rollStep);
        const prevTier = spotTier(i === 0 ? start : steps[i - 1]);
        const tier = spotTier(v);
        tl.call(() => this.showNumber(c, v), [], tAt);
        // (immediateRender: false — a timeline fromTo must not apply its start values early)
        if (i === 0 && numWasHidden) {
          tl.fromTo(c.num, { alpha: 0 }, { alpha: 1, duration: s(80), ease: 'power1.out', immediateRender: false }, tAt);
          tl.fromTo(
            c.num.scale,
            { x: 0.55, y: 0.55 },
            { x: 1, y: 1, duration: s(120), ease: 'back.out(2)', immediateRender: false },
            tAt,
          );
        } else if (i < steps.length - 1) {
          tl.fromTo(
            c.num.scale,
            { x: 1.12, y: 1.12 },
            { x: 1, y: 1, duration: s(BOARD_TIMING.rollStep), ease: 'power1.out', immediateRender: false },
            tAt,
          );
        }
        // a fresh mark already owns the fx sprite (ignite ring): swap the skin without a flash
        if (tier !== prevTier) this.tierFlash(tl, c, tier, tAt, !(from === 0 && i === 0));
      });
      const end = at + s((steps.length - 1) * BOARD_TIMING.rollStep);
      const punch = TIMING.spots.punchDuration;
      tl.to(c.num.scale, { x: TIMING.spots.punchScale, y: TIMING.spots.punchScale, duration: s(punch * 0.35), ease: 'power2.out' }, end);
      tl.to(c.num.scale, { x: 1, y: 1, duration: s(punch * 0.65), ease: 'back.out(2.2)' }, end + s(punch * 0.35));
      tl.to(c.tile.scale, { x: 1.06, y: 1.06, duration: s(punch * 0.3), ease: 'power2.out' }, end);
      tl.to(c.tile.scale, { x: 1, y: 1, duration: s(punch * 0.7), ease: 'back.out(2)' }, end + s(punch * 0.3));
      if (spotTier(to) >= 4) {
        tl.call(() => {
          this.ctx.game.broadcast('fx:burst', {
            kind: 'spotSpark',
            x: p.x,
            y: p.y,
            color: spotTier(to) >= 5 ? 0xffe14a : 0xff7a2a,
            count: spotTier(to) >= 5 ? 16 : 10,
            power: spotTier(to) >= 5 ? 0.9 : 0.65,
          });
        }, [], end);
      }
    }

    return new Promise<void>((resolve) => {
      const done = () => {
        if (c.tl === tl) c.tl = null;
        resolve();
      };
      tl.eventCallback('onComplete', done);
      tl.eventCallback('onInterrupt', done);
    });
  }

  /** Tier change: tile skin (+ heat shimmer) swaps at the peak of an additive flash. */
  private tierFlash(tl: gsap.core.Timeline, c: SpotCell, tier: SpotTier, at: number, flash: boolean): void {
    tl.call(() => {
      c.tile.texture = tileTexture(tier, this.cell, this.res);
      this.setHeat(c, tier);
      if (!flash) return;
      c.fx.texture = overlayTexture('flash', this.cell, this.res);
      c.fx.tint = TIER_FLASH[tier];
      c.fx.scale.set(1);
    }, [], at);
    if (!flash) return;
    const d = s(TIMING.spots.tierFlash);
    tl.fromTo(c.fx, { alpha: 0.95 }, { alpha: 0, duration: d, ease: 'power2.in', immediateRender: false }, at);
    tl.fromTo(c.fx.scale, { x: 1, y: 1 }, { x: 1.1, y: 1.1, duration: d, ease: 'power2.out', immediateRender: false }, at);
  }

  /** Values shown while rolling start -> to (evenly sampled, always ends on `to`). */
  private rollSteps(start: number, to: number): number[] {
    const n = to - start;
    const count = Math.min(n, BOARD_TIMING.rollMaxSteps);
    const out: number[] = [];
    for (let i = 1; i <= count; i++) out.push(Math.round(start + (n * i) / count));
    return out;
  }
}
