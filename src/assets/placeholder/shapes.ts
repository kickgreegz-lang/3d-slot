import { GraphicsPath } from 'pixi.js';

/**
 * Transform-safe path builders (bezier-only, so they survive the extrusion
 * offsets applied by CelCanvas.place()).
 */

const K = 0.5523;

/**
 * Stadium between two points with radius r (limbs, stalks, tubes). Pass `into` to
 * append several capsules to one path — never nest paths with addPath(): Pixi 8's
 * GraphicsPath.transform() mutates nested paths in place, so every extrusion
 * offset would accumulate on them.
 */
export const capsule = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
  into = new GraphicsPath(),
): GraphicsPath => {
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const dx = (x1 - x0) / len;
  const dy = (y1 - y0) / len;
  const nx = -dy;
  const ny = dx;
  const k = K * r;
  const A = [x0 + nx * r, y0 + ny * r];
  const B = [x1 + nx * r, y1 + ny * r];
  const E = [x1 + dx * r, y1 + dy * r];
  const C = [x1 - nx * r, y1 - ny * r];
  const D = [x0 - nx * r, y0 - ny * r];
  const F = [x0 - dx * r, y0 - dy * r];
  return into
    .moveTo(A[0], A[1])
    .lineTo(B[0], B[1])
    .bezierCurveTo(B[0] + dx * k, B[1] + dy * k, E[0] + nx * k, E[1] + ny * k, E[0], E[1])
    .bezierCurveTo(E[0] - nx * k, E[1] - ny * k, C[0] + dx * k, C[1] + dy * k, C[0], C[1])
    .lineTo(D[0], D[1])
    .bezierCurveTo(D[0] - dx * k, D[1] - dy * k, F[0] - nx * k, F[1] - ny * k, F[0], F[1])
    .bezierCurveTo(F[0] + nx * k, F[1] + ny * k, A[0] - dx * k, A[1] - dy * k, A[0], A[1])
    .closePath();
};

/**
 * Smooth closed curve through points [x0,y0,x1,y1,...] (Catmull-Rom -> cubic bezier).
 * `tension` 1 = standard, lower = tighter corners.
 */
export const blob = (pts: number[], tension = 1, into = new GraphicsPath()): GraphicsPath => {
  const n = pts.length / 2;
  const P = (i: number): [number, number] => {
    const j = ((i % n) + n) % n;
    return [pts[j * 2], pts[j * 2 + 1]];
  };
  const t = tension / 6;
  into.moveTo(...P(0));
  for (let i = 0; i < n; i++) {
    const p0 = P(i - 1);
    const p1 = P(i);
    const p2 = P(i + 1);
    const p3 = P(i + 2);
    into.bezierCurveTo(
      p1[0] + (p2[0] - p0[0]) * t,
      p1[1] + (p2[1] - p0[1]) * t,
      p2[0] - (p3[0] - p1[0]) * t,
      p2[1] - (p3[1] - p1[1]) * t,
      p2[0],
      p2[1],
    );
  }
  return into.closePath();
};

/** Mixed polygon: corners listed as [x, y, r] get rounded with radius r (quadratic corners). */
export const roundedPoly = (pts: [number, number, number][], into = new GraphicsPath()): GraphicsPath => {
  const n = pts.length;
  const at = (i: number) => pts[((i % n) + n) % n];
  const lerp = (a: [number, number, number], b: [number, number, number], d: number): [number, number] => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const u = Math.min(0.5, d / len);
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  };
  for (let i = 0; i < n; i++) {
    const p = at(i);
    const a = lerp(p, at(i - 1), p[2]);
    const b = lerp(p, at(i + 1), p[2]);
    if (i === 0) into.moveTo(a[0], a[1]);
    else into.lineTo(a[0], a[1]);
    into.quadraticCurveTo(p[0], p[1], b[0], b[1]);
  }
  return into.closePath();
};

/** Scalloped seal / starburst badge. */
export const seal = (cx: number, cy: number, rIn: number, rOut: number, points: number, rot = 0): GraphicsPath => {
  const p = new GraphicsPath();
  const step = (Math.PI * 2) / points;
  for (let i = 0; i <= points; i++) {
    const a = rot + i * step;
    const x = cx + Math.cos(a) * rIn;
    const y = cy + Math.sin(a) * rIn;
    if (i === 0) {
      p.moveTo(x, y);
      continue;
    }
    const am = a - step / 2;
    p.quadraticCurveTo(cx + Math.cos(am) * rOut, cy + Math.sin(am) * rOut, x, y);
  }
  return p.closePath();
};

/** Rotated ellipse as four cubic arcs (transform-safe). */
export const ellipsePath = (cx: number, cy: number, rx: number, ry: number, rot = 0, into = new GraphicsPath()): GraphicsPath => {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const P = (x: number, y: number): [number, number] => [cx + x * c - y * s, cy + x * s + y * c];
  const kx = K * rx;
  const ky = K * ry;
  into.moveTo(...P(rx, 0));
  into.bezierCurveTo(...P(rx, ky), ...P(kx, ry), ...P(0, ry));
  into.bezierCurveTo(...P(-kx, ry), ...P(-rx, ky), ...P(-rx, 0));
  into.bezierCurveTo(...P(-rx, -ky), ...P(-kx, -ry), ...P(0, -ry));
  into.bezierCurveTo(...P(kx, -ry), ...P(rx, -ky), ...P(rx, 0));
  return into.closePath();
};

/** Regular star as a plain polygon path. */
export const starPath = (cx: number, cy: number, points: number, rOut: number, rIn: number, rot = -Math.PI / 2): GraphicsPath => {
  const pts: number[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? rOut : rIn;
    const a = rot + (i * Math.PI) / points;
    pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return new GraphicsPath().poly(pts, true);
};
