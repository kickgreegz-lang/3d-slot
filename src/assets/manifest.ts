import type { EnvArtKey, ParticleKey, SymbolVariant } from './art';

/**
 * PRODUCTION art manifest types. Each game fills its own `ART_MANIFEST` in
 * src/games/<GAME>/art.ts (art pipeline: Higgsfield -> matte -> AssetPack), re-exported
 * below. Everything listed there is loaded by `createArt()`; every key that is
 * NOT listed falls back to the procedural placeholder provider, per key.
 *
 * Rules (Stake Engine approval):
 *  - relative URLs only ('./assets/...'); never list a file that is not shipped
 *    (a 404 is a console error = approval failure);
 *  - symbols are 360x360 @2x canvases (180 design px), anchor 0.5, content baked at
 *    `SYMBOLS[id].cellScale` of the 150 px cell, drawn UPRIGHT (the symbol view
 *    applies `restAngle`). Name files `*@2x.webp` so Assets picks resolution 2;
 *  - a symbol may ship only its static art: blur/glow are then derived at boot.
 *
 * Example entries:
 *   symbols: [{ id: 'H1', variant: 'static', src: './assets/symbols/H1@2x.webp' }]
 *   env:     [{ key: 'bg_landscape', src: './assets/env/bg_landscape.webp' }]
 *   spine:   [{ id: 'H1', skeleton: './assets/spine/H1.skel', atlas: './assets/spine/H1.atlas' }]
 */
export interface ManifestSymbol {
  /** symbol id (config/game.ts SYMBOLS key) */
  id: string;
  variant: SymbolVariant;
  src: string;
}

export interface ManifestEnv {
  key: EnvArtKey;
  src: string;
}

export interface ManifestParticle {
  key: ParticleKey;
  src: string;
}

export interface ManifestSpine {
  /** symbol id the rig belongs to */
  id: string;
  skeleton: string;
  atlas: string;
  skin?: string;
}

export interface ArtManifest {
  symbols: ManifestSymbol[];
  env: ManifestEnv[];
  particles: ManifestParticle[];
  spine: ManifestSpine[];
}

/** The active game's production manifest (src/games/<GAME>/art.ts). */
export { ART_MANIFEST } from '@game/art';
