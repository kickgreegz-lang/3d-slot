import { gsap } from 'gsap';
import { Container, Graphics, Text } from 'pixi.js';
import { FONTS } from '../assets/fonts';
import { getSymbolDef } from '../config/game';
import { fallTime, s, TIMING } from '../core/timing';
import type { GameContext } from '../game/context';
import { createSymbolView } from '../symbols/createSymbolView';
import type { SymbolView } from '../symbols/types';
import type { ProbeTarget } from './motion';

/**
 * DEV-ONLY single-symbol inspector: one magnified SymbolView on a card, driven
 * through the public SymbolView contract only (land/win/explode/anticipation/
 * dim/blur/idleAccent). `land` drops the symbol from exactly the height that
 * produces the chosen impact velocity under TIMING.drop.gravity, so what you see
 * is the board's physics, magnified.
 */

export type InspectorPlacement = 'left' | 'center' | 'right';

/** Card geometry in cells (1x) around the symbol's rest point (cell centre). */
const CARD = { halfW: 0.66, top: 1.34, bottom: 0.74, margin: 12 } as const;
/** Speed above which the falling symbol shows its motion-blur variant (design px/s). */
const BLUR_SPEED = 1500;

const COLORS = {
  veil: 0x05030d,
  card: 0x0b1120,
  cardEdge: 0x2b3d5c,
  cellGuide: 0x48d6ff,
  floor: 0x8fb4ff,
  title: 0xeaf2ff,
  sub: 0x8ea3c7,
} as const;

export class SymbolInspector {
  readonly root = new Container({ label: 'lab-inspector' });
  id = 'H1';
  /** impact velocity for land() in design px/s */
  velocity = 4200;
  magnify = 2;
  placement: InspectorPlacement = 'left';
  blurWhileFalling = true;

  private readonly veil = new Graphics();
  private readonly card = new Graphics();
  private readonly guides = new Graphics();
  private readonly clip = new Graphics();
  private readonly holder = new Container({ label: 'lab-inspector-holder' });
  private readonly title: Text;
  private readonly sub: Text;
  private sv: SymbolView | null = null;
  private busy: Promise<void> = Promise.resolve();

  constructor(private readonly ctx: GameContext) {
    // QA captures crop to the card, so centre it (bigger, veiled board) by default there
    if (ctx.params.capture) this.placement = 'center';
    this.title = new Text({
      text: '',
      style: { fontFamily: FONTS.label, fontSize: 30, fill: COLORS.title, letterSpacing: 1.5 },
    });
    this.sub = new Text({
      text: '',
      style: { fontFamily: FONTS.label, fontSize: 20, fill: COLORS.sub, letterSpacing: 1 },
    });
    this.title.anchor.set(0.5, 0);
    this.sub.anchor.set(0.5, 0);
    this.holder.mask = this.clip;
    this.root.addChild(this.veil, this.card, this.guides, this.holder, this.clip, this.title, this.sub);
    this.root.visible = false;
    ctx.layers.root.addChild(this.root);
    ctx.game.on('layout:change', () => this.layout());
  }

  get visible(): boolean {
    return this.root.visible;
  }

  get state(): string {
    return this.sv?.state ?? '—';
  }

  show(id = this.id): SymbolView {
    this.id = id;
    const sv = this.ensure();
    if (sv.id !== id) sv.setSymbol(id);
    // keep the inspector on top of anything other modules added since
    this.ctx.layers.root.addChild(this.root);
    this.root.visible = true;
    this.layout();
    return sv;
  }

  hide(): void {
    this.sv?.reset();
    this.root.visible = false;
  }

  /** Card bounds in canvas CSS px (QA crops screenshots to this). */
  screenRect(): { x: number; y: number; width: number; height: number } {
    this.show();
    const b = this.card.getBounds();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  }

  probeTarget(): ProbeTarget {
    const sv = this.show();
    return { view: sv.view, restY: 0, label: `inspector ${sv.id}` };
  }

  /** Serialises actions so rapid clicks queue instead of fighting over tweens. */
  private queue(fn: (sv: SymbolView) => Promise<void> | void): Promise<void> {
    const run = async () => {
      const sv = this.show();
      if (sv.state === 'hidden') sv.reset();
      await fn(sv);
    };
    this.busy = this.busy.then(run, run);
    return this.busy;
  }

  /** Free-fall from the height that yields `velocity` at impact, then `land()`. */
  land(velocity = this.velocity): Promise<void> {
    return this.queue(async (sv) => {
      gsap.killTweensOf(sv.view);
      sv.reset();
      const g = TIMING.drop.gravity;
      const drop = (velocity * velocity) / (2 * g);
      sv.view.y = -drop;
      if (this.blurWhileFalling && velocity > BLUR_SPEED) sv.setBlur(true);
      await gsap.to(sv.view, { y: 0, duration: s(fallTime(drop, g)), ease: 'power2.in' });
      sv.setBlur(false);
      await sv.land({ velocity });
    });
  }

  win(): Promise<void> {
    return this.queue((sv) => sv.win());
  }

  explode(): Promise<void> {
    return this.queue((sv) => sv.explode());
  }

  idleAccent(): Promise<void> {
    return this.queue((sv) => sv.idleAccent());
  }

  setAnticipation(on: boolean): Promise<void> {
    return this.queue((sv) => sv.setAnticipation(on));
  }

  setDim(on: boolean): Promise<void> {
    return this.queue((sv) => sv.setDim(on, true));
  }

  setBlur(on: boolean): Promise<void> {
    return this.queue((sv) => sv.setBlur(on));
  }

  reset(): Promise<void> {
    return this.queue((sv) => {
      gsap.killTweensOf(sv.view);
      sv.view.y = 0;
      sv.reset();
    });
  }

  private ensure(): SymbolView {
    if (this.sv) return this.sv;
    const sv = createSymbolView(this.ctx, this.id);
    // The inspector sits above every layer already; elevation into the win
    // RenderLayer would hide it UNDER the card, so it is disabled here.
    sv.setElevated = () => {};
    this.holder.addChild(sv.view);
    this.sv = sv;
    return sv;
  }

  private layout(): void {
    if (!this.root.visible) return;
    const L = this.ctx.layout;
    const c = L.cell;
    const fit = (L.height - 2 * CARD.margin) / ((CARD.top + CARD.bottom) * c);
    const m = Math.max(0.5, Math.min(this.magnify, fit));
    const cm = c * m;
    const w = CARD.halfW * 2 * cm;
    const top = -CARD.top * cm;
    const bottom = CARD.bottom * cm;

    let x = L.center.x;
    if (this.placement === 'left') x = CARD.margin + w / 2;
    if (this.placement === 'right') x = L.width - CARD.margin - w / 2;
    const y = Math.min(
      Math.max(CARD.margin - top, L.center.y - (top + bottom) / 2),
      L.height - CARD.margin - bottom,
    );
    this.root.position.set(x, y);
    this.holder.scale.set(m);

    this.veil.clear();
    if (this.placement === 'center') {
      this.veil.rect(-x, -y, L.width, L.height).fill({ color: COLORS.veil, alpha: 0.72 });
    }
    this.card
      .clear()
      .roundRect(-w / 2, top, w, bottom - top, 18)
      .fill({ color: COLORS.card, alpha: 0.96 })
      .stroke({ width: 2, color: COLORS.cardEdge, alpha: 1 });
    this.clip.clear().roundRect(-w / 2, top, w, bottom - top, 18).fill(0xffffff);

    // cell bounds + floor: squash reads against a fixed frame of reference
    const half = cm / 2;
    this.guides
      .clear()
      .rect(-half, -half, cm, cm)
      .stroke({ width: 1, color: COLORS.cellGuide, alpha: 0.28 })
      .moveTo(-w / 2 + 16, half)
      .lineTo(w / 2 - 16, half)
      .stroke({ width: 2, color: COLORS.floor, alpha: 0.45 });

    const def = getSymbolDef(this.id);
    this.title.text = `${def.id} · ${def.label}`.toUpperCase();
    this.title.position.set(0, top + 14);
    this.sub.text = `${def.kind} · ${def.landWeight} · ${Math.round(this.velocity)} px/s · ${m.toFixed(1)}x`.toUpperCase();
    this.sub.position.set(0, top + 50);
  }

  /** Re-draws labels after the pane changes id/velocity/placement/magnify. */
  refresh(): void {
    if (this.sv && this.sv.id !== this.id) this.sv.setSymbol(this.id);
    this.layout();
  }

  destroy(): void {
    this.sv?.destroy();
    this.root.destroy({ children: true });
  }
}
