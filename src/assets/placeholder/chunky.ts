import { CanvasSource, Container, Graphics, Rectangle, type Renderer, Sprite, Texture } from 'pixi.js';
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
 * The glyph masks are drawn with Canvas2D (native AA, exact ink metrics, no GPU
 * readback) on one shared centred frame, so sprites at the same position register
 * pixel-perfectly.
 */
export interface ChunkyOptions extends GlyphRun {
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
  /** custom face paint (bands, stripes), in the text's centred local space */
  paint?: (g: Graphics, box: Rectangle) => void;
  /** specular streaks, in the text's centred local space */
  streaks?: (g: Graphics, box: Rectangle) => void;
  /** bake resolution of the glyph masks */
  resolution?: number;
}

/** Font run description shared by the measuring and drawing helpers. */
export interface GlyphRun {
  text: string;
  fontFamily: string;
  fontSize: number;
  /** letter spacing in px (Canvas2D letterSpacing; ignored where unsupported) */
  letterSpacing?: number;
}

let scratch: CanvasRenderingContext2D | null = null;
const ctx2d = (): CanvasRenderingContext2D => {
  if (!scratch) {
    const c = document.createElement('canvas');
    c.width = c.height = 4;
    const g = c.getContext('2d');
    if (!g) throw new Error('2D canvas unavailable');
    scratch = g;
  }
  return scratch;
};

const setFont = (g: CanvasRenderingContext2D, run: GlyphRun): void => {
  g.font = `${run.fontSize}px "${run.fontFamily}"`;
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${run.letterSpacing ?? 0}px`;
};

interface InkMetrics {
  /** ink box centred on (0,0) */
  box: Rectangle;
  /** where the run's origin (left, baseline) sits in that centred space */
  ox: number;
  oy: number;
}

/**
 * Exact ink metrics from Canvas2D (actualBoundingBox*) — no GPU readback. The run
 * is positioned so its ink box is centred on the local origin.
 */
const inkMetrics = (run: GlyphRun): InkMetrics => {
  const g = ctx2d();
  setFont(g, run);
  const m = g.measureText(run.text);
  const L = m.actualBoundingBoxLeft;
  const R = m.actualBoundingBoxRight;
  const A = m.actualBoundingBoxAscent;
  const D = m.actualBoundingBoxDescent;
  const w = L + R;
  const h = A + D;
  return { box: new Rectangle(-w / 2, -h / 2, w, h), ox: (L - R) / 2, oy: (A - D) / 2 };
};

/** Ink (visible glyph) box of a text run, centred local space — for fitting type to a box. */
export const inkBox = (run: GlyphRun): Rectangle => inkMetrics(run).box;

/** White glyph mask on a Canvas2D texture: fill, optionally dilated by a round stroke. */
const glyphTexture = (run: GlyphRun, ink: InkMetrics, frame: Rectangle, resolution: number, stroke = 0): Texture => {
  const c = document.createElement('canvas');
  c.width = Math.ceil(frame.width * resolution);
  c.height = Math.ceil(frame.height * resolution);
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');
  g.scale(resolution, resolution);
  g.translate(-frame.x, -frame.y);
  setFont(g, run);
  g.fillStyle = '#ffffff';
  if (stroke > 0) {
    g.strokeStyle = '#ffffff';
    g.lineWidth = stroke;
    g.lineJoin = 'round';
    g.strokeText(run.text, ink.ox, ink.oy);
  }
  g.fillText(run.text, ink.ox, ink.oy);
  return new Texture({ source: new CanvasSource({ resource: c, resolution }) });
};

export interface ChunkyResult {
  view: Container;
  /** textures owned by the result; destroy after baking the parent */
  textures: Texture[];
  /** ink box of the plain glyph run (centred local space) */
  box: Rectangle;
}

export const chunkyText = (o: ChunkyOptions): ChunkyResult => {
  const res = o.resolution ?? 2;
  const ink = inkMetrics(o);
  const box = ink.box;
  const pad = o.outline * 2 + o.depth + 6;
  const frame = new Rectangle(box.x - pad, box.y - pad, box.width + pad * 2, box.height + pad * 2);
  const glyph = glyphTexture(o, ink, frame, res);
  const dilated = glyphTexture(o, ink, frame, res, o.outline * 2);
  const thin = glyphTexture(o, ink, frame, res, (o.faceLine ?? o.outline * 0.55) * 2);

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
