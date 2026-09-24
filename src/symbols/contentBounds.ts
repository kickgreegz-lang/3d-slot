import type { Renderer, Texture } from 'pixi.js';

/**
 * Visible-content metrics of a symbol texture, in texture (orig) units with the
 * origin at the texture's top-left. Symbol art sits on a fixed square canvas with
 * transparent padding (assets/art.ts), so the rig measures the opaque pixels once
 * per texture to (a) fit the content to `def.cellScale` of the cell and (b) find
 * the FEET — the lowest opaque point after `restAngle` — for weight-true squash.
 */
export interface ContentBounds {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Silhouette samples (left/right-most opaque pixel per row), flat [x0,y0,x1,y1,...]. */
  hull: Float32Array;
}

const ALPHA_THRESHOLD = 24;
const cache = new Map<number, ContentBounds>();

const fallback = (tex: Texture): ContentBounds => {
  const w = tex.width;
  const h = tex.height;
  const m = 0.1;
  const x0 = w * m;
  const y0 = h * m;
  const x1 = w * (1 - m);
  const y1 = h * (1 - m);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, hull: new Float32Array([x0, y0, x1, y0, x0, y1, x1, y1]) };
};

/** Measured (and cached by texture uid) content bounds. One GPU read-back per texture. */
export const measureContent = (renderer: Renderer, tex: Texture): ContentBounds => {
  const hit = cache.get(tex.uid);
  if (hit) return hit;
  let result: ContentBounds;
  try {
    result = scan(renderer, tex);
  } catch {
    result = fallback(tex);
  }
  cache.set(tex.uid, result);
  return result;
};

const scan = (renderer: Renderer, tex: Texture): ContentBounds => {
  const { pixels, width, height } = renderer.extract.pixels(tex);
  // pixel -> orig units (frame may be trimmed inside a larger orig rect)
  const sx = tex.frame.width / width;
  const sy = tex.frame.height / height;
  const ox = tex.trim?.x ?? 0;
  const oy = tex.trim?.y ?? 0;
  const hull: number[] = [];
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    let left = -1;
    let right = -1;
    for (let x = 0; x < width; x++) {
      if (pixels[row + x * 4 + 3] > ALPHA_THRESHOLD) {
        left = x;
        break;
      }
    }
    if (left < 0) continue;
    for (let x = width - 1; x >= left; x--) {
      if (pixels[row + x * 4 + 3] > ALPHA_THRESHOLD) {
        right = x;
        break;
      }
    }
    minX = Math.min(minX, left);
    maxX = Math.max(maxX, right);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    const cy = oy + (y + 0.5) * sy;
    hull.push(ox + left * sx, cy, ox + (right + 1) * sx, cy);
  }
  if (maxX < 0) return fallback(tex);
  return {
    x: ox + minX * sx,
    y: oy + minY * sy,
    w: (maxX - minX + 1) * sx,
    h: (maxY - minY + 1) * sy,
    hull: new Float32Array(hull),
  };
};
