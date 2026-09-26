import { type Container, Rectangle, type Renderer, type Sprite, type Texture } from 'pixi.js';
import { speedScale } from '../../../core/timing';

/**
 * Shared plumbing of the stage placeholder rigs (env_speaker_stack, env_horn, env_dj_booth):
 * baking code-drawn parts to textures and a tiny 30 fps clip playhead. Each placeholder class
 * keeps the ANIMATION_SET clip names as its play() API, so a Spine rig can replace it later
 * without touching the Stage module's choreography.
 */

/** ANIMATION_SET §0: every rig is authored at 30 fps. */
export const FPS = 30;

/** (frame, value) keys of one animated channel. */
export type Keys = ReadonlyArray<readonly [number, number]>;

const smooth = (u: number): number => u * u * (3 - 2 * u);

/** Value of a keyed channel at frame `f`: smoothstep between keys, held before / after. */
export const sample = (keys: Keys, f: number): number => {
  if (!keys.length) return 0;
  if (f <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const f1 = keys[i][0];
    if (f <= f1) {
      const f0 = keys[i - 1][0];
      const v0 = keys[i - 1][1];
      return v0 + (keys[i][1] - v0) * smooth((f - f0) / Math.max(1e-6, f1 - f0));
    }
  }
  return keys[keys.length - 1][1];
};

/**
 * One-shot clip playhead in frames. It advances with the GAME clock (hit-stops freeze it) at
 * 30 fps x speedScale(), like a Spine track whose timeScale follows the speed profile (a
 * slam retimes it); `rate` stretches a clip to a given length (drop_press over the charge).
 */
export class Playhead {
  name: string | null = null;
  f = 0;
  len = 0;
  rate = 1;

  play(name: string, len: number, rate = 1): void {
    this.name = name;
    this.f = 0;
    this.len = len;
    this.rate = rate;
  }

  /** Advance by `dt` game seconds; returns the frame (or -1 when idle). */
  advance(dt: number): number {
    if (!this.name) return -1;
    this.f += dt * FPS * speedScale() * this.rate;
    if (this.f >= this.len) {
      this.name = null;
      return -1;
    }
    return this.f;
  }

  is(name: string): boolean {
    return this.name === name;
  }

  stop(): void {
    this.name = null;
  }
}

/** A baked part: texture + the top-left of its frame in the rig's local space. */
export interface Baked {
  tex: Texture;
  x: number;
  y: number;
}

/** Bake a code-drawn part (destroyed afterwards) over `frame` at `res`, antialiased. */
export const bake = (renderer: Renderer, target: Container, frame: Rectangle, res: number): Baked => {
  const tex = renderer.generateTexture({ target, frame, resolution: res, antialias: true });
  target.destroy({ children: true });
  return { tex, x: frame.x, y: frame.y };
};

/** Bake a part drawn around (0, 0) inside a square of half-size `half` (centred sprites). */
export const bakeCentred = (renderer: Renderer, target: Container, half: number, res: number): Texture =>
  bake(renderer, target, new Rectangle(-half, -half, half * 2, half * 2), res).tex;

/** Place a sprite on a baked part (anchor 0 at the frame's top-left). */
export const placeBaked = (sprite: Sprite, b: Baked): Sprite => {
  sprite.texture = b.tex;
  sprite.anchor.set(0);
  sprite.position.set(b.x, b.y);
  return sprite;
};

/** Bake resolution for a part shown at `displayScale` design px -> screen px (x renderer resolution). */
export const bakeRes = (displayScale: number): number => Math.min(2, Math.max(0.5, Math.ceil(displayScale * 4) / 4));
