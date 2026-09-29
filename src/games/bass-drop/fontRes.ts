import type { Renderer } from 'pixi.js';

/**
 * Bass Drop's bitmap-font page resolution (the present/common/fonts.ts policy, installed by
 * ./modules.ts before any module installs a font): what this device's SCREEN shows, not the raw
 * renderer resolution. The fonts are installed at or above their display size in the landscape
 * design space (1920 x 1080; portrait and compact show them proportionally smaller; only the
 * feature banner's amount reaches x1.25 of the amount font, as it did at resolution 1 on a 1080p
 * desktop), so a glyph needs about one texel per device px per landscape-design px. Taken at the
 * full screen (a window can grow to it, a rotation keeps it): min(long / 1920, short / 1080) x
 * renderer resolution, in quarter steps, 1..2.
 *
 * A phone (390 x 844 CSS px, renderer resolution 2) gets 1 instead of 2: its dynamic-font pages are
 * 512² texels (1 MiB), not 1024² (4 MiB), across the ~26 pages the game's 11 fonts fill. A 1080p
 * desktop at DPR 1 keeps 1, a DPR-2 1080p desktop keeps 2, a 1440 x 900 DPR-2 laptop gets 1.5.
 */
export const bassDropFontResolution = (renderer: Renderer): number => {
  const w = Math.max(window.screen?.width ?? 0, window.innerWidth || 0);
  const h = Math.max(window.screen?.height ?? 0, window.innerHeight || 0);
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  const s = Math.min(long / 1920, short / 1080) * renderer.resolution;
  if (!Number.isFinite(s) || s <= 0) return Math.min(2, Math.max(1, renderer.resolution));
  return Math.min(2, Math.max(1, Math.ceil(s * 4) / 4));
};
