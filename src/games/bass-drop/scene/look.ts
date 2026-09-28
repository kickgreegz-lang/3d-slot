import type { GlyphPalette } from '../../../present/common/glyphs';
import { registerTiming } from '../../../core/timing';
import type { MeterMode } from '../events';

/**
 * Bass Drop room (painted plates + neon layer) and logo look, lab-tunable as section
 * `bassDropScene`. Plate art: art/source/backgrounds/bass-drop (tools/bdart/backgrounds.py),
 * shipped to public/assets/bass-drop/bg by tools/licence/ship.py.
 */
export const SCENE_LOOK = registerTiming('bassDropScene', {
  /** music beat per mode (ms): 100 / 106 / 112 BPM, the same grid the meter and the stage pump on */
  beatMs: { base: 600, bonus: 566, super: 536 } as Record<MeterMode, number>,
  /** plate crossfade base <-> Juke Jam <-> Mega Mix (ms, UI time), behind the feature wipe */
  modeCrossfade: 1400,
  /** the feature wipe covers the screen this long after it starts (FeatureWipe, DESIGN §10.1) */
  wipeCover: 620,
  /** feature upgrade: the Mega Mix emblem slams at f28 of ui_feature_upgrade (DESIGN §10.4) */
  upgradeAt: 933,
  /**
   * Additive neon layer alpha: rest + beat x (1 - phase)^3 (the kick envelope the stage uses).
   * Per look: Juke Jam's dimmed string lights pulse softer, Mega Mix's party beams harder.
   */
  neon: {
    base: { rest: 0.28, beat: 0.5 },
    jukejam: { rest: 0.26, beat: 0.42 },
    megamix: { rest: 0.3, beat: 0.62 },
  },
  /** reduced motion: the neon holds this fraction of its beat amplitude (no pulse) */
  neonStill: 0.35,
  /** logo shine sweep (s, UI time): duration, gap, first delay */
  shineDuration: 1.1,
  shineGap: 7,
  shineDelay: 2.2,
});

export type PlateLook = 'base' | 'jukejam' | 'megamix';
export type PlateOrient = 'landscape' | 'portrait';

export const lookOf = (mode: MeterMode): PlateLook => (mode === 'bonus' ? 'jukejam' : mode === 'super' ? 'megamix' : 'base');

/** Shipped plate files (relative URLs, public/assets/bass-drop/bg). */
export const plateUrl = (look: PlateLook, orient: PlateOrient, neon: boolean): string =>
  `./assets/bass-drop/bg/${look}_${orient}${neon ? '_neon' : ''}.webp`;

/** Source size of each orientation's plates (px): 2:1 and 1:2. */
export const PLATE_SIZE: Record<PlateOrient, { w: number; h: number }> = {
  landscape: { w: 2560, h: 1280 },
  portrait: { w: 1536, h: 3072 },
};

/** Behind the plates while one loads (and if one ever fails): the plate's night-room plum. */
export const PLATE_BACKDROP = 0x1a1030;

/** Logo crest (tools/bdart/logo.py): 960 x 855 px, blank banner face at textBox [x, y, w, h]. */
export const LOGO_ART = {
  url: './assets/bass-drop/logo/logo_emblem.webp',
  size: { w: 960, h: 855 },
  textBox: { x: 110, y: 510, w: 738, h: 260 },
  /** the crest without the banner (speaker, horns, neon arcs): rows 0..crestBottom */
  crestBottom: 492,
  /** the banner's upward bow over its face width (px of the 960 canvas) */
  bannerRise: 58,
} as const;

/** Word-mark palettes: the intro logo's cyan over hot pink (screens/look.ts), own ids. */
export const LOGO_CYAN: GlyphPalette = {
  id: 'bd-logo-cyan',
  bands: [
    [0, '#e9fffb'],
    [0.2, '#8ffcee'],
    [0.5, '#35f2e0'],
    [0.76, '#16b9c9'],
    [0.9, '#0f84a8'],
  ],
  extrude: '#1d1a4d',
  extrudeFar: '#0e0b2b',
  outline: '#000000',
  specular: '#ffffff',
};

export const LOGO_PINK: GlyphPalette = {
  id: 'bd-logo-pink',
  bands: [
    [0, '#ffe6fb'],
    [0.2, '#ff9ae6'],
    [0.5, '#f828c8'],
    [0.76, '#c4169c'],
    [0.9, '#8c0f70'],
  ],
  extrude: '#3d1233',
  extrudeFar: '#220a1d',
  outline: '#000000',
  specular: '#ffffff',
};
