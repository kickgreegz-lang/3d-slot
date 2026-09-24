import type { Texture } from 'pixi.js';

/**
 * Art provider contract. Production art (Higgsfield -> matte -> AssetPack) and the
 * procedural placeholder art both implement it, so gameplay code never knows
 * which one is active. Resolution order: manifest asset -> placeholder.
 *
 * Symbol textures live on a fixed square canvas (360x360 @2x == 180 design px for a
 * 150 px cell, i.e. 1.2x the cell to leave room for pops/overflow), anchor 0.5.
 */
export type SymbolVariant = 'static' | 'blur' | 'glow';

export type EnvArtKey =
  | 'bg_landscape'
  | 'bg_portrait'
  | 'bg_fs_landscape'
  | 'bg_fs_portrait'
  | 'frame_beam'
  | 'frame_post'
  | 'frame_sill'
  | 'logo'
  | 'panel';

export type ParticleKey = 'spark' | 'dust' | 'coin' | 'star' | 'ring' | 'smoke' | 'shard' | 'glow' | 'note';

export interface SpineRef {
  skeleton: string;
  atlas: string;
  skin?: string;
}

export interface ArtProvider {
  /** Symbol texture; must exist for every id in config/game.ts SYMBOLS. */
  symbol(id: string, variant?: SymbolVariant): Texture;
  /** Spine binding for a symbol (loaded & ready) or null => procedural animation. */
  spine(id: string): SpineRef | null;
  /** Environment pieces; null when the layout should draw a procedural fallback. */
  env(key: EnvArtKey): Texture | null;
  particle(key: ParticleKey): Texture;
  /** Canvas size (design px) that symbol textures are authored for. */
  readonly symbolCanvas: number;
}
