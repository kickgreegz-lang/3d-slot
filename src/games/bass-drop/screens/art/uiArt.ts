import { Assets, type Texture } from 'pixi.js';

/**
 * The painted screen art (ART_STATUS §7.6), shipped by tools/artqa/ship_ui.py under
 * ./assets/bass-drop/ui/ (relative urls only; every file listed here is shipped):
 *   emblems/jukebox, jukebox_cracked, mega_speaker   768 px canvases (feature intro / upgrade / outro)
 *   emblems/*_icon                                   256 px (feature plate icon)
 *   emblems/shard_1..6                               the cracked jukebox cut into six (x0.75 of the 1024 cut)
 *   cards/art_meter, art_jukejam, art_megamix        768 px card illustrations (intro + buy, cropped live)
 *
 * Textures are loaded on demand and ref-counted per screen: the intro holds the three cards while it
 * shows, the buy screen its two, a feature its emblems (+ the upgrade set in Juke Jam), the plate
 * the two icons. The last release unloads the texture (GPU memory back). Operations on one url are
 * serialised, so an unload never lands on a texture a new acquire is loading. A failed load leaves
 * the key empty (the screens fall back to their code-drawn art) and logs nothing.
 *
 * Memory (RGBA8): emblem 2.25 MiB each, icon 0.25, the six shards 2.6 in all, card 2.25 each. Peaks:
 * intro 6.75 MiB (freed when it closes), buy screen 4.5 (freed on close), Juke Jam with the upgrade
 * set ready 9.3, Mega Mix 2.25; the two plate icons (0.5) stay.
 */
const BASE = './assets/bass-drop/ui/';

export const UI_ART = {
  jukebox: 'emblems/jukebox.webp',
  jukeboxCracked: 'emblems/jukebox_cracked.webp',
  megaSpeaker: 'emblems/mega_speaker.webp',
  jukeboxIcon: 'emblems/jukebox_icon.webp',
  megaSpeakerIcon: 'emblems/mega_speaker_icon.webp',
  shard1: 'emblems/shard_1.webp',
  shard2: 'emblems/shard_2.webp',
  shard3: 'emblems/shard_3.webp',
  shard4: 'emblems/shard_4.webp',
  shard5: 'emblems/shard_5.webp',
  shard6: 'emblems/shard_6.webp',
  cardMeter: 'cards/art_meter.webp',
  cardJukeJam: 'cards/art_jukejam.webp',
  cardMegaMix: 'cards/art_megamix.webp',
} as const;

export type UiArtKey = keyof typeof UI_ART;

export const SHARD_KEYS: readonly UiArtKey[] = ['shard1', 'shard2', 'shard3', 'shard4', 'shard5', 'shard6'];

class UiArtStore {
  private readonly tex = new Map<UiArtKey, Texture>();
  private readonly refs = new Map<UiArtKey, number>();
  /** last queued load / unload per key */
  private readonly chain = new Map<UiArtKey, Promise<void>>();

  /** QA: the keys resident now. */
  loaded(): UiArtKey[] {
    return [...this.tex.keys()];
  }

  /** The loaded texture (null while loading, after a failed load or once released). */
  get(key: UiArtKey): Texture | null {
    return this.tex.get(key) ?? null;
  }

  private queue(key: UiArtKey, op: () => Promise<void>): Promise<void> {
    const next = (this.chain.get(key) ?? Promise.resolve()).then(op, op);
    this.chain.set(key, next);
    return next;
  }

  /** Take a reference on each key and load what is missing; resolves when all are settled. */
  acquire(keys: readonly UiArtKey[]): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const key of keys) {
      const n = (this.refs.get(key) ?? 0) + 1;
      this.refs.set(key, n);
      jobs.push(
        this.queue(key, async () => {
          if (this.tex.has(key) || (this.refs.get(key) ?? 0) <= 0) return;
          try {
            const t = await Assets.load<Texture>(BASE + UI_ART[key]);
            if ((this.refs.get(key) ?? 0) > 0) this.tex.set(key, t);
            else await Assets.unload(BASE + UI_ART[key]);
          } catch {
            /* missing art: the owner keeps its code fallback */
          }
        }),
      );
    }
    return Promise.all(jobs).then(() => undefined);
  }

  /** Drop a reference on each key; the last one unloads the texture. */
  release(keys: readonly UiArtKey[]): void {
    for (const key of keys) {
      const n = (this.refs.get(key) ?? 0) - 1;
      if (n > 0) {
        this.refs.set(key, n);
        continue;
      }
      this.refs.delete(key);
      void this.queue(key, async () => {
        if ((this.refs.get(key) ?? 0) > 0 || !this.tex.has(key)) return;
        this.tex.delete(key);
        await Assets.unload(BASE + UI_ART[key]).catch(() => undefined);
      });
    }
  }
}

export const uiArt = new UiArtStore();
