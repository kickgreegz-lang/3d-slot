import type { Renderer, Texture } from 'pixi.js';
import { SYMBOL_BUILDERS } from '@game/art';
import { SYMBOLS, type SymbolDef } from '../../config/game';
import type { ParticleKey, SymbolVariant } from '../art';
import { PARTICLE_KEYS, buildParticle } from './particles';
import { buildRoyal } from './symbolsRoyal';
import { makeBlur, makeGlow } from './variants';

/** Symbol canvas in design px (360 px @2x — matches the production pipeline). */
export const SYMBOL_CANVAS = 180;

/** Bakes one symbol's static placeholder on the SYMBOL_CANVAS (design px). */
export type SymbolBuilder = (r: Renderer, size: number, def: SymbolDef) => Texture;

/** The game's placeholder builders by symbol id (src/games/<GAME>/art.ts); royals are generic. */
const BUILDERS: Record<string, SymbolBuilder> = SYMBOL_BUILDERS;

const royal: SymbolBuilder = (r, s, def) => buildRoyal(r, def.glyph ?? def.id, def.color, s, def.cellScale, def.restAngle);

/**
 * High-quality procedural placeholder art (cel style bible), baked once to cached
 * textures. Also derives blur/glow variants for production statics that ship
 * without them.
 */
export class ProceduralArt {
  readonly symbolCanvas = SYMBOL_CANVAS;
  private cache = new Map<string, Texture>();

  constructor(
    private renderer: Renderer,
    /** resolution of the derived blur/glow variants (they are soft, 1 is plenty) */
    private variantResolution = 1,
  ) {}

  symbol(id: string, variant: SymbolVariant = 'static'): Texture {
    const key = `${id}:${variant}`;
    let t = this.cache.get(key);
    if (t) return t;
    const def = SYMBOLS[id];
    if (variant === 'static') {
      t = (def && (BUILDERS[id] ?? (def.kind === 'royal' ? royal : null)))?.(this.renderer, SYMBOL_CANVAS, def) ?? this.missing(id);
    } else {
      t = this.derive(this.symbol(id, 'static'), variant, def?.restAngle ?? 0);
    }
    this.cache.set(key, t);
    return t;
  }

  /** Blur/glow from any static texture on the symbol canvas. */
  derive(staticTex: Texture, variant: Exclude<SymbolVariant, 'static'>, restAngle: number): Texture {
    return variant === 'blur'
      ? makeBlur(this.renderer, staticTex, SYMBOL_CANVAS, restAngle, this.variantResolution)
      : makeGlow(this.renderer, staticTex, SYMBOL_CANVAS, this.variantResolution);
  }

  particle(key: ParticleKey): Texture {
    const k = `p:${key}`;
    let t = this.cache.get(k);
    if (!t) {
      t = buildParticle(this.renderer, key);
      this.cache.set(k, t);
    }
    return t;
  }

  /** Bake everything up-front so gameplay never hitches on first use. */
  warm(ids: string[] = Object.keys(SYMBOLS)): void {
    for (const id of ids) for (const v of ['static', 'blur', 'glow'] as const) this.symbol(id, v);
    for (const p of PARTICLE_KEYS) this.particle(p);
  }

  /** Unknown id (theme swap in progress): the royal builder with the raw id as glyph. */
  private missing(id: string): Texture {
    return buildRoyal(this.renderer, id.slice(0, 2), 0xb0a0c0, SYMBOL_CANVAS, 0.8, 0);
  }
}
