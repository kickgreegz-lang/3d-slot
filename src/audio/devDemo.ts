import { GRID } from '../config/game';
import type { SfxId } from '../game/events';
import type { AudioEngine, PlayOpts } from './engine';
import { busNode, createGraph, rng } from './graph';
import type { MusicStem } from './manifest';
import { AUDIO_TIMING, SFX_RULES } from './mix';
import { Groove } from './music';
import { SFX_IDS, SYNTH_VOICES } from './synth';
import { Voice } from './voice';

/**
 * DEV ONLY (imported under import.meta.env.DEV): offline renders of every voice
 * and the groove through the real bus graph + limiter, as base64 float WAVs, so
 * QA scripts can measure peak / loudness / spectrum without a sound card.
 *
 *   await __audioDemo.renderToWav('explode', { seconds: 2 })
 *   await __audioDemo.renderMusic('freegame', 20, 1)
 *   await __audioDemo.renderMix()            // worst-case stack: music + lands + wins + big win
 *   __audioDemo.state()                      // live engine snapshot
 *   __audioDemo.peakDb()                     // live output peak over the last ~20 ms
 */
export interface RenderOpts extends PlayOpts {
  seconds?: number;
  /** anticipation_loop: when to release it */
  stopAt?: number;
  sampleRate?: number;
}

export interface AudioDemo {
  ids: SfxId[];
  renderToWav(id: SfxId, opts?: RenderOpts): Promise<string>;
  renderMusic(stem: MusicStem, seconds?: number, energy?: number): Promise<string>;
  renderMix(): Promise<string>;
  state(): Record<string, unknown>;
  peakDb(): number;
}

declare global {
  interface Window {
    __audioDemo?: AudioDemo;
  }
}

const SR = 48000;

const toBase64 = (bytes: Uint8Array): string => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
};

/** 32-bit float WAV (keeps overs visible to the analysis). */
const encodeWav = (buf: AudioBuffer): string => {
  const ch = buf.numberOfChannels;
  const n = buf.length;
  const bytes = new Uint8Array(44 + n * ch * 4);
  const dv = new DataView(bytes.buffer);
  const str = (o: number, t: string): void => {
    for (let i = 0; i < t.length; i++) dv.setUint8(o + i, t.charCodeAt(i));
  };
  str(0, 'RIFF');
  dv.setUint32(4, 36 + n * ch * 4, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 3, true);
  dv.setUint16(22, ch, true);
  dv.setUint32(24, buf.sampleRate, true);
  dv.setUint32(28, buf.sampleRate * ch * 4, true);
  dv.setUint16(32, ch * 4, true);
  dv.setUint16(34, 32, true);
  str(36, 'data');
  dv.setUint32(40, n * ch * 4, true);
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      dv.setFloat32(o, data[c]?.[i] ?? 0, true);
      o += 4;
    }
  }
  return toBase64(bytes);
};

const spawn = (g: ReturnType<typeof createGraph>, id: SfxId, t: number, o: PlayOpts, seed: number): Voice => {
  const rule = SFX_RULES[id];
  const v = new Voice(g.ac, busNode(g, rule.bus), g.reverbIn, g.noise, t, rng(seed));
  v.level.gain.value = rule.gain * (o.volume ?? 1);
  SYNTH_VOICES[id](v, { t, r: o.rate ?? 1, step: o.step ?? 0, period: o.period ?? 0.52, span: o.span ?? AUDIO_TIMING.chargeSpan });
  return v;
};

export const installAudioDemo = (engine: AudioEngine): void => {
  let analyser: AnalyserNode | null = null;
  let scratch: Float32Array<ArrayBuffer> | null = null;

  const demo: AudioDemo = {
    ids: SFX_IDS,

    async renderToWav(id, opts = {}) {
      const sr = opts.sampleRate ?? SR;
      const seconds = opts.seconds ?? 4;
      const off = new OfflineAudioContext(2, Math.ceil(seconds * sr), sr);
      const g = createGraph(off);
      const v = spawn(g, id, 0.02, opts, 7);
      if (id === 'anticipation_loop') v.release(opts.stopAt ?? 3.2, AUDIO_TIMING.anticipationFadeOut);
      return encodeWav(await off.startRendering());
    },

    async renderMusic(stem, seconds = 20, energy = 0) {
      const off = new OfflineAudioContext(2, Math.ceil(seconds * SR), SR);
      const g = createGraph(off);
      const groove = new Groove(g, stem, rng(3));
      groove.energy = energy;
      groove.start(0.05, 0.01);
      groove.schedule(seconds);
      return encodeWav(await off.startRendering());
    },

    async renderMix() {
      const seconds = 12;
      const off = new OfflineAudioContext(2, seconds * SR, SR);
      const g = createGraph(off);
      const groove = new Groove(g, 'base', rng(3));
      groove.start(0.05, 0.01);
      groove.schedule(seconds);
      // a dense round with NO voice limiting (worst case for the limiter)
      let seed = 11;
      const at = (t: number, id: SfxId, o: PlayOpts = {}): void => {
        spawn(g, id, t, o, seed++);
      };
      at(0.5, 'spin_start');
      at(0.55, 'fall_out');
      for (let reel = 0; reel < GRID.reels; reel++) {
        for (let row = 0; row < GRID.rows; row++) {
          const w = (['land_light', 'land_medium', 'land_heavy'] as const)[(reel + row) % 3] ?? 'land_light';
          at(0.9 + reel * 0.06 + row * 0.025, w);
        }
      }
      at(1.3, 'scatter_land_1');
      at(1.6, 'scatter_land_2');
      at(2.2, 'win_cluster');
      at(2.6, 'explode');
      at(2.62, 'explode');
      at(2.64, 'explode');
      at(2.9, 'tumble_drop');
      at(3.0, 'spot_upgrade', { step: 5 });
      at(3.4, 'win_cluster', { step: 3 });
      at(4, 'bigwin_start');
      at(5.2, 'bigwin_tier', { step: 2 });
      at(6.4, 'bigwin_tier', { step: 3 });
      for (let i = 0; i < 40; i++) at(4 + i * 0.05, 'counter_tick');
      at(8, 'bigwin_end');
      at(9.5, 'fs_trigger');
      return encodeWav(await off.startRendering());
    },

    state: () => engine.debugState(),

    peakDb() {
      const g = engine.graph;
      if (!g) return -Infinity;
      if (!analyser) {
        analyser = g.ac.createAnalyser();
        analyser.fftSize = 1024;
        g.limiter.connect(analyser);
        scratch = new Float32Array(analyser.fftSize);
      }
      if (!scratch) return -Infinity;
      analyser.getFloatTimeDomainData(scratch);
      let peak = 0;
      for (const x of scratch) peak = Math.max(peak, Math.abs(x));
      return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
    },
  };
  window.__audioDemo = demo;
};
