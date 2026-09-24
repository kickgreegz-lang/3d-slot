import {
  type Container,
  FillGradient,
  type Graphics,
  type PointData,
  Rectangle,
  type Renderer,
  type Texture,
} from 'pixi.js';

const DEG = Math.PI / 180;

/**
 * Corners of a regular POINTY-TOP hexagon with circumradius `r`, rotated by
 * `tiltDeg` (clockwise, screen space). The reference HUD tilts its hexes 20°.
 */
export const hexPoints = (r: number, tiltDeg = 0, squash = 1): PointData[] => {
  const pts: PointData[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (-90 + 60 * i) * DEG;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r * squash;
    const t = tiltDeg * DEG;
    pts.push({ x: x * Math.cos(t) - y * Math.sin(t), y: x * Math.sin(t) + y * Math.cos(t) });
  }
  return pts;
};

/** Rounded hexagon path on `g` (call .fill/.stroke after). */
export const hexPath = (g: Graphics, r: number, tiltDeg: number, cornerFrac: number, squash = 1): Graphics =>
  g.roundShape(hexPoints(r, tiltDeg, squash), r * cornerFrac, true, 12);

/** Midpoint + direction (radians) of hex edge `i` (edge between corner i and i+1). */
export const hexEdge = (r: number, tiltDeg: number, i: number, squash = 1): { x: number; y: number; angle: number } => {
  const p = hexPoints(r, tiltDeg, squash);
  const a = p[i % 6];
  const b = p[(i + 1) % 6];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, angle: Math.atan2(b.y - a.y, b.x - a.x) };
};

const ramps = new Map<string, FillGradient>();

/** Vertical light ramp (top-left key light) in shape-local space; cached (gradients own a texture). */
export const verticalRamp = (top: number, bottom: number, mid?: number): FillGradient => {
  const key = `${top}:${mid ?? ''}:${bottom}`;
  let g = ramps.get(key);
  if (!g) {
    g = new FillGradient({
      type: 'linear',
      start: { x: 0.3, y: 0 },
      end: { x: 0.7, y: 1 },
      colorStops:
        mid === undefined
          ? [
              { offset: 0, color: top },
              { offset: 1, color: bottom },
            ]
          : [
              { offset: 0, color: top },
              { offset: 0.5, color: mid },
              { offset: 1, color: bottom },
            ],
      textureSpace: 'local',
    });
    ramps.set(key, g);
  }
  return g;
};

/**
 * Rasterise a vector container into a texture centred on its origin (anchor 0.5).
 * The game renderer runs with antialias:false, so vector HUD art is baked with MSAA
 * at 2x the on-screen pixel density — it then minifies to perfectly smooth edges at
 * every layout, down to the 400x225 popout. Re-bake on layout change.
 */
export const bakeCentered = (renderer: Renderer, target: Container, box: number, resolution: number): Texture => {
  const size = Math.ceil(box);
  return renderer.generateTexture({
    target,
    frame: new Rectangle(-size / 2, -size / 2, size, size),
    resolution,
    antialias: true,
  });
};
