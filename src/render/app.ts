import { Application } from 'pixi.js';
import { clock } from '../core/clock';
import type { QualityTier } from '../env/tier';

/**
 * Pixi Application on WebGL2 (NOT WebGPU): three.js shares this GL context to
 * render the 3D mascots into render targets (see mascots/Mascots3D.ts).
 * sharedTicker:true so Spine autoUpdate, GSAP (via clock) and Pixi share one clock.
 */
export const createApp = async (tier: QualityTier): Promise<Application> => {
  const app = new Application();
  const dprCap = tier === 'low' ? 1.5 : 2;
  await app.init({
    preference: 'webgl',
    resizeTo: window,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, dprCap),
    antialias: false,
    background: '#0a0420',
    sharedTicker: true,
    powerPreference: 'high-performance',
  });
  app.canvas.id = 'game-canvas';
  document.getElementById('app')?.appendChild(app.canvas);
  clock.attach(app.ticker);
  return app;
};
