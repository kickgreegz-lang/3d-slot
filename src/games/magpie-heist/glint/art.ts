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

/**
 * The glint tile for one cell: a vault-gold square with a raised bevelled rim, a darker engraved channel,
 * corner rivets and a soft lattice in the leaf (the symbol covers the centre, so the rim carries the look).
 */
export const glintTileTexture = (cell: number): Texture => {
  const s = shipped.get('glint');
  if (s) return s;
  return once(`glint:${Math.round(cell)}`, () => {
    const S = Math.round(cell * PX);
    const [c, g] = createCanvas(S, S);
    const R = S * 0.13;
    const rr = (i: number, r = R): void => {
      g.beginPath();
      g.roundRect(i, i, S - i * 2, S - i * 2, Math.max(2, r - i * 0.45));
    };
    // outer rim: bright polished gold, lit upper left
    const rim = g.createLinearGradient(0, 0, S, S);
    rim.addColorStop(0, '#fff7cf');
    rim.addColorStop(0.25, '#ffd24a');
    rim.addColorStop(0.6, '#d48d12');
    rim.addColorStop(1, '#7c4304');
    rr(S * 0.02);
    g.fillStyle = rim;
    g.fill();
    // engraved channel
    rr(S * 0.075);
    const ch = g.createLinearGradient(0, 0, S, S);
    ch.addColorStop(0, '#8a5206');
    ch.addColorStop(1, '#4a2702');
    g.fillStyle = ch;
    g.fill();
    // leaf field: warm radial gold, brighter upper left
    rr(S * 0.1);
    const leaf = g.createRadialGradient(S * 0.32, S * 0.28, S * 0.05, S * 0.5, S * 0.5, S * 0.75);
    leaf.addColorStop(0, '#f6dc8c');
    leaf.addColorStop(0.35, '#e2b143');
    leaf.addColorStop(0.75, '#c48a22');
    leaf.addColorStop(1, '#8e540c');
    g.fillStyle = leaf;
    g.fill();
    // lattice + brushed texture inside the field
    g.save();
    rr(S * 0.1);
    g.clip();
    g.globalAlpha = 0.16;
    g.strokeStyle = '#7a4204';
    g.lineWidth = S * 0.006;
    const step = S / 7;
    for (let x = -S; x < S * 2; x += step) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + S, S);
      g.stroke();
      g.beginPath();
      g.moveTo(x + S, 0);
      g.lineTo(x, S);
      g.stroke();
    }
    g.globalAlpha = 0.08;
    g.strokeStyle = '#ffffff';
    for (let i = 0; i < S; i += 4) {
      g.beginPath();
      g.moveTo(0, i);
      g.lineTo(S, i + S * 0.1);
      g.stroke();
    }
    g.globalAlpha = 1;
    // inner shadow under the rim
    const sh = g.createLinearGradient(0, 0, 0, S);
    sh.addColorStop(0, 'rgba(70,35,0,0.45)');
    sh.addColorStop(0.12, 'rgba(70,35,0,0)');
    sh.addColorStop(0.9, 'rgba(255,240,180,0)');
    sh.addColorStop(1, 'rgba(255,240,180,0.35)');
    g.fillStyle = sh;
    g.fillRect(0, 0, S, S);
    g.restore();
    // rim highlights: a bright inner line top-left, a dark one bottom-right
    g.lineWidth = S * 0.012;
    const hl = g.createLinearGradient(0, 0, S, S);
    hl.addColorStop(0, 'rgba(255,255,255,0.95)');
    hl.addColorStop(0.5, 'rgba(255,255,255,0)');
    hl.addColorStop(1, 'rgba(60,25,0,0.7)');
    g.strokeStyle = hl;
    rr(S * 0.035);
    g.stroke();
    // corner rivets
    for (const [x, y] of [
      [0.06, 0.06],
      [0.94, 0.06],
      [0.06, 0.94],
      [0.94, 0.94],
    ]) {
      const cx = x * S;
      const cy = y * S;
      const r = S * 0.028;
      const rv = g.createRadialGradient(cx - r * 0.4, cy - r * 0.4, r * 0.1, cx, cy, r);
      rv.addColorStop(0, '#ffffff');
      rv.addColorStop(0.4, '#ffd768');
      rv.addColorStop(1, '#6a3a04');
      g.fillStyle = rv;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.fill();
    }
    // outline
    g.lineWidth = S * 0.014;
    g.strokeStyle = '#2a1402';
    rr(S * 0.02);
    g.stroke();
    return canvasToTexture(c, PX);
  });
};

/**
 * The velvet display cushion the loot sits on (covers the symbol under it): deep midnight velvet with
 * a soft top sheen and an inner shadow, inset inside the gold rim.
 */
export const cushionTexture = (cell: number): Texture =>
  once(`cushion:${Math.round(cell)}`, () => {
    const S = Math.round(cell * PX);
    const [c, g] = createCanvas(S, S);
    const i = S * 0.1;
    const R = S * 0.1;
    g.beginPath();
    g.roundRect(i, i, S - i * 2, S - i * 2, R);
    const v = g.createRadialGradient(S * 0.5, S * 0.36, S * 0.05, S * 0.5, S * 0.55, S * 0.6);
    v.addColorStop(0, '#3a2a6e');
    v.addColorStop(0.55, '#1f1746');
    v.addColorStop(1, '#0d0a24');
    g.fillStyle = v;
    g.fill();
    g.save();
    g.clip();
    // tufted buttons (a quilted display cushion)
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (const [x, y] of [
      [0.3, 0.3],
      [0.7, 0.3],
      [0.3, 0.7],
      [0.7, 0.7],
      [0.5, 0.5],
    ]) {
      g.beginPath();
      g.arc(x * S, y * S, S * 0.018, 0, Math.PI * 2);
      g.fill();
    }
    const inner = g.createLinearGradient(0, i, 0, S - i);
    inner.addColorStop(0, 'rgba(0,0,0,0.55)');
    inner.addColorStop(0.15, 'rgba(0,0,0,0)');
    inner.addColorStop(0.85, 'rgba(0,0,0,0)');
    inner.addColorStop(1, 'rgba(0,0,0,0.4)');
    g.fillStyle = inner;
    g.fillRect(0, 0, S, S);
    g.restore();
    g.lineWidth = S * 0.012;
    g.strokeStyle = 'rgba(20,10,30,0.9)';
    g.beginPath();
    g.roundRect(i, i, S - i * 2, S - i * 2, R);
    g.stroke();
    return canvasToTexture(c, PX);
  });

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
