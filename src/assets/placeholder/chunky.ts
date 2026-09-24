import { Container, Graphics, Rectangle, type Renderer, Sprite, Text, type TextStyleOptions, type Texture } from 'pixi.js';
import { INK, type Light, PLUM, PLUM_LIGHT, WHITE } from './palette';

/**
 * Chunky extruded display type (royals, WILD, the logo word-mark), built from
 * three baked white glyph masks and tinted sprites so every layer lines up exactly:
 *
 *   ink sweep     dilated glyph, swept along the extrusion vector  -> outer outline
 *   extrusion     glyph swept (plum), lighter plum lip next to the face
 *   face line     slightly dilated glyph in ink -> separation line face/extrusion
 *   face          clipped group: base tone, hard cel shadow crescent (lit copy
 *                 shifted toward the light), optional custom paint (colour bands),
 *                 white specular streaks
 *
 * All textures are generated with the same centred frame, so sprites at the same
 * position register pixel-perfectly.
 */
export interface ChunkyOptions {
  text: string;
  fontFamily: string;
  fontSize: number;
  light: Light;
  /** face base tone */
  base: number;
  /** cel shadow tone (crescent away from the light); omit for a flat face */
  shade?: number;
  shadeOff?: number;
  /** outer outline width (design px) */
  outline: number;
  /** face/extrusion separation line width */
  faceLine?: number;
  /** extrusion depth (design px) */
  depth: number;
  extrusion?: number;
  extrusionLip?: number | null;
  letterSpacing?: number;
  /** custom face paint (bands, stripes), in the text's centred local space */
  paint?: (g: Graphics, box: Rectangle) => void;
  /** specular streaks, in the text's centred local space */
  streaks?: (g: Graphics, box: Rectangle) => void;
  /** bake resolution of the glyph masks */
  resolution?: number;
}

const glyphTexture = (
  renderer: Renderer,
  style: TextStyleOptions,
  text: string,
  frame: Rectangle,
  resolution: number,
): Texture => {
  const t = new Text({ text, style });
  t.anchor.set(0.5);
  const tex = renderer.generateTexture({ target: t, frame, resolution, antialias: true });
  t.destroy();
  return tex;
};

/** Layout box (centred) of a text run. */
const layoutBox = (style: TextStyleOptions, text: string): Rectangle => {
  const t = new Text({ text, style });
  t.anchor.set(0.5);
  const b = t.getLocalBounds().rectangle.clone();
  t.destroy();
  return b;
};

/** Alpha bounding box of a texture rendered with `frame`, in the frame's space. */
const alphaBox = (renderer: Renderer, tex: Texture, frame: Rectangle): Rectangle => {
  const { pixels, width, height } = renderer.extract.pixels(tex);
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] > 96) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return frame.clone();
  const sx = frame.width / width;
  const sy = frame.height / height;
  return new Rectangle(frame.x + x0 * sx, frame.y + y0 * sy, (x1 - x0 + 1) * sx, (y1 - y0 + 1) * sy);
};

/** Ink (visible glyph) box of a text run, centred local space — for fitting type to a box. */
export const inkBox = (renderer: Renderer, style: TextStyleOptions, text: string): Rectangle => {
  const lb = layoutBox(style, text);
  const frame = new Rectangle(lb.x - 8, lb.y - 8, lb.width + 16, lb.height + 16);
  const tex = glyphTexture(renderer, style, text, frame, 1);
  const box = alphaBox(renderer, tex, frame);
  tex.destroy(true);
  return box;
};

export interface ChunkyResult {
  view: Container;
  /** textures owned by the result; destroy after baking the parent */
  textures: Texture[];
  /** ink box of the plain glyph run (centred local space) */
  box: Rectangle;
}

export const chunkyText = (renderer: Renderer, o: ChunkyOptions): ChunkyResult => {
  const res = o.resolution ?? 2;
  const common: TextStyleOptions = {
    fontFamily: o.fontFamily,
    fontSize: o.fontSize,
    fill: WHITE,
    letterSpacing: o.letterSpacing ?? 0,
    padding: 4,
  };
  const lb = layoutBox(common, o.text);
  const pad = o.outline * 2 + o.depth + 8;
  const frame = new Rectangle(lb.x - pad, lb.y - pad, lb.width + pad * 2, lb.height + pad * 2);

  const glyph = glyphTexture(renderer, common, o.text, frame, res);
  const box = alphaBox(renderer, glyph, frame);
  const dilated = glyphTexture(
    renderer,
    { ...common, stroke: { color: WHITE, width: o.outline * 2, join: 'round' } },
    o.text,
    frame,
    res,
  );
  const faceLineW = o.faceLine ?? o.outline * 0.55;
  const thin = glyphTexture(
    renderer,
    { ...common, stroke: { color: WHITE, width: faceLineW * 2, join: 'round' } },
    o.text,
    frame,
    res,
  );

  const view = new Container();
  const sp = (tex: Texture, x: number, y: number, tint: number): Sprite => {
    const s = new Sprite(tex);
    s.position.set(frame.x + x, frame.y + y);
    s.tint = tint;
    return s;
  };

  // 1) ink sweep (outer outline around face + extrusion)
  const steps = Math.max(1, Math.ceil(o.depth * 1.5));
  for (let i = steps; i >= 0; i--) {
    const p = o.light.off((o.depth * i) / steps);
    view.addChild(sp(dilated, p.x, p.y, INK));
  }
  // 2) extrusion body (+ lighter lip right behind the face)
  const ext = o.extrusion ?? PLUM;
  const lip = o.extrusionLip === undefined ? PLUM_LIGHT : o.extrusionLip;
  for (let i = steps; i >= 1; i--) {
    const d = (o.depth * i) / steps;
    const p = o.light.off(d);
    view.addChild(sp(glyph, p.x, p.y, lip !== null && d <= o.depth * 0.3 ? lip : ext));
  }
  // 3) separation line
  view.addChild(sp(thin, 0, 0, INK));
  // 4) face (clipped)
  const face = new Container();
  const mask = sp(glyph, 0, 0, WHITE);
  if (o.shade !== undefined) {
    face.addChild(sp(glyph, 0, 0, o.shade));
    const p = o.light.off(-(o.shadeOff ?? 5));
    face.addChild(sp(glyph, p.x, p.y, o.base));
  } else {
    face.addChild(sp(glyph, 0, 0, o.base));
  }
  if (o.paint || o.streaks) {
    const g = new Graphics();
    o.paint?.(g, box);
    o.streaks?.(g, box);
    face.addChild(g);
  }
  face.addChild(mask);
  face.mask = mask;
  view.addChild(face);

  return { view, textures: [glyph, dilated, thin], box };
};

/** Bake a container into a square canvas texture and free the temporary textures. */
export const bakeSquare = (
  renderer: Renderer,
  target: Container,
  size: number,
  resolution: number,
  temp: Texture[] = [],
): Texture => {
  const root = new Container();
  root.addChild(new Graphics().rect(0, 0, size, size).fill({ color: 0, alpha: 0 }));
  root.addChild(target);
  const tex = renderer.generateTexture({
    target: root,
    frame: new Rectangle(0, 0, size, size),
    resolution,
    antialias: true,
  });
  root.destroy({ children: true });
  for (const t of temp) t.destroy(true);
  return tex;
};
