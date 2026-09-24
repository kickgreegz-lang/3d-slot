import { audioTimer } from './graph';
import type { MusicStem } from './manifest';

interface Track {
  el: HTMLAudioElement;
  gain: GainNode;
}

/**
 * Production music stems: each loops in an <audio> element routed through a
 * MediaElementAudioSourceNode into the music bus (streamed, not decoded — iOS
 * memory), with gain crossfades between base / freegame / bigwin. Elements are
 * created lazily on first use, i.e. only for listed files and only after unlock.
 */
export class StemPlayer {
  private readonly tracks = new Map<MusicStem, Track>();
  private active: MusicStem | null = null;

  constructor(
    private readonly ac: AudioContext,
    private readonly dest: AudioNode,
    private readonly urls: Partial<Record<MusicStem, string>>,
  ) {}

  has(stem: MusicStem): boolean {
    return typeof this.urls[stem] === 'string';
  }

  get current(): MusicStem | null {
    return this.active;
  }

  /** Crossfade to `stem` (bigwin restarts from the top; loops resume where they were). */
  play(stem: MusicStem, fade: number): void {
    if (stem === this.active) return;
    const track = this.track(stem);
    if (!track) return;
    this.fadeOutOthers(stem, fade);
    this.active = stem;
    if (stem === 'bigwin') track.el.currentTime = 0;
    void track.el.play().catch(() => undefined);
    const now = this.ac.currentTime;
    const g = track.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(1, now + fade);
  }

  /** Fade everything out (the procedural groove takes over). */
  stop(fade: number): void {
    this.fadeOutOthers(null, fade);
    this.active = null;
  }

  /** Pause/resume the media elements with the context (hidden tab, mute). */
  suspend(): void {
    for (const t of this.tracks.values()) t.el.pause();
  }

  resume(): void {
    if (!this.active) return;
    const t = this.tracks.get(this.active);
    if (t) void t.el.play().catch(() => undefined);
  }

  destroy(): void {
    for (const t of this.tracks.values()) {
      t.el.pause();
      t.el.removeAttribute('src');
      t.el.load();
      t.gain.disconnect();
    }
    this.tracks.clear();
  }

  private fadeOutOthers(keep: MusicStem | null, fade: number): void {
    const now = this.ac.currentTime;
    for (const [stem, t] of this.tracks) {
      if (stem === keep) continue;
      const g = t.gain.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + fade);
      audioTimer(this.ac, this.dest, fade + 0.05, () => {
        if (this.active !== stem) t.el.pause();
      });
    }
  }

  private track(stem: MusicStem): Track | null {
    const existing = this.tracks.get(stem);
    if (existing) return existing;
    const url = this.urls[stem];
    if (!url) return null;
    const el = new Audio();
    el.preload = 'auto';
    el.loop = true;
    el.src = url;
    const src = this.ac.createMediaElementSource(el);
    const gain = this.ac.createGain();
    gain.gain.value = 0;
    src.connect(gain);
    gain.connect(this.dest);
    const t = { el, gain };
    this.tracks.set(stem, t);
    return t;
  }
}
