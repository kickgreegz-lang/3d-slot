import { FLOOR, type Voice, ahr, glide, perc, swellEnv } from './voice';

/**
 * Synth instrument primitives shared by the SFX voices (synth.ts) and the
 * procedural groove (music.ts). Each schedules nodes on a Voice at time `t`
 * into `dest`. Levels are linear peaks before the voice/bus gain.
 */

export interface KickOpts {
  f0: number;
  f1: number;
  /** pitch-drop time (s) */
  drop: number;
  /** amplitude decay (s) */
  decay: number;
  level: number;
  /** click transient level (0..1 of level) */
  click?: number;
  clickFreq?: number;
}

/** Sine pitch-drop kick with a filtered-noise click: the body of every thud. */
export const kick = (v: Voice, dest: AudioNode, t: number, o: KickOpts): void => {
  const amp = v.gain(dest, 0);
  perc(amp.gain, t, o.level, 0.0015, o.decay);
  const osc = v.osc(amp, 'sine', o.f0, t, t + o.decay + 0.01);
  glide(osc.frequency, t, v.hz(o.f0), v.hz(o.f1), o.drop);
  if (o.click && o.click > 0) {
    const cAmp = v.gain(dest, 0);
    perc(cAmp.gain, t, o.level * o.click, 0.0005, 0.012);
    const f = v.filter(cAmp, 'bandpass', o.clickFreq ?? 2500, 0.9);
    v.noise(f, t, t + 0.02);
  }
};

/** Snare: pitched triangle body + high-passed noise rattle. */
export const snare = (v: Voice, dest: AudioNode, t: number, level: number, decay = 0.17, tone = 185): void => {
  const bAmp = v.gain(dest, 0);
  perc(bAmp.gain, t, level * 0.55, 0.001, 0.075);
  const body = v.osc(bAmp, 'triangle', tone * 1.35, t, t + 0.09);
  glide(body.frequency, t, v.hz(tone * 1.35), v.hz(tone), 0.03);
  const nAmp = v.gain(dest, 0);
  perc(nAmp.gain, t, level * 0.75, 0.001, decay);
  const bp = v.filter(nAmp, 'peaking', 4200, 1.1);
  bp.gain.value = 5;
  const hp = v.filter(bp, 'highpass', 1100, 0.7);
  v.noise(hp, t, t + decay + 0.01);
};

/** Hi-hat from band-limited noise (open = long decay). */
export const hat = (v: Voice, dest: AudioNode, t: number, level: number, open = false): void => {
  const decay = open ? 0.26 : 0.038;
  const amp = v.gain(dest, 0);
  perc(amp.gain, t, level, 0.0008, decay);
  const bp = v.filter(amp, 'bandpass', 10500, 0.9);
  const hp = v.filter(bp, 'highpass', 7200, 0.8);
  v.noise(hp, t, t + decay + 0.01);
};

/** Shaker: softer attack, mid-high band. */
export const shaker = (v: Voice, dest: AudioNode, t: number, level: number): void => {
  const amp = v.gain(dest, 0);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(level, t + 0.012);
  amp.gain.exponentialRampToValueAtTime(FLOOR, t + 0.07);
  const bp = v.filter(amp, 'bandpass', 6500, 1.4);
  v.noise(bp, t, t + 0.08);
};

/** Crash cymbal: two noise bands + a quiet ring of inharmonic squares (808 metal). */
export const crash = (v: Voice, dest: AudioNode, t: number, level: number, decay = 1.9): void => {
  const a = v.gain(dest, 0);
  perc(a.gain, t, level * 0.8, 0.002, decay);
  v.noise(v.filter(v.filter(a, 'lowpass', 11000, 0.5), 'highpass', 3400, 0.6), t, t + decay + 0.01);
  const b = v.gain(dest, 0);
  perc(b.gain, t, level * 0.5, 0.001, decay * 0.45);
  v.noise(v.filter(b, 'bandpass', 8800, 1.2), t, t + decay * 0.45 + 0.01);
  const ring = v.gain(dest, 0);
  perc(ring.gain, t, level * 0.09, 0.001, decay * 0.6);
  const rf = v.filter(v.filter(ring, 'highpass', 5500, 0.7), 'bandpass', 8200, 1.5);
  for (const f of [296, 445, 587, 807, 1043, 1352]) v.osc(rf, 'square', f, t, t + decay * 0.6 + 0.01);
};

/** Reverse-cymbal swell: rising noise with an opening low-pass, cut at the end. */
export const swell = (v: Voice, dest: AudioNode, t: number, dur: number, level: number): void => {
  const amp = v.gain(dest, 0);
  const end = swellEnv(amp.gain, t, level, dur);
  const lp = v.filter(amp, 'lowpass', 1200, 0.9);
  glide(lp.frequency, t, 1200, v.hz(13000), dur);
  const hp = v.filter(lp, 'highpass', 2200, 0.7);
  v.noise(hp, t, end);
};

/** Sub boom: a long sine drop for impacts (kept above ~35 Hz). */
export const subBoom = (v: Voice, dest: AudioNode, t: number, level: number, f0 = 95, f1 = 38, decay = 1): void => {
  kick(v, dest, t, { f0, f1, drop: decay * 0.45, decay, level });
};

export interface BellOpts {
  level: number;
  /** modulator : carrier ratio (3.5 = bell, 4 = marimba, 1 = warm) */
  ratio?: number;
  /** modulation index at the strike */
  index?: number;
  /** time for the index to fall to 10% (brightness decay) */
  indexDecay?: number;
  decay?: number;
  attack?: number;
}

/** 2-operator FM strike (bells, marimba, chimes). */
export const fm = (v: Voice, dest: AudioNode, t: number, freq: number, o: BellOpts): void => {
  const ratio = o.ratio ?? 3.5;
  const index = o.index ?? 3;
  const decay = o.decay ?? 1.2;
  const attack = o.attack ?? 0.0015;
  const amp = v.gain(dest, 0);
  const end = perc(amp.gain, t, o.level, attack, decay);
  const car = v.osc(amp, 'sine', freq, t, end);
  const mf = v.hz(freq * ratio);
  const modAmp = v.gain(car.frequency, 0);
  modAmp.gain.setValueAtTime(index * mf, t);
  modAmp.gain.exponentialRampToValueAtTime(Math.max(0.5, index * mf * 0.1), t + (o.indexDecay ?? 0.3));
  v.osc(modAmp, 'sine', mf, t, end);
};

/** Marimba: FM wood strike + clean fundamental body. */
export const marimba = (v: Voice, dest: AudioNode, t: number, freq: number, level: number, decay = 0.55): void => {
  fm(v, dest, t, freq, { level: level * 0.55, ratio: 4, index: 2.2, indexDecay: 0.05, decay: decay * 0.6 });
  const amp = v.gain(dest, 0);
  perc(amp.gain, t, level * 0.6, 0.002, decay);
  v.osc(amp, 'sine', freq, t, t + decay + 0.01);
};

/** Glassy ping: slightly scooped sine + inharmonic glass partials. */
export const glass = (v: Voice, dest: AudioNode, t: number, freq: number, level: number, decay = 0.9): void => {
  const partials: [number, number, number][] = [
    [1, 1, decay],
    [2.76, 0.32, decay * 0.4],
    [5.4, 0.12, decay * 0.16],
  ];
  for (const [ratio, amt, d] of partials) {
    const amp = v.gain(dest, 0);
    perc(amp.gain, t, level * amt, 0.002, d);
    const o = v.osc(amp, 'sine', freq * ratio, t, t + d + 0.01);
    glide(o.frequency, t, v.hz(freq * ratio * 0.985), v.hz(freq * ratio), 0.014);
  }
};

/** Bright synth pluck: detuned saw+square through an enveloped resonant low-pass. */
export const pluck = (v: Voice, dest: AudioNode, t: number, freq: number, level: number, decay = 0.38, bright = 1): void => {
  const amp = v.gain(dest, 0);
  const end = perc(amp.gain, t, level, 0.002, decay);
  const lp = v.filter(amp, 'lowpass', 5000, 2.4);
  glide(lp.frequency, t, v.hz(900 + 5200 * bright), v.hz(Math.max(400, freq * 1.5)), decay * 0.55);
  v.osc(lp, 'sawtooth', freq, t, end, -7);
  v.osc(v.gain(lp, 0.6), 'square', freq, t, end, 7);
  const shine = v.gain(dest, 0);
  perc(shine.gain, t, level * 0.22, 0.001, decay * 0.6);
  v.osc(shine, 'sine', freq * 2, t, end);
};

export interface BrassOpts {
  /** held length before release (s) */
  len: number;
  level: number;
  /** 0..1.5 filter brightness */
  bright?: number;
  /** end-of-note pitch fall (funk "fall-off") in semitones */
  fall?: number;
}

/**
 * Brass-section stab: 3 detuned saws per note with a scooped attack, through a
 * shared low-pass with a "blat" filter envelope.
 */
export const brass = (v: Voice, dest: AudioNode, t: number, freqs: number[], o: BrassOpts): void => {
  const bright = o.bright ?? 1;
  const release = 0.16;
  const amp = v.gain(dest, 0);
  const end = ahr(amp.gain, t, o.level, 0.014, o.len, release, 0.72);
  const lp = v.filter(amp, 'lowpass', 300, 1.3);
  const f = lp.frequency;
  f.setValueAtTime(260, t);
  f.exponentialRampToValueAtTime(v.hz(1400 + 2600 * bright), t + 0.04);
  f.setTargetAtTime(v.hz(900 + 900 * bright), t + 0.05, 0.12);
  f.setTargetAtTime(300, t + o.len, 0.08);
  const mix = v.gain(lp, 1 / Math.sqrt(freqs.length * 3));
  for (const hz of freqs) {
    for (const det of [-11, 0, 11]) {
      const osc = v.osc(mix, 'sawtooth', hz, t, end, det);
      osc.frequency.setValueAtTime(v.hz(hz * 0.965), t);
      osc.frequency.exponentialRampToValueAtTime(v.hz(hz), t + 0.045);
      if (o.fall) {
        osc.frequency.setValueAtTime(v.hz(hz), t + o.len);
        osc.frequency.exponentialRampToValueAtTime(v.hz(hz * 2 ** (-o.fall / 12)), end);
      }
    }
  }
};

/** Soft saw pad with slow attack (feature intros/outros). */
export const pad = (
  v: Voice,
  dest: AudioNode,
  t: number,
  freqs: number[],
  level: number,
  attack: number,
  hold: number,
  release: number,
  cutoff = 1800,
): void => {
  const amp = v.gain(dest, 0);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(level, t + attack);
  amp.gain.setValueAtTime(level, t + attack + hold);
  amp.gain.exponentialRampToValueAtTime(FLOOR, t + attack + hold + release);
  const end = t + attack + hold + release;
  const lp = v.filter(amp, 'lowpass', cutoff * 0.5, 0.8);
  lp.frequency.setValueAtTime(v.hz(cutoff * 0.5), t);
  lp.frequency.linearRampToValueAtTime(v.hz(cutoff), t + attack + hold * 0.5);
  const mix = v.gain(lp, 1 / Math.sqrt(freqs.length * 2));
  freqs.forEach((hz, i) => {
    const p = v.pan(mix, i % 2 ? 0.35 : -0.35);
    v.osc(p, 'sawtooth', hz, t, end, -8);
    v.osc(p, 'sawtooth', hz, t, end, 8);
  });
};

/**
 * Rhodes-style electric piano (two FM stacks: warm 1:1 body + 14:1 tine attack),
 * with a sagging sustain. `len` is the held length before the release.
 */
export const rhodes = (v: Voice, dest: AudioNode, t: number, freq: number, level: number, len: number): void => {
  const release = 0.22;
  const amp = v.gain(dest, 0);
  const end = ahr(amp.gain, t, level, 0.004, Math.max(0.05, len), release, 0.4);
  // body
  const c1 = v.osc(amp, 'sine', freq, t, end);
  const m1 = v.gain(c1.frequency, 0);
  m1.gain.setValueAtTime(freq * 1.9, t);
  m1.gain.exponentialRampToValueAtTime(freq * 0.55, t + 0.9);
  v.osc(m1, 'sine', freq, t, end);
  // tine
  const tAmp = v.gain(amp, 0.4);
  const c2 = v.osc(tAmp, 'sine', freq, t, end, 4);
  const m2 = v.gain(c2.frequency, 0);
  const tf = v.hz(freq * 14);
  m2.gain.setValueAtTime(tf * 0.9, t);
  m2.gain.exponentialRampToValueAtTime(1, t + 0.06);
  v.osc(m2, 'sine', tf, t, t + 0.08);
};

/** Funk synth bass: saw + sine sub through a resonant, plucked low-pass. */
export const bass = (v: Voice, dest: AudioNode, t: number, freq: number, level: number, len: number, accent = 1): void => {
  const release = 0.05;
  const amp = v.gain(dest, 0);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(level, t + 0.004);
  amp.gain.linearRampToValueAtTime(level * 0.85, t + len);
  amp.gain.exponentialRampToValueAtTime(FLOOR, t + len + release);
  const end = t + len + release;
  const lp = v.filter(amp, 'lowpass', 400, 6);
  glide(lp.frequency, t, v.hz(500 + 1700 * accent), v.hz(Math.max(220, freq * 3)), 0.13);
  v.osc(lp, 'sawtooth', freq, t, end);
  v.osc(v.gain(amp, 0.4), 'sine', freq, t, end);
};

/** Clavinet-ish chank: short square chord through an auto-wah band-pass. */
export const clav = (v: Voice, dest: AudioNode, t: number, freqs: number[], level: number): void => {
  const amp = v.gain(dest, 0);
  const end = perc(amp.gain, t, level, 0.002, 0.11);
  const bp = v.filter(amp, 'bandpass', 1800, 3.2);
  glide(bp.frequency, t, 2600, 800, 0.1);
  const mix = v.gain(bp, 1 / freqs.length);
  for (const hz of freqs) v.osc(mix, 'square', hz, t, end);
};
