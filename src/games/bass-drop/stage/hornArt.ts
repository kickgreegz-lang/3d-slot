import { Container, Graphics } from 'pixi.js';
import { BRASS, CAB, INK, LINE, METAL, OUTLINE, RIM, bolt, orb, ramp } from './palette';

/**
 * `env_horn` code parts (ANIMATION_SET §4.3; the generated horn is unfunded, ART_STATUS §5), in
 * the formula-D finish of the painted set (palette.ts: soft ramps lit from the top-left, glossy
 * brass with white speculars, a thin cool rim on the shade side, one bold outline, no plum
 * extrusion). A brass PA horn bolted onto the frame's
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
    .fill(ramp([
      [0, METAL.light],
      [0.45, METAL.base],
      [1, METAL.shade],
    ], 0.1, 0, 0.6, 1))
    .stroke({ width: OUTLINE * 0.8, color: INK, join: 'round' });
  g.moveTo(-3, -2).lineTo(62, -2).stroke({ width: 1.4, color: 0xffffff, alpha: 0.4 });
  g.moveTo(9, 46).lineTo(9, 12).lineTo(64, 12).stroke({ width: 1.1, color: RIM, alpha: 0.35 });
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
  // lit side = +n (the upper contour); the ramp runs across the can in its local box
  const across = (): [number, number, number, number] => [0.5 + H.n.x * 0.42, 0.5 + H.n.y * 0.42, 0.5 - H.n.x * 0.42, 0.5 - H.n.y * 0.42];
  const [ax, ay, bx, by] = across();
  const can = new Graphics();
  can.poly(capsule(back.x, back.y, front.x, front.y, r), true)
    .fill(ramp([
      [0, METAL.light],
      [0.4, METAL.base],
      [1, METAL.dark],
    ], ax, ay, bx, by))
    .stroke({ width: OUTLINE, color: INK, join: 'round' });
  // soft sheen along the lit side, thin cool rim on the shade side
  const s0 = add(back, H.n, r * 0.55);
  const s1 = add(front, H.n, r * 0.55);
  can.moveTo(s0.x, s0.y).lineTo(s1.x, s1.y).stroke({ width: 2.2, color: 0xffffff, alpha: 0.45, cap: 'round' });
  const c0 = add(back, H.n, -r * 0.82);
  const c1 = add(front, H.n, -r * 0.82);
  can.moveTo(c0.x, c0.y).lineTo(c1.x, c1.y).stroke({ width: 1.2, color: RIM, alpha: 0.55, cap: 'round' });
  // gold clamp band around the middle
  const b0 = add(H.D, H.u, -2);
  const b1 = add(H.D, H.u, 4);
  can.poly(band(b0, b1, H.n, -r - 2, r + 2), true)
    .fill(ramp([
      [0, BRASS.light],
      [0.45, BRASS.base],
      [1, BRASS.deep],
    ], ax, ay, bx, by))
    .stroke({ width: LINE, color: INK, join: 'round' });
  bolt(can, H.D.x + H.u.x + H.n.x * (r + 1), H.D.y + H.u.y + H.n.y * (r + 1), 3, 0xe8c070);
  root.addChild(can);
  // rear cap (rotated ellipse)
  const cap = new Graphics()
    .ellipse(0, 0, r * 0.4, r * 0.96)
    .fill(ramp([
      [0, METAL.base],
      [1, METAL.dark],
    ]))
    .stroke({ width: LINE, color: INK });
  cap.ellipse(-r * 0.05, -r * 0.2, r * 0.16, r * 0.46).fill({ color: 0xffffff, alpha: 0.3 });
  cap.position.set(back.x, back.y);
  cap.rotation = Math.atan2(H.u.y, H.u.x);
  root.addChild(cap);
  return root;
};

/** A painted dust puff (fx_puff fallback): three soft lumps lit from the top-left, one outline. */
export const drawPuff = (): Graphics => {
  const g = new Graphics();
  const lumps: Array<[number, number, number]> = [
    [-7, 2, 9],
    [5, -3, 11],
    [8, 6, 7],
  ];
  // merged silhouette: all outlines first, then the fills over them
  for (const [x, y, r] of lumps) g.circle(x, y, r + 1.8).fill(INK);
  for (const [x, y, r] of lumps) {
    g.circle(x, y, r).fill(orb([
      [0, 0xf6f1ff],
      [0.5, 0xd6cce2],
      [1, 0x9a8bb0],
    ]));
  }
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
  // brass body: a soft ramp across the flare (lit +n contour -> shade), glossy
  const nx = 0.5 + H.n.x * 0.45;
  const ny = 0.5 + H.n.y * 0.45;
  g.poly(outline(), true)
    .fill(ramp([
      [0, BRASS.light],
      [0.3, BRASS.base],
      [0.75, BRASS.shade],
      [1, BRASS.deep],
    ], nx, ny, 1 - nx, 1 - ny))
    .stroke({ width: OUTLINE, color: INK, join: 'round' });
  // thin cool rim along the shade-side contour, warm bounce under it
  const shade: number[] = [];
  for (let i = 3; i <= 16; i++) {
    const t = i / 16;
    const r = H.throatR + (H.mouthR - H.throatR) * t ** 2.2;
    const c = add(T, H.u, L * t);
    shade.push(c.x - H.n.x * (r - 2.2), c.y - H.n.y * (r - 2.2));
  }
  g.poly(shade, false).stroke({ width: 1.4, color: RIM, alpha: 0.55, cap: 'round', join: 'round' });
  // specular streak + a crisp hotspot
  const s0 = add(add(T, H.u, L * 0.3), H.n, 4.5);
  const s1 = add(add(T, H.u, L * 0.72), H.n, 10);
  g.moveTo(s0.x, s0.y).lineTo(s1.x, s1.y).stroke({ width: 2.4, color: 0xffffff, alpha: 0.85, cap: 'round' });
  g.circle(s1.x + H.u.x * 4, s1.y + H.u.y * 4, 1.6).fill(0xffffff);
  root.addChild(g);

  // mouth: rim ellipse, dark interior, phase plug
  const mouth = new Graphics();
  const ang = Math.atan2(H.n.y, H.n.x);
  mouth
    .ellipse(0, 0, H.mouthR + 2, H.mouthDepth + 2)
    .fill(ramp([
      [0, 0xfff6c8],
      [0.5, BRASS.light],
      [1, BRASS.shade],
    ], 0.5, 0, 0.5, 1))
    .stroke({ width: OUTLINE, color: INK });
  mouth
    .ellipse(0.5, 1.5, H.mouthR - 3.5, H.mouthDepth - 3)
    .fill(ramp([
      [0, 0x05020a],
      [1, CAB.shade],
    ], 0.5, 0, 0.5, 1))
    .stroke({ width: LINE, color: INK });
  mouth
    .ellipse(0, 2, H.mouthR * 0.22, H.mouthDepth * 0.45)
    .fill(orb([
      [0, METAL.light],
      [1, METAL.shade],
    ]))
    .stroke({ width: 1.4, color: INK });
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
