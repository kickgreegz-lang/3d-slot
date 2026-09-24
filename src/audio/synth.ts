import type { SfxId } from '../game/events';
import { AUDIO_TIMING } from './mix';
import {
  brass, crash, fm, glass, kick, marimba, pad, pluck, subBoom, swell,
} from './instruments';
import { FLOOR, type Voice, glide, mtof, penta, perc } from './voice';

/**
 * PLACEHOLDER SFX — procedural Web Audio voices for every SfxId until the
 * production files land in manifest.ts. Everything tonal is in E minor
 * pentatonic (the groove's key) so SFX sit inside the music.
 *
 * A voice schedules its nodes on `v` starting at `a.t`, into `v.out`.
 */
export interface VoiceArgs {
  /** start time (context clock, s) */
  t: number;
  /** pitch multiplier (payload rate x jitter) */
  r: number;
  /** escalation index: cascade step, spot tier, big-win tier step or win level */
  step: number;
  /** anticipation heartbeat period (s, speed-profile scaled) */
  period: number;
}

export type VoiceFn = (v: Voice, a: VoiceArgs) => void;

const E4 = 64;
const E5 = 76;
/** Em9 and friends, voiced for brass / pads (MIDI). */
const EM9 = [52, 59, 62, 66, 67];
const hzs = (midis: number[], shift = 0): number[] => midis.map((m) => mtof(m + shift));

// ------------------------------------------------------------------ lands

interface Thud {
  f0: number;
  f1: number;
  drop: number;
  decay: number;
  body: number;
  click: number;
  clickFreq: number;
  /** woody knock: fundamental (Hz) and level */
  knock: number;
  knockLevel: number;
  /** band-passed noise "box" resonance (Hz) and level — the thock phones can reproduce */
  box: number;
  boxLevel: number;
  /** low-passed noise "weight" layer level */
  weight: number;
}

/**
 * Symbol landing. Heavier = lower and longer. Layers: pitch-drop body, an octave
 * "punch" (2nd harmonic, so the weight survives phone speakers), a box resonance,
 * a short modal knock (the tile) and the click transient.
 */
const thud = (v: Voice, a: VoiceArgs, w: Thud): void => {
  const { t, r } = a;
  kick(v, v.out, t, {
    f0: w.f0 * r, f1: w.f1 * r, drop: w.drop, decay: w.decay, level: w.body, click: w.click, clickFreq: w.clickFreq * r,
  });
  const punch = v.gain(v.out, 0);
  perc(punch.gain, t, w.body * 0.42, 0.001, w.decay * 0.45);
  const po = v.osc(punch, 'sine', w.f0 * 2 * r, t, t + w.decay * 0.45 + 0.01);
  glide(po.frequency, t, w.f0 * 2 * r, w.f1 * 2 * r, w.drop);
  const box = v.gain(v.out, 0);
  perc(box.gain, t, w.boxLevel, 0.001, w.decay * 0.35);
  v.noise(v.filter(box, 'bandpass', w.box * r, 1.8), t, t + w.decay * 0.35 + 0.01);
  // modal knock (wood/lacquer tile): three decaying partials
  const modes: [number, number, number][] = [
    [1, 1, 0.07],
    [2.32, 0.4, 0.04],
    [4.1, 0.16, 0.022],
  ];
  for (const [ratio, amt, d] of modes) {
    const amp = v.gain(v.out, 0);
    perc(amp.gain, t, w.knockLevel * amt, 0.0008, d);
    v.osc(amp, 'sine', w.knock * r * ratio, t, t + d + 0.01);
  }
  if (w.weight > 0) {
    const amp = v.gain(v.out, 0);
    perc(amp.gain, t, w.weight, 0.002, w.decay * 0.5);
    v.noise(v.filter(amp, 'lowpass', 320, 0.8), t, t + w.decay * 0.5 + 0.01);
  }
};

const LAND_LIGHT: Thud = {
  f0: 300, f1: 150, drop: 0.035, decay: 0.1, body: 0.4, click: 0.35, clickFreq: 3200,
  knock: 980, knockLevel: 0.34, box: 900, boxLevel: 0.25, weight: 0,
};
const LAND_MEDIUM: Thud = {
  f0: 220, f1: 98, drop: 0.05, decay: 0.17, body: 0.5, click: 0.32, clickFreq: 2200,
  knock: 720, knockLevel: 0.4, box: 420, boxLevel: 0.6, weight: 0.08,
};
const LAND_HEAVY: Thud = {
  f0: 170, f1: 62, drop: 0.075, decay: 0.27, body: 0.62, click: 0.3, clickFreq: 1500,
  knock: 480, knockLevel: 0.42, box: 260, boxLevel: 0.7, weight: 0.2,
};

const landSpecial: VoiceFn = (v, a) => {
  thud(v, a, { ...LAND_HEAVY, body: 0.7, decay: 0.3 });
  // shimmer: detuned E6 / B6 / E7 sines, soft attack
  const amp = v.gain(v.out, 0);
  perc(amp.gain, a.t + 0.01, 0.16, 0.012, 0.75);
  [88, 95, 100].forEach((m, i) => {
    const f = mtof(m) * a.r;
    v.osc(v.gain(amp, 1 / (i + 1.4)), 'sine', f, a.t, a.t + 0.8, -4);
    v.osc(v.gain(amp, 0.5 / (i + 1.4)), 'sine', f, a.t, a.t + 0.8, 5);
  });
  v.reverb(0.3);
};

// ------------------------------------------------------------------ scatters

/** Golden-mic scatter: marimba strike + bell overtone + sub weight; rises B4 -> D5 -> E5. */
const scatter = (n: 1 | 2 | 3): VoiceFn => (v, a) => {
  const { t, r } = a;
  const m = [71, 74, 76][n - 1] ?? 71;
  subBoom(v, v.out, t, 0.42 + n * 0.06, 120, 50, 0.32);
  marimba(v, v.out, t, mtof(m) * r, 0.5, 0.7);
  fm(v, v.out, t, mtof(m + 12) * r, { level: 0.16, ratio: 3.5, index: 2, indexDecay: 0.2, decay: 1.2 + n * 0.2 });
  const air = v.gain(v.out, 0);
  perc(air.gain, t, 0.03 + n * 0.012, 0.004, 0.25);
  v.noise(v.filter(air, 'highpass', 6500), t, t + 0.3);
  if (n === 3) {
    [79, 83, 88].forEach((mm, i) => {
      const ti = t + 0.08 * (i + 1);
      marimba(v, v.out, ti, mtof(mm) * r, 0.34, 0.8);
      fm(v, v.out, ti, mtof(mm + 12) * r, { level: 0.08, ratio: 3.5, index: 1.6, decay: 1.4 });
    });
    crash(v, v.out, t + 0.24, 0.1, 1.4);
  }
  v.reverb(0.28 + n * 0.05);
};

// ------------------------------------------------------------------ anticipation

/**
 * Anticipation loop: rising band-passed noise riser, a slowly opening E/B drone
 * and a lub-dub heartbeat on the symbol pulse period. Runs until the engine
 * releases it (or AUDIO_TIMING.anticipationMax).
 */
const anticipationLoop: VoiceFn = (v, a) => {
  const { t } = a;
  const max = AUDIO_TIMING.anticipationMax;
  const end = t + max;
  const rise = 4.2;
  // fade-in + auto fade at the safety limit
  v.out.gain.setValueAtTime(0, t);
  v.out.gain.linearRampToValueAtTime(1, t + 0.25);
  v.out.gain.setValueAtTime(1, end - 0.6);
  v.out.gain.linearRampToValueAtTime(0, end);

  const rAmp = v.gain(v.out, 0);
  rAmp.gain.setValueAtTime(0.012, t);
  rAmp.gain.exponentialRampToValueAtTime(0.2, t + rise);
  rAmp.gain.setValueAtTime(0.2, end);
  const bp = v.filter(rAmp, 'bandpass', 300, 3.5);
  bp.frequency.setValueAtTime(300, t);
  bp.frequency.exponentialRampToValueAtTime(3000, t + rise);
  bp.frequency.exponentialRampToValueAtTime(v.hz(5200), end);
  v.noise(bp, t, end);

  const dAmp = v.gain(v.out, 0.1);
  const lp = v.filter(dAmp, 'lowpass', 160, 4);
  lp.frequency.setValueAtTime(160, t);
  lp.frequency.exponentialRampToValueAtTime(1300, t + rise);
  for (const [m, det] of [[40, -7], [40, 7], [47, -5], [47, 6]] as const) {
    v.osc(lp, 'sawtooth', mtof(m) * a.r, t, end, det);
  }
  // tremolo on the drone at 4x the heartbeat rate
  const trem = v.gain(dAmp.gain, 0.035);
  v.osc(trem, 'sine', 4 / a.period, t, end);

  const period = Math.max(0.25, a.period);
  for (let bt = t + 0.05; bt < end - 0.3; bt += period) {
    kick(v, v.out, bt, { f0: 72, f1: 42, drop: 0.06, decay: 0.16, level: 0.62 });
    kick(v, v.out, bt + period * 0.27, { f0: 66, f1: 40, drop: 0.06, decay: 0.14, level: 0.42 });
  }
  v.reverb(0.12);
};

const anticipationEnd: VoiceFn = (v, a) => {
  const { t, r } = a;
  const amp = v.gain(v.out, 0);
  perc(amp.gain, t, 0.65, 0.018, 0.34);
  const bp = v.filter(amp, 'bandpass', 2800, 1.4);
  glide(bp.frequency, t, 2800 * r, 320 * r, 0.3);
  v.noise(bp, t, t + 0.4);
  kick(v, v.out, t + 0.01, { f0: 110 * r, f1: 48, drop: 0.12, decay: 0.28, level: 0.34 });
  v.reverb(0.2);
};

// ------------------------------------------------------------------ wins

const winSmall: VoiceFn = (v, a) => {
  const { t, r } = a;
  marimba(v, v.out, t, mtof(83) * r, 0.45, 0.6);
  marimba(v, v.out, t + 0.07, mtof(88) * r, 0.42, 0.8);
  fm(v, v.out, t + 0.07, mtof(100) * r, { level: 0.06, ratio: 3.5, index: 1.2, decay: 0.9 });
  v.reverb(0.25);
};

/** Cluster win: 4-note pluck arpeggio that climbs one scale degree per cascade step. */
const winCluster: VoiceFn = (v, a) => {
  const { t, r } = a;
  const base = Math.min(7, a.step);
  [0, 2, 4, 5].forEach((d, i) => {
    const ti = t + i * 0.052;
    const last = i === 3;
    pluck(v, v.out, ti, mtof(penta(E4, base + d)) * r, last ? 0.34 : 0.28, last ? 0.55 : 0.3, 0.9 + base * 0.08);
  });
  const sp = v.gain(v.out, 0);
  perc(sp.gain, t + 0.15, 0.03, 0.02, 0.35);
  v.noise(v.filter(sp, 'highpass', 7500), t + 0.15, t + 0.55);
  v.reverb(0.26);
};

/** Pop: bandpass-swept noise burst + low thump + crackle + a little swamp-bubble "bloop". */
const explode: VoiceFn = (v, a) => {
  const { t, r } = a;
  const amp = v.gain(v.out, 0);
  perc(amp.gain, t, 0.8, 0.002, 0.3);
  const bp = v.filter(amp, 'bandpass', 3200, 1.3);
  glide(bp.frequency, t, 3200 * r, 460 * r, 0.26);
  v.noise(bp, t, t + 0.32);
  const crunch = v.gain(v.out, 0);
  perc(crunch.gain, t, 0.34, 0.001, 0.07);
  v.noise(v.filter(crunch, 'bandpass', 1200 * r, 0.8), t, t + 0.08);
  kick(v, v.out, t, { f0: 150 * r, f1: 50, drop: 0.09, decay: 0.24, level: 0.42, click: 0.3, clickFreq: 1800 });
  const cr = v.gain(v.out, 0);
  perc(cr.gain, t, 0.32, 0.0005, 0.028);
  v.noise(v.filter(cr, 'highpass', 4500), t, t + 0.04);
  const bub = v.gain(v.out, 0);
  perc(bub.gain, t + 0.006, 0.22, 0.002, 0.05);
  const bo = v.osc(bub, 'sine', 360 * r, t + 0.006, t + 0.07);
  glide(bo.frequency, t + 0.006, 360 * r, 1150 * r, 0.045);
  v.reverb(0.14);
};

/** Tumble refill: soft wooden clack (modal partials + a tiny noise tick). */
const tumbleDrop: VoiceFn = (v, a) => {
  const { t, r } = a;
  const f = 640 * r;
  const modes: [number, number, number][] = [
    [1, 0.4, 0.06],
    [2.57, 0.2, 0.034],
    [4.2, 0.09, 0.02],
  ];
  for (const [ratio, amt, d] of modes) {
    const amp = v.gain(v.out, 0);
    perc(amp.gain, t, amt, 0.0006, d);
    v.osc(amp, 'sine', f * ratio, t, t + d + 0.01);
  }
  const tick = v.gain(v.out, 0);
  perc(tick.gain, t, 0.18, 0.0004, 0.008);
  v.noise(v.filter(tick, 'bandpass', 2600 * r, 1.2), t, t + 0.015);
  kick(v, v.out, t, { f0: 190 * r, f1: 120 * r, drop: 0.03, decay: 0.06, level: 0.24 });
};

// ------------------------------------------------------------------ spots

const spotMark: VoiceFn = (v, a) => {
  const { t, r } = a;
  glass(v, v.out, t, mtof(88) * r, 0.34, 0.85);
  fm(v, v.out, t, mtof(100) * r, { level: 0.05, ratio: 1.41, index: 0.8, decay: 0.3 });
  v.reverb(0.38);
};

/** Spot upgrade: two-note glass "bling", pitch rising with the spot tier (1..5). */
const spotUpgrade: VoiceFn = (v, a) => {
  const { t, r } = a;
  const tier = Math.max(1, Math.min(5, a.step || 1));
  const n1 = penta(E5, tier - 1);
  const n2 = penta(E5, tier + 1);
  glass(v, v.out, t, mtof(n1) * r, 0.3, 0.7);
  glass(v, v.out, t + 0.06, mtof(n2) * r, 0.3, 0.9 + tier * 0.08);
  if (tier >= 3) {
    const sh = v.gain(v.out, 0);
    perc(sh.gain, t + 0.06, 0.02 + tier * 0.008, 0.01, 0.3);
    v.noise(v.filter(sh, 'highpass', 7000), t + 0.06, t + 0.4);
    glass(v, v.out, t + 0.12, mtof(n1 + 12) * r, 0.12, 0.8);
  }
  if (tier >= 5) subBoom(v, v.out, t, 0.35, 110, 45, 0.4);
  v.reverb(0.34);
};

// ------------------------------------------------------------------ counters

const counterTick: VoiceFn = (v, a) => {
  const { t, r } = a;
  const amp = v.gain(v.out, 0);
  perc(amp.gain, t, 0.16, 0.0005, 0.014);
  v.osc(amp, 'sine', 3100 * r, t, t + 0.02);
  const n = v.gain(v.out, 0);
  perc(n.gain, t, 0.1, 0.0003, 0.006);
  v.noise(v.filter(n, 'highpass', 5000), t, t + 0.01);
};

/** Count-up end chime; richer with the win level. */
const counterEnd: VoiceFn = (v, a) => {
  const { t, r } = a;
  fm(v, v.out, t, mtof(88) * r, { level: 0.26, ratio: 3.5, index: 1.6, indexDecay: 0.25, decay: 1.4 });
  fm(v, v.out, t + 0.045, mtof(95) * r, { level: 0.18, ratio: 3.5, index: 1.4, decay: 1.3 });
  marimba(v, v.out, t, mtof(E5) * r, 0.3, 0.6);
  if (a.step >= 3) fm(v, v.out, t + 0.09, mtof(100) * r, { level: 0.12, ratio: 3.5, index: 1.2, decay: 1.2 });
  v.reverb(0.34);
};

// ------------------------------------------------------------------ big win

/** "bah-BAAH!": D pickup stab into a big Em9 stab, crash and sub boom. */
const bigwinStart: VoiceFn = (v, a) => {
  const { t } = a;
  brass(v, v.out, t, hzs([50, 57, 62, 66]), { len: 0.09, level: 0.36, bright: 0.8 });
  const t2 = t + 0.17;
  brass(v, v.out, t2, hzs(EM9), { len: 0.62, level: 0.46, bright: 1.2, fall: 2 });
  crash(v, v.out, t2, 0.24, 2.2);
  subBoom(v, v.out, t2, 0.62, 96, 36, 1.1);
  v.reverb(0.24);
};

/** Tier-up: stab transposed one pentatonic degree per tier step, crash, boom, glitter. */
const bigwinTier: VoiceFn = (v, a) => {
  const { t } = a;
  const k = Math.max(1, Math.min(5, a.step || 1));
  const shift = penta(0, k);
  brass(v, v.out, t, hzs(EM9, shift), { len: 0.34, level: 0.44, bright: 1 + k * 0.1 });
  crash(v, v.out, t, 0.2, 1.6);
  subBoom(v, v.out, t, 0.52, 90, 38, 0.8);
  [0, 2, 4].forEach((d, i) => {
    fm(v, v.out, t + 0.05 + i * 0.05, mtof(penta(E5, k + d)), { level: 0.07, ratio: 3.5, index: 1.4, decay: 0.9 });
  });
  v.reverb(0.24);
};

/** Resolution: long Em9 stab with a filter close, long crash, descending bell sparkle. */
const bigwinEnd: VoiceFn = (v, a) => {
  const { t } = a;
  brass(v, v.out, t, hzs(EM9), { len: 1.1, level: 0.46, bright: 1.1 });
  brass(v, v.out, t, hzs([40]), { len: 1.1, level: 0.22, bright: 0.6 });
  crash(v, v.out, t, 0.26, 2.8);
  subBoom(v, v.out, t, 0.7, 92, 34, 1.4);
  [95, 91, 88, 83, 79].forEach((m, i) => {
    fm(v, v.out, t + 0.12 + i * 0.09, mtof(m), { level: 0.1, ratio: 3.5, index: 1.5, decay: 1.2 });
  });
  v.reverb(0.3);
};

// ------------------------------------------------------------------ free spins

const fsTrigger: VoiceFn = (v, a) => {
  const { t } = a;
  [76, 79, 81, 83, 86, 88, 91, 95].forEach((m, i) => {
    const ti = t + i * 0.045;
    marimba(v, v.out, ti, mtof(m), 0.3, 0.5);
    fm(v, v.out, ti, mtof(m + 12), { level: 0.05, ratio: 3.5, index: 1.2, decay: 0.7 });
  });
  const hit = t + 0.38;
  swell(v, v.out, t, 0.38, 0.22);
  brass(v, v.out, hit, hzs(EM9), { len: 0.55, level: 0.46, bright: 1.2, fall: 3 });
  crash(v, v.out, hit, 0.26, 2.4);
  subBoom(v, v.out, hit, 0.7, 100, 36, 1.2);
  fm(v, v.out, hit, mtof(88), { level: 0.14, ratio: 3.5, index: 2, decay: 1.8 });
  fm(v, v.out, hit, mtof(95), { level: 0.1, ratio: 3.5, index: 2, decay: 1.8 });
  v.reverb(0.3);
};

/** Riser into an impact that opens onto an Em9 pad (~2.6 s, the intro card). */
const fsIntro: VoiceFn = (v, a) => {
  const { t } = a;
  const rise = 1.35;
  const rAmp = v.gain(v.out, 0);
  rAmp.gain.setValueAtTime(FLOOR, t);
  rAmp.gain.exponentialRampToValueAtTime(0.3, t + rise);
  rAmp.gain.linearRampToValueAtTime(0, t + rise + 0.02);
  const lp = v.filter(rAmp, 'lowpass', 500, 1.6);
  glide(lp.frequency, t, 500, v.hz(9000), rise);
  v.noise(lp, t, t + rise + 0.03);
  const tone = v.gain(v.out, 0);
  tone.gain.setValueAtTime(0, t);
  tone.gain.linearRampToValueAtTime(0.07, t + rise * 0.8);
  tone.gain.linearRampToValueAtTime(0, t + rise + 0.02);
  const to = v.osc(tone, 'triangle', mtof(E4), t, t + rise + 0.03);
  glide(to.frequency, t, mtof(E4), mtof(88), rise);
  const hit = t + rise;
  subBoom(v, v.out, hit, 0.6, 100, 38, 1.3);
  crash(v, v.out, hit, 0.28, 2.4);
  brass(v, v.out, hit, hzs(EM9), { len: 0.18, level: 0.34, bright: 1 });
  pad(v, v.out, hit, hzs([52, 59, 62, 66, 71]), 0.18, 0.06, 0.6, 0.9, 2400);
  v.reverb(0.32);
};

const fsOutro: VoiceFn = (v, a) => {
  const { t } = a;
  [95, 91, 88, 83, 79, 76].forEach((m, i) => {
    fm(v, v.out, t + i * 0.09, mtof(m), { level: 0.16, ratio: 3.5, index: 1.6, decay: 1.2 });
  });
  pad(v, v.out, t + 0.1, hzs([52, 59, 62, 66, 71]), 0.16, 0.35, 0.8, 0.9, 1600);
  subBoom(v, v.out, t, 0.4, 80, 36, 0.9);
  v.reverb(0.4);
};

// ------------------------------------------------------------------ spin / ui

const spinStart: VoiceFn = (v, a) => {
  const { t, r } = a;
  kick(v, v.out, t, { f0: 170 * r, f1: 70, drop: 0.05, decay: 0.09, level: 0.36, click: 0.4, clickFreq: 3000 });
  const amp = v.gain(v.out, 0);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(0.34, t + 0.1);
  amp.gain.exponentialRampToValueAtTime(FLOOR, t + 0.3);
  const bp = v.filter(amp, 'bandpass', 500, 1.8);
  glide(bp.frequency, t, 480 * r, 2700 * r, 0.22);
  v.noise(bp, t, t + 0.31);
};

const fallOut: VoiceFn = (v, a) => {
  const { t, r } = a;
  const amp = v.gain(v.out, 0);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(0.4, t + 0.05);
  amp.gain.exponentialRampToValueAtTime(FLOOR, t + 0.38);
  const bp = v.filter(amp, 'bandpass', 2200, 1.2);
  glide(bp.frequency, t, 2200 * r, 260 * r, 0.32);
  v.noise(bp, t, t + 0.39);
  const rum = v.gain(v.out, 0);
  perc(rum.gain, t, 0.14, 0.04, 0.3);
  v.noise(v.filter(rum, 'lowpass', 260), t, t + 0.35);
};

const uiClick: VoiceFn = (v, a) => {
  const { t, r } = a;
  const amp = v.gain(v.out, 0);
  perc(amp.gain, t, 0.3, 0.001, 0.035);
  const o = v.osc(amp, 'sine', 1500 * r, t, t + 0.045);
  glide(o.frequency, t, 1500 * r, 1050 * r, 0.025);
  const n = v.gain(v.out, 0);
  perc(n.gain, t, 0.07, 0.0005, 0.01);
  v.noise(v.filter(n, 'highpass', 4000), t, t + 0.015);
};

const blip = (v: Voice, t: number, midi: number, r: number, level: number, decay: number): void => {
  const amp = v.gain(v.out, 0);
  perc(amp.gain, t, level, 0.002, decay);
  v.osc(amp, 'triangle', mtof(midi) * r, t, t + decay + 0.01);
  v.osc(v.gain(amp, 0.25), 'sine', mtof(midi + 12) * r, t, t + decay + 0.01);
};

const uiBetUp: VoiceFn = (v, a) => {
  blip(v, a.t, 83, a.r, 0.22, 0.07);
  blip(v, a.t + 0.055, 88, a.r, 0.22, 0.1);
};

const uiBetDown: VoiceFn = (v, a) => {
  blip(v, a.t, 88, a.r, 0.22, 0.07);
  blip(v, a.t + 0.055, 83, a.r, 0.22, 0.1);
};

/** Every SfxId has a voice (Record enforces exhaustiveness at compile time). */
export const SYNTH_VOICES: Record<SfxId, VoiceFn> = {
  spin_start: spinStart,
  fall_out: fallOut,
  land_light: (v, a) => thud(v, a, LAND_LIGHT),
  land_medium: (v, a) => thud(v, a, LAND_MEDIUM),
  land_heavy: (v, a) => thud(v, a, LAND_HEAVY),
  land_special: landSpecial,
  scatter_land_1: scatter(1),
  scatter_land_2: scatter(2),
  scatter_land_3: scatter(3),
  anticipation_loop: anticipationLoop,
  anticipation_end: anticipationEnd,
  win_small: winSmall,
  win_cluster: winCluster,
  explode,
  tumble_drop: tumbleDrop,
  spot_mark: spotMark,
  spot_upgrade: spotUpgrade,
  counter_tick: counterTick,
  counter_end: counterEnd,
  bigwin_start: bigwinStart,
  bigwin_tier: bigwinTier,
  bigwin_end: bigwinEnd,
  fs_trigger: fsTrigger,
  fs_intro: fsIntro,
  fs_outro: fsOutro,
  ui_click: uiClick,
  ui_bet_up: uiBetUp,
  ui_bet_down: uiBetDown,
};

export const SFX_IDS = Object.keys(SYNTH_VOICES) as SfxId[];
