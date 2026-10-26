import { FONTS } from '../../../assets/fonts';
import type { GlyphPalette, GlyphStyle } from '../../../present/common/glyphs';
import { GOLD as GOLD_GLYPHS } from '../../../present/common/glyphs';
import type { HeistFeature } from '../config';

/** Moonlight silver-teal: Night Prowl. */
export const MOON: GlyphPalette = {
  id: 'mh-moon',
  bands: [
    [0, '#ffffff'],
    [0.2, '#d6fbff'],
    [0.5, '#7fe6ef'],
    [0.76, '#3fb6c8'],
    [0.9, '#2a7fa6'],
  ],
  extrude: '#141a46',
  extrudeFar: '#0a0d29',
  outline: '#000000',
  specular: '#ffffff',
};

/** Starlight violet: Starfall. */
export const VIOLET: GlyphPalette = {
  id: 'mh-violet',
  bands: [
    [0, '#fff4ff'],
    [0.2, '#e6c4ff'],
    [0.5, '#b47cff'],
    [0.76, '#8a4ff0'],
    [0.9, '#6330c4'],
  ],
  extrude: '#1d1240',
  extrudeFar: '#0f0826',
  outline: '#000000',
  specular: '#ffffff',
};

/** Alarm crimson: retriggers, upgrades. */
export const RUBY: GlyphPalette = {
  id: 'mh-ruby',
  bands: [
    [0, '#ffe8ea'],
    [0.2, '#ff8f9c'],
    [0.5, '#ff3a52'],
    [0.76, '#d01a36'],
    [0.9, '#9c0f28'],
  ],
  extrude: '#2a0a1a',
  extrudeFar: '#16040e',
  outline: '#000000',
  specular: '#ffffff',
};

export const GOLD = GOLD_GLYPHS;

const TYPE = { family: FONTS.title, extrude: 0.1 } as const;
export const style = (size: number, palette: GlyphPalette, outline = 0.065, tracking = 0.03): GlyphStyle => ({
  ...TYPE,
  size,
  palette,
  outline,
  tracking,
});

/** Per heist: palette, accent colour, i18n keys. */
export const HEIST_LOOK: Record<HeistFeature, { palette: GlyphPalette; accent: number; rays: number; title: string; desc: string }> = {
  prowl: { palette: MOON, accent: 0x4fd1d9, rays: 0x7fe6ef, title: 'heist.prowl.title', desc: 'heist.prowl.desc' },
  vault: { palette: GOLD, accent: 0xffc53d, rays: 0xffc53d, title: 'heist.vault.title', desc: 'heist.vault.desc' },
  starfall: { palette: VIOLET, accent: 0xb06cff, rays: 0xc9a2ff, title: 'heist.starfall.title', desc: 'heist.starfall.desc' },
};
