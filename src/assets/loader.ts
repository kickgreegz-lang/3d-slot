// side-effect import: registers the Spine skeleton/atlas loaders with Assets
import '@esotericsoftware/spine-pixi-v8';
import { type Application, Assets, type Texture } from 'pixi.js';
import { SYMBOLS } from '../config/game';
import type { ArtProvider, EnvArtKey, ParticleKey, SpineRef, SymbolVariant } from './art';
import { ART_MANIFEST, type ArtManifest } from './manifest';
import { PARTICLE_KEYS } from './placeholder/particles';
import { ProceduralArt, SYMBOL_CANVAS } from './placeholder/ProceduralArt';

/**
 * Art entry point. Resolution order per key:
 *   production file listed in assets/manifest.ts  ->  procedural placeholder.
 * Symbol blur/glow variants missing from the manifest are derived from whichever
 * static texture wins. Everything is baked/loaded here, before the first frame,
 * so no module ever hitches on first use.
 */
export const createArt = async (app: Application): Promise<ArtProvider> => {
  const renderer = app.renderer;
  const proc = new ProceduralArt(renderer, renderer.resolution >= 1.75 ? 1.5 : 1);
  const loaded = await loadManifest(ART_MANIFEST);
  const art = new ManifestArt(loaded, proc);
  art.warm();
  return art;
};

interface LoadedManifest {
  symbols: Map<string, Texture>;
  env: Map<EnvArtKey, Texture>;
  particles: Map<ParticleKey, Texture>;
  spine: Map<string, SpineRef>;
}

/** Only same-origin relative URLs may ever be requested (Stake Engine rule). */
const isRelative = (src: string): boolean => src.startsWith('./') && !src.includes('//');

const loadTexture = async (src: string): Promise<Texture | null> => {
  if (!isRelative(src)) return null;
  try {
    return await Assets.load<Texture>(src);
  } catch {
    return null;
  }
};

const loadManifest = async (m: ArtManifest): Promise<LoadedManifest> => {
  const out: LoadedManifest = { symbols: new Map(), env: new Map(), particles: new Map(), spine: new Map() };
  const jobs: Promise<void>[] = [];
  for (const e of m.symbols) {
    jobs.push(
      loadTexture(e.src).then((t) => {
        if (t) out.symbols.set(`${e.id}:${e.variant}`, t);
      }),
    );
  }
  for (const e of m.env) {
    jobs.push(
      loadTexture(e.src).then((t) => {
        if (t) out.env.set(e.key, t);
      }),
    );
  }
  for (const e of m.particles) {
    jobs.push(
      loadTexture(e.src).then((t) => {
        if (t) out.particles.set(e.key, t);
      }),
    );
  }
  if (m.spine.length > 0) {
    for (const e of m.spine) {
      if (!isRelative(e.skeleton) || !isRelative(e.atlas)) continue;
      const skeleton = `spine:${e.id}:skeleton`;
      const atlas = `spine:${e.id}:atlas`;
      jobs.push(
        Assets.load([
          { alias: skeleton, src: e.skeleton },
          { alias: atlas, src: e.atlas },
        ]).then(
          () => void out.spine.set(e.id, { skeleton, atlas, skin: e.skin }),
          () => undefined,
        ),
      );
    }
  }
  await Promise.all(jobs);
  return out;
};

/** Manifest-first provider with per-key procedural fallback. */
class ManifestArt implements ArtProvider {
  readonly symbolCanvas = SYMBOL_CANVAS;
  private derived = new Map<string, Texture>();

  constructor(
    private prod: LoadedManifest,
    private proc: ProceduralArt,
  ) {}

  symbol(id: string, variant: SymbolVariant = 'static'): Texture {
    const key = `${id}:${variant}`;
    const hit = this.prod.symbols.get(key) ?? this.derived.get(key);
    if (hit) return hit;
    if (variant !== 'static') {
      const prodStatic = this.prod.symbols.get(`${id}:static`);
      if (prodStatic) {
        const t = this.proc.derive(prodStatic, variant, SYMBOLS[id]?.restAngle ?? 0);
        this.derived.set(key, t);
        return t;
      }
    }
    return this.proc.symbol(id, variant);
  }

  spine(id: string): SpineRef | null {
    return this.prod.spine.get(id) ?? null;
  }

  env(key: EnvArtKey): Texture | null {
    return this.prod.env.get(key) ?? null;
  }

  particle(key: ParticleKey): Texture {
    return this.prod.particles.get(key) ?? this.proc.particle(key);
  }

  /** Resolve every symbol variant and particle now (bakes placeholders). */
  warm(): void {
    for (const id of Object.keys(SYMBOLS)) for (const v of ['static', 'blur', 'glow'] as const) this.symbol(id, v);
    for (const p of PARTICLE_KEYS) this.particle(p);
  }
}

// Dev-only visual QA: window.__artDemo(ctx, 'sheet' | 'board')
if (import.meta.env.DEV) {
  void import('./placeholder/demo').then((m) => m.installArtDemo());
}
