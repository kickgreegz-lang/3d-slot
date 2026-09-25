import { type Container, Rectangle, type Renderer, Sprite, type Texture } from 'pixi.js';

/** A baked drawing: texture + the anchor that puts the drawing's local (0, 0) on the sprite position. */
export interface Baked {
  texture: Texture;
  ax: number;
  ay: number;
}

/**
 * Bake cache for the screen placeholders. Drawings (./emblems.ts, ./chrome.ts) are built as
 * Graphics once, rendered to a texture with antialias (the app runs without MSAA) at the
 * requested resolution, then destroyed. Keyed by `name@res`; a different resolution (window
 * resize, rotation) bakes a new entry.
 *
 * Shared by the three screen modules: each retains it in init() and releases it in destroy();
 * the last release frees every texture.
 */
class ScreenArtCache {
  private renderer: Renderer | null = null;
  private readonly cache = new Map<string, Baked>();
  private users = 0;

  retain(renderer: Renderer): void {
    this.renderer = renderer;
    this.users++;
  }

  release(): void {
    this.users = Math.max(0, this.users - 1);
    if (this.users > 0) return;
    for (const b of this.cache.values()) b.texture.destroy(true);
    this.cache.clear();
    this.renderer = null;
  }

  /** Bake quality steps (quarter steps, 0.5 .. 2) so small resizes reuse the same set. */
  static res(r: number): number {
    return Math.min(2, Math.max(0.5, Math.ceil(r * 4) / 4));
  }

  /** Texture of `build()` baked at `res`; `name` must identify the drawing (sizes / colours included). */
  get(name: string, res: number, build: () => Container): Baked {
    const q = ScreenArtCache.res(res);
    const key = `${name}@${q}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const renderer = this.renderer;
    if (!renderer) throw new Error('ScreenArt used before retain()');
    const target = build();
    const b = target.getLocalBounds();
    const pad = 4;
    const frame = new Rectangle(
      Math.floor(b.minX - pad),
      Math.floor(b.minY - pad),
      Math.ceil(b.maxX - b.minX + pad * 2),
      Math.ceil(b.maxY - b.minY + pad * 2),
    );
    const texture = renderer.generateTexture({ target, frame, resolution: q, antialias: true });
    target.destroy({ children: true });
    const baked: Baked = { texture, ax: -frame.x / frame.width, ay: -frame.y / frame.height };
    // older resolutions stay until the last release (a sprite may still show one; the
    // quarter-step quantisation bounds the set at 7 per drawing)
    this.cache.set(key, baked);
    return baked;
  }
}

export const screenArt = new ScreenArtCache();
export const bakeRes = ScreenArtCache.res;

/** Point `sprite` at a baked texture (anchor included). */
export const useBaked = (sprite: Sprite, b: Baked): Sprite => {
  if (sprite.texture !== b.texture) sprite.texture = b.texture;
  sprite.anchor.set(b.ax, b.ay);
  return sprite;
};

/** New sprite of a baked texture. */
export const bakedSprite = (b: Baked): Sprite => useBaked(new Sprite(), b);
