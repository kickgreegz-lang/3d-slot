import { registerTiming } from '../core/timing';

/**
 * ENVIRONMENT CONTRACT: the background (BG) states every new game must show
 * (docs/new-slot/ANIMATION_STATES.md §3). The engine module that plays them is
 * `LayeredEnvironment` (opt-in: a game lists it in its modules.ts instead of a bespoke
 * background); the state logic is `EnvironmentDirector` (pure, no Pixi).
 *
 *   idle          ambient life: per-layer drift + a slow light breath
 *   spin          the scene leans in while the board falls out and drops in (held)
 *   land          a depth-scaled thump per column impact (weighted like the land SFX)
 *   miss          a dead spin exhales: the plates dim a little, then recover
 *   connect       winning clusters light the emissive layers in the winner's colour (held, pulsing)
 *   explode       the burst frame of a tumble: light kick + zoom punch + upward jolt
 *   anticipation  only when the book qualifies: dim + slow push-in + heartbeat light (held)
 *   bigwin        big-win presentation: light up, pulse (held until the round ends)
 *   feature       free-spins trigger: light kick, then the look crossfades to the feature look
 */
export type EnvState = 'idle' | 'spin' | 'land' | 'miss' | 'connect' | 'explode' | 'anticipation' | 'bigwin' | 'feature';

export const ENV_STATES: readonly EnvState[] = ['idle', 'spin', 'land', 'miss', 'connect', 'explode', 'anticipation', 'bigwin', 'feature'];

/**
 * Channels every layer reads (all springs, so states blend and never snap):
 *   light  0..1+  emissive ('light' role) layers: alpha rest -> lit
 *   zoom   fraction of scale added around the board centre, x depth gain
 *   lift   design px, + = down; x layer depth (near layers move most)
 *   dim    0..1   plate darkening (tint toward black)
 *   tint   0..1   blend of the light layers toward the current state colour
 */
export type EnvChannel = 'light' | 'zoom' | 'lift' | 'dim' | 'tint';
export const ENV_CHANNELS: readonly EnvChannel[] = ['light', 'zoom', 'lift', 'dim', 'tint'];

export type EnvOrient = 'landscape' | 'portrait';

/** Procedural stand-in for a layer until its production plate exists (placeholder.ts). */
export interface EnvPlaceholder {
  /** sky: vertical gradient · ridge: silhouette band · glow: soft lights at the edges · fog: soft band */
  kind: 'sky' | 'ridge' | 'glow' | 'fog';
  /** sky: top -> bottom stops; ridge: [fill]; glow: light colours; fog: [colour] */
  colors: number[];
  /** ridge / fog: vertical position of the band, 0 = top, 1 = bottom of the design rect */
  y?: number;
  /** ridge: band height as a fraction of the rect height */
  height?: number;
  seed?: number;
}

export interface EnvLayerSpec {
  id: string;
  /** plate: opaque or alpha art, dimmed by `dim` · light: additive, driven by `light` + `tint` */
  role: 'plate' | 'light';
  /** 0 = far (barely moves) .. 1 = at the board plane (moves with every reaction) */
  depth: number;
  /**
   * Shipped texture per orientation, RELATIVE url (e.g. './assets/<game>/bg/base_back_landscape.webp').
   * Leave out until the file exists: a missing file is a failed request (Stake approval) — the
   * placeholder is drawn instead. A layer with neither draws nothing.
   */
  src?: Partial<Record<EnvOrient, string>>;
  placeholder?: EnvPlaceholder;
  /** ambient drift (design px amplitude, period s); also gated by reduced motion */
  drift?: { x: number; y: number; period: number };
  /** light layers: alpha at rest and fully lit (default 0.35 / 1) */
  alpha?: { rest: number; lit: number };
}

export interface EnvLookSpec {
  layers: EnvLayerSpec[];
}

export interface EnvironmentSpec {
  /** 'base' is required; other looks are feature variants (same composition, new mood) */
  looks: { base: EnvLookSpec } & Record<string, EnvLookSpec>;
  /** look shown while gameType === 'freegame' (default: stay on base) */
  featureLook?: string;
  /** state colours for the light layers (connect uses the winning symbol's colour) */
  colors: { anticipation: number; bigwin: number; feature: number };
}

/**
 * Every number the environment uses — registered as lab section `environment`, so it is tuned
 * live in ?dev=lab and exported with the other sections (core/timing.ts registerTiming).
 * Hold/kick amplitudes are channel units (see EnvChannel); times are ms.
 */
export const ENV_TIMING = registerTiming('environment', {
  /** spring natural frequency (Hz) and damping ratio per channel */
  springHz: { light: 5, zoom: 2.6, lift: 6.5, dim: 2.2, tint: 3 },
  springZeta: { light: 0.7, zoom: 0.75, lift: 0.32, dim: 1, tint: 1 },
  idle: { breathe: 0.07, breathePeriod: 4.6 },
  spin: { zoom: 0.01, light: 0.12 },
  /** per column impact, x the land weight (light 0.7 .. special 1.6) */
  land: { lift: 4, zoom: -0.003, light: 0.08 },
  miss: { dim: 0.14, holdMs: 650 },
  connect: { light: 0.55, zoom: 0.006, tint: 1, pulse: 0.14, pulseHz: 2.2 },
  explode: { light: 0.6, zoom: 0.016, lift: -6 },
  anticipation: { dim: 0.28, light: 0.3, zoom: 0.024, tint: 1, pulse: 0.22, pulseHz: 1.9 },
  bigwin: { light: 0.85, zoom: 0.018, tint: 1, pulse: 0.2, pulseHz: 2.4 },
  feature: { light: 1, zoom: 0.03, crossfadeMs: 1400 },
  /** light kicks at or above flashLight are spaced >= flashGapMs (<= 3 flashes / s, IRIS gate) */
  flashLight: 0.4,
  flashGapMs: 334,
  /** zoom / lift / drift scale under prefers-reduced-motion (light is kept) */
  reducedMotionScale: 0,
  /** design px of overscan around the visible rect: must cover max zoom + lift + drift */
  bleed: 64,
  /** placeholder bake resolution (they are soft by design) */
  placeholderResolution: 0.5,
});

/** Land weight -> kick multiplier (mirrors TIMING.land.weight). */
export const LAND_WEIGHT: Record<string, number> = { light: 0.7, medium: 1, heavy: 1.35, special: 1.6 };
