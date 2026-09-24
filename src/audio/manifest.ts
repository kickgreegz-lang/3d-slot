import type { SfxId } from '../game/events';

/**
 * PRODUCTION AUDIO MANIFEST — filled by the audio pipeline (mastered, AssetPack
 * m4a/ogg). An entry here always wins over the procedural placeholder in
 * synth.ts / music.ts; anything missing keeps the synth. Only listed files are
 * ever requested (a 404 is an approval failure), all as same-origin relative URLs.
 *
 *   sfx:   one URL, or several round-robin variations, per SfxId.
 *          'anticipation_loop' should be a seamless loop (it is played looped).
 *   music: loopable stems, streamed through <audio> elements (never decoded to PCM,
 *          which keeps iOS memory low) and crossfaded base <-> freegame <-> bigwin.
 *
 * Example:
 *   sfx: { land_heavy: ['./assets/audio/sfx/land_heavy_1.m4a', './assets/audio/sfx/land_heavy_2.m4a'] },
 *   music: { base: './assets/audio/music/base.m4a' },
 */
export type MusicStem = 'base' | 'freegame' | 'bigwin';

export interface AudioManifest {
  sfx: Partial<Record<SfxId, string | readonly string[]>>;
  music: Partial<Record<MusicStem, string>>;
}

export const AUDIO_MANIFEST: AudioManifest = {
  sfx: {},
  music: {},
};

/** Normalised URL list for an SfxId (empty when the synth placeholder should play). */
export const sfxUrls = (id: SfxId, manifest: AudioManifest = AUDIO_MANIFEST): readonly string[] => {
  const e = manifest.sfx[id];
  if (!e) return [];
  return typeof e === 'string' ? [e] : e;
};
