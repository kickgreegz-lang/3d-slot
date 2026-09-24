import { type LayoutSpec, gridSize } from '../../config/layout';

/**
 * Where presentation elements sit in each design space. Derived from the layout
 * spec (frame/grid/HUD) so a re-tuned layout moves them automatically.
 */
export interface Placement {
  /** running tumble-win plate: on the frame sill, centred under the grid */
  tumblePlate: { x: number; y: number; scale: number };
  /** free-spin counter plate */
  fsCounter: { x: number; y: number; scale: number; stacked: boolean };
  /** scale for full-screen overlays (big win, FS intro/outro) around layout.center */
  overlayScale: number;
  /** max width available to overlay titles (design px, before overlayScale) */
  overlayMaxWidth: number;
}

export const placementFor = (L: LayoutSpec): Placement => {
  const g = gridSize(L);
  const gridCx = L.grid.x + g.w / 2;
  const sillY = L.frame.y + L.frame.h - L.frameParts.sill / 2;
  const k = L.cell / 150;
  switch (L.kind) {
    case 'portrait':
      return {
        tumblePlate: { x: gridCx, y: sillY, scale: k * 1.05 },
        // top beam (the logo lives above the frame in portrait)
        fsCounter: { x: L.width / 2, y: L.frame.y + L.frameParts.beam / 2 - 2, scale: 1.05, stacked: false },
        overlayScale: 0.78,
        overlayMaxWidth: L.width * 0.9 / 0.78,
      };
    case 'compact':
      return {
        tumblePlate: { x: gridCx + 90, y: sillY, scale: 0.72 },
        fsCounter: { x: gridCx - 190, y: sillY, scale: 0.72, stacked: false },
        overlayScale: 0.5,
        overlayMaxWidth: L.width * 0.66 / 0.5,
      };
    default: {
      // landscape + tablet: left column above the menu, clear of the frame and mascot
      const left = L.frame.x / 2;
      return {
        tumblePlate: { x: gridCx, y: sillY, scale: k },
        fsCounter: { x: left, y: L.grid.y + 160, scale: 1, stacked: true },
        overlayScale: 1,
        overlayMaxWidth: 1180,
      };
    }
  }
};
