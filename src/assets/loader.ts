import { type Application, Graphics, type Renderer, Text, Texture, Container } from 'pixi.js';
import { SYMBOLS } from '../config/game';
import type { ArtProvider, EnvArtKey, ParticleKey, SpineRef, SymbolVariant } from './art';
import { FONTS } from './fonts';

/**
 * Art entry point. STUB placeholder provider (flat tiles + glyphs) so the game boots;
 * the art module replaces this with: manifest-backed production art (AssetPack bundles)
 * falling back to high-quality procedural placeholder art.
 */
export const createArt = async (app: Application): Promise<ArtProvider> => new StubArt(app.renderer);

const CANVAS = 180;

class StubArt implements ArtProvider {
  readonly symbolCanvas = CANVAS;
  private cache = new Map<string, Texture>();

  constructor(private renderer: Renderer) {}

  symbol(id: string, variant: SymbolVariant = 'static'): Texture {
    const key = `${id}:${variant}`;
    let t = this.cache.get(key);
    if (!t) {
      t = this.makeSymbol(id, variant);
      this.cache.set(key, t);
    }
    return t;
  }

  spine(): SpineRef | null {
    return null;
  }

  env(_key: EnvArtKey): Texture | null {
    return null;
  }

  particle(key: ParticleKey): Texture {
    const k = `p:${key}`;
    let t = this.cache.get(k);
    if (!t) {
      const g = new Graphics().circle(16, 16, 14).fill(0xffffff);
      t = this.renderer.generateTexture({ target: g, resolution: 2 });
      this.cache.set(k, t);
    }
    return t;
  }

  private makeSymbol(id: string, variant: SymbolVariant): Texture {
    const def = SYMBOLS[id];
    const c = new Container();
    const bounds = new Graphics().rect(0, 0, CANVAS, CANVAS).fill({ color: 0, alpha: 0 });
    c.addChild(bounds);
    const g = new Graphics()
      .roundRect(25, 25, CANVAS - 50, CANVAS - 50, 28)
      .fill(def?.color ?? 0xffffff)
      .stroke({ width: 6, color: 0x000000 });
    c.addChild(g);
    const label = new Text({
      text: def?.glyph ?? id,
      style: { fontFamily: FONTS.royal, fontSize: 64, fill: 0xffffff, stroke: { color: 0x000000, width: 8 } },
    });
    label.anchor.set(0.5);
    label.position.set(CANVAS / 2, CANVAS / 2);
    c.addChild(label);
    if (variant === 'blur') c.alpha = 0.7;
    return this.renderer.generateTexture({ target: c, resolution: 2 });
  }
}
