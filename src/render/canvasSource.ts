import { CanvasSource, type CanvasSourceOptions } from 'pixi.js';

/**
 * A CanvasSource at `resolution` that never resizes (and so never clears) its canvas.
 *
 * Pixi 8's CanvasSource derives `width = canvas.width / resolution`, then `pixelWidth = width *
 * resolution` WITHOUT rounding, and resizes the canvas whenever that is not exactly its pixel size.
 * At a fractional resolution the round trip can miss by one ulp (1.75: 58 / 1.75 * 1.75 =
 * 57.999...), so the canvas is set to 57 px and loses everything painted on it: a blank glyph in a
 * title, a blank tile. Built at resolution 1 (exact pixel sizes) and then switched to `resolution`,
 * which only recomputes width / height. Build the Texture AFTER this (its frame comes from the
 * source's width / height at construction).
 */
export const canvasSource = (
  canvas: HTMLCanvasElement,
  resolution: number,
  opts: Omit<CanvasSourceOptions, 'resource' | 'resolution' | 'width' | 'height'> = {},
): CanvasSource => {
  const source = new CanvasSource({ ...opts, resource: canvas, resolution: 1 });
  source.resolution = resolution;
  return source;
};
