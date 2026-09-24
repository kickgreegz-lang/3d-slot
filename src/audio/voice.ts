/**
 * Voice: one playing sound. It owns its source nodes, exposes ONE output gain
 * (the engine fades it for voice stealing / loop stops) and tracks its end time.
 * Every source it creates is scheduled to stop, so nothing leaks.
 *
 * Envelope helpers never ramp to exactly 0 with exponential curves (illegal);
 * they decay to FLOOR (-80 dB) and sources stop just after, so no clicks.
 */

/** -80 dB: the exponential-decay floor. */
export const FLOOR = 1e-4;

export const mtof = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

/** E minor pentatonic (E G A B D) — the key every musical sound and the groove share. */
const PENTA = [0, 3, 5, 7, 10];
/** MIDI note of scale `degree` counted from `rootMidi` (an E), degree may exceed 4 (next octave). */
export const penta = (rootMidi: number, degree: number): number => {
  const d = Math.max(0, Math.floor(degree));
  return rootMidi + 12 * Math.floor(d / 5) + (PENTA[d % 5] ?? 0);
};

/** Anything a node can feed: another node or an AudioParam (FM, tremolo). */
export type Dest = AudioNode | AudioParam;

const link = (src: AudioNode, dest: Dest): void => {
  if (dest instanceof AudioParam) src.connect(dest);
  else src.connect(dest);
};

export class Voice {
  /** where voice functions write (they may automate it: fades, auto-stop) */
  readonly out: GainNode;
  /** engine-owned level: play volume, steal/stop fades */
  readonly level: GainNode;
  /** latest scheduled stop time (s, context clock) */
  end: number;
  private readonly sources: AudioScheduledSourceNode[] = [];
  /** scheduled stop time per source (parallel to `sources`) */
  private readonly stops: number[] = [];
  private send: GainNode | null = null;
  private readonly nyquist: number;

  constructor(
    readonly ac: BaseAudioContext,
    dest: AudioNode,
    private readonly reverbIn: AudioNode | null,
    private readonly noiseBuf: AudioBuffer,
    readonly t: number,
    private readonly random: () => number = Math.random,
  ) {
    this.level = ac.createGain();
    this.level.connect(dest);
    this.out = ac.createGain();
    this.out.connect(this.level);
    this.end = t;
    this.nyquist = ac.sampleRate * 0.45;
  }

  gain(dest: Dest, value = 1): GainNode {
    const g = this.ac.createGain();
    g.gain.value = value;
    link(g, dest);
    return g;
  }

  filter(dest: AudioNode, type: BiquadFilterType, freq: number, q = 0.707): BiquadFilterNode {
    const f = this.ac.createBiquadFilter();
    f.type = type;
    f.frequency.value = this.hz(freq);
    f.Q.value = q;
    f.connect(dest);
    return f;
  }

  pan(dest: AudioNode, value: number): AudioNode {
    const p = this.ac.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, value));
    p.connect(dest);
    return p;
  }

  osc(dest: Dest, type: OscillatorType, freq: number, t0: number, t1: number, detune = 0): OscillatorNode {
    const o = this.ac.createOscillator();
    o.type = type;
    o.frequency.value = this.hz(freq);
    o.detune.value = detune;
    link(o, dest);
    this.track(o, t0, t1);
    return o;
  }

  /** Looping white noise from a random offset of the shared buffer. */
  noise(dest: AudioNode, t0: number, t1: number, playbackRate = 1): AudioBufferSourceNode {
    const s = this.ac.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    s.playbackRate.value = playbackRate;
    s.connect(dest);
    this.track(s, t0, t1, this.random() * (this.noiseBuf.duration - 0.1));
    return s;
  }

  /** A pre-recorded buffer (production SFX from the manifest). */
  buffer(dest: AudioNode, buf: AudioBuffer, t0: number, rate = 1, loop = false, maxDur = Infinity): AudioBufferSourceNode {
    const s = this.ac.createBufferSource();
    s.buffer = buf;
    s.loop = loop;
    s.playbackRate.value = rate;
    s.connect(dest);
    const dur = loop ? maxDur : buf.duration / rate;
    this.track(s, t0, t0 + Math.min(dur, maxDur));
    return s;
  }

  /** Route this voice's output to the shared room at `amount` (0..1). */
  reverb(amount: number): void {
    if (!this.reverbIn || amount <= 0) return;
    if (!this.send) {
      this.send = this.ac.createGain();
      this.level.connect(this.send);
      this.send.connect(this.reverbIn);
    }
    this.send.gain.value = amount;
  }

  /** Clamp to a legal filter/oscillator frequency. */
  hz(f: number): number {
    return Math.max(10, Math.min(this.nyquist, f));
  }

  /** Fade out from `t` over `fade` and stop every source (stealing, loop stop). */
  release(t: number, fade: number): void {
    const g = this.level.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + fade);
    const stopAt = t + fade + 0.005;
    this.sources.forEach((s, i) => {
      if ((this.stops[i] ?? 0) <= stopAt) return;
      s.stop(stopAt);
      this.stops[i] = stopAt;
    });
    this.end = Math.min(this.end, stopAt);
  }

  /** Call `fn` once the last source has stopped (disconnect + bookkeeping). */
  finish(fn: () => void): void {
    let last: AudioScheduledSourceNode | null = null;
    let lastT = -1;
    this.sources.forEach((s, i) => {
      const st = this.stops[i] ?? 0;
      if (st >= lastT) {
        lastT = st;
        last = s;
      }
    });
    const done = (): void => {
      this.level.disconnect();
      this.send?.disconnect();
      fn();
    };
    const src = last as AudioScheduledSourceNode | null;
    if (src) src.onended = done;
    else done();
  }

  private track(s: AudioScheduledSourceNode, t0: number, t1: number, offset?: number): void {
    const start = Math.max(t0, 0);
    if (offset !== undefined && s instanceof AudioBufferSourceNode) s.start(start, offset);
    else s.start(start);
    const stop = Math.max(t1, start + 0.005) + 0.01;
    s.stop(stop);
    this.sources.push(s);
    this.stops.push(stop);
    if (stop > this.end) this.end = stop;
  }
}

// ---------------------------------------------------------------- envelopes

/** 0 -> peak (linear attack) -> exponential decay to the floor. Returns the end time. */
export const perc = (p: AudioParam, t: number, peak: number, attack: number, decay: number): number => {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + attack);
  p.exponentialRampToValueAtTime(FLOOR, t + attack + decay);
  return t + attack + decay;
};

/** Attack, hold (with optional sag to `sustain` x peak), exponential release. Returns the end time. */
export const ahr = (
  p: AudioParam,
  t: number,
  peak: number,
  attack: number,
  hold: number,
  release: number,
  sustain = 1,
): number => {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + attack);
  p.exponentialRampToValueAtTime(Math.max(FLOOR, peak * sustain), t + attack + hold);
  p.exponentialRampToValueAtTime(FLOOR, t + attack + hold + release);
  return t + attack + hold + release;
};

/** Exponential glide (pitch drops, filter sweeps). Both values must be > 0. */
export const glide = (p: AudioParam, t: number, from: number, to: number, dur: number): void => {
  p.setValueAtTime(from, t);
  p.exponentialRampToValueAtTime(to, t + dur);
};

/** Exponential swell from near-silence to `peak`, then a fast cut (reverse-cymbal "suck"). */
export const swellEnv = (p: AudioParam, t: number, peak: number, dur: number, cut = 0.012): number => {
  p.setValueAtTime(FLOOR, t);
  p.exponentialRampToValueAtTime(peak, t + dur);
  p.linearRampToValueAtTime(0, t + dur + cut);
  return t + dur + cut;
};
