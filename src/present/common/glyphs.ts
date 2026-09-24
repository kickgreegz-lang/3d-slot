import { CanvasSource, Container, Sprite, Texture } from 'pixi.js';

/**
 * Display-type baker for titles ("MEGA WIN", "10 FREE SPINS", "TOTAL WIN").
 *
 * Each glyph is painted ONCE with Canvas2D in the style-bible look — hard-edged cel
 * bands (no airbrush), one pure-black outline, a dark-plum extrusion toward the
 * lower-right (key light top-left) and one crisp white specular streak — and becomes
 * its own sprite so titles can do per-letter drops, waves and punches.
 * Glyph textures are cached by (style, char, resolution) and shared across words.
 */

export interface GlyphPalette {
  id: string;
  /** hard cel bands top -> bottom: [start offset 0..1 of cap height, css colour] */
  bands: ReadonlyArray<readonly [number, string]>;
  extrude: string;
  /** darker tone on the far half of the extrusion (depth read) */
  extrudeFar: string;
  outline: string;
  /** specular streak colour (null = none) */
  specular: string | null;
}

export interface GlyphStyle {
  family: string;
  /** font size in design px */
  size: number;
  palette: GlyphPalette;
  /** outline width as a fraction of size */
  outline?: number;
  /** extrusion depth as a fraction of size */
  extrude?: number;
  /** extra advance between letters, fraction of size */
  tracking?: number;
}

/** Molten gold — big-win titles, TOTAL WIN. */
export const GOLD: GlyphPalette = {
  id: 'gold',
  bands: [
    [0, '#fff8d2'],
    [0.2, '#ffe25a'],
    [0.5, '#ffc21f'],
    [0.74, '#f28a12'],
    [0.9, '#d4600c'],
  ],
  extrude: '#4b283d',
  extrudeFar: '#2c1224',
  outline: '#000000',
  specular: '#ffffff',
};

/** Neon cyan — free-spin banners (theme accent). */
export const CYAN: GlyphPalette = {
  id: 'cyan',
  bands: [
    [0, '#e9fffb'],
    [0.2, '#8ffcee'],
    [0.5, '#35f2e0'],
    [0.76, '#16b9c9'],
    [0.9, '#0f84a8'],
  ],
  extrude: '#1d1a4d',
  extrudeFar: '#0e0b2b',
  outline: '#000000',
  specular: '#ffffff',
};

/** Hot magenta — retrigger / accents. */
export const PINK: GlyphPalette = {
  id: 'pink',
  bands: [
    [0, '#ffe3f3'],
    [0.2, '#ff8fcf'],
    [0.5, '#ff3fa8'],
    [0.76, '#d61f86'],
    [0.9, '#a3126a'],
  ],
  extrude: '#3d1233',
  extrudeFar: '#220a1d',
  outline: '#000000',
  specular: '#ffffff',
};

interface BakedGlyph {
  texture: Texture;
  advance: number;
  /** glyph visual centre relative to the pen origin (x) / baseline (y) */
  cx: number;
  cy: number;
}

const glyphCache = new Map<string, BakedGlyph>();

const glyphKey = (char: string, st: GlyphStyle, res: number): string => {
  const outline = Math.max(2, Math.round(st.size * (st.outline ?? 0.07)));
  const depth = Math.max(2, Math.round(st.size * (st.extrude ?? 0.085)));
  return `${st.family}|${st.size}|${st.palette.id}|${outline}|${depth}|${res}|${char}`;
};
const capCache = new Map<string, number>();

const fontCss = (family: string, size: number): string => `${size}px "${family}"`;

let measureCtx: CanvasRenderingContext2D | null = null;
const measurer = (): CanvasRenderingContext2D => {
  if (!measureCtx) {
    const c = document.createElement('canvas');
    c.width = c.height = 4;
    const g = c.getContext('2d');
    if (!g) throw new Error('Canvas2D unavailable');
    measureCtx = g;
  }
  return measureCtx;
};

const capHeight = (family: string, size: number): number => {
  const key = `${family}|${size}`;
  let h = capCache.get(key);
  if (h === undefined) {
    const g = measurer();
    g.font = fontCss(family, size);
    h = g.measureText('H').actualBoundingBoxAscent;
    capCache.set(key, h);
  }
  return h;
};

const EX = { x: 0.56, y: 0.83 };

const bakeGlyph = (char: string, st: GlyphStyle, res: number): BakedGlyph => {
  const outline = Math.max(2, Math.round(st.size * (st.outline ?? 0.07)));
  const depth = Math.max(2, Math.round(st.size * (st.extrude ?? 0.085)));
  const key = glyphKey(char, st, res);
  const hit = glyphCache.get(key);
  if (hit) return hit;

  const m = measurer();
  m.font = fontCss(st.family, st.size);
  const met = m.measureText(char);
  const asc = Math.ceil(met.actualBoundingBoxAscent);
  const desc = Math.ceil(met.actualBoundingBoxDescent);
  const left = Math.ceil(met.actualBoundingBoxLeft);
  const right = Math.ceil(met.actualBoundingBoxRight);
  const pad = outline + 3;
  const exX = Math.ceil(depth * EX.x);
  const exY = Math.ceil(depth * EX.y);
  const w = left + right + pad * 2 + exX;
  const h = asc + desc + pad * 2 + exY;
  const ox = pad + left;
  const oy = pad + asc;
  const cap = capHeight(st.family, st.size);

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * res);
  canvas.height = Math.ceil(h * res);
  const g = canvas.getContext('2d');
  if (!g) throw new Error('Canvas2D unavailable');
  g.scale(res, res);
  g.font = fontCss(st.family, st.size);
  g.textBaseline = 'alphabetic';
  g.lineJoin = 'round';
  g.miterLimit = 2;
  const pal = st.palette;

  // 1) outline of the whole extruded solid
  g.strokeStyle = pal.outline;
  g.lineWidth = outline * 2;
  // (steps of ~1/12 depth: the wide strokes/fills overlap, so no gaps, far fewer draws)
  const step = Math.max(1, Math.floor(depth / 12));
  for (let i = depth; i >= 0; i -= step) g.strokeText(char, ox + EX.x * i, oy + EX.y * i);
  g.strokeText(char, ox, oy);
  // 2) extrusion body: far half darker for a two-tone depth read
  for (let i = depth; i >= 1; i -= step) {
    g.fillStyle = i > depth * 0.5 ? pal.extrudeFar : pal.extrude;
    g.fillText(char, ox + EX.x * i, oy + EX.y * i);
  }
  // 3) face outline (crisp line between face and extrusion)
  g.lineWidth = outline * 1.35;
  g.strokeText(char, ox, oy);

  // 4) face: hard cel bands + specular streak, composed off-screen then stamped
  const face = document.createElement('canvas');
  face.width = canvas.width;
  face.height = canvas.height;
  const f = face.getContext('2d');
  if (!f) throw new Error('Canvas2D unavailable');
  f.scale(res, res);
  f.font = g.font;
  f.textBaseline = 'alphabetic';
  const top = oy - cap;
  const grad = f.createLinearGradient(0, top, 0, oy);
  const bands = pal.bands;
  for (let i = 0; i < bands.length; i++) {
    const [start, color] = bands[i];
    const end = i + 1 < bands.length ? bands[i + 1][0] : 1;
    grad.addColorStop(Math.max(0, Math.min(1, start)), color);
    grad.addColorStop(Math.max(0, Math.min(1, end)) - 0.0001 * (i + 1 < bands.length ? 1 : 0), color);
  }
  f.fillStyle = grad;
  f.fillText(char, ox, oy);
  if (pal.specular) {
    f.globalCompositeOperation = 'source-atop';
    f.fillStyle = pal.specular;
    f.save();
    f.translate(ox - left + (left + right) * 0.3, top + cap * 0.16);
    f.rotate(-0.42);
    f.beginPath();
    f.ellipse(0, 0, (left + right) * 0.2, cap * 0.045, 0, 0, Math.PI * 2);
    f.fill();
    f.restore();
    f.globalCompositeOperation = 'source-over';
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(face, 0, 0);

  // visual centre of the glyph face (not the extrusion) relative to pen/baseline
  const cx = (right - left) / 2;
  const cy = -(asc - desc) / 2;
  const tw = canvas.width / res;
  const th = canvas.height / res;
  const texture = new Texture({
    source: new CanvasSource({ resource: canvas, resolution: res, width: tw, height: th, transparent: true }),
    defaultAnchor: { x: (ox + cx) / tw, y: (oy + cy) / th },
  });
  const baked: BakedGlyph = { texture, advance: met.width + st.size * (st.tracking ?? 0.02), cx, cy };
  glyphCache.set(key, baked);
  return baked;
};

const clampRes = (resolution: number): number => Math.max(1, Math.min(2, resolution));

/**
 * Bake jobs for the not-yet-cached glyphs of `text`, to be run one per frame
 * (e.g. pre-warming upcoming big-win tier titles while the count-up runs, so a
 * tier punch never hitches on Canvas2D text rasterisation).
 */
export const glyphBakeJobs = (text: string, style: GlyphStyle, resolution: number): Array<() => void> => {
  const res = clampRes(resolution);
  const jobs: Array<() => void> = [];
  for (const c of new Set(text)) {
    if (c === ' ' || glyphCache.has(glyphKey(c, style, res))) continue;
    jobs.push(() => void bakeGlyph(c, style, res));
  }
  return jobs;
};

export interface WordGlyph {
  sprite: Sprite;
  homeX: number;
  homeY: number;
  index: number;
  /** animated offsets layered on top of home (drops, idle wave) */
  dx: number;
  dy: number;
  /** additive copy of the glyph used for the shine sweep (kept in sync by Title) */
  shine: Sprite;
}

/**
 * A baked word/line as a container of per-letter sprites, centred on (0, 0)
 * (horizontal centre, vertical centre of the cap height).
 */
export class BakedWord extends Container {
  readonly glyphs: WordGlyph[] = [];
  readonly textWidth: number;
  readonly capHeight: number;

  constructor(text: string, style: GlyphStyle, resolution: number) {
    super({ label: `word:${text}` });
    const res = clampRes(resolution);
    const chars = [...text];
    const baked = chars.map((c) => (c === ' ' ? null : bakeGlyph(c, style, res)));
    const spaceW = style.size * 0.32;
    let width = 0;
    baked.forEach((b) => (width += b ? b.advance : spaceW));
    width -= style.size * (style.tracking ?? 0.02);
    this.textWidth = width;
    this.capHeight = capHeight(style.family, style.size);
    let pen = -width / 2;
    let index = 0;
    for (const b of baked) {
      if (!b) {
        pen += spaceW;
        continue;
      }
      const sprite = new Sprite(b.texture);
      const homeX = pen + b.cx;
      const homeY = b.cy + this.capHeight / 2;
      sprite.position.set(homeX, homeY);
      this.addChild(sprite);
      const shine = new Sprite({ texture: b.texture, blendMode: 'add', alpha: 0 });
      shine.visible = false;
      this.glyphs.push({ sprite, homeX, homeY, index: index++, dx: 0, dy: 0, shine });
      pen += b.advance;
    }
    // shine copies render above every glyph
    for (const g of this.glyphs) this.addChild(g.shine);
  }

  override destroy(): void {
    // glyph textures are cached/shared: never destroy them with the word
    super.destroy({ children: true, texture: false, textureSource: false });
  }
}

/** Free every cached glyph texture (e.g. after a big win, to return VRAM). */
export const releaseGlyphCache = (): void => {
  for (const g of glyphCache.values()) g.texture.destroy(true);
  glyphCache.clear();
};
