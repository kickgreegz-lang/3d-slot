import type { Texture } from 'pixi.js';
import type { ParticleKey } from '../assets/art';
import type { LayoutSpec } from '../config/layout';
import type { GameEvents } from '../game/events';
import { ALPHA, type ParticleSystem, SIZE, SPIN, type Sim } from './particles';
import { confettiTexture } from './textures';
import { darken, lighten, mixColor, pick, rand, randInt } from './util';

/**
 * Burst presets for `'fx:burst'`. Each preset is a small, hand-tuned recipe of
 * layered emitters (debris + light + smoke + ring) — the layering is what makes a
 * hit read as "AAA" instead of a single sprite spray.
 *
 * All sizes/speeds are authored for a 150 px cell and scaled by `layout.cell / 150`.
 * Lifetimes are physical (seconds of particle life), tuned here rather than in
 * TIMING because they are per-particle randomised ranges, not choreography.
 */
export type BurstKind = GameEvents['fx:burst']['kind'];
export type BurstPayload = GameEvents['fx:burst'];

export interface BurstContext {
  sys: ParticleSystem;
  tex: (key: ParticleKey) => Texture;
  layout: LayoutSpec;
}

/** Festive palette (theme neon + gold) for confetti / notes. */
export const PARTY_COLORS = [0xff3fa8, 0x35f2e0, 0xffd54a, 0x9dff4a, 0xff7a1a, 0x9b5cff, 0xffffff] as const;

const TAU = Math.PI * 2;

/** Default hue per kind when the payload has no colour. */
const DEFAULT_COLOR: Record<BurstKind, number> = {
  explode: 0xffd54a,
  dust: 0xcbb8e8,
  sparkle: 0xffe27a,
  coins: 0xffffff,
  confetti: 0xffffff,
  spotSpark: 0xffcc00,
  scatter: 0xffd54a,
};

const ring = (c: BurstContext, x: number, y: number, k: number, from: number, to: number, life: number, color: number, alpha = 0.95): Sim | null => {
  const s = c.sys.acquire(c.tex('ring'), 'add', 2);
  if (!s) return null;
  s.x = x;
  s.y = y;
  s.size0 = from * k;
  s.size1 = to * k;
  s.sizeMode = SIZE.easeOut;
  s.life = life;
  s.alpha0 = alpha;
  s.alphaMode = ALPHA.fade;
  s.color = color;
  s.rot = rand(0, TAU);
  return s;
};

const glow = (c: BurstContext, x: number, y: number, k: number, from: number, to: number, life: number, color: number, alpha = 0.85, mode: number = ALPHA.flash): Sim | null => {
  const s = c.sys.acquire(c.tex('glow'), 'add', 2);
  if (!s) return null;
  s.x = x;
  s.y = y;
  s.size0 = from * k;
  s.size1 = to * k;
  s.sizeMode = SIZE.easeOut;
  s.life = life;
  s.alpha0 = alpha;
  s.alphaMode = mode;
  s.color = color;
  return s;
};

const sparks = (c: BurstContext, x: number, y: number, k: number, n: number, color: number, speed: [number, number], opts: { up?: number; spread?: number; g?: number; size?: [number, number]; life?: [number, number] } = {}): void => {
  const tex = c.tex('spark');
  for (let i = 0; i < n; i++) {
    const s = c.sys.acquire(tex, 'add', 2);
    if (!s) return;
    const a = opts.up !== undefined ? -Math.PI / 2 + rand(-1, 1) * (opts.spread ?? 0.7) : rand(0, TAU);
    const v = rand(speed[0], speed[1]) * k;
    s.x = x + Math.cos(a) * 6 * k;
    s.y = y + Math.sin(a) * 6 * k;
    s.vx = Math.cos(a) * v;
    s.vy = Math.sin(a) * v;
    s.g = (opts.g ?? 900) * k;
    s.drag = 3;
    s.spin = SPIN.velocity;
    s.stretch = 0.0022 / k;
    const sz = opts.size ?? [14, 24];
    s.size0 = rand(sz[0], sz[1]) * k;
    s.size1 = s.size0 * 0.3;
    s.life = rand(...(opts.life ?? [0.28, 0.5]));
    s.alphaMode = ALPHA.fade;
    s.color = lighten(color, rand(0.35, 0.7));
  }
};

const stars = (c: BurstContext, x: number, y: number, k: number, n: number, color: number, radial: [number, number], opts: { radius?: [number, number]; life?: [number, number]; size?: [number, number]; delay?: number } = {}): void => {
  const tex = c.tex('star');
  for (let i = 0; i < n; i++) {
    const s = c.sys.acquire(tex, 'add', 2);
    if (!s) return;
    const a = rand(0, TAU);
    const r = rand(...(opts.radius ?? [0, 10])) * k;
    const v = rand(radial[0], radial[1]) * k;
    s.x = x + Math.cos(a) * r;
    s.y = y + Math.sin(a) * r;
    s.vx = Math.cos(a) * v;
    s.vy = Math.sin(a) * v - 30 * k;
    s.drag = 2.6;
    s.rot = rand(-0.4, 0.4);
    s.vrot = rand(-1.5, 1.5);
    const sz = opts.size ?? [26, 44];
    s.size0 = rand(sz[0], sz[1]) * k;
    s.size1 = s.size0 * 0.4;
    s.sizeMode = SIZE.pop;
    s.alphaMode = ALPHA.twinkle;
    s.phase = rand(0, TAU);
    s.life = rand(...(opts.life ?? [0.6, 1.1]));
    s.color = lighten(color, rand(0.1, 0.6));
    if (opts.delay) s.delay(rand(0, opts.delay));
  }
};

const explode = (c: BurstContext, p: BurstPayload, k: number, power: number, color: number): void => {
  const { x, y } = p;
  // `count` = total debris (shards + sparks); default 6-10 shards + 8-12 sparks
  const n = p.count !== undefined ? Math.max(3, Math.round(p.count * 0.45)) : randInt(6, 10);
  const nSparks = p.count !== undefined ? Math.max(3, p.count - n) : randInt(8, 12);
  // light first (additive flash + ring) so the eye lands on the impact
  glow(c, x, y, k, 260, 150, 0.2, lighten(color, 0.45), 1);
  ring(c, x, y, k, 60, 300 * (0.8 + 0.2 * power), 0.34, lighten(color, 0.5), 0.95);
  // smoke puff behind
  const smoke = c.tex('smoke');
  for (let i = 0; i < 3; i++) {
    const s = c.sys.acquire(smoke, 'normal', 0);
    if (!s) break;
    const a = rand(0, TAU);
    s.x = x + Math.cos(a) * 14 * k;
    s.y = y + Math.sin(a) * 14 * k;
    s.vx = Math.cos(a) * rand(30, 110) * k;
    s.vy = Math.sin(a) * rand(30, 110) * k - 40 * k;
    s.drag = 1.8;
    s.g = -50 * k;
    s.rot = rand(0, TAU);
    s.vrot = rand(-1, 1);
    s.size0 = rand(60, 90) * k;
    s.size1 = rand(140, 180) * k;
    s.sizeMode = SIZE.easeOut;
    s.alpha0 = 0.3;
    s.alphaMode = ALPHA.inOut;
    s.life = rand(0.45, 0.7);
    s.color = mixColor(color, 0xffffff, 0.25);
  }
  // tinted shards: cel colours of the symbol (base, highlight, shadow)
  const shard = c.tex('shard');
  const tones = [color, lighten(color, 0.35), darken(color, 0.3)];
  for (let i = 0; i < n; i++) {
    const s = c.sys.acquire(shard, 'normal', 1);
    if (!s) break;
    const a = (i / n) * TAU + rand(-0.3, 0.3);
    const v = rand(480, 1050) * k * (0.7 + 0.3 * power);
    s.x = x + Math.cos(a) * 18 * k;
    s.y = y + Math.sin(a) * 18 * k;
    s.vx = Math.cos(a) * v;
    s.vy = Math.sin(a) * v - 260 * k;
    s.g = 2600 * k;
    s.drag = 1.3;
    s.rot = rand(0, TAU);
    s.vrot = rand(-16, 16);
    s.size0 = rand(40, 64) * k * (0.8 + 0.2 * power);
    s.size1 = s.size0 * 0.5;
    s.alphaMode = ALPHA.late;
    s.life = rand(0.55, 0.85);
    s.color = tones[i % 3];
  }
  sparks(c, x, y, k, nSparks, color, [700, 1500], { size: [26, 40] });
};

const dust = (c: BurstContext, p: BurstPayload, k: number, power: number, color: number): void => {
  const n = p.count ?? 10;
  const tex = c.tex('dust');
  for (let i = 0; i < n; i++) {
    const s = c.sys.acquire(tex, 'normal', 0);
    if (!s) return;
    const side = i % 2 === 0 ? -1 : 1;
    s.x = p.x + side * rand(4, 34) * k;
    s.y = p.y + rand(-8, 4) * k;
    s.vx = side * rand(140, 480) * k * (0.6 + 0.4 * power);
    s.vy = -rand(15, 90) * k;
    s.drag = 3.6;
    s.g = -45 * k;
    s.rot = rand(0, TAU);
    s.vrot = side * rand(0.5, 2.5);
    s.size0 = rand(40, 66) * k;
    s.size1 = s.size0 * rand(1.8, 2.3);
    s.sizeMode = SIZE.easeOut;
    s.alpha0 = rand(0.4, 0.62);
    s.alphaMode = ALPHA.inOut;
    s.life = rand(0.45, 0.75);
    s.color = mixColor(color, 0xffffff, rand(0, 0.25));
  }
};

const sparkle = (c: BurstContext, p: BurstPayload, k: number, power: number, color: number): void => {
  stars(c, p.x, p.y, k, p.count ?? Math.round(10 * (0.6 + 0.4 * power)), color, [15, 60], {
    radius: [10, 85],
    delay: 0.35,
  });
};

const coins = (c: BurstContext, p: BurstPayload, k: number, power: number, color: number): void => {
  const n = p.count ?? 14;
  const tex = c.tex('coin');
  for (let i = 0; i < n; i++) {
    const s = c.sys.acquire(tex, 'normal', 1);
    if (!s) return;
    s.x = p.x + rand(-24, 24) * k;
    s.y = p.y + rand(-10, 10) * k;
    s.vx = rand(-440, 440) * k * power;
    s.vy = -rand(820, 1420) * k * power;
    s.g = 2600 * k;
    s.drag = 0.25;
    s.spin = SPIN.coin;
    s.spinSpeed = rand(8, 16) * (Math.random() < 0.5 ? -1 : 1);
    s.phase = rand(0, TAU);
    s.rot = rand(-0.35, 0.35);
    s.vrot = rand(-2, 2);
    // bigger (closer) coins for high-energy bursts, with depth variance
    s.size0 = s.size1 = rand(34, 50) * k * (0.7 + 0.3 * power) * (Math.random() < 0.2 ? 1.35 : 1);
    s.alphaMode = ALPHA.late;
    s.life = rand(1.45, 2.05);
    s.floorY = p.y + 250 * k * power;
    s.bounce = rand(0.32, 0.48);
    s.color = color;
    s.shade = mixColor(color, 0x6b3f0a, 0.6);
  }
};

const confetti = (c: BurstContext, p: BurstPayload, k: number, power: number): void => {
  const n = p.count ?? 36;
  const tex = confettiTexture();
  for (let i = 0; i < n; i++) {
    const s = c.sys.acquire(tex, 'normal', 1);
    if (!s) return;
    const a = -Math.PI / 2 + rand(-0.95, 0.95);
    const v = rand(650, 1500) * k * power;
    s.x = p.x + rand(-20, 20) * k;
    s.y = p.y + rand(-10, 10) * k;
    s.vx = Math.cos(a) * v;
    s.vy = Math.sin(a) * v;
    s.g = 1500 * k;
    s.drag = 2.3;
    s.spin = SPIN.flutter;
    s.spinSpeed = rand(8, 18);
    s.phase = rand(0, TAU);
    s.sway = rand(60, 170) * k;
    s.swayFreq = rand(3, 6);
    s.rot = rand(0, TAU);
    s.vrot = rand(-7, 7);
    s.size0 = s.size1 = rand(14, 22) * k;
    s.alphaMode = ALPHA.late;
    s.life = rand(1.8, 2.8);
    s.color = pick(PARTY_COLORS);
  }
};

const spotSpark = (c: BurstContext, p: BurstPayload, k: number, power: number, color: number): void => {
  glow(c, p.x, p.y, k, 120, 70, 0.14, lighten(color, 0.4), 0.8);
  ring(c, p.x, p.y, k, 36, 150, 0.24, lighten(color, 0.3), 0.9);
  sparks(c, p.x, p.y, k, p.count ?? 8, color, [260, 680], {
    up: 1,
    spread: 0.65,
    g: 950,
    size: [12, 20],
    life: [0.3, 0.5],
  });
  void power;
};

const scatter = (c: BurstContext, p: BurstPayload, k: number, power: number, color: number): void => {
  const { x, y } = p;
  glow(c, x, y, k, 250, 390, 0.75, lighten(color, 0.2), 0.95, ALPHA.inOut);
  ring(c, x, y, k, 120, 640 * (0.75 + 0.25 * power), 0.58, lighten(color, 0.25), 1);
  ring(c, x, y, k, 80, 420, 0.5, 0xffffff, 0.8)?.delay(0.08);
  stars(c, x, y, k, p.count ?? 18, color, [360, 900], { size: [24, 42], life: [0.7, 1.1] });
  sparks(c, x, y, k, 12, color, [900, 1700], { size: [18, 30], life: [0.3, 0.55] });
  // a few music notes float up — theme flavour
  const note = c.tex('note');
  for (let i = 0; i < 4; i++) {
    const s = c.sys.acquire(note, 'normal', 1);
    if (!s) break;
    s.x = x + rand(-50, 50) * k;
    s.y = y + rand(-20, 20) * k;
    s.vx = rand(-120, 120) * k;
    s.vy = -rand(160, 320) * k;
    s.drag = 1.2;
    s.sway = 120 * k;
    s.swayFreq = rand(4, 7);
    s.phase = rand(0, TAU);
    s.rot = rand(-0.3, 0.3);
    s.vrot = rand(-1.2, 1.2);
    s.size0 = rand(34, 46) * k;
    s.size1 = s.size0 * 0.8;
    s.sizeMode = SIZE.pop;
    s.alphaMode = ALPHA.late;
    s.life = rand(1, 1.4);
    s.color = pick(PARTY_COLORS);
    s.delay(rand(0.05, 0.25));
  }
};

/** Spawn a preset burst. */
export const spawnBurst = (c: BurstContext, p: BurstPayload): void => {
  const k = c.layout.cell / 150;
  const power = Math.max(0.1, p.power ?? 1);
  const color = p.color ?? DEFAULT_COLOR[p.kind];
  switch (p.kind) {
    case 'explode':
      explode(c, p, k, power, color);
      break;
    case 'dust':
      dust(c, p, k, power, color);
      break;
    case 'sparkle':
      sparkle(c, p, k, power, color);
      break;
    case 'coins':
      coins(c, p, k, power, color);
      break;
    case 'confetti':
      confetti(c, p, k, power);
      break;
    case 'spotSpark':
      spotSpark(c, p, k, power, color);
      break;
    case 'scatter':
      scatter(c, p, k, power, color);
      break;
  }
};
