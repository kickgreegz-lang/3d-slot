import { gsap } from 'gsap';
import { Container, Graphics, Text } from 'pixi.js';
import { FONTS } from '../assets/fonts';
import { SYMBOL_IDS } from '../config/game';
import { fallTime, s, TIMING } from '../core/timing';
import type { GameContext } from '../game/context';
import { createSymbolView } from '../symbols/createSymbolView';
import type { SymbolView } from '../symbols/types';

/**
 * DEV-ONLY symbol x state gallery (`?dev=gallery`): every symbol in every
 * SymbolView state, all cycling in lock-step so a contact sheet of N frames shows
 * the whole state machine side by side. Other layers are hidden; the gallery owns
 * the design space.
 */

type GalleryState = 'static' | 'blur' | 'land' | 'idle' | 'anticipation' | 'win' | 'dim' | 'explode';

const STATES: GalleryState[] = ['static', 'blur', 'land', 'idle', 'anticipation', 'win', 'dim', 'explode'];

/** Cycle choreography (lab pacing, game ms from the cycle start). */
const CYCLE = {
  length: 2600,
  actionAt: 250,
  releaseAt: 1700,
  /** land row: drop height in cells (sets impact velocity via TIMING.drop.gravity) */
  landDropCells: 3,
} as const;

const HEADER = { top: 64, left: 190, pad: 14 } as const;
const COLORS = { bg: 0x090611, grid: 0x1c2436, text: 0xdbe6ff, dim: 0x7c8db0 } as const;

interface Cell {
  state: GalleryState;
  sv: SymbolView;
  holder: Container;
  /** land row only: clips the drop to the row band so it never overlaps rows above */
  clip?: Graphics;
}

export class SymbolGallery {
  readonly root = new Container({ label: 'lab-gallery' });
  private readonly bg = new Graphics();
  private readonly labels = new Container({ label: 'lab-gallery-labels' });
  private readonly cells: Cell[] = [];
  private tl: gsap.core.Timeline | null = null;
  private hidden: Array<{ c: { visible: boolean }; was: boolean }> = [];

  constructor(private readonly ctx: GameContext) {
    this.root.addChild(this.bg, this.labels);
    for (const state of STATES) {
      for (const id of SYMBOL_IDS) {
        const sv = createSymbolView(ctx, id);
        // gallery owns the top of the stack; elevation would move views under it
        sv.setElevated = () => {};
        const holder = new Container({ label: `gallery-${id}-${state}` });
        holder.addChild(sv.view);
        this.root.addChild(holder);
        const cell: Cell = { state, sv, holder };
        if (state === 'land') {
          cell.clip = new Graphics();
          holder.mask = cell.clip;
          this.root.addChild(cell.clip);
        }
        this.cells.push(cell);
      }
    }
    ctx.game.on('layout:change', () => this.layout());
  }

  start(): void {
    const { layers } = this.ctx;
    // hide every other visual layer (restored by stop())
    const others = [layers.background, layers.bgFx, ...layers.root.children, layers.screenFx].filter(
      (c) => c !== layers.fx && c !== this.root,
    );
    this.hidden = others.map((c) => ({ c, was: c.visible }));
    for (const h of this.hidden) h.c.visible = false;
    layers.root.addChild(this.root);
    this.layout();
    this.play();
  }

  /** Rebuild the cycle (after a speed-profile change: cycle offsets are profile-scaled). */
  restart(): void {
    if (this.root.parent) this.play();
  }

  stop(): void {
    this.tl?.kill();
    this.tl = null;
    for (const h of this.hidden) h.c.visible = h.was;
    this.hidden = [];
    this.root.removeFromParent();
  }

  private layout(): void {
    const L = this.ctx.layout;
    const cols = SYMBOL_IDS.length;
    const rows = STATES.length;
    const cw = (L.width - HEADER.left - HEADER.pad) / cols;
    const ch = (L.height - HEADER.top - HEADER.pad) / rows;
    // symbol art is 1.2x the cell; leave ~15% headroom for pops and hops
    const scale = Math.min(cw, ch) / (L.cell * 1.2 * 1.08);

    this.bg.clear().rect(0, 0, L.width, L.height).fill(COLORS.bg);
    for (let r = 0; r <= rows; r++) {
      const y = HEADER.top + r * ch;
      this.bg.moveTo(HEADER.left - 8, y).lineTo(L.width - HEADER.pad, y);
    }
    this.bg.stroke({ width: 1, color: COLORS.grid });

    this.labels.removeChildren().forEach((c) => c.destroy());
    const label = (text: string, x: number, y: number, size: number, color: number, anchorX: number) => {
      const t = new Text({ text, style: { fontFamily: FONTS.label, fontSize: size, fill: color, letterSpacing: 1.5 } });
      t.anchor.set(anchorX, 0.5);
      t.position.set(x, y);
      this.labels.addChild(t);
    };
    SYMBOL_IDS.forEach((id, i) => label(id, HEADER.left + cw * (i + 0.5), HEADER.top / 2, 30, COLORS.text, 0.5));
    STATES.forEach((st, i) => label(st.toUpperCase(), HEADER.left - 24, HEADER.top + ch * (i + 0.5), 28, COLORS.dim, 1));

    for (const cell of this.cells) {
      const col = SYMBOL_IDS.indexOf(cell.sv.id);
      const row = STATES.indexOf(cell.state);
      const cx = HEADER.left + cw * (col + 0.5);
      const cy = HEADER.top + ch * (row + 0.5);
      cell.holder.scale.set(scale);
      cell.holder.position.set(cx, cy);
      cell.clip?.clear().rect(cx - cw / 2, cy - ch / 2, cw, ch).fill(0xffffff);
    }
  }

  /** One looping timeline (driven by the game clock) orchestrates every cell. */
  private play(): void {
    this.tl?.kill();
    const tl = gsap.timeline({ repeat: -1 });
    const at = (ms: number) => s(ms);
    tl.call(() => this.cycleStart(), [], 0);
    tl.call(() => this.action(), [], at(CYCLE.actionAt));
    tl.call(() => this.release(), [], at(CYCLE.releaseAt));
    tl.to({}, { duration: at(CYCLE.length) }, 0);
    this.tl = tl;
  }

  private cycleStart(): void {
    for (const { state, sv } of this.cells) {
      gsap.killTweensOf(sv.view);
      sv.view.y = 0;
      sv.reset();
      if (state === 'blur') sv.setBlur(true);
      if (state === 'land') {
        const g = TIMING.drop.gravity;
        const drop = CYCLE.landDropCells * this.ctx.layout.cell;
        sv.view.y = -drop;
        sv.setBlur(true);
        gsap.to(sv.view, {
          y: 0,
          duration: s(fallTime(drop, g)),
          ease: 'power2.in',
          onComplete: () => {
            sv.setBlur(false);
            void sv.land({ velocity: Math.sqrt(2 * g * drop) });
          },
        });
      }
    }
  }

  private action(): void {
    for (const { state, sv } of this.cells) {
      if (state === 'idle') sv.idleAccent();
      else if (state === 'anticipation') sv.setAnticipation(true);
      else if (state === 'win') void sv.win();
      else if (state === 'dim') sv.setDim(true, true);
      else if (state === 'explode') void sv.explode();
    }
  }

  private release(): void {
    for (const { state, sv } of this.cells) {
      if (state === 'anticipation') sv.setAnticipation(false);
      else if (state === 'dim') sv.setDim(false, true);
    }
  }

  destroy(): void {
    this.stop();
    for (const c of this.cells) c.sv.destroy();
    this.root.destroy({ children: true });
  }
}
