// side-effect import: registers the Spine skeleton / atlas loaders with Assets (also done by assets/loader)
import '@esotericsoftware/spine-pixi-v8';
import { Assets } from 'pixi.js';
import type { QualityTier } from '../../../env/tier';

/**
 * Loading of the Bass Drop 2D mascot rigs (ANIMATION_SET §5, art/source/mascots), shipped by
 * tools/artqa/ship_mascots.py:
 *   ./assets/bass-drop/mascots/chr_<id>.json             skeleton (4.3 JSON, one per character)
 *   ./assets/bass-drop/mascots/chr_<id>.atlas|.webp      full texel density (authored at 2x landscape)
 *   ./assets/bass-drop/mascots/chr_<id>_half.atlas|.webp half density (the @0.5x pack; same skeleton)
 * Both atlases are PMA, one page each: Gumbo 1144x1024 (4.5 MiB RGBA8) / half 648x512 (1.3 MiB),
 * Croak 1272x1020 (4.9 MiB) / half 632x512 (1.2 MiB). Only one density per character is resident.
 *
 * Density: the rigs are authored at 2x the landscape design size, so a character drawn at `k`
 * screen px per skeleton unit needs the full page only above ~0.62 (a desktop at DPR 2); a
 * 1080p desktop (0.46 px/unit) and phones use the half page. The low tier stays on the half page
 * up to 0.9. A later layout that needs more upgrades (never downgrades: no thrash on resize).
 *
 * Aliases are registered once (Assets warns on a duplicate alias: a console line is an approval
 * failure); loads are ref-counted per atlas and a released atlas is unloaded (its GPU page freed).
 * A failed load resolves null (the character stays hidden) and logs nothing.
 */
export type MascotId = 'gumbo' | 'croak';
export type MascotDensity = 'full' | 'half';

export interface MascotRigRef {
  id: MascotId;
  density: MascotDensity;
  /** Assets aliases (new Spine({ skeleton, atlas })) */
  skeleton: string;
  atlas: string;
}

const BASE = './assets/bass-drop/mascots/';
const added = new Set<string>();
const users = new Map<string, number>();
const loading = new Map<string, Promise<boolean>>();

const alias = (id: MascotId, part: 'skel' | MascotDensity): string => `bd-mascot:${id}:${part}`;

const register = (key: string, src: string): void => {
  if (added.has(key)) return;
  added.add(key);
  Assets.add({ alias: key, src });
};

/** Density a character needs when drawn at `pxPerUnit` screen px per skeleton unit. */
export const mascotDensity = (pxPerUnit: number, tier: QualityTier): MascotDensity =>
  pxPerUnit > (tier === 'low' ? 0.9 : 0.62) ? 'full' : 'half';

/** Load (or share) a character rig at a density; null when it cannot be loaded. */
export const loadMascotRig = async (id: MascotId, density: MascotDensity): Promise<MascotRigRef | null> => {
  const skeleton = alias(id, 'skel');
  const atlas = alias(id, density);
  register(skeleton, `${BASE}chr_${id}.json`);
  register(atlas, `${BASE}chr_${id}${density === 'half' ? '_half' : ''}.atlas`);
  let job = loading.get(atlas);
  if (!job) {
    job = Assets.load([skeleton, atlas]).then(
      () => true,
      () => false,
    );
    loading.set(atlas, job);
  }
  const ok = await job;
  loading.delete(atlas);
  if (!ok) return null;
  users.set(atlas, (users.get(atlas) ?? 0) + 1);
  return { id, density, skeleton, atlas };
};

/** Drop one user of a character's atlas; the last one unloads the page. */
export const releaseMascotRig = (ref: MascotRigRef): void => {
  const n = (users.get(ref.atlas) ?? 1) - 1;
  if (n > 0) {
    users.set(ref.atlas, n);
    return;
  }
  users.delete(ref.atlas);
  void Assets.unload(ref.atlas).catch(() => undefined);
};

/** GPU bytes of a character's atlas page (RGBA8, no mipmaps), for the memory report / QA hooks. */
export const MASCOT_PAGE_BYTES: Record<MascotId, Record<MascotDensity, number>> = {
  gumbo: { full: 1144 * 1024 * 4, half: 648 * 512 * 4 },
  croak: { full: 1272 * 1020 * 4, half: 632 * 512 * 4 },
};
