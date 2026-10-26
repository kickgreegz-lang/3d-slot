import { Assets, type Texture } from 'pixi.js';
import { canvasToTexture, createCanvas } from '../../../fx/textures';
import type { LootTier } from '../config';

/**
 * Loot and glint-square textures. Production files (./assets/magpie-heist/loot/*.webp, matted from the
 * Higgsfield loot sheet, ART_PLAN §3) win; until they ship each one is painted here with Canvas2D in
 * the game's cartoon finish (single-weight black outline, soft cel gradients, key light upper left,
 * a crisp specular). All are square, authored at 2x of `size` design px.
 */
const ROOT = './assets/magpie-heist/loot';
const cache = new Map<string, Texture>();
const shipped = new Map<string, Texture | null>();

const once = (key: string, make: () => Texture): Texture => {
  let t = cache.get(key);
  if (!t) {
    t = make();
    cache.set(key, t);
  }
  return t;
};

/** Load the shipped loot art (missing files keep the painted fallback). */
export const loadLootArt = async (): Promise<void> => {
  const names = ['coin_bronze', 'coin_silver', 'coin_gold', 'diamond', 'nest', 'glint'];
  await Promise.all(
    names.map(async (n) => {
      if (shipped.has(n)) return;
      try {
        shipped.set(n, await Assets.load<Texture>(`${ROOT}/${n}@2x.webp`));
      } catch {
        shipped.set(n, null);
      }
    }),
  );
};

const PX = 2;
const OUT = '#120a14';

const METAL: Record<LootTier, { hi: string; mid: string; lo: string; rim: string; deep: string }> = {
  bronze: { hi: '#ffd6a8', mid: '#e0884a', lo: '#9a4a1e', rim: '#b8622c', deep: '#5c2810' },
  silver: { hi: '#ffffff', mid: '#cfd9e6', lo: '#7d8ba3', rim: '#a9b6c9', deep: '#3e4a60' },
  gold: { hi: '#fff6c4', mid: '#ffc53d', lo: '#c27a12', rim: '#e8a020', deep: '#6a3a06' },
};

/** A thick cartoon coin seen straight on: rim, beaded ring, embossed star ring, a plain centre for the value. */
export const coinTexture = (tier: LootTier, size = 120): Texture => {
  const s = shipped.get(`coin_${tier}`);
  if (s) return s;
  return once(`coin:${tier}:${size}`, () => {
    const S = size * PX;
    const [c, g] = createCanvas(S, S);
    const m = METAL[tier];
    const cx = S / 2;
    const cy = S / 2;
    const R = S * 0.44;
    const ol = S * 0.03;
    // edge thickness (the coin's side, lower right)
    g.fillStyle = m.deep;
    g.beginPath();
    g.arc(cx + R * 0.04, cy + R * 0.07, R, 0, Math.PI * 2);
    g.fill();
    // face
    const face = g.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R * 1.05);
    face.addColorStop(0, m.hi);
    face.addColorStop(0.45, m.mid);
    face.addColorStop(1, m.lo);
    g.fillStyle = face;
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.fill();
    // rim ring
    g.lineWidth = R * 0.13;
    g.strokeStyle = m.rim;
    g.beginPath();
    g.arc(cx, cy, R * 0.88, 0, Math.PI * 2);
    g.stroke();
    const rimLight = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    rimLight.addColorStop(0, 'rgba(255,255,255,0.75)');
    rimLight.addColorStop(0.5, 'rgba(255,255,255,0)');
    rimLight.addColorStop(1, 'rgba(0,0,0,0.25)');
    g.strokeStyle = rimLight;
    g.stroke();
    // beads
    g.fillStyle = m.hi;
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      g.beginPath();
      g.arc(cx + Math.cos(a) * R * 0.88, cy + Math.sin(a) * R * 0.88, R * 0.028, 0, Math.PI * 2);
      g.fill();
    }
    // inner medallion (plain, for the live value)
    g.lineWidth = ol * 0.7;
    g.strokeStyle = m.deep;
    g.beginPath();
    g.arc(cx, cy, R * 0.7, 0, Math.PI * 2);
    g.stroke();
    const med = g.createLinearGradient(cx, cy - R * 0.7, cx, cy + R * 0.7);
    med.addColorStop(0, m.mid);
    med.addColorStop(1, m.lo);
    g.fillStyle = med;
    g.beginPath();
    g.arc(cx, cy, R * 0.66, 0, Math.PI * 2);
    g.fill();
    // embossed stars around the medallion
    g.fillStyle = m.hi;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      star(g, cx + Math.cos(a) * R * 0.77, cy + Math.sin(a) * R * 0.77, R * 0.05);
    }
    // outline
    g.lineWidth = ol;
    g.strokeStyle = OUT;
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.stroke();
    // specular
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.beginPath();
    g.ellipse(cx - R * 0.42, cy - R * 0.5, R * 0.16, R * 0.08, -0.6, 0, Math.PI * 2);
    g.fill();
    return canvasToTexture(c, PX);
  });
};

const star = (g: CanvasRenderingContext2D, x: number, y: number, r: number): void => {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
};

/** A big brilliant-cut diamond in a gold claw setting, frontal. */
export const diamondTexture = (size = 120): Texture => {
  const s = shipped.get('diamond');
  if (s) return s;
  return once(`diamond:${size}`, () => {
    const S = size * PX;
    const [c, g] = createCanvas(S, S);
    const cx = S / 2;
    const top = S * 0.24;
    const girdle = S * 0.42;
    const bottom = S * 0.86;
    const w = S * 0.4;
    const ol = S * 0.028;
    const crown: Array<[number, number]> = [
      [cx - w, girdle],
      [cx - w * 0.62, top],
      [cx + w * 0.62, top],
      [cx + w, girdle],
    ];
    // claws (behind)
    g.fillStyle = '#e8a020';
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.ellipse(cx + sx * w * 0.98, girdle + S * 0.02, S * 0.05, S * 0.08, 0, 0, Math.PI * 2);
      g.fill();
    }
    // pavilion facets
    const facet = (pts: Array<[number, number]>, fill: string): void => {
      g.fillStyle = fill;
      g.beginPath();
      for (const [x, y] of pts) g.lineTo(x, y);
      g.closePath();
      g.fill();
    };
    facet([[cx - w, girdle], [cx, bottom], [cx - w * 0.45, girdle]], '#6fd6f5');
    facet([[cx - w * 0.45, girdle], [cx, bottom], [cx, girdle]], '#b9f1ff');
    facet([[cx, girdle], [cx, bottom], [cx + w * 0.45, girdle]], '#5ac2ea');
    facet([[cx + w * 0.45, girdle], [cx, bottom], [cx + w, girdle]], '#2f8fc6');
    // crown facets
    facet([[cx - w, girdle], [cx - w * 0.62, top], [cx - w * 0.25, girdle]], '#c9f6ff');
    facet([[cx - w * 0.62, top], [cx, top], [cx - w * 0.25, girdle]], '#ffffff');
    facet([[cx - w * 0.25, girdle], [cx, top], [cx + w * 0.25, girdle]], '#a8ecff');
    facet([[cx, top], [cx + w * 0.62, top], [cx + w * 0.25, girdle]], '#7fdcf7');
    facet([[cx + w * 0.25, girdle], [cx + w * 0.62, top], [cx + w, girdle]], '#4bb2df');
    // facet lines
    g.strokeStyle = 'rgba(20,40,80,0.45)';
    g.lineWidth = ol * 0.35;
    for (const [x0, y0, x1, y1] of [
      [cx - w * 0.45, girdle, cx, bottom],
      [cx, girdle, cx, bottom],
      [cx + w * 0.45, girdle, cx, bottom],
      [cx - w * 0.25, girdle, cx - w * 0.62, top],
      [cx - w * 0.25, girdle, cx, top],
      [cx + w * 0.25, girdle, cx, top],
      [cx + w * 0.25, girdle, cx + w * 0.62, top],
      [cx - w, girdle, cx + w, girdle],
    ]) {
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
    }
    // outline
    g.lineWidth = ol;
    g.strokeStyle = OUT;
    g.lineJoin = 'round';
    g.beginPath();
    for (const [x, y] of crown) g.lineTo(x, y);
    g.lineTo(cx, bottom);
    g.closePath();
    g.stroke();
    // sparkle
    g.fillStyle = '#ffffff';
    star(g, cx - w * 0.35, top + S * 0.05, S * 0.06);
    return canvasToTexture(c, PX);
  });
};

/** A woven twig nest heaped with coins and a pearl string. */
export const nestTexture = (size = 130): Texture => {
  const s = shipped.get('nest');
  if (s) return s;
  return once(`nest:${size}`, () => {
    const S = size * PX;
    const [c, g] = createCanvas(S, S);
    const cx = S / 2;
    const cy = S * 0.6;
    const rx = S * 0.42;
    const ry = S * 0.24;
    const ol = S * 0.026;
    // heap of coins (behind the front rim)
    const coin = (x: number, y: number, r: number): void => {
      const gr = g.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r);
      gr.addColorStop(0, '#fff3b0');
      gr.addColorStop(0.5, '#ffc53d');
      gr.addColorStop(1, '#b8700e');
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(x, y, r, r * 0.92, 0, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = ol * 0.6;
      g.strokeStyle = OUT;
      g.stroke();
    };
    for (const [dx, dy, r] of [
      [-0.2, -0.16, 0.13],
      [0.16, -0.2, 0.12],
      [0.0, -0.3, 0.13],
      [-0.05, -0.12, 0.12],
      [0.25, -0.08, 0.1],
      [-0.28, -0.04, 0.1],
    ] as Array<[number, number, number]>) {
      coin(cx + dx * S, cy + dy * S, r * S);
    }
    // pearls
    g.fillStyle = '#fff8ec';
    for (let i = 0; i < 7; i++) {
      const x = cx - S * 0.3 + i * S * 0.1;
      const y = cy - S * 0.02 + Math.sin(i * 0.9) * S * 0.03;
      g.beginPath();
      g.arc(x, y, S * 0.03, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = ol * 0.4;
      g.strokeStyle = OUT;
      g.stroke();
    }
    // the nest bowl
    const bowl = g.createLinearGradient(0, cy - ry, 0, cy + ry * 1.4);
    bowl.addColorStop(0, '#a0703c');
    bowl.addColorStop(0.5, '#7a4a22');
    bowl.addColorStop(1, '#4a2a12');
    g.fillStyle = bowl;
    g.beginPath();
    g.ellipse(cx, cy + ry * 0.2, rx, ry * 1.25, 0, 0, Math.PI);
    g.lineTo(cx - rx, cy);
    g.ellipse(cx, cy, rx, ry * 0.45, 0, Math.PI, 0, false);
    g.closePath();
    g.fill();
    // twigs
    let seed = 7;
    const rnd = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    g.lineCap = 'round';
    for (let i = 0; i < 46; i++) {
      const a0 = Math.PI * (0.02 + rnd() * 0.96);
      const yy = cy + ry * (0.1 + rnd() * 1.0);
      const x0 = cx - rx * 1.02 + rnd() * rx * 0.6;
      const len = rx * (0.6 + rnd() * 0.9);
      const tilt = (rnd() - 0.5) * 0.5;
      g.strokeStyle = i % 3 === 0 ? '#c8945a' : i % 3 === 1 ? '#6a3e1a' : '#9a6834';
      g.lineWidth = S * (0.008 + rnd() * 0.012);
      g.beginPath();
      g.moveTo(x0, yy);
      g.quadraticCurveTo(x0 + len * 0.5, yy + Math.sin(a0) * ry * 0.3 + tilt * ry, Math.min(cx + rx, x0 + len), yy + tilt * ry * 0.6);
      g.stroke();
    }
    // front rim twigs
    g.lineWidth = S * 0.022;
    g.strokeStyle = '#b07a42';
    g.beginPath();
    g.ellipse(cx, cy, rx * 0.98, ry * 0.42, 0, 0.05, Math.PI - 0.05);
    g.stroke();
    // outline
    g.lineWidth = ol;
    g.strokeStyle = OUT;
    g.beginPath();
    g.ellipse(cx, cy + ry * 0.2, rx, ry * 1.25, 0, 0, Math.PI);
    g.stroke();
    g.beginPath();
    g.ellipse(cx, cy, rx, ry * 0.45, 0, Math.PI, Math.PI * 2);
    g.stroke();
    return canvasToTexture(c, PX);
  });
};

/** The gold-leaf glint tile for one cell (rounded square), with a thin bright rim and engraved border. */
export const glintTileTexture = (cell: number): Texture => {
  const s = shipped.get('glint');
  if (s) return s;
  return once(`glint:${Math.round(cell)}`, () => {
    const S = Math.round(cell * PX);
    const [c, g] = createCanvas(S, S);
    const r = S * 0.12;
    const inset = S * 0.03;
    const path = (i: number): void => {
      g.beginPath();
      g.roundRect(i, i, S - i * 2, S - i * 2, Math.max(2, r - i * 0.5));
    };
    const leaf = g.createLinearGradient(0, 0, S, S);
    leaf.addColorStop(0, '#fff2b8');
    leaf.addColorStop(0.28, '#ffd35a');
    leaf.addColorStop(0.62, '#e8a21c');
    leaf.addColorStop(1, '#a8620a');
    path(inset);
    g.fillStyle = leaf;
    g.fill();
    // brushed texture
    g.globalAlpha = 0.12;
    for (let i = 0; i < S; i += 3) {
      g.strokeStyle = i % 6 ? '#ffffff' : '#7a4a06';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, i);
      g.lineTo(S, i + S * 0.15);
      g.stroke();
    }
    g.globalAlpha = 1;
    // engraved inner border
    g.lineWidth = S * 0.018;
    g.strokeStyle = 'rgba(122,70,6,0.8)';
    path(S * 0.1);
    g.stroke();
    g.lineWidth = S * 0.008;
    g.strokeStyle = 'rgba(255,248,210,0.9)';
    path(S * 0.115);
    g.stroke();
    // corner diamonds
    g.fillStyle = 'rgba(255,250,220,0.9)';
    for (const [x, y] of [
      [S * 0.1, S * 0.1],
      [S * 0.9, S * 0.1],
      [S * 0.1, S * 0.9],
      [S * 0.9, S * 0.9],
    ]) {
      g.beginPath();
      g.moveTo(x, y - S * 0.035);
      g.lineTo(x + S * 0.035, y);
      g.lineTo(x, y + S * 0.035);
      g.lineTo(x - S * 0.035, y);
      g.closePath();
      g.fill();
    }
    // bevel: bright rim top-left, dark bottom-right
    const bevel = g.createLinearGradient(0, 0, S, S);
    bevel.addColorStop(0, 'rgba(255,255,255,0.95)');
    bevel.addColorStop(0.5, 'rgba(255,255,255,0.1)');
    bevel.addColorStop(1, 'rgba(60,30,0,0.8)');
    g.lineWidth = S * 0.03;
    g.strokeStyle = bevel;
    path(inset + S * 0.015);
    g.stroke();
    g.lineWidth = S * 0.012;
    g.strokeStyle = '#3a1e04';
    path(inset);
    g.stroke();
    return canvasToTexture(c, PX);
  });
};

/** A diagonal light band (white, additive) for the tiles' shimmer sweep. */
export const shineTexture = (): Texture =>
  once('shine', () => {
    const [c, g] = createCanvas(128, 128);
    const grad = g.createLinearGradient(0, 128, 128, 0);
    grad.addColorStop(0.35, 'rgba(255,255,255,0)');
    grad.addColorStop(0.47, 'rgba(255,255,255,0.75)');
    grad.addColorStop(0.5, 'rgba(255,255,255,1)');
    grad.addColorStop(0.53, 'rgba(255,255,255,0.75)');
    grad.addColorStop(0.65, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return canvasToTexture(c);
  });

/** A rounded-square outline glow (white) that rings a cell. */
export const cellRingTexture = (cell: number): Texture =>
  once(`ring:${Math.round(cell)}`, () => {
    const S = Math.round(cell * 1.3);
    const [c, g] = createCanvas(S, S);
    const pad = (S - cell) / 2;
    for (let i = 12; i >= 1; i--) {
      g.strokeStyle = `rgba(255,255,255,${(0.08 * (13 - i)) / 12})`;
      g.lineWidth = i * 2;
      g.beginPath();
      g.roundRect(pad, pad, cell, cell, cell * 0.14);
      g.stroke();
    }
    g.strokeStyle = 'rgba(255,255,255,1)';
    g.lineWidth = 3;
    g.beginPath();
    g.roundRect(pad, pad, cell, cell, cell * 0.14);
    g.stroke();
    return canvasToTexture(c);
  });
