import type { SfxId } from '../game/events';
import { type AudioGraph, audioTimer, createGraph, dbToGain, rampFreqTo, rampTo } from './graph';
import { AUDIO_MANIFEST, type AudioManifest, type MusicStem, musicUrls, sfxUrls } from './manifest';
import { AUDIO_TIMING, SFX_RULES, VOLUME_JITTER_DB } from './mix';
import { Groove } from './music';
import { StemPlayer } from './stems';
import { SYNTH_VOICES } from './synth';
import { Voice } from './voice';

export interface PlayOpts {
  volume?: number;
  rate?: number;
  /** escalation index handed to the voice (cascade step, spot tier, ...) */
  step?: number;
  /** anticipation heartbeat period (s) */
  period?: number;
}

interface GroupState {
  voices: Voice[];
  lastStart: number;
  lastPriority: number;
}

/** Events that carry user activation in every current engine (pointerdown on touch does not). */
const GESTURES = ['keydown', 'mousedown', 'pointerup', 'touchend', 'click'] as const;

/** Tiny offset so voices never start "in the past" of the render quantum. */
const AHEAD = 0.004;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

type AudioContextCtor = new (opts?: AudioContextOptions) => AudioContext;

/**
 * AudioEngine — owns the (lazily created) AudioContext and everything that
 * plays through it.
 *
 *  - No AudioContext exists until a real user gesture (keydown / mousedown /
 *    pointerup / touchend / click with `navigator.userActivation.isActive`), so
 *    the browser never logs an autoplay warning. Before that, plays are no-ops.
 *  - Mute and hidden-tab both fade the master bus and then SUSPEND the context:
 *    nothing renders, the music clock stops, and it resumes seamlessly.
 *  - Voice limiting per group (max concurrent, min gap, priority), random pitch
 *    and level spread per play, music ducking and the anticipation filter.
 *  - Production files from manifest.ts replace synth voices / the groove per id.
 */
export class AudioEngine {
  private ac: AudioContext | null = null;
  private g: AudioGraph | null = null;
  private groove: Groove | null = null;
  private stems: StemPlayer | null = null;
  private enabled: boolean;
  private hidden: boolean;
  private started = false;
  private suspendGen = 0;
  private readonly groups = new Map<string, GroupState>();
  private loop: Voice | null = null;
  private readonly buffers = new Map<SfxId, AudioBuffer[]>();
  private readonly raw = new Map<SfxId, Promise<ArrayBuffer | null>[]>();
  private mode: MusicStem = 'base';
  private inBigWin = false;
  private anticipating = false;
  private duckDb = 0;
  private duckUntil = 0;
  private listening = false;
  private pumping = false;

  constructor(
    private readonly opts: { lowTier: boolean; enabled: boolean; manifest?: AudioManifest },
    private readonly random: () => number = Math.random,
  ) {
    this.enabled = opts.enabled;
    this.hidden = typeof document !== 'undefined' && document.hidden;
  }

  private get manifest(): AudioManifest {
    return this.opts.manifest ?? AUDIO_MANIFEST;
  }

  /** True when sounds actually render (unlocked, enabled, visible). */
  get live(): boolean {
    return !!this.ac && this.ac.state === 'running' && this.enabled && !this.hidden;
  }

  get context(): AudioContext | null {
    return this.ac;
  }

  get graph(): AudioGraph | null {
    return this.g;
  }

  // ---------------------------------------------------------------- lifecycle

  /** Listen for the first user gesture (and later ones, to recover iOS interruptions). */
  attach(): void {
    if (this.listening) return;
    this.listening = true;
    for (const type of GESTURES) window.addEventListener(type, this.onGesture, { capture: true, passive: true });
  }

  /** Start fetching (not decoding) listed production SFX; decoding waits for the context. */
  preload(): void {
    for (const id of Object.keys(this.manifest.sfx) as SfxId[]) {
      const urls = sfxUrls(id, this.manifest);
      if (!urls.length) continue;
      this.raw.set(
        id,
        urls.map((u) =>
          fetch(u)
            .then((r) => (r.ok ? r.arrayBuffer() : null))
            .catch(() => null),
        ),
      );
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (on && !this.ac) this.tryCreate();
    this.sync();
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.sync();
  }

  destroy(): void {
    for (const type of GESTURES) window.removeEventListener(type, this.onGesture, { capture: true });
    this.listening = false;
    this.stems?.destroy();
    void this.ac?.close().catch(() => undefined);
    this.ac = null;
    this.g = null;
    this.groove = null;
    this.stems = null;
  }

  private readonly onGesture = (): void => {
    if (!this.enabled) return;
    if (!this.ac) this.tryCreate();
    else if (this.ac.state !== 'running' && !this.hidden) void this.ac.resume().catch(() => undefined);
  };

  private tryCreate(): void {
    if (this.ac) return;
    const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
    if (ua && !ua.isActive) return;
    const w = window as Window & { webkitAudioContext?: AudioContextCtor };
    const Ctor: AudioContextCtor | undefined = window.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) {
      this.destroy();
      return;
    }
    let ac: AudioContext | null = null;
    try {
      ac = new Ctor({ latencyHint: 'interactive' });
      // pre-2021 WebKit lacks these; degrade to silence rather than throw in a gesture handler
      if (typeof ac.createConstantSource !== 'function' || typeof ac.createStereoPanner !== 'function') {
        throw new Error('unsupported Web Audio');
      }
      this.g = createGraph(ac, { lowTier: this.opts.lowTier });
      this.groove = new Groove(this.g, this.mode, this.random);
      const stems = musicUrls(this.manifest);
      if (Object.keys(stems).length) this.stems = new StemPlayer(ac, this.g.musicIn, stems);
    } catch {
      void ac?.close().catch(() => undefined);
      this.destroy();
      return;
    }
    this.ac = ac;
    ac.addEventListener('statechange', this.onState);
    // iOS: a (silent) buffer started inside the gesture fully unlocks output
    const src = ac.createBufferSource();
    src.buffer = ac.createBuffer(1, 1, ac.sampleRate);
    src.connect(ac.destination);
    src.start(0);
    if (ac.state !== 'running') void ac.resume().catch(() => undefined);
    this.onState();
  }

  private readonly onState = (): void => {
    const ac = this.ac;
    if (!ac || ac.state !== 'running' || this.started) return;
    this.started = true;
    void this.decodeAll();
    this.startMusic();
    this.pump();
    if (!this.enabled || this.hidden) this.sync();
  };

  /** Bring the context in line with enabled/hidden: fade + suspend, or resume + fade in. */
  private sync(): void {
    const ac = this.ac;
    const g = this.g;
    if (!ac || !g) return;
    const want = this.enabled && !this.hidden;
    const gen = ++this.suspendGen;
    const now = ac.currentTime;
    if (want) {
      if (ac.state !== 'running') void ac.resume().catch(() => undefined);
      this.stems?.resume();
      rampTo(g.master.gain, 1, now, AUDIO_TIMING.masterFade);
      return;
    }
    rampTo(g.master.gain, 0, now, AUDIO_TIMING.masterFade);
    this.stopLoop(AUDIO_TIMING.masterFade);
    if (ac.state !== 'running') {
      this.stems?.suspend();
      return;
    }
    audioTimer(ac, ac.destination, AUDIO_TIMING.masterFade + 0.02, () => {
      if (gen !== this.suspendGen || this.enabled && !this.hidden) return;
      this.stems?.suspend();
      void ac.suspend().catch(() => undefined);
    });
  }

  private async decodeAll(): Promise<void> {
    const ac = this.ac;
    if (!ac) return;
    for (const [id, list] of this.raw) {
      const out: AudioBuffer[] = [];
      for (const p of list) {
        const ab = await p;
        if (!ab) continue;
        try {
          out.push(await ac.decodeAudioData(ab));
        } catch {
          /* undecodable file: keep the synth voice */
        }
      }
      if (out.length) this.buffers.set(id, out);
    }
    this.raw.clear();
  }

  // ---------------------------------------------------------------- music

  /** Keep the groove scheduled `lookAhead` seconds ahead of the audio clock (also called per frame). */
  tick(): void {
    if (!this.live || !this.groove || !this.ac) return;
    this.groove.schedule(this.ac.currentTime + AUDIO_TIMING.lookAhead);
  }

  /** Audio-clock pump: re-arms itself every pumpInterval; freezes with the context while suspended. */
  private pump(): void {
    if (this.pumping) return;
    this.pumping = true;
    const loop = (): void => {
      const ac = this.ac;
      if (!ac) {
        this.pumping = false;
        return;
      }
      this.tick();
      audioTimer(ac, ac.destination, AUDIO_TIMING.pumpInterval, loop);
    };
    loop();
  }

  setMode(stem: MusicStem): void {
    this.mode = stem;
    if (!this.inBigWin) this.switchMusic(stem, 16);
  }

  bigWinStart(): void {
    if (this.inBigWin) return;
    this.inBigWin = true;
    this.switchMusic('bigwin', 4);
  }

  bigWinEnd(): void {
    if (!this.inBigWin) return;
    this.inBigWin = false;
    this.switchMusic(this.mode, 16);
  }

  /** Extra groove layers (0..3), e.g. the tumble cascade depth. */
  setEnergy(level: number): void {
    if (this.groove) this.groove.energy = clamp(Math.floor(level), 0, 3);
  }

  private startMusic(): void {
    const ac = this.ac;
    if (!ac) return;
    const stem = this.inBigWin ? 'bigwin' : this.mode;
    if (this.stems?.has(stem)) this.stems.play(stem, AUDIO_TIMING.musicFadeIn);
    else {
      this.groove?.setStem(stem);
      this.groove?.start(ac.currentTime + 0.05);
    }
  }

  private switchMusic(stem: MusicStem, quantum: number): void {
    const ac = this.ac;
    if (!ac || !this.started) {
      this.groove?.setStem(stem);
      return;
    }
    const fade = AUDIO_TIMING.stemCrossfade;
    if (this.stems?.has(stem)) {
      this.groove?.stop(ac.currentTime, fade);
      this.stems.play(stem, fade);
      return;
    }
    this.stems?.stop(fade);
    if (this.groove?.isRunning) this.groove.setStem(stem, quantum);
    else {
      this.groove?.setStem(stem);
      this.groove?.start(ac.currentTime + 0.05, fade);
    }
  }

  // ---------------------------------------------------------------- ducking

  /** Dip the music by `db` for `hold` seconds (overlapping ducks take the deeper/longer). */
  duck(db: number, hold: number): void {
    const ac = this.ac;
    if (!ac) return;
    const now = ac.currentTime;
    this.duckDb = now < this.duckUntil ? Math.min(this.duckDb, db) : db;
    this.duckUntil = Math.max(this.duckUntil, now + hold);
    this.applyDuck();
  }

  private applyDuck(): void {
    const ac = this.ac;
    const g = this.g;
    if (!ac || !g) return;
    const now = ac.currentTime;
    const base = this.anticipating ? dbToGain(AUDIO_TIMING.anticipationDuckDb) : 1;
    const p = g.musicDuck.gain;
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    if (this.duckUntil > now) {
      const target = Math.min(base, dbToGain(this.duckDb));
      p.linearRampToValueAtTime(target, now + AUDIO_TIMING.duckAttack);
      p.setValueAtTime(target, Math.max(now + AUDIO_TIMING.duckAttack, this.duckUntil));
      p.linearRampToValueAtTime(base, Math.max(now + AUDIO_TIMING.duckAttack, this.duckUntil) + AUDIO_TIMING.duckRelease);
    } else {
      p.linearRampToValueAtTime(base, now + AUDIO_TIMING.duckAttack * 2);
    }
  }

  private setAnticipation(on: boolean): void {
    const ac = this.ac;
    const g = this.g;
    if (!ac || !g || this.anticipating === on) return;
    this.anticipating = on;
    const open = Math.min(20000, ac.sampleRate * 0.45);
    rampFreqTo(g.musicFilter.frequency, on ? AUDIO_TIMING.anticipationCutoff : open, ac.currentTime, AUDIO_TIMING.anticipationSweep);
    this.applyDuck();
  }

  // ---------------------------------------------------------------- sfx

  /** Play a sound effect now. Returns the voice, or null when dropped / not live. */
  play(id: SfxId, o: PlayOpts = {}): Voice | null {
    if (id === 'anticipation_end') this.stopLoop(AUDIO_TIMING.anticipationFadeOut);
    if (!this.live || !this.g) return null;
    const g = this.g;
    const ac = g.ac;
    const rule = SFX_RULES[id];
    const now = ac.currentTime;

    if (id === 'anticipation_loop' && this.loop && this.loop.end > now) return null;

    const st = this.group(rule.group ?? id);
    const prio = rule.priority ?? 0;
    if (rule.minGapMs > 0 && now - st.lastStart < rule.minGapMs / 1000 && prio <= st.lastPriority) return null;
    for (let i = st.voices.length - 1; i >= 0; i--) if ((st.voices[i]?.end ?? 0) <= now) st.voices.splice(i, 1);
    while (st.voices.length >= rule.max) st.voices.shift()?.release(now, AUDIO_TIMING.stealFade);
    st.lastStart = now;
    st.lastPriority = prio;

    const req = clamp(o.rate ?? 1, 0.25, 4);
    let step = o.step ?? 0;
    let rate = req;
    if (rule.pitch === 'degrees') {
      step += Math.round((12 * Math.log2(req)) / 2.4);
      rate = 1;
    } else if (rule.pitch === 'octave') {
      rate = 2 ** Math.round(Math.log2(req));
    }
    rate *= 1 + (this.random() * 2 - 1) * rule.pitchJitter;
    const volume = clamp(o.volume ?? 1, 0, 2) * rule.gain * dbToGain((this.random() * 2 - 1) * VOLUME_JITTER_DB);
    const t = now + AHEAD;
    const v = new Voice(ac, rule.bus === 'ui' ? g.ui : g.sfx, g.reverbIn, g.noise, t, this.random);
    v.level.gain.value = volume;

    const bufs = this.buffers.get(id);
    const buf = bufs?.[Math.floor(this.random() * bufs.length)];
    if (buf) {
      const isLoop = id === 'anticipation_loop';
      v.buffer(v.out, buf, t, rate, isLoop, isLoop ? AUDIO_TIMING.anticipationMax : Infinity);
    } else {
      SYNTH_VOICES[id](v, { t, r: rate, step: Math.max(0, step), period: o.period ?? 0.52 });
    }
    st.voices.push(v);
    v.finish(() => {
      const i = st.voices.indexOf(v);
      if (i >= 0) st.voices.splice(i, 1);
      if (this.loop === v) {
        this.loop = null;
        this.setAnticipation(false);
      }
    });

    if (id === 'anticipation_loop') {
      this.loop = v;
      this.setAnticipation(true);
    }
    if (rule.duck) this.duck(rule.duck.db, rule.duck.holdMs / 1000);
    return v;
  }

  /** Stop the anticipation loop (if any) and reopen the music filter. */
  stopLoop(fade: number = AUDIO_TIMING.anticipationFadeOut): void {
    const ac = this.ac;
    if (!ac) return;
    if (this.loop) this.loop.release(ac.currentTime, fade);
    this.loop = null;
    this.setAnticipation(false);
  }

  private group(key: string): GroupState {
    let st = this.groups.get(key);
    if (!st) {
      st = { voices: [], lastStart: -1, lastPriority: 0 };
      this.groups.set(key, st);
    }
    return st;
  }

  /** Dev/QA snapshot. */
  debugState(): Record<string, unknown> {
    let voices = 0;
    for (const st of this.groups.values()) voices += st.voices.length;
    return {
      context: this.ac?.state ?? 'none',
      enabled: this.enabled,
      hidden: this.hidden,
      live: this.live,
      started: this.started,
      mode: this.mode,
      inBigWin: this.inBigWin,
      music: this.stems?.current ?? this.groove?.current ?? null,
      grooveRunning: this.groove?.isRunning ?? false,
      anticipating: this.anticipating,
      voices,
      buffers: this.buffers.size,
      time: this.ac?.currentTime ?? 0,
    };
  }
}
