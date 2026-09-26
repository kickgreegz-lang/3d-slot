import { BitmapFont, FillGradient, type Renderer } from 'pixi.js';
import { FONTS } from '../../../assets/fonts';

/**
 * Connection count-pop font `bd-connect-pop`: Titan One in meter teal with hard cel bands
 * (light top, base, shade bottom), black stroke and the plum extrusion shadow (ART_BIBLE
 * text: live BitmapText, nothing baked). Installed at 96 px and scaled down at use (44·k).
 * Glyphs outside the list are added on demand by pixi's dynamic bitmap fonts.
 */
export const CONNECT_POP_FONT = 'bd-connect-pop';

let installed = false;

export const ensureConnectFonts = (renderer: Renderer): void => {
  if (installed) return;
  installed = true;
  const fill = new FillGradient({
    type: 'linear',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    textureSpace: 'local',
    colorStops: [
      { offset: 0, color: '#c8fff8' },
      { offset: 0.34, color: '#c8fff8' },
      { offset: 0.3401, color: '#35f2e0' },
      { offset: 0.72, color: '#35f2e0' },
      { offset: 0.7201, color: '#17b3ab' },
      { offset: 1, color: '#17b3ab' },
    ],
  });
  BitmapFont.install({
    name: CONNECT_POP_FONT,
    chars: [['0', '9'], '+×x'],
    resolution: Math.min(2, Math.max(1, renderer.resolution)),
    padding: 10,
    style: {
      fontFamily: FONTS.value,
      fontSize: 96,
      fill,
      stroke: { color: 0x000000, width: 12, join: 'round' },
      dropShadow: { color: 0x4b283d, alpha: 1, blur: 0, distance: 6, angle: Math.atan2(0.83, 0.56) },
    },
  });
};
