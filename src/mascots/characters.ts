import type { DressColors, DressKind } from './placeholderDressing';
import type { Personality } from './procedural';
import type { PaletteRule } from './toon';

/**
 * Theme data for the two flanking mascots. Swapping the theme = swapping this file
 * (and the GLBs). Production GLBs are textured, so `palette` only matters for the
 * untextured CC0 placeholder (RobotExpressive), which is recoloured per character.
 */
export type MascotSide = 'left' | 'right';

export interface MascotDef {
  id: string;
  name: string;
  side: MascotSide;
  /** same-origin relative URL (Stake CDN sub-path safe) */
  url: string;
  palette: PaletteRule[];
  /** non-uniform body build: heavyset (>1 width) vs lanky (>1 height) */
  build: { width: number; height: number };
  /** yaw toward the reels (rad); + turns toward screen right */
  facing: number;
  /** clip playback-rate multiplier (heavier characters move a touch slower) */
  tempo: number;
  /** reaction delay after a cue (ms) so the pair never moves in lockstep */
  reactDelay: number;
  /** 0..1 start phase of the idle loop */
  idlePhase: number;
  persona: Personality;
  seed: number;
  /** placeholder-only props (see placeholderDressing.ts); unset for production GLBs */
  dress?: { kind: DressKind; colors: DressColors };
}

const PLACEHOLDER = './assets/characters/placeholder/RobotExpressive.glb';

/** LEFT: "Gumbo" — heavyset alligator bouncer. Swamp greens, cream belly. */
export const GUMBO: MascotDef = {
  id: 'gumbo',
  name: 'Gumbo',
  side: 'left',
  url: PLACEHOLDER,
  palette: [
    { mesh: /^Torso$/, material: /Main/, color: 0xeee0ab },
    { material: /Main/, color: 0x3f9d3a },
    { mesh: /^Hand/, material: /Grey/, color: 0xeee0ab },
    { material: /Grey/, color: 0x2b6b2a },
    { material: /Black/, color: 0x15101c },
  ],
  build: { width: 1.14, height: 0.97 },
  facing: 0.5,
  tempo: 0.92,
  reactDelay: 0,
  idlePhase: 0.1,
  persona: { groove: 0, sway: 0.035, breath: 4.2, blink: [2.8, 5.5] },
  seed: 0x6a7b,
  dress: { kind: 'gator', colors: { skin: 0x3f9d3a, shade: 0x2b6b2a, belly: 0xeee0ab, accent: 0xf2c230 } },
};

/** RIGHT: "Baron Croak" — lanky bullfrog DJ. Olive/yellow-green with hot-pink accents. */
export const BARON_CROAK: MascotDef = {
  id: 'croak',
  name: 'Baron Croak',
  side: 'right',
  url: PLACEHOLDER,
  palette: [
    { mesh: /^Torso$/, material: /Main/, color: 0xf2e79a },
    { material: /Main/, color: 0x8fbf3a },
    { material: /Grey/, color: 0xff5fa2 },
    { material: /Black/, color: 0x1a1024 },
  ],
  build: { width: 0.93, height: 1.05 },
  facing: -0.5,
  tempo: 1.06,
  reactDelay: 140,
  idlePhase: 0.55,
  persona: { groove: 104, sway: 0, breath: 3.3, blink: [2.2, 4.8] },
  seed: 0xc40a,
  dress: { kind: 'frog', colors: { skin: 0x8fbf3a, shade: 0x5f8a26, belly: 0xf2e79a, accent: 0xff5fa2 } },
};

export const MASCOTS: readonly MascotDef[] = [GUMBO, BARON_CROAK];

/** Small deterministic PRNG (mulberry32) — idle variation must replay identically. */
export const makeRng = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
