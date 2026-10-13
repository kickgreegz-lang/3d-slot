import type { EnvironmentSpec } from '../../environment/spec';

/**
 * __TITLE__ environment: the background stack LayeredEnvironment animates through every BG state
 * (idle, spin, land, miss, connect, explode, anticipation, bigwin, feature; ANIMATION_STATES.md §3).
 *
 * Today every layer is a procedural PLACEHOLDER so the game reacts from day one. Production
 * (HIGGSFIELD_PLAYBOOK.md §3.3):
 *   1. approve the 4k 21:9 plate (nano_banana_pro), outpaint the 1:2 portrait plate;
 *   2. split it into depth layers (image_decompose / background.txt#B) + the emissive light layer
 *      (background.txt#C), fill the holes behind the front layers;
 *   3. ship them as public/assets/__ID__/bg/<look>_<layer>_<orient>.webp (scripts only, manifest rows);
 *   4. set `src` below (RELATIVE urls) — never before the file exists (a 404 fails Stake approval).
 * The placeholder stays as the fallback if a plate ever fails to load.
 *
 * depth: 0 = far (barely moves) .. 1 = board plane. Keep the centre 60% calm: the board sits there.
 */
export const ENVIRONMENT: EnvironmentSpec = {
  looks: {
    base: {
      layers: [
        {
          id: 'sky',
          role: 'plate',
          depth: 0,
          // src: { landscape: './assets/__ID__/bg/base_sky_landscape.webp', portrait: './assets/__ID__/bg/base_sky_portrait.webp' },
          placeholder: { kind: 'sky', colors: [0x0b1030, 0x1d1450, 0x3a1a4a] },
        },
        {
          id: 'far',
          role: 'plate',
          depth: 0.2,
          placeholder: { kind: 'ridge', colors: [0x171a3c], y: 0.78, height: 0.32, seed: 11 },
          drift: { x: 6, y: 0, period: 19 },
        },
        {
          id: 'lights',
          role: 'light',
          depth: 0.35,
          placeholder: { kind: 'glow', colors: [0x3fd0ff, 0xff4fd8, 0xffc23f], seed: 7 },
          alpha: { rest: 0.35, lit: 1 },
          drift: { x: 0, y: 4, period: 7.3 },
        },
        {
          id: 'near',
          role: 'plate',
          depth: 0.6,
          placeholder: { kind: 'ridge', colors: [0x0a0a1c], y: 0.92, height: 0.3, seed: 23 },
        },
        {
          id: 'fog',
          role: 'plate',
          depth: 0.85,
          placeholder: { kind: 'fog', colors: [0x5a4a9a], y: 0.86, height: 0.2 },
          drift: { x: 14, y: 0, period: 23 },
        },
      ],
    },
    feature: {
      layers: [
        { id: 'sky', role: 'plate', depth: 0, placeholder: { kind: 'sky', colors: [0x2a0718, 0x5a0f2e, 0x8a2a1a] } },
        { id: 'far', role: 'plate', depth: 0.2, placeholder: { kind: 'ridge', colors: [0x2a0a1e], y: 0.78, height: 0.32, seed: 11 } },
        {
          id: 'lights',
          role: 'light',
          depth: 0.35,
          placeholder: { kind: 'glow', colors: [0xff7a2a, 0xff2a6a, 0xffd23f], seed: 7 },
          alpha: { rest: 0.45, lit: 1 },
        },
        { id: 'near', role: 'plate', depth: 0.6, placeholder: { kind: 'ridge', colors: [0x12040c], y: 0.92, height: 0.3, seed: 23 } },
      ],
    },
  },
  featureLook: 'feature',
  colors: { anticipation: 0xffd54a, bigwin: 0xffc23f, feature: 0xff4f6a },
};
