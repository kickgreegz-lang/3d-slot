import { BUS_LEVELS } from './mix';

/**
 * The bus graph, built identically on a live AudioContext and on an
 * OfflineAudioContext (dev renders), so what we measure is what ships:
 *
 *   voices ─> sfx ─┐
 *   voices ─> ui ──┼──> master (mute/hide fade) ─> DC block ─> limiter ─> ceiling ─> destination
 *   groove/stems ─> musicIn ─> musicFilter (LP) ─> musicDuck ─> music ─┘
 *   voice/instrument sends ─> reverbIn ─> HP ─> convolver ─> reverb ─┘
 *
 * The limiter is a DynamicsCompressorNode (6 ms look-ahead; its automatic makeup
 * gain is ~+3.4 dB for these settings). Its attack lets fast transients overshoot,
 * so a WaveShaper soft-clip ceiling follows: transparent below -4 dBFS, saturating
 * smoothly into a hard ceiling of -1.6 dBFS (sample peak), keeping true peaks < -1 dBTP.
 */
export interface AudioGraph {
  ac: BaseAudioContext;
  master: GainNode;
  limiter: DynamicsCompressorNode;
  sfx: GainNode;
  ui: GainNode;
  musicIn: GainNode;
  musicFilter: BiquadFilterNode;
  musicDuck: GainNode;
  music: GainNode;
  reverbIn: GainNode;
  reverb: GainNode;
  /** shared 2 s white-noise buffer for every noise source */
  noise: AudioBuffer;
}

/** Linear below `knee`, tanh shoulder above, flat at the curve end (inputs beyond ±1 clamp). */
const ceilingCurve = (knee: number, ceiling: number): Float32Array<ArrayBuffer> => {
  const n = 4097;
  const c = new Float32Array(n);
  const room = ceiling - knee;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    c[i] = a <= knee ? x : Math.sign(x) * (knee + room * Math.tanh((a - knee) / room));
  }
  return c;
};

export const dbToGain = (db: number): number => 10 ** (db / 20);

/** Deterministic PRNG (mulberry32) so buffers and offline renders are reproducible. */
export const rng = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const makeNoise = (ac: BaseAudioContext): AudioBuffer => {
  const len = Math.floor(ac.sampleRate * 2);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  const r = rng(0x5eed);
  for (let i = 0; i < len; i++) d[i] = r() * 2 - 1;
  return buf;
};

/**
 * Procedural stereo room impulse: pre-delay, exponentially decaying noise with
 * frequency-dependent damping (the tail darkens), short fades at both ends.
 */
const makeImpulse = (ac: BaseAudioContext, seconds: number, rt60: number): AudioBuffer => {
  const sr = ac.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ac.createBuffer(2, len, sr);
  const preDelay = Math.floor(sr * 0.014);
  const fadeIn = Math.floor(sr * 0.004);
  const fadeOut = Math.floor(sr * 0.08);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const r = rng(0x1234 + ch * 7919);
    let lp = 0;
    for (let i = preDelay; i < len; i++) {
      const t = (i - preDelay) / sr;
      const env = Math.exp((-6.91 * t) / rt60);
      // one-pole low-pass whose cutoff falls over time (air absorption)
      const k = 0.85 - 0.7 * Math.min(1, t / rt60);
      lp += (r() * 2 - 1 - lp) * k;
      let g = env;
      if (i - preDelay < fadeIn) g *= (i - preDelay) / fadeIn;
      if (i > len - fadeOut) g *= (len - i) / fadeOut;
      d[i] = lp * g;
    }
  }
  return buf;
};

export interface GraphOptions {
  /** shorter room on low-tier devices */
  lowTier?: boolean;
}

export const createGraph = (ac: BaseAudioContext, opts: GraphOptions = {}): AudioGraph => {
  const gain = (v: number): GainNode => {
    const g = ac.createGain();
    g.gain.value = v;
    return g;
  };

  const ceiling = ac.createWaveShaper();
  ceiling.curve = ceilingCurve(0.63, 0.84);
  ceiling.oversample = 'none';
  ceiling.connect(ac.destination);

  const limiter = ac.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 3;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.12;
  limiter.connect(ceiling);

  // DC / subsonic blocker (pitch-drop kicks are asymmetric) — also frees limiter headroom
  const dcBlock = ac.createBiquadFilter();
  dcBlock.type = 'highpass';
  dcBlock.frequency.value = 24;
  dcBlock.Q.value = 0.7;
  dcBlock.connect(limiter);

  const master = gain(1);
  master.connect(dcBlock);

  const sfx = gain(BUS_LEVELS.sfx);
  const ui = gain(BUS_LEVELS.ui);
  sfx.connect(master);
  ui.connect(master);

  const music = gain(BUS_LEVELS.music);
  const musicDuck = gain(1);
  const musicFilter = ac.createBiquadFilter();
  musicFilter.type = 'lowpass';
  musicFilter.frequency.value = Math.min(20000, ac.sampleRate * 0.45);
  musicFilter.Q.value = 0.9;
  const musicIn = gain(1);
  musicIn.connect(musicFilter);
  musicFilter.connect(musicDuck);
  musicDuck.connect(music);
  music.connect(master);

  const reverbIn = gain(1);
  const reverbHp = ac.createBiquadFilter();
  reverbHp.type = 'highpass';
  reverbHp.frequency.value = 220;
  const convolver = ac.createConvolver();
  convolver.buffer = opts.lowTier ? makeImpulse(ac, 1.0, 0.8) : makeImpulse(ac, 1.7, 1.25);
  const reverb = gain(BUS_LEVELS.reverb);
  reverbIn.connect(reverbHp);
  reverbHp.connect(convolver);
  convolver.connect(reverb);
  reverb.connect(master);

  return {
    ac, master, limiter, sfx, ui, musicIn, musicFilter, musicDuck, music, reverbIn, reverb,
    noise: makeNoise(ac),
  };
};

/** Glide an AudioParam from its current value to `target` over `dur` (s), cancelling pending automation. */
export const rampTo = (p: AudioParam, target: number, now: number, dur: number): void => {
  p.cancelScheduledValues(now);
  p.setValueAtTime(p.value, now);
  p.linearRampToValueAtTime(target, now + Math.max(0.001, dur));
};

/** Exponential variant for frequencies (both ends must be > 0). */
export const rampFreqTo = (p: AudioParam, target: number, now: number, dur: number): void => {
  p.cancelScheduledValues(now);
  p.setValueAtTime(Math.max(1, p.value), now);
  p.exponentialRampToValueAtTime(Math.max(1, target), now + Math.max(0.001, dur));
};

/**
 * Audio-clock timer: calls `fn` once the context has played `delay` seconds.
 * Used instead of setTimeout for audio housekeeping (fade-then-suspend, stem pause).
 */
export const audioTimer = (ac: BaseAudioContext, dest: AudioNode, delay: number, fn: () => void): void => {
  const src = ac.createConstantSource();
  const mute = ac.createGain();
  mute.gain.value = 0;
  src.connect(mute);
  mute.connect(dest);
  src.onended = () => {
    src.disconnect();
    mute.disconnect();
    fn();
  };
  const t = ac.currentTime;
  src.start(t);
  src.stop(t + Math.max(0.001, delay));
};
