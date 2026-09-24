import { Container, Graphics, GraphicsPath, Matrix, Rectangle, type Renderer, Sprite, type Texture } from 'pixi.js';
import { INK, LINE, type Light, OUTLINE, PLUM, WHITE } from './palette';

/**
 * CelCanvas — a tiny cel-shading kit on top of Pixi v8 Graphics.
 *
 * Every placeholder object is built from the same layer recipe, which is what
 * keeps the whole set on ONE style system:
 *   1. body():  ink silhouette (outer outline) swept along the extrusion vector,
 *               then the plum extrusion body on top of it;
 *   2. part():  per part a clipped face group (base tone, hard offset shadow
 *               crescent, optional rim light, hand-placed highlight/specular
 *               detail) followed by its own outline stroke that also hides the
 *               stencil-mask edge;
 *   3. ink()/overlay(): interior lines, sparkles, text.
 *
 * Paths are authored in canvas design px. NOTE: paths are transformed when drawn
 * (extrusion offsets), so author them with moveTo/lineTo/bezier/quadratic/
 * arcToSvg/circle/ellipse/rect/roundRect/poly only — `arc`/`arcTo`/`roundPoly`
 * are not transformable in Pixi 8 and would log a warning.
 */
export interface Shape {
  path: GraphicsPath;
  /** local -> canvas transform */
  m?: Matrix;
}
export type ShapeIn = GraphicsPath | Shape;

export const shape = (path: GraphicsPath, m?: Matrix): Shape => ({ path, m });
const toShape = (s: ShapeIn): Shape => (s instanceof GraphicsPath ? { path: s } : s);

/** Local transform helper: rotate (deg) + scale about the origin, then translate. */
export const at = (x: number, y: number, deg = 0, sx = 1, sy = sx): Matrix =>
  new Matrix().scale(sx, sy).rotate((deg * Math.PI) / 180).translate(x, y);

/** Add a shape to `g`'s active path, offset by (ox, oy) and scaled by k about (cx, cy). */
export const place = (g: Graphics, s: ShapeIn, ox = 0, oy = 0, k = 1, cx = 0, cy = 0): Graphics => {
  const sh = toShape(s);
  const m = sh.m ? sh.m.clone() : new Matrix();
  if (k !== 1) m.translate(-cx, -cy).scale(k, k).translate(cx, cy);
  m.translate(ox, oy);
  g.setTransform(m);
  g.path(sh.path);
  g.resetTransform();
  return g;
};

export const boundsOf = (s: ShapeIn): Rectangle => {
  const tmp = new Graphics();
  place(tmp, s).fill(0);
  const b = tmp.getLocalBounds().rectangle.clone();
  tmp.destroy();
  return b;
};

export interface PartSpec {
  shape: ShapeIn;
  fill: number;
  /** hard cel shadow tone (crescent on the side away from the light) */
  shade?: number;
  /** how far the lit copy is shifted toward the light (px) */
  shadeOff?: number;
  /** extra shrink of the lit copy (0..0.3) so the shadow thickens on the far side */
  shadeShrink?: number;
  /** hard rim-light tone along the lit edge */
  rim?: number;
  rimOff?: number;
  /** clipped detail painted inside the part (highlights, grooves, specular) */
  paint?: (g: Graphics) => void;
  /** outline width; 0 = none. Default: interior LINE weight. */
  line?: number;
}

export class CelCanvas {
  readonly root = new Container();

  constructor(
    readonly light: Light,
    readonly size = 180,
  ) {
    // keep the canvas square even when content is smaller
    this.root.addChild(new Graphics().rect(0, 0, size, size).fill({ color: 0, alpha: 0 }));
  }

  /**
   * Outer silhouette: ink outline around the union of `shapes` swept along the
   * extrusion vector, then the plum extrusion body.
   */
  body(shapes: ShapeIn[], depth = 8, outline = OUTLINE, plum = PLUM): this {
    const ink = new Graphics();
    const ext = new Graphics();
    const steps = Math.max(1, Math.ceil(depth * 1.5));
    for (let i = 0; i <= steps; i++) {
      const o = this.light.off((depth * i) / steps);
      for (const s of shapes) place(ink, s, o.x, o.y);
    }
    ink.fill(INK).stroke({ width: outline * 2, color: INK, join: 'round' });
    if (depth > 0) {
      for (let i = 1; i <= steps; i++) {
        const o = this.light.off((depth * i) / steps);
        for (const s of shapes) place(ext, s, o.x, o.y);
      }
      ext.fill(plum);
    }
    this.root.addChild(ink, ext);
    return this;
  }

  /** A clipped, cel-shaded face with its own outline. */
  part(spec: PartSpec): this {
    const s = toShape(spec.shape);
    const group = new Container();
    const mask = place(new Graphics(), s).fill(WHITE);
    const g = new Graphics();
    place(g, s).fill(spec.shade ?? spec.fill);
    if (spec.shade !== undefined) {
      const o = this.light.off(-(spec.shadeOff ?? 7));
      const k = 1 - (spec.shadeShrink ?? 0);
      let cx = 0;
      let cy = 0;
      if (k !== 1) {
        // shrink toward the lit corner so the shadow grows on the far side
        const b = boundsOf(s);
        cx = b.x + b.width / 2 - (this.light.dir.x * b.width) / 2;
        cy = b.y + b.height / 2 - (this.light.dir.y * b.height) / 2;
      }
      place(g, s, o.x, o.y, k, cx, cy).fill(spec.fill);
    }
    if (spec.rim !== undefined) {
      const o = this.light.off(spec.rimOff ?? 4);
      g.rect(-this.size, -this.size, this.size * 3, this.size * 3).fill(spec.rim);
      place(g, s, o.x, o.y).cut();
    }
    spec.paint?.(g);
    group.addChild(g, mask);
    group.mask = mask;
    this.root.addChild(group);
    const line = spec.line ?? LINE;
    if (line > 0) {
      this.root.addChild(place(new Graphics(), s).stroke({ width: line, color: INK, join: 'round' }));
    }
    return this;
  }

  /** Free-drawn graphics on top (interior lines, sparkles). */
  ink(draw: (g: Graphics) => void): this {
    const g = new Graphics();
    draw(g);
    this.root.addChild(g);
    return this;
  }

  overlay(...children: Container[]): this {
    this.root.addChild(...children);
    return this;
  }

  /** Render to a texture of exactly size x size design px. */
  bake(renderer: Renderer, resolution = 2): Texture {
    const tex = renderer.generateTexture({
      target: this.root,
      frame: new Rectangle(0, 0, this.size, this.size),
      resolution,
      antialias: true,
    });
    this.root.destroy({ children: true });
    return tex;
  }
}

/** Common specular streak: a crisp tapered white sliver along a quadratic curve. */
export const streak = (
  g: Graphics,
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
  width: number,
  color = WHITE,
  alpha = 1,
): Graphics => {
  // tapered: draw the curve twice with offset control points to form a lens
  const nx = -(y1 - y0);
  const ny = x1 - x0;
  const len = Math.hypot(nx, ny) || 1;
  const ox = (nx / len) * width;
  const oy = (ny / len) * width;
  g.moveTo(x0, y0)
    .quadraticCurveTo(cx + ox, cy + oy, x1, y1)
    .quadraticCurveTo(cx - ox, cy - oy, x0, y0)
    .closePath()
    .fill({ color, alpha });
  return g;
};

/** A 4-point sparkle star (used on specials and the spark particle). */
export const sparkle = (g: Graphics, x: number, y: number, r: number, thin = 0.22, color = WHITE): Graphics => {
  const t = r * thin;
  g.moveTo(x, y - r)
    .quadraticCurveTo(x + t * 0.35, y - t * 0.35, x + r, y)
    .quadraticCurveTo(x + t * 0.35, y + t * 0.35, x, y + r)
    .quadraticCurveTo(x - t * 0.35, y + t * 0.35, x - r, y)
    .quadraticCurveTo(x - t * 0.35, y - t * 0.35, x, y - r)
    .closePath()
    .fill(color);
  return g;
};

/** Sprite helper for composing baked textures. */
export const spriteOf = (tex: Texture, x = 0, y = 0, tint = WHITE, alpha = 1): Sprite => {
  const s = new Sprite(tex);
  s.position.set(x, y);
  s.tint = tint;
  s.alpha = alpha;
  return s;
};
