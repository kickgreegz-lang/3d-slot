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
 *          which keeps iOS memory low) and crossfaded base <-> freegame <-> megamix <-> bigwin.
 *
 * Format alternatives: end a URL with `.{ogg,m4a}` (AssetPack emits both); the first
 * extension the browser can play is chosen and ONLY that file is requested.
 *
 * Example:
 *   sfx: { land_heavy: ['./assets/audio/sfx/land_heavy_1.{ogg,m4a}', './assets/audio/sfx/land_heavy_2.{ogg,m4a}'] },
 *   music: { base: './assets/audio/music/base.{ogg,m4a}' },
 */
/**
 * base / freegame follow the round's gameType; 'megamix' is a hotter feature variant a game
 * selects with 'music:stem' (Bass Drop's Mega Mix, 112 BPM); bigwin plays over everything.
 */
export type MusicStem = 'base' | 'freegame' | 'megamix' | 'bigwin';

export interface AudioManifest {
  sfx: Partial<Record<SfxId, string | readonly string[]>>;
  music: Partial<Record<MusicStem, string>>;
}

export const AUDIO_MANIFEST: AudioManifest = {
  sfx: {},
  music: {},
};

const MIME: Record<string, string> = {
  ogg: 'audio/ogg; codecs="vorbis"',
  opus: 'audio/ogg; codecs="opus"',
  webm: 'audio/webm; codecs="opus"',
  m4a: 'audio/mp4; codecs="mp4a.40.2"',
  mp4: 'audio/mp4; codecs="mp4a.40.2"',
  aac: 'audio/aac',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
};

let probe: HTMLAudioElement | null = null;
const canPlay = (ext: string): boolean => {
  const mime = MIME[ext];
  if (!mime) return false;
  probe ??= document.createElement('audio');
  return probe.canPlayType(mime) !== '';
};

/** Resolve `name.{ogg,m4a}` to the first playable alternative (null when none is playable). */
export const pickFormat = (url: string): string | null => {
  const m = /\.\{([^}]+)\}$/.exec(url);
  if (!m) return url;
  const stem = url.slice(0, m.index);
  for (const ext of (m[1] ?? '').split(',').map((x) => x.trim())) if (canPlay(ext)) return `${stem}.${ext}`;
  return null;
};

/** Playable URL list for an SfxId (empty when the synth placeholder should play). */
export const sfxUrls = (id: SfxId, manifest: AudioManifest = AUDIO_MANIFEST): string[] => {
  const e = manifest.sfx[id];
  if (!e) return [];
  const list: readonly string[] = typeof e === 'string' ? [e] : e;
  return list.map(pickFormat).filter((u): u is string => u !== null);
};

/** Playable URL per music stem (unplayable / missing stems fall back to the procedural groove). */
export const musicUrls = (manifest: AudioManifest = AUDIO_MANIFEST): Partial<Record<MusicStem, string>> => {
  const out: Partial<Record<MusicStem, string>> = {};
  for (const [stem, url] of Object.entries(manifest.music) as [MusicStem, string][]) {
    const u = pickFormat(url);
    if (u) out[stem] = u;
  }
  return out;
};
