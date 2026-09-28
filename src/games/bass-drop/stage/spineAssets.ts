// side-effect import: registers the Spine skeleton / atlas loaders with Assets (also done by assets/loader)
import '@esotericsoftware/spine-pixi-v8';
import { Assets } from 'pixi.js';
import type { QualityTier } from '../../../env/tier';

/**
 * Loading of the Bass Drop UI / environment Spine rigs (ANIMATION_SET §3 `ui_groove_meter`, §4.1
 * `env_speaker_stack`), shipped by tools/artqa/ship_ui.py:
 *   ./assets/bass-drop/ui/spine/<rig>.json             skeleton (4.3 JSON, one per rig)
 *   ./assets/bass-drop/ui/spine/<rig>.atlas|.webp      full texel density (authored at 2x landscape)
 *   ./assets/bass-drop/ui/spine/<rig>_half.atlas|.webp half density (same skeleton, half the texels)
 * Both atlases are PMA, one page each (meter 2048x2036 = 15.9 MiB / half 1004x1012 = 3.9 MiB; speaker
 * stack 1280x992 = 4.8 MiB / half 644x500 = 1.2 MiB, RGBA8). Only one density per rig is resident.
 *
 * Density: the rigs are authored at 2x the landscape design size (1 skeleton unit = 0.5 design px at
 * rig scale 1), so a rig drawn at `k` screen px per skeleton unit needs the full page only above
 * ~0.62 (desktop at DPR 2, 4K); phones (portrait meter ~0.5 px/unit) and a 1080p desktop (0.5) use the
 * half page 1:1. The low tier stays on the half page up to 0.9. A later layout that needs more upgrades
 * (never downgrades: no thrash on resize).
 *
 * Aliases are registered once (Assets warns on a duplicate alias, a console line = approval failure);
 * loads are ref-counted per atlas and a released atlas is unloaded (its GPU page freed). A failed load
 * resolves null (the owner keeps its code rig) and logs nothing.
 */
export type RigId = 'ui_groove_meter' | 'env_speaker_stack';
export type RigDensity = 'full' | 'half';

export interface RigRef {
  id: RigId;
  density: RigDensity;
  /** Assets aliases (Spine.from / new Spine({ skeleton, atlas })) */
  skeleton: string;
  atlas: string;
}

const BASE = './assets/bass-drop/ui/spine/';
const added = new Set<string>();
const users = new Map<string, number>();
const loading = new Map<string, Promise<boolean>>();

const alias = (id: RigId, part: 'skel' | RigDensity): string => `bd-ui-spine:${id}:${part}`;

const register = (key: string, src: string): void => {
  if (added.has(key)) return;
  added.add(key);
  Assets.add({ alias: key, src });
};

/** Density the rig needs when drawn at `pxPerUnit` screen px per skeleton unit. */
export const rigDensity = (pxPerUnit: number, tier: QualityTier): RigDensity =>
  pxPerUnit > (tier === 'low' ? 0.9 : 0.62) ? 'full' : 'half';

/** Load (or share) a rig at a density; null when it cannot be loaded. */
export const loadRig = async (id: RigId, density: RigDensity): Promise<RigRef | null> => {
  const skeleton = alias(id, 'skel');
  const atlas = alias(id, density);
  register(skeleton, `${BASE}${id}.json`);
  register(atlas, `${BASE}${id}${density === 'half' ? '_half' : ''}.atlas`);
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

/** Drop one user of a rig's atlas; the last one unloads the page. */
export const releaseRig = (ref: RigRef): void => {
  const n = (users.get(ref.atlas) ?? 1) - 1;
  if (n > 0) {
    users.set(ref.atlas, n);
    return;
  }
  users.delete(ref.atlas);
  void Assets.unload(ref.atlas).catch(() => undefined);
};

/** GPU bytes of a rig page (RGBA8), for the memory report / QA hooks. */
export const RIG_PAGE_BYTES: Record<RigId, Record<RigDensity, number>> = {
  ui_groove_meter: { full: 2048 * 2036 * 4, half: 1004 * 1012 * 4 },
  env_speaker_stack: { full: 1280 * 992 * 4, half: 644 * 500 * 4 },
};
