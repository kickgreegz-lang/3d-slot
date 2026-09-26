import { CanvasSource, Texture } from 'pixi.js';
import { createCanvas } from '../../../fx/textures';

/**
 * Procedural textures of the groove links (ANIMATION_SET §8 `link_wave`), drawn once with
 * Canvas2D and shared by every link. Both tile seamlessly along x (every curve is periodic
 * over the texture width) and use `addressMode: 'repeat'`, so the link meshes scroll them
 * by moving their u coordinates. White on transparent: links tint them per cluster and draw
 * them additively. Mipmapped: the 32 px strip is shown ~13 px wide on the landscape board.
 */

/** Waveform strip size (DESIGN §7.3: 128 x 32, one bass wavelength per texture width). */
export const WAVE_W = 128;
export const WAVE_H = 32;
const CORE_H = 8;

const TAU = Math.PI * 2;

const repeatTexture = (canvas: HTMLCanvasElement): Texture =>
  new Texture({
    source: new CanvasSource({
      resource: canvas,
      width: canvas.width,
      height: canvas.height,
      transparent: true,
      scaleMode: 'linear',
      addressMode: 'repeat',
      autoGenerateMipmaps: true,
    }),
  });

/** Bass wave centre line (px from the strip centre) at x: one long hump + a small harmonic. */
const waveY = (x: number): number => 9.4 * Math.sin((TAU * x) / WAVE_W) + 1.6 * Math.sin((3 * TAU * x) / WAVE_W + 0.6);

/**
 * 128 x 32 bass-waveform strip: a soft glow band, an audio-waveform envelope of thin bars
 * (two lobes per wavelength) and the bright bass wave line with its own halo.
 */
const drawWave = (): HTMLCanvasElement => {
  const [c, g] = createCanvas(WAVE_W, WAVE_H);
  const cy = WAVE_H / 2;
  // tube body: a flat plateau over the inner ~60% with soft edges (reads as a lit neon tube)
  for (let y = 0; y < WAVE_H; y++) {
    const d = Math.abs(y + 0.5 - cy) / cy;
    const a = d < 0.5 ? 0.62 : 0.62 * Math.max(0, 1 - (d - 0.5) / 0.5) ** 1.5;
    g.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
    g.fillRect(0, y, WAVE_W, 1);
  }
  // waveform envelope (the "audio file" read): two filled lobes per wavelength
  g.beginPath();
  for (let x = 0; x <= WAVE_W; x++) g.lineTo(x, cy - 14 * (0.25 + 0.75 * Math.abs(Math.sin((TAU * x) / WAVE_W)) ** 0.7));
  for (let x = WAVE_W; x >= 0; x--) g.lineTo(x, cy + 14 * (0.25 + 0.75 * Math.abs(Math.sin((TAU * x) / WAVE_W)) ** 0.7));
  g.closePath();
  g.fillStyle = 'rgba(255,255,255,0.26)';
  g.fill();
  // the bass wave: halo stroke, then the bright line (drawn past both edges so it tiles)
  const path = (): void => {
    g.beginPath();
    for (let x = -8; x <= WAVE_W + 8; x += 1) {
      const y = cy + waveY(x);
      if (x === -8) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
  };
  g.lineJoin = 'round';
  g.lineCap = 'round';
  path();
  g.strokeStyle = 'rgba(255,255,255,0.7)';
  g.lineWidth = 16;
  g.stroke();
  path();
  g.strokeStyle = 'rgba(255,255,255,1)';
  g.lineWidth = 9;
  g.stroke();
  return c;
};

/** 128 x 8 white-hot core: a hard centre line whose brightness beats twice per wavelength. */
const drawCore = (): HTMLCanvasElement => {
  const [c, g] = createCanvas(WAVE_W, CORE_H);
  const cy = CORE_H / 2;
  for (let x = 0; x < WAVE_W; x++) {
    const beat = 0.78 + 0.22 * (0.5 + 0.5 * Math.cos((2 * TAU * x) / WAVE_W));
    for (let y = 0; y < CORE_H; y++) {
      const d = (y + 0.5 - cy) / 2.9;
      g.fillStyle = `rgba(255,255,255,${(beat * Math.exp(-(d ** 6))).toFixed(3)})`;
      g.fillRect(x, y, 1, 1);
    }
  }
  return c;
};

let wave: Texture | null = null;
let core: Texture | null = null;

export const linkTextures = (): { wave: Texture; core: Texture } => {
  wave ??= repeatTexture(drawWave());
  core ??= repeatTexture(drawCore());
  return { wave, core };
};

export const destroyLinkTextures = (): void => {
  wave?.destroy(true);
  core?.destroy(true);
  wave = core = null;
};
