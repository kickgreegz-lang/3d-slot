import { Container, Graphics } from 'pixi.js';
import { BRASS, CAB, INK, LINE, METAL, OUTLINE, PLUM, bolt } from './palette';

/**
 * `env_horn` placeholder parts (ANIMATION_SET §4.3): a brass PA horn bolted onto the frame's
 * top corner, flaring up and out of the frame. Local space = the LEFT horn at landscape size
 * (frameHorns rect 116 x 100) with the anchor (0, 0) on the bolt point, i.e. the frame's
 * top-left corner (the beam runs toward +x, the post toward +y); the right horn is the same
 * rig mirrored (scale.x -1). Parts: bracket + driver can (static), the bell (pivot at its
 * throat, flares), the mouth trim ring (tinted per mode) and the fx slots.
 */
export const HORN_REF_W = 116;

/** Horn axis, driver can and bell geometry (left horn, landscape px). */
export const HORN = (() => {
  const D = { x: 30, y: 24 };
  const M = { x: -17, y: -19 };
  const len = Math.hypot(M.x - D.x, M.y - D.y);
  const u = { x: (M.x - D.x) / len, y: (M.y - D.y) / len };
  const n = { x: -u.y, y: u.x };
  const throat = { x: D.x + u.x * 16, y: D.y + u.y * 16 };
  return {
    /** driver can centre, mouth centre, unit axis (driver -> mouth) and its normal */
    D,
    M,
    u,
    n,
    throat,
    canR: 16,
    throatR: 8,
    mouthR: 29,
    /** mouth ellipse minor axis (the mouth faces up-left, seen at 3/4) */
    mouthDepth: 12,
    /** recoil distance (8 rig units at 2x = 4 design px) */
    recoil: 4,
  };
})();

const add = (a: { x: number; y: number }, b: { x: number; y: number }, k: number) => ({ x: a.x + b.x * k, y: a.y + b.y * k });

/** Iron corner strap bolted on the frame corner (static `bracket`). */
export const drawHornBracket = (): Graphics => {
  const g = new Graphics();
  g.poly([-7, -6, 66, -6, 66, 9, 9, 9, 9, 46, -7, 46], true)
    .fill(METAL.shade)
    .stroke({ width: OUTLINE * 0.8, color: INK, join: 'round' });
  g.poly([-3, -2, 62, -2, 62, 2, 1, 2, 1, 42, -3, 42], true).fill(METAL.base);
  bolt(g, 1, 36, 3.4);
  bolt(g, 54, 2, 3.4);
  bolt(g, 2, 2, 3.4);
  return g;
};

/** Driver can with its gold clamp band (`horn_body`; recoils with the bell). */
export const drawHornCan = (): Container => {
  const H = HORN;
  const root = new Container();
  const back = add(H.D, H.u, -13);
  const front = add(H.D, H.u, 12);
  const r = H.canR;
  const can = new Graphics();
  // plum extrusion lower-right, then the body
  can.poly(capsule(back.x + 5, back.y + 5, front.x + 5, front.y + 5, r), true).fill(PLUM).stroke({ width: OUTLINE, color: INK, join: 'round' });
  can.poly(capsule(back.x, back.y, front.x, front.y, r), true).fill(METAL.base).stroke({ width: OUTLINE, color: INK, join: 'round' });
  // light band on the +n side (faces the top-left key light), shade band on -n
  can.poly(band(back, front, H.n, r * 0.45, r * 0.85), true).fill(METAL.light);
  can.poly(band(back, front, H.n, -r * 0.85, -r * 0.4), true).fill(METAL.shade);
  // gold clamp band around the middle
  const c0 = add(H.D, H.u, -2);
  const c1 = add(H.D, H.u, 4);
  can.poly(band(c0, c1, H.n, -r - 2, r + 2), true).fill(BRASS.base).stroke({ width: LINE, color: INK, join: 'round' });
  bolt(can, H.D.x + H.u.x + H.n.x * (r + 1), H.D.y + H.u.y + H.n.y * (r + 1), 3);
  root.addChild(can);
  // rear cap (rotated ellipse)
  const cap = new Graphics().ellipse(0, 0, r * 0.4, r * 0.96).fill(METAL.shade).stroke({ width: LINE, color: INK });
  cap.ellipse(-r * 0.05, -r * 0.2, r * 0.18, r * 0.5).fill(METAL.base);
  cap.position.set(back.x, back.y);
  cap.rotation = Math.atan2(H.u.y, H.u.x);
  root.addChild(cap);
  return root;
};

/** A cel dust puff (fx_puff fallback): three lumps, lavender with a shade band, black outline. */
export const drawPuff = (): Graphics => {
  const g = new Graphics();
  const lumps: Array<[number, number, number]> = [
    [-7, 2, 9],
    [5, -3, 11],
    [8, 6, 7],
  ];
  // merged silhouette: all outlines first, then the fills over them
  for (const [x, y, r] of lumps) g.circle(x, y, r + 2.2).fill(INK);
  for (const [x, y, r] of lumps) g.circle(x, y, r).fill(0xd6cce2);
  for (const [x, y, r] of lumps) g.circle(x + r * 0.25, y + r * 0.3, r * 0.62).fill(0xa99bbd);
  for (const [x, y, r] of lumps) g.circle(x - r * 0.3, y - r * 0.35, r * 0.28).fill(0xf4efff);
  return g;
};

/**
 * The flared brass bell, drawn with its THROAT at (0, 0) so a sprite anchored there flares
 * about it: exponential flare to the mouth, cel light band on the lit side, shade band on
 * the other, the mouth rim, the dark interior and a phase plug. The trim ring is separate.
 */
export const drawHornBell = (): Container => {
  const H = HORN;
  const root = new Container();
  const T = { x: 0, y: 0 };
  const M = { x: H.M.x - H.throat.x, y: H.M.y - H.throat.y };
  const L = Math.hypot(M.x, M.y);
  /** one flank of the flare (sgn +1 = the +n side) */
  const side = (sgn: number): number[] => {
    const pts: number[] = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const r = H.throatR + (H.mouthR - H.throatR) * t ** 2.2;
      const c = add(T, H.u, L * t);
      pts.push(c.x + H.n.x * r * sgn, c.y + H.n.y * r * sgn);
    }
    return pts;
  };
  const outline = (): number[] => {
    const a = side(1);
    const b = side(-1);
    const out: number[] = [...a];
    for (let i = b.length - 2; i >= 0; i -= 2) out.push(b[i], b[i + 1]);
    return out;
  };
  const g = new Graphics();
  // extrusion toward the lower right, then the brass body
  g.poly(outline().map((v) => v + 5), true).fill(PLUM).stroke({ width: OUTLINE, color: INK, join: 'round' });
  g.poly(outline(), true).fill(BRASS.base).stroke({ width: OUTLINE, color: INK, join: 'round' });
  // cel bands: light along the +n contour, shade along -n (inner edges follow the flare)
  const lit: number[] = [];
  const shade: number[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const r = H.throatR + (H.mouthR - H.throatR) * t ** 2.2;
    const c = add(T, H.u, L * t);
    lit.push(c.x + H.n.x * r * 0.92, c.y + H.n.y * r * 0.92);
    shade.push(c.x - H.n.x * r * 0.92, c.y - H.n.y * r * 0.92);
  }
  for (let i = 16; i >= 0; i--) {
    const t = i / 16;
    const r = H.throatR + (H.mouthR - H.throatR) * t ** 2.2;
    const c = add(T, H.u, L * t);
    lit.push(c.x + H.n.x * r * 0.5, c.y + H.n.y * r * 0.5);
    shade.push(c.x - H.n.x * r * 0.45, c.y - H.n.y * r * 0.45);
  }
  g.poly(lit, true).fill(BRASS.light);
  g.poly(shade, true).fill(BRASS.shade);
  // specular streak
  const s0 = add(add(T, H.u, L * 0.3), H.n, 4.5);
  const s1 = add(add(T, H.u, L * 0.72), H.n, 10);
  g.moveTo(s0.x, s0.y).lineTo(s1.x, s1.y).stroke({ width: 2.6, color: 0xffffff, cap: 'round' });
  root.addChild(g);

  // mouth: rim ellipse, dark interior, phase plug
  const mouth = new Graphics();
  const ang = Math.atan2(H.n.y, H.n.x);
  mouth.ellipse(0, 0, H.mouthR + 2, H.mouthDepth + 2).fill(BRASS.light).stroke({ width: OUTLINE, color: INK });
  mouth.ellipse(0.5, 1.5, H.mouthR - 3.5, H.mouthDepth - 3).fill(CAB.hole).stroke({ width: LINE, color: INK });
  mouth.ellipse(0, 2, H.mouthR * 0.22, H.mouthDepth * 0.45).fill(METAL.base).stroke({ width: 1.8, color: INK });
  mouth.position.set(M.x, M.y);
  mouth.rotation = ang;
  root.addChild(mouth);
  return root;
};

/** Mode trim ring inside the mouth rim (white; tinted per skin), in bell space. */
export const drawHornTrim = (): Container => {
  const H = HORN;
  const root = new Container();
  const g = new Graphics().ellipse(0, 0, H.mouthR - 1, H.mouthDepth - 0.5).stroke({ width: 2.4, color: 0xffffff });
  // a baked target's own transform is ignored: place the ring as a child
  g.position.set(H.M.x - H.throat.x, H.M.y - H.throat.y);
  g.rotation = Math.atan2(H.n.y, H.n.x);
  root.addChild(g);
  return root;
};

/** Capsule polygon between two points (radius r). */
const capsule = (x0: number, y0: number, x1: number, y1: number, r: number): number[] => {
  const a = Math.atan2(y1 - y0, x1 - x0);
  const pts: number[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = a - Math.PI / 2 + (i / 10) * Math.PI;
    pts.push(x1 + Math.cos(t) * r, y1 + Math.sin(t) * r);
  }
  for (let i = 0; i <= 10; i++) {
    const t = a + Math.PI / 2 + (i / 10) * Math.PI;
    pts.push(x0 + Math.cos(t) * r, y0 + Math.sin(t) * r);
  }
  return pts;
};

/** Straight band between two axis points, from normal offset o0 to o1. */
const band = (p0: { x: number; y: number }, p1: { x: number; y: number }, n: { x: number; y: number }, o0: number, o1: number): number[] => [
  p0.x + n.x * o0,
  p0.y + n.y * o0,
  p1.x + n.x * o0,
  p1.y + n.y * o0,
  p1.x + n.x * o1,
  p1.y + n.y * o1,
  p0.x + n.x * o1,
  p0.y + n.y * o1,
];
