import { Container, Graphics } from 'pixi.js';
import { CAB, CONE, INK, LINE, METAL, OUTLINE, PLUM, bolt, cornerCap } from './palette';

/**
 * `env_speaker_stack` placeholder parts (ANIMATION_SET §4.1), drawn in local space with the
 * anchor at the bottom centre of the lowerCabinet rect (x in [-w/2, w/2], y in [-h, 0]).
 * Same furniture as the Groove Meter's upper cabinet (plum-black wood, perforated grille,
 * gold corner caps), so the two read as one stack. Static parts are baked; the woofer is a
 * separate centred part that pumps.
 */
export interface CabinetGeom {
  /** body rect (without the plum extrusion) */
  bx: number;
  by: number;
  bw: number;
  bh: number;
  /** woofer centre + mount radius */
  wx: number;
  wy: number;
  mountR: number;
  /** cone radius (the pumping part) */
  coneR: number;
  /** bass ports (centres + radius) */
  ports: Array<{ x: number; y: number }>;
  portR: number;
  /** cable socket on the right side */
  socket: { x: number; y: number };
}

export const cabinetGeom = (w: number, h: number): CabinetGeom => {
  const bx = -w / 2 + 2;
  const by = -h + 4;
  const bw = w - 13;
  const bh = h - 20;
  const mountR = Math.min(bw, bh) * 0.36;
  const wy = by + bh * 0.4;
  const wx = bx + bw / 2;
  return {
    bx,
    by,
    bw,
    bh,
    wx,
    wy,
    mountR,
    coneR: mountR * 0.9,
    ports: [
      { x: bx + bw * 0.2, y: by + bh * 0.86 },
      { x: bx + bw * 0.8, y: by + bh * 0.86 },
    ],
    portR: bw * 0.07,
    socket: { x: bx + bw - 4, y: by + bh * 0.28 },
  };
};

/** Cabinet body: feet, extrusion, face with cel bands, grille, woofer collar, ports, corner caps. */
export const drawCabinet = (w: number, h: number): Container => {
  const G = cabinetGeom(w, h);
  const { bx, by, bw, bh } = G;
  const root = new Container();
  const g = new Graphics();
  // feet (under the extrusion so it wraps them)
  for (const fx of [bx + 16, bx + bw - 50]) {
    g.roundRect(fx, by + bh - 4, 40, 20, 5).fill(METAL.dark).stroke({ width: OUTLINE * 0.8, color: INK });
    g.rect(fx + 5, by + bh + 1, 30, 4).fill(METAL.base);
  }
  const r = 22;
  g.roundRect(bx + 9, by + 9, bw, bh, r).fill(PLUM).stroke({ width: OUTLINE, color: INK });
  g.roundRect(bx, by, bw, bh, r).fill(CAB.face).stroke({ width: OUTLINE, color: INK });
  // hard light band top + left, shadow band right + bottom
  g.roundRect(bx + 5, by + 5, bw - 10, 12, 9).fill(CAB.light);
  g.roundRect(bx + 5, by + 5, 12, bh - 10, 9).fill(CAB.light);
  g.roundRect(bx + bw - 17, by + 14, 12, bh - 19, 8).fill(CAB.shade);
  g.roundRect(bx + 14, by + bh - 17, bw - 19, 12, 8).fill(CAB.shade);
  root.addChild(g);

  // perforated grille panel; holes skip the woofer collar and the ports
  const gx = bx + 22;
  const gy = by + 22;
  const gw = bw - 44;
  const gh = bh - 44;
  const grill = new Graphics();
  grill.roundRect(gx, gy, gw, gh, 14).fill(CAB.grill);
  const clearR = G.mountR * 1.1;
  const portClear = G.portR * 1.5;
  let row = 0;
  for (let y = gy + 7; y < gy + gh - 4; y += 8.5, row++) {
    for (let x = gx + 7 + (row % 2) * 4.25; x < gx + gw - 4; x += 8.5) {
      if ((x - G.wx) ** 2 + (y - G.wy) ** 2 < clearR * clearR) continue;
      if (G.ports.some((p) => (x - p.x) ** 2 + (y - p.y) ** 2 < portClear * portClear)) continue;
      grill.circle(x, y, 2.3);
    }
  }
  grill.fill(CAB.hole);
  grill.poly([gx + gw, gy + gh * 0.18, gx + gw, gy + gh, gx + gw * 0.12, gy + gh], true).fill({ color: INK, alpha: 0.2 });
  grill.roundRect(gx, gy, gw, gh, 14).stroke({ width: 3, color: INK });
  root.addChild(grill);

  // woofer collar (cabinet_front): dark bevelled ring the cone sits in, with 8 bolts
  const m = new Graphics();
  m.circle(G.wx, G.wy, G.mountR).fill(CAB.mount).stroke({ width: OUTLINE, color: INK });
  m.moveTo(G.wx + Math.cos(-2.1) * G.mountR * 0.96, G.wy + Math.sin(-2.1) * G.mountR * 0.96)
    .arc(G.wx, G.wy, G.mountR * 0.96, -2.1, -0.2)
    .stroke({ width: G.mountR * 0.045, color: CAB.light });
  m.moveTo(G.wx + Math.cos(1.0) * G.mountR * 0.96, G.wy + Math.sin(1.0) * G.mountR * 0.96)
    .arc(G.wx, G.wy, G.mountR * 0.96, 1.0, 2.9)
    .stroke({ width: G.mountR * 0.045, color: INK, alpha: 0.5 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    bolt(m, G.wx + Math.cos(a) * G.mountR * 0.95, G.wy + Math.sin(a) * G.mountR * 0.95, G.mountR * 0.045);
  }
  root.addChild(m);

  // bass ports: metal flare ring + deep hole
  const p = new Graphics();
  for (const q of G.ports) {
    p.circle(q.x, q.y, G.portR).fill(METAL.base).stroke({ width: OUTLINE * 0.8, color: INK });
    p.moveTo(q.x + Math.cos(-2.6) * G.portR * 0.86, q.y + Math.sin(-2.6) * G.portR * 0.86)
      .arc(q.x, q.y, G.portR * 0.86, -2.6, -0.6)
      .stroke({ width: G.portR * 0.16, color: METAL.light });
    p.circle(q.x, q.y, G.portR * 0.66).fill(CAB.hole).stroke({ width: LINE, color: INK });
    p.circle(q.x + G.portR * 0.18, q.y + G.portR * 0.2, G.portR * 0.4).fill({ color: 0x000000, alpha: 0.6 });
  }
  // cable socket (the cable plugs in here)
  p.roundRect(G.socket.x - 10, G.socket.y - 12, 16, 24, 4).fill(METAL.base).stroke({ width: LINE, color: INK });
  p.circle(G.socket.x - 2, G.socket.y, 3.5).fill(CAB.hole);
  root.addChild(p);

  // gold corner protectors
  const corners = new Graphics();
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    const x = sx < 0 ? bx - 4 : bx + bw + 4;
    const y = sy < 0 ? by - 4 : by + bh + 4;
    cornerCap(corners, x, y, sx, sy, 38);
  }
  root.addChild(corners);
  return root;
};

/** Skin piping inside the cabinet border (white, tinted per mode like the meter's trim). */
export const drawCabinetTrim = (w: number, h: number): Graphics => {
  const { bx, by, bw, bh } = cabinetGeom(w, h);
  return new Graphics().roundRect(bx + 13, by + 13, bw - 26, bh - 26, 16).stroke({ width: 3, color: 0xffffff });
};

/**
 * Woofer (the `woofer` mesh slot): rubber surround with a lit arc, a cone with concentric cel
 * rings and a hard shade crescent, a metal dust cap with a specular. Centred on (0, 0).
 */
export const drawWoofer = (r: number): Graphics => {
  const g = new Graphics();
  g.circle(0, 0, r).fill(CONE.ring).stroke({ width: OUTLINE, color: INK });
  g.moveTo(Math.cos(-2.5) * r * 0.9, Math.sin(-2.5) * r * 0.9)
    .arc(0, 0, r * 0.9, -2.5, -0.9)
    .stroke({ width: r * 0.07, color: CONE.light });
  g.circle(0, 0, r * 0.8).fill(CONE.base).stroke({ width: LINE, color: INK });
  for (const k of [0.66, 0.52]) g.circle(0, 0, r * k).stroke({ width: 2, color: CONE.shade });
  // hard shade crescent lower-right (key light top-left)
  g.moveTo(Math.cos(-0.4) * r * 0.8, Math.sin(-0.4) * r * 0.8)
    .arc(0, 0, r * 0.8, -0.4, 2.2)
    .arc(r * 0.1, r * 0.12, r * 0.74, 2.2, -0.4, true)
    .fill({ color: INK, alpha: 0.28 });
  // dust cap
  const c = r * 0.34;
  g.circle(0, 0, c).fill(METAL.base).stroke({ width: OUTLINE * 0.7, color: INK });
  g.moveTo(Math.cos(-2.8) * c * 0.8, Math.sin(-2.8) * c * 0.8)
    .arc(0, 0, c * 0.8, -2.8, -0.7)
    .stroke({ width: c * 0.2, color: METAL.light });
  g.ellipse(-c * 0.35, -c * 0.4, c * 0.2, c * 0.1).fill({ color: 0xffffff, alpha: 0.9 });
  return g;
};
