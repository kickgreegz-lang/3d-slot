import type { SfxId } from '../game/events';
import { brass, clav, crash, fm, glass, kick, marimba, pad, pluck, subBoom, swell } from './instruments';
import type { VoiceFn } from './synth';
import { FLOOR, type Voice, glide, mtof, penta, perc } from './voice';

/**
 * PLACEHOLDER SFX for the Groove Meter / Bass Drop ids (DESIGN bass-drop §17), procedural
 * like synth.ts until production files land in manifest.ts. Tonal voices stay in E minor
 * pentatonic (the groove's key); pitch escalation comes from the play's rate (see the
 * SFX_RULES comments in mix.ts: 'degrees' voices read `a.step`, 'free' ones `a.r`).
 *
 * Loudness intent: bass_boom is the loudest SFX in the game (sub 35-60 Hz + transient, on
 * the un-ducked hero bus); wild_impact is the next heaviest; ticks and UI stay small.
 */
type BassDropSfx =
  | 'link_connect'
  | 'orb_launch'
  | 'orb_absorb'
  | 'meter_threshold'
  | 'meter_lock_bonus'
  | 'meter_lock_super'
  | 'meter_heat'
  | 'meter_drain'
  | 'meter_lap'
  | 'bass_charge'
  | 'bass_boom'
  | 'wild_launch'
  | 'wild_whoosh'
  | 'wild_impact'
  | 'symbol_crush'
  | 'wild_mult'
  | 'sticky_lock'
  | 'sticky_mult_up'
  | 'feature_upgrade'
  | 'intro_card'
  | 'buy_open'
  | 'buy_select'
  | 'buy_confirm'
  | 'button_slam'
  | 'cooler_slam'
  | 'mic_drop'
  | 'dj_scratch';

const E5 = 76;
const EM9 = [52, 59, 62, 66, 67];
const hzs = (midis: number[], shift = 0): number[] => midis.map((m) => mtof(m + shift));

/** Short noise tick through a band-pass (debris, splinters, rattles). */
const tick = (v: Voice, dest: AudioNode, t: number, freq: number, level: number, decay: number, q = 2): void => {
  const g = v.gain(dest, 0);
  perc(g.gain, t, level, 0.0005, decay);
  v.noise(v.filter(g, 'bandpass', freq, q), t, t + decay + 0.01);
};

// ------------------------------------------------------------------ connections / orbs

/** Link draw-on: an electric zip (buzzing saw sweep through a resonant band-pass + crackle). */
const linkConnect: VoiceFn = (v, a) => {
  const { t, r } = a;
  const dur = 0.13;
  const amp = v.gain(v.out, 0);
  perc(amp.gain, t, 0.7, 0.004, dur);
  const bp = v.filter(amp, 'bandpass', 900 * r, 3.5);
  glide(bp.frequency, t, v.hz(700 * r), v.hz(4200 * r), dur * 0.8);
  const o = v.osc(bp, 'sawtooth', 200 * r, t, t + dur + 0.02);
  glide(o.frequency, t, v.hz(180 * r), v.hz(880 * r), dur * 0.8);
  const buzz = v.gain(o.frequency, 0);
  buzz.gain.setValueAtTime(240 * r, t);
  v.osc(buzz, 'square', 57 * r, t, t + dur + 0.02);
  const cr = v.gain(v.out, 0);
  perc(cr.gain, t, 0.2, 0.001, 0.05);
  v.noise(v.filter(cr, 'highpass', 5200), t, t + 0.07);
  glass(v, v.out, t + dur * 0.7, mtof(88) * r, 0.12, 0.25);
  v.reverb(0.12);
};

/** First orb burst of a step: one airy upward whoosh bundle with a small sparkle. */
const orbLaunch: VoiceFn = (v, a) => {
  const { t, r } = a;
  const amp = v.gain(v.out, 0);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(0.55, t + 0.05);
  amp.gain.exponentialRampToValueAtTime(FLOOR, t + 0.26);
  const bp = v.filter(amp, 'bandpass', 700, 1.6);
  glide(bp.frequency, t, v.hz(600 * r), v.hz(3600 * r), 0.22);
  v.noise(bp, t, t + 0.27);
  const fwip = v.gain(v.out, 0);
  perc(fwip.gain, t, 0.16, 0.01, 0.16);
  const o = v.osc(fwip, 'sine', mtof(71) * r, t, t + 0.18);
  glide(o.frequency, t, mtof(71) * r, mtof(83) * r, 0.14);
  fm(v, v.out, t + 0.06, mtof(95) * r, { level: 0.04, ratio: 3.5, index: 1, decay: 0.3 });
  v.reverb(0.15);
};

/** Orb arrival: a short glassy pitched tick (E6; +1 semitone per arrival comes in as rate). */
const orbAbsorb: VoiceFn = (v, a) => {
  const { t, r } = a;
  const f = mtof(88) * r;
  const amp = v.gain(v.out, 0);
  perc(amp.gain, t, 0.45, 0.001, 0.07);
  const o = v.osc(amp, 'sine', f, t, t + 0.08);
  glide(o.frequency, t, v.hz(f * 1.12), v.hz(f), 0.012);
  const ov = v.gain(v.out, 0);
  perc(ov.gain, t, 0.08, 0.001, 0.035);
  v.osc(ov, 'triangle', f * 2, t, t + 0.04);
  tick(v, v.out, t, 7000, 0.06, 0.008, 0.8);
  v.reverb(0.1);
};

// ------------------------------------------------------------------ meter

/** Minor notch: bell + glass + wood chime, one pentatonic degree up per notch (a.step). */
const meterThreshold: VoiceFn = (v, a) => {
  const { t } = a;
  const n = penta(E5, Math.min(9, a.step));
  fm(v, v.out, t, mtof(n), { level: 0.22, ratio: 3.5, index: 1.8, indexDecay: 0.2, decay: 0.9 });
  glass(v, v.out, t + 0.05, mtof(n + 12), 0.12, 0.7);
  marimba(v, v.out, t, mtof(n - 12), 0.26, 0.4);
  kick(v, v.out, t, { f0: 120, f1: 55, drop: 0.06, decay: 0.16, level: 0.28 });
  v.reverb(0.3);
};

/** 40 locked (Juke Jam): "bah-da-BAH" horn pickup into an Em9 stab, marimba run, crash, sub. */
const meterLockBonus: VoiceFn = (v, a) => {
  const { t } = a;
  brass(v, v.out, t, hzs([59, 64]), { len: 0.07, level: 0.3, bright: 0.9 });
  brass(v, v.out, t + 0.12, hzs([62, 67]), { len: 0.07, level: 0.32, bright: 0.95 });
  const hit = t + 0.26;
  brass(v, v.out, hit, hzs(EM9, 12), { len: 0.45, level: 0.44, bright: 1.2, fall: 2 });
  crash(v, v.out, hit, 0.2, 1.8);
  subBoom(v, v.out, hit, 0.6, 96, 38, 0.9);
  [76, 79, 83, 88].forEach((m, i) => marimba(v, v.out, hit + 0.05 + i * 0.05, mtof(m), 0.24, 0.5));
  v.reverb(0.28);
};

/** 60 locked (Mega Mix): reverse swell into a double-octave stab, sub drop, bell glissando. */
const meterLockSuper: VoiceFn = (v, a) => {
  const { t } = a;
  swell(v, v.out, t, 0.22, 0.2);
  const hit = t + 0.22;
  brass(v, v.out, hit, hzs(EM9, 12), { len: 0.7, level: 0.46, bright: 1.35 });
  brass(v, v.out, hit, hzs([40, 52]), { len: 0.7, level: 0.24, bright: 0.7 });
  crash(v, v.out, hit, 0.28, 2.4);
  subBoom(v, v.out, hit, 0.8, 70, 34, 1.4);
  [79, 83, 86, 88, 91, 95, 100].forEach((m, i) => {
    fm(v, v.out, hit + 0.04 + i * 0.045, mtof(m), { level: 0.1, ratio: 3.5, index: 1.6, decay: 1 });
  });
  const sw = v.gain(v.out, 0);
  perc(sw.gain, hit, 0.26, 0.01, 0.8);
  const lp = v.filter(sw, 'lowpass', 2000, 4);
  glide(lp.frequency, hit, 2400, 120, 0.7);
  v.osc(lp, 'sawtooth', mtof(40), hit, hit + 0.85, -8);
  v.osc(lp, 'sawtooth', mtof(40), hit, hit + 0.85, 8);
  v.reverb(0.3);
};

/** Heat: ONE low tick per play (the meter plays it on each heat pulse). */
const meterHeat: VoiceFn = (v, a) => {
  const { t, r } = a;
  kick(v, v.out, t, { f0: 110 * r, f1: 60 * r, drop: 0.04, decay: 0.1, level: 0.4, click: 0.2, clickFreq: 1400 });
  const k = v.gain(v.out, 0);
  perc(k.gain, t, 0.1, 0.0008, 0.03);
  v.osc(k, 'sine', 620 * r, t, t + 0.04);
};

/** Base-spin drain: quiet descending band-pass sweep with a falling tone. */
const meterDrain: VoiceFn = (v, a) => {
  const { t, r } = a;
  const amp = v.gain(v.out, 0);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(0.22, t + 0.04);
  amp.gain.exponentialRampToValueAtTime(FLOOR, t + 0.42);
  const bp = v.filter(amp, 'bandpass', 2400, 2.2);
  glide(bp.frequency, t, v.hz(2600 * r), v.hz(260 * r), 0.4);
  v.noise(bp, t, t + 0.43);
  const tone = v.gain(v.out, 0);
  perc(tone.gain, t, 0.08, 0.02, 0.36);
  const o = v.osc(tone, 'triangle', mtof(E5) * r, t, t + 0.4);
  glide(o.frequency, t, mtof(E5) * r, mtof(52) * r, 0.36);
  v.reverb(0.16);
};

/** Fallback lap: the notch chime plus a rising glass shimmer. */
const meterLap: VoiceFn = (v, a) => {
  meterThreshold(v, a);
  [0, 2, 4].forEach((d, i) => glass(v, v.out, a.t + 0.08 + i * 0.05, mtof(penta(88, d)), 0.07, 0.6));
};

// ------------------------------------------------------------------ the drop

/**
 * Charge riser over `a.span` (500 ms at normal speed): band-passed noise swelling up, a
 * wobble bass whose low-pass wobbles faster and faster, a rising tension tone and an
 * accelerating snare roll. The boom cuts it (SFX_RULES.bass_boom.cuts).
 */
const bassCharge: VoiceFn = (v, a) => {
  const { t, r } = a;
  const span = Math.max(0.12, a.span);
  const end = t + span;
  const nAmp = v.gain(v.out, 0);
  nAmp.gain.setValueAtTime(FLOOR, t);
  nAmp.gain.exponentialRampToValueAtTime(0.3, end);
  nAmp.gain.linearRampToValueAtTime(0, end + 0.02);
  const bp = v.filter(nAmp, 'bandpass', 300, 2.5);
  glide(bp.frequency, t, v.hz(300 * r), v.hz(5200 * r), span);
  v.noise(bp, t, end + 0.03);

  const wAmp = v.gain(v.out, 0);
  wAmp.gain.setValueAtTime(0, t);
  wAmp.gain.linearRampToValueAtTime(0.3, t + span * 0.7);
  wAmp.gain.linearRampToValueAtTime(0.38, end);
  wAmp.gain.linearRampToValueAtTime(0, end + 0.02);
  const lp = v.filter(wAmp, 'lowpass', 300, 7);
  lp.frequency.setValueAtTime(260, t);
  lp.frequency.exponentialRampToValueAtTime(1600, end);
  const wob = v.gain(lp.frequency, 220);
  const lfo = v.osc(wob, 'sine', 4, t, end + 0.03);
  glide(lfo.frequency, t, 4, 18, span);
  for (const det of [-9, 9]) {
    const o = v.osc(lp, 'sawtooth', mtof(28) * r, t, end + 0.03, det);
    glide(o.frequency, t, mtof(28) * r, mtof(40) * r, span);
  }

  const tone = v.gain(v.out, 0);
  tone.gain.setValueAtTime(0, t);
  tone.gain.linearRampToValueAtTime(0.09, end);
  tone.gain.linearRampToValueAtTime(0, end + 0.015);
  const to = v.osc(tone, 'triangle', mtof(52) * r, t, end + 0.02);
  glide(to.frequency, t, mtof(52) * r, mtof(76) * r, span);

  for (let k = 0; k < 8; k++) {
    const x = 1 - (1 - k / 8) ** 1.7;
    tick(v, v.out, t + span * x, 2600, 0.05 + 0.1 * (k / 8), 0.05, 1);
  }
};

/**
 * The boom — the loudest SFX: a 62 -> 35 Hz sub, a 2nd-harmonic punch (so phone speakers
 * feel it), a click/chest transient, a low-passed air blast, cone grit and a downlifter tail.
 * +2 semitones per chain step arrive as rate.
 */
const bassBoom: VoiceFn = (v, a) => {
  const { t, r } = a;
  kick(v, v.out, t, { f0: 62 * r, f1: 35 * r, drop: 0.5, decay: 1.5, level: 0.95 });
  const punch = v.gain(v.out, 0);
  perc(punch.gain, t, 0.5, 0.001, 0.35);
  const po = v.osc(punch, 'sine', 130 * r, t, t + 0.4);
  glide(po.frequency, t, 150 * r, 70 * r, 0.25);
  kick(v, v.out, t, { f0: 180 * r, f1: 60 * r, drop: 0.05, decay: 0.16, level: 0.6, click: 0.55, clickFreq: 2800 });
  const blast = v.gain(v.out, 0);
  perc(blast.gain, t, 0.42, 0.002, 0.3);
  const lp = v.filter(blast, 'lowpass', 1200, 0.8);
  glide(lp.frequency, t, 2400, 180, 0.3);
  v.noise(lp, t, t + 0.32);
  const grit = v.gain(v.out, 0);
  perc(grit.gain, t, 0.16, 0.002, 0.28);
  const glp = v.filter(grit, 'lowpass', 420, 2);
  glide(glp.frequency, t, 900, 90, 0.26);
  const go = v.osc(glp, 'square', 55 * r, t, t + 0.3);
  glide(go.frequency, t, 70 * r, 38 * r, 0.26);
  const tail = v.gain(v.out, 0);
  tail.gain.setValueAtTime(0, t);
  tail.gain.linearRampToValueAtTime(0.1, t + 0.05);
  tail.gain.exponentialRampToValueAtTime(FLOOR, t + 0.9);
  const tb = v.filter(tail, 'bandpass', 1500, 1.4);
  glide(tb.frequency, t, 1800, 140, 0.85);
  v.noise(tb, t, t + 0.92);
  v.reverb(0.18);
};

/** Wild pops out of the woofer: a rising "thwip", a puff, a small chain jingle. */
const wildLaunch: VoiceFn = (v, a) => {
  const { t, r } = a;
  const amp = v.gain(v.out, 0);
  perc(amp.gain, t, 0.34, 0.002, 0.12);
  const o = v.osc(amp, 'sine', 280 * r, t, t + 0.14);
  glide(o.frequency, t, 240 * r, 980 * r, 0.08);
  tick(v, v.out, t, 1800 * r, 0.22, 0.06, 1.2);
  kick(v, v.out, t, { f0: 140 * r, f1: 70 * r, drop: 0.03, decay: 0.08, level: 0.3 });
  [0, 0.018, 0.041].forEach((dt, i) => glass(v, v.out, t + 0.02 + dt, (3100 + i * 470) * r, 0.05, 0.12));
};

/** Flight: doppler whoosh (band-pass + tone rise while approaching, fall as it passes). */
const wildWhoosh: VoiceFn = (v, a) => {
  const { t, r } = a;
  const dur = 0.62;
  const peak = t + dur * 0.72;
  const amp = v.gain(v.out, 0);
  amp.gain.setValueAtTime(FLOOR, t);
  amp.gain.exponentialRampToValueAtTime(0.4, peak);
  amp.gain.exponentialRampToValueAtTime(FLOOR, t + dur);
  const bp = v.filter(amp, 'bandpass', 500, 1.8);
  bp.frequency.setValueAtTime(v.hz(450 * r), t);
  bp.frequency.exponentialRampToValueAtTime(v.hz(2400 * r), peak);
  bp.frequency.exponentialRampToValueAtTime(v.hz(700 * r), t + dur);
  v.noise(bp, t, t + dur + 0.01);
  const tone = v.gain(v.out, 0);
  tone.gain.setValueAtTime(FLOOR, t);
  tone.gain.exponentialRampToValueAtTime(0.06, peak);
  tone.gain.exponentialRampToValueAtTime(FLOOR, t + dur);
  const o = v.osc(v.filter(tone, 'lowpass', 900), 'sawtooth', 190 * r, t, t + dur + 0.01);
  o.frequency.setValueAtTime(190 * r, t);
  o.frequency.exponentialRampToValueAtTime(260 * r, peak);
  o.frequency.exponentialRampToValueAtTime(150 * r, t + dur);
};

/** Contact: heavy thud (sub + punch + floorboard box + crunch) and bouncing debris. */
const wildImpact: VoiceFn = (v, a) => {
  const { t, r } = a;
  kick(v, v.out, t, { f0: 150 * r, f1: 40 * r, drop: 0.1, decay: 0.5, level: 0.85, click: 0.4, clickFreq: 1600 });
  const punch = v.gain(v.out, 0);
  perc(punch.gain, t, 0.36, 0.001, 0.22);
  const po = v.osc(punch, 'sine', 180 * r, t, t + 0.24);
  glide(po.frequency, t, 220 * r, 90 * r, 0.14);
  tick(v, v.out, t, 240 * r, 0.55, 0.12, 1.6);
  const cr = v.gain(v.out, 0);
  perc(cr.gain, t, 0.3, 0.001, 0.1);
  v.noise(v.filter(cr, 'lowpass', 900, 0.9), t, t + 0.12);
  const bits: ReadonlyArray<readonly [number, number, number]> = [
    [0.045, 3400, 0.1],
    [0.07, 2600, 0.085],
    [0.105, 4100, 0.07],
    [0.15, 3000, 0.055],
    [0.2, 3700, 0.04],
    [0.26, 2800, 0.028],
  ];
  for (const [dt, f, lvl] of bits) tick(v, v.out, t + dt, f * r, lvl, 0.02, 3);
  v.reverb(0.16);
};

/** The replaced symbol is crushed: crunchy sweep, splinter snaps, a woody knock. */
const symbolCrush: VoiceFn = (v, a) => {
  const { t, r } = a;
  const amp = v.gain(v.out, 0);
  perc(amp.gain, t, 0.5, 0.002, 0.16);
  const bp = v.filter(amp, 'bandpass', 1600, 1.1);
  glide(bp.frequency, t, v.hz(1900 * r), v.hz(380 * r), 0.14);
  v.noise(bp, t, t + 0.18);
  [0, 0.022, 0.05].forEach((dt, i) => {
    const s = v.gain(v.out, 0);
    perc(s.gain, t + dt, 0.2 - i * 0.05, 0.0005, 0.025);
    v.noise(v.filter(s, 'highpass', 3000 + i * 800), t + dt, t + dt + 0.03);
  });
  const k = v.gain(v.out, 0);
  perc(k.gain, t, 0.24, 0.0008, 0.06);
  v.osc(k, 'sine', 620 * r, t, t + 0.07);
  kick(v, v.out, t, { f0: 130 * r, f1: 60, drop: 0.05, decay: 0.12, level: 0.3 });
  v.reverb(0.1);
};

/** Multiplier badge slam / label-sum arrival: a metallic "ching", pitched by a.step (tier). */
const wildMult: VoiceFn = (v, a) => {
  const { t } = a;
  const n = penta(E5, Math.min(10, a.step));
  fm(v, v.out, t, mtof(n), { level: 0.26, ratio: 1.41, index: 3, indexDecay: 0.08, decay: 0.55 });
  fm(v, v.out, t, mtof(n + 12), { level: 0.12, ratio: 3.5, index: 1.4, decay: 0.7 });
  glass(v, v.out, t + 0.03, mtof(n + 7), 0.08, 0.5);
  tick(v, v.out, t, 2400, 0.22, 0.03, 1);
  kick(v, v.out, t, { f0: 160, f1: 80, drop: 0.03, decay: 0.08, level: 0.24 });
  v.reverb(0.22);
};

/** One steel clamp clank (inharmonic partials + click + a small body thud). */
const clank = (v: Voice, t: number, r: number, level: number, pan: number): void => {
  const out = v.pan(v.out, pan);
  const partials: ReadonlyArray<readonly [number, number, number]> = [
    [520, 1, 0.22],
    [1190, 0.55, 0.14],
    [2140, 0.35, 0.09],
    [3330, 0.22, 0.05],
  ];
  for (const [f, amt, d] of partials) {
    const g = v.gain(out, 0);
    perc(g.gain, t, level * amt * 0.3, 0.0005, d);
    v.osc(g, 'triangle', f * r, t, t + d + 0.01);
  }
  const n = v.gain(out, 0);
  perc(n.gain, t, level * 0.3, 0.0005, 0.02);
  v.noise(v.filter(n, 'highpass', 2500), t, t + 0.03);
  kick(v, out, t, { f0: 200 * r, f1: 90, drop: 0.03, decay: 0.09, level: level * 0.35 });
};

/** Sticky lock: the two clamps snap shut left then right ("clank-clank"), a bolt glint. */
const stickyLock: VoiceFn = (v, a) => {
  clank(v, a.t, a.r, 1, -0.3);
  clank(v, a.t + 0.06, a.r * 1.06, 0.9, 0.3);
  glass(v, v.out, a.t + 0.1, mtof(88) * a.r, 0.06, 0.4);
  v.reverb(0.14);
};

/** Sticky multiplier grows: wood + bell two-note rise (a.step = badge tier) with shimmer. */
const stickyMultUp: VoiceFn = (v, a) => {
  const { t } = a;
  const d = Math.min(10, a.step);
  const n1 = penta(E5, d);
  const n2 = penta(E5, d + 2);
  marimba(v, v.out, t, mtof(n1), 0.3, 0.45);
  fm(v, v.out, t + 0.07, mtof(n2), { level: 0.2, ratio: 3.5, index: 1.8, decay: 0.8 });
  glass(v, v.out, t + 0.07, mtof(n2 + 12), 0.08, 0.6);
  const sh = v.gain(v.out, 0);
  perc(sh.gain, t + 0.07, 0.04, 0.01, 0.25);
  v.noise(v.filter(sh, 'highpass', 7200), t + 0.07, t + 0.35);
  v.reverb(0.3);
};

// ------------------------------------------------------------------ feature / UI / foley

/** Juke Jam -> Mega Mix: crack, riser, glass shatter, then the Mega Mix hit with a pad bloom. */
const featureUpgrade: VoiceFn = (v, a) => {
  const { t } = a;
  const ck = v.gain(v.out, 0);
  perc(ck.gain, t, 0.5, 0.0006, 0.06);
  v.noise(v.filter(ck, 'highpass', 1800), t, t + 0.08);
  kick(v, v.out, t, { f0: 200, f1: 70, drop: 0.05, decay: 0.14, level: 0.4, click: 0.5, clickFreq: 3000 });
  swell(v, v.out, t + 0.05, 0.25, 0.2);
  const sh = t + 0.3;
  [96, 91, 100, 88, 103, 95].forEach((m, i) => glass(v, v.out, sh + i * 0.022, mtof(m), 0.09, 0.5));
  const tail = v.gain(v.out, 0);
  perc(tail.gain, sh, 0.28, 0.001, 0.5);
  v.noise(v.filter(tail, 'highpass', 4200), sh, sh + 0.55);
  const hit = sh + 0.12;
  brass(v, v.out, hit, hzs(EM9, 12), { len: 0.8, level: 0.46, bright: 1.35, fall: 2 });
  brass(v, v.out, hit, hzs([40, 52]), { len: 0.8, level: 0.24, bright: 0.7 });
  crash(v, v.out, hit, 0.28, 2.6);
  subBoom(v, v.out, hit, 0.8, 80, 34, 1.5);
  pad(v, v.out, hit + 0.2, hzs([52, 59, 62, 66, 71]), 0.14, 0.2, 0.8, 0.9, 2400);
  v.reverb(0.32);
};

/** Intro card lands: card slap + low thud + a wooden accent, a little air after. */
const introCard: VoiceFn = (v, a) => {
  const { t, r } = a;
  tick(v, v.out, t, 1900 * r, 0.4, 0.05, 0.9);
  kick(v, v.out, t, { f0: 170 * r, f1: 80, drop: 0.04, decay: 0.12, level: 0.4 });
  marimba(v, v.out, t, mtof(83) * r, 0.14, 0.3);
  const air = v.gain(v.out, 0);
  air.gain.setValueAtTime(0, t);
  air.gain.linearRampToValueAtTime(0.06, t + 0.03);
  air.gain.exponentialRampToValueAtTime(FLOOR, t + 0.2);
  v.noise(v.filter(air, 'bandpass', 3200, 0.8), t, t + 0.21);
  v.reverb(0.16);
};

const buyOpen: VoiceFn = (v, a) => {
  const { t, r } = a;
  const amp = v.gain(v.out, 0);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(0.18, t + 0.08);
  amp.gain.exponentialRampToValueAtTime(FLOOR, t + 0.28);
  const bp = v.filter(amp, 'bandpass', 800, 1.5);
  glide(bp.frequency, t, v.hz(700 * r), v.hz(3000 * r), 0.22);
  v.noise(bp, t, t + 0.3);
  marimba(v, v.out, t + 0.06, mtof(83) * r, 0.24, 0.35);
  marimba(v, v.out, t + 0.12, mtof(88) * r, 0.26, 0.5);
  v.reverb(0.18);
};

const buySelect: VoiceFn = (v, a) => {
  const { t, r } = a;
  tick(v, v.out, t, 3000 * r, 0.22, 0.02, 1.2);
  pluck(v, v.out, t, mtof(88) * r, 0.14, 0.18, 0.6);
};

const buyConfirm: VoiceFn = (v, a) => {
  const { t, r } = a;
  clav(v, v.out, t, hzs([64, 67, 71]).map((f) => f * r), 0.2);
  fm(v, v.out, t + 0.05, mtof(88) * r, { level: 0.2, ratio: 3.5, index: 1.6, decay: 0.7 });
  fm(v, v.out, t + 0.1, mtof(95) * r, { level: 0.16, ratio: 3.5, index: 1.4, decay: 0.9 });
  kick(v, v.out, t, { f0: 130, f1: 55, drop: 0.06, decay: 0.2, level: 0.34 });
  v.reverb(0.26);
};

/** Croak's drop button: a plastic arcade-button thunk with a spring rattle. */
const buttonSlam: VoiceFn = (v, a) => {
  const { t, r } = a;
  kick(v, v.out, t, { f0: 260 * r, f1: 120 * r, drop: 0.025, decay: 0.08, level: 0.45, click: 0.5, clickFreq: 3500 });
  tick(v, v.out, t, 900 * r, 0.35, 0.05, 2.2);
  const sp = v.gain(v.out, 0);
  perc(sp.gain, t + 0.02, 0.06, 0.001, 0.09);
  v.osc(v.filter(sp, 'bandpass', 1800 * r, 8), 'sawtooth', 110 * r, t + 0.02, t + 0.12);
};

/** Gumbo's cooler lid: heavy plastic slam, lid rattle, ice clinks. */
const coolerSlam: VoiceFn = (v, a) => {
  const { t, r } = a;
  kick(v, v.out, t, { f0: 120 * r, f1: 50 * r, drop: 0.06, decay: 0.28, level: 0.7, click: 0.35, clickFreq: 1200 });
  tick(v, v.out, t, 320 * r, 0.5, 0.18, 1.4);
  [0.06, 0.1, 0.13].forEach((dt, i) => tick(v, v.out, t + dt, (700 + i * 180) * r, 0.12 - i * 0.03, 0.04, 3));
  [0.03, 0.055, 0.09].forEach((dt, i) => glass(v, v.out, t + dt, (2600 + i * 530) * r, 0.05, 0.12));
  v.reverb(0.12);
};

/** Croak's mic drop: thud, a low PA ring and a short feedback whine. */
const micDrop: VoiceFn = (v, a) => {
  const { t, r } = a;
  kick(v, v.out, t, { f0: 190 * r, f1: 70 * r, drop: 0.05, decay: 0.2, level: 0.55, click: 0.45, clickFreq: 2000 });
  const ring = v.gain(v.out, 0);
  perc(ring.gain, t + 0.005, 0.3, 0.004, 0.55);
  v.osc(v.filter(ring, 'lowpass', 300, 3), 'triangle', 82 * r, t + 0.005, t + 0.6);
  const fb = v.gain(v.out, 0);
  fb.gain.setValueAtTime(FLOOR, t + 0.08);
  fb.gain.exponentialRampToValueAtTime(0.05, t + 0.45);
  fb.gain.linearRampToValueAtTime(0, t + 0.5);
  v.osc(fb, 'sine', 2640 * r, t + 0.08, t + 0.51);
  v.reverb(0.2);
};

/** Booth scratch: two forward/back strokes ("wikka-wikka") of filtered noise + saw. */
const djScratch: VoiceFn = (v, a) => {
  const { t, r } = a;
  const dur = 0.26;
  const amp = v.gain(v.out, 0);
  amp.gain.setValueAtTime(0, t);
  for (const dt of [0, 0.13]) {
    amp.gain.linearRampToValueAtTime(0.3, t + dt + 0.02);
    amp.gain.linearRampToValueAtTime(0.02, t + dt + 0.11);
  }
  amp.gain.linearRampToValueAtTime(0, t + dur);
  const sweep = (p: AudioParam, lo: number, hi: number): void => {
    p.setValueAtTime(v.hz(lo * r), t);
    p.exponentialRampToValueAtTime(v.hz(hi * r), t + 0.06);
    p.exponentialRampToValueAtTime(v.hz(lo * 0.85 * r), t + 0.13);
    p.exponentialRampToValueAtTime(v.hz(hi * 0.85 * r), t + 0.19);
    p.exponentialRampToValueAtTime(v.hz(lo * 0.7 * r), t + dur);
  };
  const bp = v.filter(amp, 'bandpass', 1200, 2.5);
  sweep(bp.frequency, 700, 2600);
  v.noise(bp, t, t + dur + 0.01);
  const o = v.osc(v.filter(amp, 'lowpass', 1800), 'sawtooth', 140 * r, t, t + dur + 0.01);
  sweep(o.frequency, 140, 420);
};

/** Bass Drop voices (merged into SYNTH_VOICES; the Record keeps the id list exhaustive). */
export const BASS_DROP_VOICES: Record<BassDropSfx, VoiceFn> & Partial<Record<SfxId, VoiceFn>> = {
  link_connect: linkConnect,
  orb_launch: orbLaunch,
  orb_absorb: orbAbsorb,
  meter_threshold: meterThreshold,
  meter_lock_bonus: meterLockBonus,
  meter_lock_super: meterLockSuper,
  meter_heat: meterHeat,
  meter_drain: meterDrain,
  meter_lap: meterLap,
  bass_charge: bassCharge,
  bass_boom: bassBoom,
  wild_launch: wildLaunch,
  wild_whoosh: wildWhoosh,
  wild_impact: wildImpact,
  symbol_crush: symbolCrush,
  wild_mult: wildMult,
  sticky_lock: stickyLock,
  sticky_mult_up: stickyMultUp,
  feature_upgrade: featureUpgrade,
  intro_card: introCard,
  buy_open: buyOpen,
  buy_select: buySelect,
  buy_confirm: buyConfirm,
  button_slam: buttonSlam,
  cooler_slam: coolerSlam,
  mic_drop: micDrop,
  dj_scratch: djScratch,
};
