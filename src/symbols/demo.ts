import { gsap } from 'gsap';
import { Assets, Container, Graphics, Text } from 'pixi.js';
import type { SpineRef } from '../assets/art';
import { SYMBOL_IDS } from '../config/game';
import { TIMING, fallTime, s, stagger } from '../core/timing';
import type { GameContext } from '../game/context';
import type { GameEvents } from '../game/events';
import { createSymbolView } from './createSymbolView';
import type { SymbolView } from './types';

/**
 * DEV-ONLY visual QA harness for the symbol rig (never shipped: imported behind
 * `import.meta.env.DEV`). Lays out symbols on the board layer and exposes triggers:
 *
 *   const d = window.__symbolsDemo(__slot.ctx, { ids: ['H1','L1','W','S'], zoom: 2 });
 *   d.dropAll();            // gravity drop + land at impact (spin weights)
 *   d.dropAll({ tumble: true, cells: 2 });
 *   d.winAll(); d.explodeAll(); d.anticipate(true); d.dimAll(true); d.accentAll();
 *   await d.loadSpine('H1', { skeleton: 'http://…/x.skel', atlas: 'http://…/x.atlas' });
 */
export interface SymbolsDemoOptions {
  ids?: string[];
  cols?: number;
  zoom?: number;
  /** centre of the demo grid in design px (defaults to the layout centre) */
  x?: number;
  y?: number;
  /** draw rings where fx:burst events land + an event log (Fx module may be a stub) */
  markers?: boolean;
  /** draw dark cell tiles behind symbols */
  tiles?: boolean;
  /** hide the rest of the scene (board, frame, spots, HUD…) while the demo runs (default true) */
  isolate?: boolean;
}

export interface DropOptions {
  tumble?: boolean;
  /** fall distance in cells (default TIMING.drop.startOffsetCells) */
  cells?: number;
}

export interface SymbolsDemo {
  views: SymbolView[];
  root: Container;
  dropAll(opts?: DropOptions): Promise<void>;
  winAll(filter?: (v: SymbolView) => boolean): Promise<void>;
  explodeAll(filter?: (v: SymbolView) => boolean): Promise<void>;
  anticipate(on: boolean, filter?: (v: SymbolView) => boolean): void;
  dimAll(on: boolean, filter?: (v: SymbolView) => boolean): void;
  elevateAll(on: boolean): void;
  accentAll(): void;
  resetAll(): void;
  loadSpine(id: string, ref: { skeleton: string; atlas: string; skin?: string }): Promise<void>;
  destroy(): void;
}

declare global {
  interface Window {
    __symbolsDemo?: (ctx: GameContext, opts?: SymbolsDemoOptions) => SymbolsDemo;
  }
}

export const installSymbolsDemo = (): void => {
  window.__symbolsDemo = createSymbolsDemo;
};

const MARKER_COLORS: Record<string, number> = {
  dust: 0xc8a27a,
  sparkle: 0xfff27a,
  explode: 0xff5a2a,
};

const createSymbolsDemo = (ctx: GameContext, opts: SymbolsDemoOptions = {}): SymbolsDemo => {
  const ids = opts.ids ?? SYMBOL_IDS;
  const cols = opts.cols ?? ids.length;
  const zoom = opts.zoom ?? 1;
  const L = ctx.layout;
  const pitch = L.cell + L.gap;
  const rows = Math.ceil(ids.length / cols);
  const root = new Container({ label: 'symbols-demo' });
  root.scale.set(zoom);
  root.position.set(
    (opts.x ?? L.center.x) - ((cols * pitch - L.gap) * zoom) / 2,
    (opts.y ?? L.center.y) - ((rows * pitch - L.gap) * zoom) / 2,
  );
  ctx.layers.board.addChild(root);

  const hidden: Container[] = [];
  if (opts.isolate !== false) {
    const { layers } = ctx;
    const others = [
      ...layers.board.children.filter((c) => c !== root),
      layers.panel,
      layers.tiles,
      layers.spotText,
      layers.frame,
      layers.logo,
      layers.mascots,
      layers.hud,
    ];
    for (const c of others) {
      if (c.visible) {
        c.visible = false;
        hidden.push(c);
      }
    }
  }

  if (opts.tiles !== false) {
    const g = new Graphics();
    for (let i = 0; i < ids.length; i++) {
      const c = i % cols;
      const r = Math.floor(i / cols);
      g.roundRect(c * pitch, r * pitch, L.cell, L.cell, L.cell * 0.12).fill({ color: 0x1f2e4d, alpha: 0.85 });
    }
    root.addChild(g);
  }

  const views: SymbolView[] = [];
  const homes: { x: number; y: number; col: number; row: number }[] = [];
  ids.forEach((id, i) => {
    const v = createSymbolView(ctx, id);
    const col = i % cols;
    const row = Math.floor(i / cols);
    const home = { x: col * pitch + L.cell / 2, y: row * pitch + L.cell / 2, col, row };
    v.view.position.set(home.x, home.y);
    root.addChild(v.view);
    views.push(v);
    homes.push(home);
  });

  const offs: Array<() => void> = [];
  if (opts.markers) {
    const log = new Text({ text: '', style: { fill: 0xffffff, fontSize: 18, fontFamily: 'monospace' } });
    log.position.set(20, 20);
    ctx.layers.fx.addChild(log);
    const lines: string[] = [];
    const push = (line: string) => {
      lines.push(line);
      while (lines.length > 12) lines.shift();
      log.text = lines.join('\n');
    };
    offs.push(() => log.destroy());
    offs.push(
      ctx.game.on('fx:burst', (p: GameEvents['fx:burst']) => {
        const ring = new Graphics().circle(0, 0, 14).stroke({ width: 4, color: MARKER_COLORS[p.kind] ?? 0xffffff });
        ring.position.set(p.x, p.y);
        ctx.layers.fx.addChild(ring);
        gsap.to(ring.scale, { x: 3, y: 3, duration: 0.5, ease: 'power2.out' });
        gsap.to(ring, { alpha: 0, duration: 0.5, ease: 'power2.in', onComplete: () => ring.destroy() });
        push(`burst ${p.kind} n=${p.count ?? '-'} @${Math.round(p.x)},${Math.round(p.y)}`);
      }),
    );
    offs.push(ctx.game.on('sfx', (p: GameEvents['sfx']) => push(`sfx ${p.id} v=${(p.volume ?? 1).toFixed(2)}`)));
    offs.push(ctx.game.on('fx:shake', (p: GameEvents['fx:shake']) => push(`shake ${p.trauma.toFixed(3)}`)));
  }

  const pick = (filter?: (v: SymbolView) => boolean) => (filter ? views.filter(filter) : views);

  const dropAll = (d: DropOptions = {}): Promise<void> => {
    const g = d.tumble ? TIMING.tumble.gravity : TIMING.drop.gravity;
    const colStagger = d.tumble ? TIMING.tumble.columnStagger : TIMING.drop.columnStagger;
    const rowStagger = d.tumble ? TIMING.tumble.rowStagger : TIMING.drop.rowStagger;
    const cells = d.cells ?? TIMING.drop.startOffsetCells;
    return Promise.all(
      views.map((v, i) => {
        const h = homes[i];
        v.reset();
        const dist = (cells + (rows - 1 - h.row) * 0.5) * pitch;
        const t = fallTime(dist, g, TIMING.drop.minFall);
        const delay = stagger(h.col * colStagger + (rows - 1 - h.row) * rowStagger);
        v.view.y = h.y - dist;
        v.view.visible = false;
        return new Promise<void>((resolve) => {
          gsap.to(v.view, {
            y: h.y,
            duration: s(t),
            delay: s(delay),
            ease: 'power2.in', // y ∝ t² == constant gravity from rest
            onStart: () => {
              v.view.visible = true;
              v.setBlur(true);
            },
            onComplete: () => {
              v.setBlur(false);
              void v.land({ velocity: (g * t) / 1000, tumble: d.tumble }).then(resolve);
            },
          });
        });
      }),
    ).then(() => undefined);
  };

  const spineRefs = new Map<string, SpineRef>();
  const origSpine = ctx.art.spine.bind(ctx.art);

  return {
    views,
    root,
    dropAll,
    winAll: (filter) => Promise.all(pick(filter).map((v) => v.win())).then(() => undefined),
    explodeAll: (filter) => Promise.all(pick(filter).map((v) => v.explode())).then(() => undefined),
    anticipate: (on, filter) => pick(filter).forEach((v) => v.setAnticipation(on)),
    dimAll: (on, filter) => pick(filter).forEach((v) => v.setDim(on)),
    elevateAll: (on) => views.forEach((v) => v.setElevated(on)),
    accentAll: () => views.forEach((v) => v.idleAccent()),
    resetAll: () => views.forEach((v) => v.reset()),
    loadSpine: async (id, ref) => {
      const skeleton = `symbols-demo:${id}:skel`;
      const atlas = `symbols-demo:${id}:atlas`;
      Assets.add({ alias: skeleton, src: ref.skeleton });
      Assets.add({ alias: atlas, src: ref.atlas });
      await Assets.load([skeleton, atlas]);
      spineRefs.set(id, { skeleton, atlas, skin: ref.skin });
      ctx.art.spine = (sid: string) => spineRefs.get(sid) ?? origSpine(sid);
    },
    destroy: () => {
      for (const off of offs) off();
      for (const v of views) v.destroy();
      root.destroy({ children: true });
      ctx.art.spine = origSpine;
      for (const c of hidden) c.visible = true;
    },
  };
};
