import type { Sprite } from 'pixi.js';
import { type UiArtKey, uiArt } from './uiArt';

/**
 * Placement data of the painted emblems (ART_STATUS §4.4 / §7.6): the content box of each canvas
 * (alpha bbox measured on the shipped files, as fractions of the canvas) so a screen sizes the
 * DRAWING, not the canvas, and the jukebox shards' boxes on the 1024 cut canvas
 * (art/source/ui/bass-drop/emblems/jukebox_shards/shards.json: bbox [x, y, w, h], burst = the unit
 * vector from the impact point through the shard's centroid).
 */
interface Content {
  /** content height and centre, fractions of the canvas */
  h: number;
  cx: number;
  cy: number;
}

const CONTENT: Partial<Record<UiArtKey, Content>> = {
  jukebox: { h: 0.923, cx: 0.505, cy: 0.505 },
  jukeboxCracked: { h: 0.923, cx: 0.505, cy: 0.505 },
  megaSpeaker: { h: 0.965, cx: 0.501, cy: 0.495 },
  jukeboxIcon: { h: 0.926, cx: 0.504, cy: 0.506 },
  megaSpeakerIcon: { h: 0.969, cx: 0.502, cy: 0.496 },
};

/**
 * Point `sprite` at a painted emblem so its drawing is `contentH` px tall and centred on the
 * sprite position. False when the art is not loaded (the caller draws its code fallback).
 */
export const useEmblem = (sprite: Sprite, key: UiArtKey, contentH: number): boolean => {
  const tex = uiArt.get(key);
  const c = CONTENT[key];
  if (!tex || !c) return false;
  if (sprite.texture !== tex) sprite.texture = tex;
  sprite.anchor.set(c.cx, c.cy);
  sprite.scale.set(contentH / (tex.height * c.h));
  return true;
};

/** Emblem canvas of the shard cut (the shards are cut on the 1024 master). */
export const SHARD_CANVAS = 1024;
/** Shipped shards are the cut at this scale (tools/artqa/ship_ui.py SHARD_SCALE). */
export const SHARD_SCALE = 0.75;

export interface ShardDef {
  key: UiArtKey;
  /** box on the 1024 canvas */
  x: number;
  y: number;
  w: number;
  h: number;
  /** unit burst direction (canvas y down) */
  bx: number;
  by: number;
}

export const SHARDS: readonly ShardDef[] = [
  { key: 'shard1', x: 394, y: 318, w: 553, h: 637, bx: 0.336, by: 0.942 },
  { key: 'shard2', x: 86, y: 319, w: 470, h: 670, bx: -0.573, by: 0.819 },
  { key: 'shard3', x: 86, y: 130, w: 470, h: 412, bx: -0.999, by: 0.033 },
  { key: 'shard4', x: 234, y: 53, w: 323, h: 265, bx: -0.635, by: -0.773 },
  { key: 'shard5', x: 503, y: 44, w: 328, h: 274, bx: 0.468, by: -0.884 },
  { key: 'shard6', x: 557, y: 150, w: 391, h: 419, bx: 0.994, by: 0.11 },
];
