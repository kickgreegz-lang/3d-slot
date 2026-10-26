// side-effect import: registers the Spine skeleton / atlas loaders with Assets (also done by assets/loader)
import '@esotericsoftware/spine-pixi-v8';
import { Assets } from 'pixi.js';
import type { QualityTier } from '../../../env/tier';

/**
 * Loading of MONTY's 2D Spine rig (chr_monty, art/source/magpie-heist/mascot), shipped by
 * tools/mhart/mascot/ship_monty.py (adapted from the Bass Drop mascot loader):
 *   ./assets/magpie-heist/mascot/chr_monty.json             skeleton (4.3 JSON)
 *   ./assets/magpie-heist/mascot/chr_monty.atlas|.webp      full texel density (authored at 2x landscape)
 *   ./assets/magpie-heist/mascot/chr_monty_half.atlas|.webp half density (the @0.5x pack; same skeleton)
 * Both atlases are PMA, one page each (MONTY_PAGE_BYTES). Only one density is resident.
 *
 * Density: the rig is authored at 2x the landscape design size, so it needs the full page only above
 * ~0.62 screen px per skeleton unit (a desktop at DPR 2); a 1080p desktop (0.5 px/unit) and phones use
 * the half page. The low tier stays on the half page up to 0.9. A later layout that needs more upgrades
 * (never downgrades: no thrash on resize). Aliases are registered once; a failed load resolves null.
 */
export type MontyDensity = 'full' | 'half';

export interface MontyRigRef {
  density: MontyDensity;
  /** Assets aliases (new Spine({ skeleton, atlas })) */
  skeleton: string;
  atlas: string;
}

const BASE = './assets/magpie-heist/mascot/';
const added = new Set<string>();
const users = new Map<string, number>();
const loading = new Map<string, Promise<boolean>>();

const alias = (part: 'skel' | MontyDensity): string => `mh-mascot:monty:${part}`;

const register = (key: string, src: string): void => {
  if (added.has(key)) return;
  added.add(key);
  Assets.add({ alias: key, src });
};

/** Density the rig needs when drawn at `pxPerUnit` screen px per skeleton unit. */
export const montyDensity = (pxPerUnit: number, tier: QualityTier): MontyDensity =>
  pxPerUnit > (tier === 'low' ? 0.9 : 0.62) ? 'full' : 'half';

/** Load (or share) the rig at a density; null when it cannot be loaded. */
export const loadMontyRig = async (density: MontyDensity): Promise<MontyRigRef | null> => {
  const skeleton = alias('skel');
  const atlas = alias(density);
  register(skeleton, `${BASE}chr_monty.json`);
  register(atlas, `${BASE}chr_monty${density === 'half' ? '_half' : ''}.atlas`);
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
  return { density, skeleton, atlas };
};

/** Drop one user of an atlas; the last one unloads the page. */
export const releaseMontyRig = (ref: MontyRigRef): void => {
  const n = (users.get(ref.atlas) ?? 1) - 1;
  if (n > 0) {
    users.set(ref.atlas, n);
    return;
  }
  users.delete(ref.atlas);
  void Assets.unload(ref.atlas).catch(() => undefined);
};
