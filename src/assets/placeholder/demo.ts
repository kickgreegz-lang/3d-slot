import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { GRID, SYMBOLS, SYMBOL_IDS } from '../../config/game';
import { cellCenter } from '../../config/layout';
import type { GameContext } from '../../game/context';
import type { ParticleKey } from '../art';
import { FONTS } from '../fonts';
import { PARTICLE_KEYS } from './particles';

/**
 * DEV ONLY — art review sheet for automated visual QA (the Board may be a stub).
 *   window.__artDemo(__slot.ctx)            every symbol (static / blur / glow) + particles
 *   window.__artDemo(__slot.ctx, 'board')   a plausible board of statics on the panel (GRID size)
 *   window.__artDemo(__slot.ctx, 'zoom')    statics at ~1.7x on the panel colours (detail review)
 *   window.__artDemo(__slot.ctx, 'off')     remove
 */
type DemoMode = 'sheet' | 'board' | 'zoom' | 'off';

declare global {
  interface Window {
    __artDemo?: (ctx: GameContext, mode?: DemoMode) => void;
  }
}

let current: Container | null = null;

const label = (text: string, x: number, y: number): Text => {
  const t = new Text({
    text,
    style: { fontFamily: FONTS.label, fontSize: 22, fill: 0xbfc9ff, letterSpacing: 1 },
  });
  t.anchor.set(0.5, 0);
  t.position.set(x, y);
  return t;
};

const sheet = (ctx: GameContext): Container => {
  const { art, layout: L } = ctx;
  const root = new Container({ label: 'artDemo' });
  const W = L.width;
  const H = L.height;
  root.addChild(new Graphics().rect(0, 0, W, H).fill({ color: 0x080418, alpha: 0.96 }));
  const n = SYMBOL_IDS.length;
  const pitch = Math.min(132, (W - 40) / n);
  const disp = pitch * 0.96;
  const x0 = (W - pitch * n) / 2 + pitch / 2;
  const rows = [
    { name: 'STATIC', y: 30 },
    { name: 'BLUR', y: 30 + pitch * 1.25 },
    { name: 'GLOW (tinted, add)', y: 30 + pitch * 2.5 },
    { name: 'STATIC + GLOW', y: 30 + pitch * 3.75 },
  ];
  rows.forEach((row, ri) => {
    root.addChild(label(row.name, W / 2, row.y - 26));
    SYMBOL_IDS.forEach((id, i) => {
      const def = SYMBOLS[id];
      const x = x0 + i * pitch;
      const y = row.y + pitch / 2;
      root.addChild(new Graphics().roundRect(x - pitch / 2 + 3, y - pitch / 2 + 3, pitch - 6, pitch - 6, 14).fill(0x14223d));
      const add = (variant: 'static' | 'blur' | 'glow', tint = 0xffffff, blend = false) => {
        const s = new Sprite(art.symbol(id, variant));
        s.anchor.set(0.5);
        s.position.set(x, y);
        s.scale.set((disp * 1.2) / art.symbolCanvas / (s.texture.width / art.symbolCanvas));
        s.angle = def.restAngle;
        s.tint = tint;
        if (blend) s.blendMode = 'add';
        root.addChild(s);
      };
      if (ri === 0) add('static');
      if (ri === 1) add('blur');
      if (ri === 2) add('glow', def.color, true);
      if (ri === 3) {
        add('glow', def.color, true);
        add('static');
      }
    });
  });
  const py = 30 + pitch * 5.1;
  root.addChild(label('PARTICLES (white = tinted by FX)', W / 2, py - 36));
  const tints: Record<ParticleKey, number> = {
    spark: 0xffe066,
    dust: 0xd9c6ff,
    coin: 0xffffff,
    star: 0xffc629,
    ring: 0x35f2e0,
    smoke: 0xb49cff,
    shard: 0xff5a2a,
    glow: 0xff3fa8,
    note: 0x35f2e0,
  };
  PARTICLE_KEYS.forEach((k, i) => {
    const x = W / 2 + (i - (PARTICLE_KEYS.length - 1) / 2) * 150;
    for (const [dx, tint] of [
      [-34, 0xffffff],
      [34, tints[k]],
    ] as const) {
      const s = new Sprite(art.particle(k));
      s.anchor.set(0.5);
      s.scale.set(64 / Math.max(s.width, s.height));
      s.position.set(x + dx, py + 36);
      s.tint = tint;
      root.addChild(s);
    }
    root.addChild(label(k, x, py + 76));
  });
  return root;
};

const BOARD = [
  ['L5', 'S', 'L5', 'L3', 'L3', 'L1', 'L1'],
  ['L5', 'L3', 'L3', 'H2', 'L3', 'L2', 'L3'],
  ['L1', 'L4', 'H1', 'L1', 'H1', 'L4', 'H1'],
  ['H4', 'L2', 'W', 'H3', 'L1', 'H2', 'L1'],
  ['L4', 'S', 'L5', 'L3', 'H3', 'L2', 'L3'],
];

/** BOARD tiled over the game's grid; ids the game does not have fall back to its own symbols. */
const demoId = (r: number, c: number): string => {
  const id = BOARD[r % BOARD.length][c % BOARD[0].length];
  return SYMBOLS[id] ? id : SYMBOL_IDS[(r * GRID.reels + c) % SYMBOL_IDS.length];
};

const board = (ctx: GameContext): Container => {
  const { art, layout: L } = ctx;
  const root = new Container({ label: 'artDemoBoard' });
  for (let r = 0; r < GRID.rows; r++) {
    for (let c = 0; c < GRID.reels; c++) {
      const p = cellCenter(L, c, r);
      root.addChild(
        new Graphics()
          .roundRect(p.x - L.cell / 2, p.y - L.cell / 2, L.cell, L.cell, L.cell * 0.13)
          .fill({ color: 0x1f2e4d, alpha: 0.85 })
          .stroke({ width: 3, color: 0x373331, alpha: 0.9 }),
      );
    }
  }
  for (let r = 0; r < GRID.rows; r++) {
    for (let c = 0; c < GRID.reels; c++) {
      const id = demoId(r, c);
      const p = cellCenter(L, c, r);
      const s = new Sprite(art.symbol(id));
      s.anchor.set(0.5);
      s.position.set(p.x, p.y);
      s.scale.set((L.cell * 1.2) / art.symbolCanvas / (s.texture.width / art.symbolCanvas));
      s.angle = SYMBOLS[id].restAngle;
      root.addChild(s);
    }
  }
  return root;
};

const zoom = (ctx: GameContext): Container => {
  const { art, layout: L } = ctx;
  const root = new Container({ label: 'artDemoZoom' });
  root.addChild(new Graphics().rect(0, 0, L.width, L.height).fill(0x0c2440));
  const cols = 7;
  const pitch = Math.min(L.width / cols, L.height / 2.1);
  SYMBOL_IDS.forEach((id, i) => {
    const x = (L.width - pitch * cols) / 2 + pitch * ((i % cols) + 0.5);
    const y = (L.height - pitch * 2) / 2 + pitch * (Math.floor(i / cols) + 0.5);
    root.addChild(new Graphics().roundRect(x - pitch * 0.42, y - pitch * 0.42, pitch * 0.84, pitch * 0.84, pitch * 0.1).fill(0x1f2e4d));
    const s = new Sprite(art.symbol(id));
    s.anchor.set(0.5);
    s.position.set(x, y);
    s.scale.set((pitch * 0.84 * 1.2) / art.symbolCanvas / (s.texture.width / art.symbolCanvas));
    s.angle = SYMBOLS[id].restAngle;
    root.addChild(s);
  });
  return root;
};

export const installArtDemo = (): void => {
  window.__artDemo = (ctx: GameContext, mode: DemoMode = 'sheet') => {
    current?.destroy({ children: true });
    current = null;
    if (mode === 'off') return;
    current = mode === 'board' ? board(ctx) : mode === 'zoom' ? zoom(ctx) : sheet(ctx);
    (mode === 'board' ? ctx.layers.board : ctx.layers.overlay).addChild(current);
  };
};
