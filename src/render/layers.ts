import { Container, RenderLayer } from 'pixi.js';

/**
 * Fixed layer stack (back -> front). Everything visual attaches to one of these.
 *
 *   background   cover-scaled environment art (outside the contain-scaled root)
 *   bgFx         additive neon pulses, haze, light cones (cover-scaled)
 *   root         contain-scaled design space; shake is applied here
 *     panel      glass panel behind the grid
 *     tiles      multiplier-spot tiles (heat skins)
 *     spotText   multiplier numbers — drawn BEHIND symbols (reference look)
 *     board      symbols (scissor-masked to the panel opening)
 *     frame      wooden frame posts/beam/sill (ABOVE the board)
 *     logo
 *     mascots    3D render-target sprites + blob shadows
 *     fx         particles, flashes that belong to the design space
 *     hud        Pixi HUD (buttons, balance/bet/win)
 *     overlay    big win, free-spin intro/outro, transitions
 *   winLayer     RenderLayer: symbols/labels re-parented here escape the board
 *                mask and render above the frame (win pops, scatter lands).
 *   screenFx     full-screen flash/vignette (not shaken, cover-scaled)
 */
export interface Layers {
  stage: Container;
  background: Container;
  bgFx: Container;
  root: Container;
  panel: Container;
  tiles: Container;
  spotText: Container;
  board: Container;
  frame: Container;
  logo: Container;
  mascots: Container;
  fx: Container;
  hud: Container;
  overlay: Container;
  winLayer: RenderLayer;
  screenFx: Container;
}

export const createLayers = (stage: Container): Layers => {
  const mk = (label: string, parent: Container): Container => {
    const c = new Container({ label });
    parent.addChild(c);
    return c;
  };
  const background = mk('background', stage);
  const bgFx = mk('bgFx', stage);
  const root = mk('root', stage);
  const panel = mk('panel', root);
  const tiles = mk('tiles', root);
  const spotText = mk('spotText', root);
  const board = mk('board', root);
  const frame = mk('frame', root);
  const logo = mk('logo', root);
  // winLayer sits in the root (so it is contain-scaled and shaken) above logo, below mascots.
  const winLayer = new RenderLayer();
  root.addChild(winLayer);
  const mascots = mk('mascots', root);
  const fx = mk('fx', root);
  const hud = mk('hud', root);
  const overlay = mk('overlay', root);
  const screenFx = mk('screenFx', stage);
  return {
    stage,
    background,
    bgFx,
    root,
    panel,
    tiles,
    spotText,
    board,
    frame,
    logo,
    mascots,
    fx,
    hud,
    overlay,
    winLayer,
    screenFx,
  };
};
