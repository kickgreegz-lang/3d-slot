import type { AudioGraph } from './graph';
import { bass, clav, crash, hat, kick, rhodes, shaker, snare } from './instruments';
import type { MusicStem } from './manifest';
import { AUDIO_TIMING, BUS_LEVELS } from './mix';
import { Voice, mtof } from './voice';

/**
 * PLACEHOLDER MUSIC — a procedural swamp-funk groove in E dorian (Em9 <-> A13
 * vamp; the SFX live in E minor pentatonic, a subset), played by a look-ahead
 * scheduler on the AudioContext clock. The frame clock only *drives* the
 * scheduler (`schedule(now + lookAhead)`); every note time comes from the audio
 * clock, so tempo never drifts with frame rate or hit-stops.
 *
 *   base     100 BPM, laid-back: kick/snare/hats, syncopated bass, Rhodes comping
 *   freegame 106 BPM, hotter: 16th hats, open hats, busier octave bass, clav chanks
 *   megamix  112 BPM, the hottest: four-on-the-floor + pushes, 16th hats, driving octave bass,
 *            clav always on, fills every 2 bars (a game's feature variant, 'music:stem')
 *   bigwin   110 BPM, four-on-the-floor party variation
 *
 * `accent(t)` plays a downbeat "drop" hit (kick + sub + crash) on the groove's bus: the
 * music answering a bass drop without waiting for the bar (gameplay never waits for the beat).
 *
 * `energy` (0..3, e.g. the tumble cascade depth) layers shaker -> open hats -> clav
 * onto whatever pattern is playing. Pattern switches land on a bar (or beat).
 */

type Hit = readonly [step: number, vel: number];
type Note = readonly [step: number, midi: number, len: number, vel: number];
type Chord = readonly [step: number, midis: readonly number[], len: number, vel: number];

interface Pattern {
  bpm: number;
  /** output trim (hotter variations sit a little louder) */
  gain: number;
  /** delay of odd 16ths, as a fraction of a 16th */
  swing: number;
  /** loop length in 16ths */
  steps: number;
  /** energy floor of this pattern */
  energy: number;
  /** snare fill on the last beat every N bars */
  fillEvery: number;
  /** crash on the downbeat every N bars (0 = never) */
  crashEvery: number;
  kick: Hit[];
  snare: Hit[];
  hats: Hit[];
  openHats: Hit[];
  /** energy >= 2 extra open hats */
  hypeHats: Hit[];
  bass: Note[];
  keys: Chord[];
  /** energy >= 3 */
  clav: Chord[];
}

const EM9 = [55, 59, 62, 66] as const;
const A13 = [55, 59, 61, 66] as const;
const CLAV_E = [64, 67, 71] as const;
const CLAV_A = [64, 69, 73] as const;

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);
/** 8th-note hats with the funk accent on the "and"s. */
const hats8 = (steps: number, skip: number[] = []): Hit[] =>
  range(steps)
    .filter((s) => s % 2 === 0 && !skip.includes(s))
    .map((s) => [s, s % 4 === 2 ? 0.42 : 0.3] as const);
const hats16 = (steps: number, skip: number[] = []): Hit[] =>
  range(steps)
    .filter((s) => !skip.includes(s))
    .map((s) => [s, s % 4 === 2 ? 0.4 : s % 2 === 0 ? 0.3 : 0.15] as const);

const PATTERNS: Record<MusicStem, Pattern> = {
  base: {
    bpm: 100, gain: 1, swing: 0.14, steps: 32, energy: 0, fillEvery: 8, crashEvery: 0,
    kick: [[0, 1], [7, 0.62], [10, 0.85], [16, 1], [22, 0.55], [24, 0.85], [27, 0.5]],
    snare: [[4, 1], [12, 1], [20, 1], [28, 1], [9, 0.2], [15, 0.24], [23, 0.18], [25, 0.2], [31, 0.28]],
    hats: hats8(32, [30]),
    openHats: [[30, 0.38]],
    hypeHats: [[14, 0.3], [6, 0.26], [22, 0.26]],
    bass: [
      [0, 40, 2, 1], [3, 40, 1, 0.55], [6, 52, 1, 0.85], [7, 50, 1, 0.7], [8, 47, 2, 0.9], [10, 43, 1, 0.75],
      [11, 45, 1, 0.7], [13, 47, 1, 0.6], [14, 50, 2, 0.8],
      [16, 45, 2, 1], [19, 45, 1, 0.55], [22, 57, 1, 0.85], [23, 55, 1, 0.7], [24, 52, 2, 0.85], [26, 50, 1, 0.7],
      [27, 49, 1, 0.6], [28, 47, 2, 0.8], [30, 43, 1, 0.7], [31, 42, 1, 0.65],
    ],
    keys: [[2, EM9, 2, 0.8], [6, EM9, 1, 0.5], [7, EM9, 5, 0.72], [18, A13, 2, 0.8], [26, A13, 4, 0.75], [30, A13, 2, 0.5]],
    clav: [[3, CLAV_E, 1, 0.5], [11, CLAV_E, 1, 0.5], [14, CLAV_E, 1, 0.3], [19, CLAV_A, 1, 0.5], [27, CLAV_A, 1, 0.5], [30, CLAV_A, 1, 0.3]],
  },
  freegame: {
    bpm: 106, gain: 1.06, swing: 0.12, steps: 32, energy: 2, fillEvery: 4, crashEvery: 8,
    kick: [[0, 1], [3, 0.55], [7, 0.7], [10, 0.9], [14, 0.5], [16, 1], [19, 0.55], [22, 0.7], [24, 0.9], [27, 0.6], [30, 0.5]],
    snare: [[4, 1], [12, 1], [20, 1], [28, 1], [7, 0.2], [9, 0.24], [15, 0.28], [23, 0.2], [25, 0.24], [29, 0.18], [31, 0.3]],
    hats: hats16(32, [6, 14, 22, 30]),
    openHats: [[6, 0.32], [14, 0.36], [22, 0.32], [30, 0.38]],
    hypeHats: [],
    bass: [
      [0, 40, 1, 1], [2, 52, 1, 0.8], [3, 40, 1, 0.6], [5, 52, 1, 0.7], [6, 50, 1, 0.7], [8, 47, 1, 0.9], [10, 40, 1, 0.8],
      [11, 52, 1, 0.7], [13, 43, 1, 0.7], [14, 45, 1, 0.75], [15, 46, 1, 0.6],
      [16, 45, 1, 1], [18, 57, 1, 0.8], [19, 45, 1, 0.6], [21, 57, 1, 0.7], [22, 55, 1, 0.7], [24, 52, 1, 0.9], [26, 45, 1, 0.8],
      [27, 57, 1, 0.7], [29, 50, 1, 0.7], [30, 47, 1, 0.75], [31, 42, 1, 0.65],
    ],
    keys: [[0, EM9, 1, 0.6], [2, EM9, 2, 0.8], [7, EM9, 3, 0.7], [12, EM9, 1, 0.5], [16, A13, 1, 0.6], [18, A13, 2, 0.8], [23, A13, 3, 0.7], [28, A13, 1, 0.5]],
    clav: [[1, CLAV_E, 1, 0.45], [5, CLAV_E, 1, 0.5], [9, CLAV_E, 1, 0.45], [13, CLAV_E, 1, 0.5], [17, CLAV_A, 1, 0.45], [21, CLAV_A, 1, 0.5], [25, CLAV_A, 1, 0.45], [29, CLAV_A, 1, 0.5]],
  },
  megamix: {
    bpm: 112, gain: 1.12, swing: 0.1, steps: 32, energy: 3, fillEvery: 2, crashEvery: 4,
    kick: [...range(8).map((i) => [i * 4, 1] as const), [3, 0.5], [11, 0.55], [14, 0.6], [19, 0.5], [27, 0.55], [30, 0.6]],
    snare: [[4, 1], [12, 1], [20, 1], [28, 1], [7, 0.22], [10, 0.2], [15, 0.3], [23, 0.22], [26, 0.2], [31, 0.34]],
    hats: hats16(32, [2, 6, 10, 14, 18, 22, 26, 30]),
    openHats: [2, 6, 10, 14, 18, 22, 26, 30].map((s) => [s, 0.36] as const),
    hypeHats: [],
    bass: [
      [0, 40, 1, 1], [1, 52, 1, 0.6], [2, 40, 1, 0.8], [3, 52, 1, 0.7], [4, 43, 1, 0.9], [6, 45, 1, 0.8], [7, 47, 1, 0.7],
      [8, 40, 1, 1], [10, 52, 1, 0.8], [11, 50, 1, 0.7], [12, 47, 1, 0.9], [14, 45, 1, 0.8], [15, 43, 1, 0.7],
      [16, 45, 1, 1], [17, 57, 1, 0.6], [18, 45, 1, 0.8], [19, 57, 1, 0.7], [20, 48, 1, 0.9], [22, 50, 1, 0.8], [23, 52, 1, 0.7],
      [24, 45, 1, 1], [26, 57, 1, 0.8], [27, 55, 1, 0.7], [28, 52, 1, 0.9], [30, 47, 1, 0.85], [31, 42, 1, 0.7],
    ],
    keys: [[0, EM9, 1, 0.7], [3, EM9, 1, 0.55], [6, EM9, 2, 0.7], [10, EM9, 1, 0.55], [14, EM9, 1, 0.6], [16, A13, 1, 0.7], [19, A13, 1, 0.55], [22, A13, 2, 0.7], [26, A13, 1, 0.55], [30, A13, 1, 0.6]],
    clav: [[1, CLAV_E, 1, 0.5], [3, CLAV_E, 1, 0.4], [5, CLAV_E, 1, 0.5], [9, CLAV_E, 1, 0.5], [11, CLAV_E, 1, 0.4], [13, CLAV_E, 1, 0.5], [17, CLAV_A, 1, 0.5], [19, CLAV_A, 1, 0.4], [21, CLAV_A, 1, 0.5], [25, CLAV_A, 1, 0.5], [27, CLAV_A, 1, 0.4], [29, CLAV_A, 1, 0.5]],
  },
  bigwin: {
    bpm: 110, gain: 1.12, swing: 0.08, steps: 32, energy: 3, fillEvery: 4, crashEvery: 4,
    kick: [...range(8).map((i) => [i * 4, 1] as const), [14, 0.5], [30, 0.5]],
    snare: [[4, 1], [12, 1], [20, 1], [28, 1], [15, 0.3], [31, 0.35]],
    hats: hats16(32, [2, 6, 10, 14, 18, 22, 26, 30]),
    openHats: [2, 6, 10, 14, 18, 22, 26, 30].map((s) => [s, 0.34] as const),
    hypeHats: [],
    bass: [
      [0, 40, 1, 1], [2, 52, 1, 0.75], [4, 40, 1, 0.9], [6, 52, 1, 0.75], [8, 40, 1, 0.9], [10, 52, 1, 0.75], [12, 43, 1, 0.85], [14, 45, 1, 0.8],
      [16, 45, 1, 1], [18, 57, 1, 0.75], [20, 45, 1, 0.9], [22, 57, 1, 0.75], [24, 45, 1, 0.9], [26, 57, 1, 0.75], [28, 47, 1, 0.85], [30, 50, 1, 0.8],
    ],
    keys: [[0, EM9, 4, 0.7], [6, EM9, 1, 0.55], [10, EM9, 2, 0.65], [14, EM9, 1, 0.5], [16, A13, 4, 0.7], [22, A13, 1, 0.55], [26, A13, 2, 0.65], [30, A13, 1, 0.5]],
    clav: [[3, CLAV_E, 1, 0.5], [7, CLAV_E, 1, 0.45], [11, CLAV_E, 1, 0.5], [15, CLAV_E, 1, 0.45], [19, CLAV_A, 1, 0.5], [23, CLAV_A, 1, 0.45], [27, CLAV_A, 1, 0.5], [31, CLAV_A, 1, 0.45]],
  },
};

/** Per-step event table, compiled once per pattern (no searching in the scheduler). */
interface StepEvents {
  kick: number;
  snare: number;
  hat: number;
  openHat: number;
  hypeHat: number;
  bass: Note | null;
  keys: Chord | null;
  clav: Chord | null;
}

const compile = (p: Pattern): StepEvents[] => {
  const table: StepEvents[] = range(p.steps).map(() => ({
    kick: 0, snare: 0, hat: 0, openHat: 0, hypeHat: 0, bass: null, keys: null, clav: null,
  }));
  const at = (s: number): StepEvents | undefined => table[s % p.steps];
  for (const [s, v] of p.kick) { const e = at(s); if (e) e.kick = v; }
  for (const [s, v] of p.snare) { const e = at(s); if (e) e.snare = v; }
  for (const [s, v] of p.hats) { const e = at(s); if (e) e.hat = v; }
  for (const [s, v] of p.openHats) { const e = at(s); if (e) e.openHat = v; }
  for (const [s, v] of p.hypeHats) { const e = at(s); if (e) e.hypeHat = v; }
  for (const n of p.bass) { const e = at(n[0]); if (e) e.bass = n; }
  for (const c of p.keys) { const e = at(c[0]); if (e) e.keys = c; }
  for (const c of p.clav) { const e = at(c[0]); if (e) e.clav = c; }
  return table;
};

const COMPILED: Record<MusicStem, StepEvents[]> = {
  base: compile(PATTERNS.base),
  freegame: compile(PATTERNS.freegame),
  megamix: compile(PATTERNS.megamix),
  bigwin: compile(PATTERNS.bigwin),
};

/** Mix levels of the groove's instruments (linear peaks x velocity). */
const LEVEL = {
  kick: 0.75, snare: 0.75, hat: 0.45, shaker: 0.24, bass: 0.4, keys: 0.15, clav: 0.14, crash: 0.2,
  keysReverb: 0.22, drumReverb: 0.06,
};

const tanhCurve = (drive: number): Float32Array<ArrayBuffer> => {
  const n = 1024;
  const c = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * drive) / norm;
  }
  return c;
};

export class Groove {
  /** 0..3 extra layers on top of the pattern's own energy floor */
  energy = 0;
  private stem: MusicStem;
  private pattern: Pattern;
  private table: StepEvents[];
  private pos = 0;
  private bar = 0;
  private next = 0;
  private running = false;
  private pending: { stem: MusicStem; quantum: number } | null = null;
  private crashNext = false;
  private readonly out: GainNode;
  private readonly trim: GainNode;
  private readonly drums: GainNode;
  private readonly bassIn: GainNode;
  private readonly keys: GainNode;
  private readonly panner: StereoPannerNode;
  private lfo: OscillatorNode | null = null;

  constructor(private readonly g: AudioGraph, stem: MusicStem = 'base', private readonly random: () => number = Math.random) {
    const ac = g.ac;
    this.stem = stem;
    this.pattern = PATTERNS[stem];
    this.table = COMPILED[stem];
    this.trim = ac.createGain();
    this.trim.gain.value = this.pattern.gain * BUS_LEVELS.groove;
    this.trim.connect(g.musicIn);
    this.out = ac.createGain();
    this.out.gain.value = 0;
    this.out.connect(this.trim);

    this.drums = ac.createGain();
    this.drums.connect(this.out);
    const drumSend = ac.createGain();
    drumSend.gain.value = LEVEL.drumReverb;
    this.drums.connect(drumSend);
    drumSend.connect(g.reverbIn);

    this.bassIn = ac.createGain();
    const drive = ac.createWaveShaper();
    drive.curve = tanhCurve(2.5);
    drive.oversample = '2x';
    const bassOut = ac.createGain();
    bassOut.gain.value = 0.8;
    this.bassIn.connect(drive);
    drive.connect(bassOut);
    bassOut.connect(this.out);

    this.keys = ac.createGain();
    this.panner = ac.createStereoPanner();
    this.keys.connect(this.panner);
    this.panner.connect(this.out);
    const keySend = ac.createGain();
    keySend.gain.value = LEVEL.keysReverb;
    this.keys.connect(keySend);
    keySend.connect(g.reverbIn);
  }

  get current(): MusicStem {
    return this.pending?.stem ?? this.stem;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Start at context time `t` with a fade-in (s). */
  start(t: number, fade: number = AUDIO_TIMING.musicFadeIn): void {
    if (this.running) return;
    const ac = this.g.ac;
    this.running = true;
    this.pos = 0;
    this.bar = 0;
    this.next = t;
    const gp = this.out.gain;
    gp.cancelScheduledValues(t);
    gp.setValueAtTime(0, t);
    gp.linearRampToValueAtTime(1, t + Math.max(0.01, fade));
    // Rhodes suitcase autopan
    const lfo = ac.createOscillator();
    lfo.frequency.value = 0.18;
    const depth = ac.createGain();
    depth.gain.value = 0.3;
    lfo.connect(depth);
    depth.connect(this.panner.pan);
    lfo.start(t);
    this.lfo = lfo;
  }

  /** Fade out and stop scheduling. */
  stop(t: number, fade: number): void {
    if (!this.running) return;
    this.running = false;
    this.pending = null;
    const gp = this.out.gain;
    gp.cancelScheduledValues(t);
    gp.setValueAtTime(gp.value, t);
    gp.linearRampToValueAtTime(0, t + Math.max(0.01, fade));
    this.lfo?.stop(t + fade + 0.05);
    this.lfo = null;
  }

  /**
   * Downbeat "drop" accent at context time `t` (the bass boom): a hard kick, an E1 sub hit
   * through the bass drive and a crash, on the groove's own bus (ducks / filters apply).
   */
  accent(t: number): void {
    if (!this.running) return;
    const v = new Voice(this.g.ac, this.out, null, this.g.noise, t, this.random);
    kick(v, this.drums, t, { f0: 160, f1: 42, drop: 0.08, decay: 0.42, level: LEVEL.kick * 1.15, click: 0.3, clickFreq: 2600 });
    bass(v, this.bassIn, t, mtof(28), LEVEL.bass * 1.1, 0.42, 1);
    crash(v, this.drums, t, LEVEL.crash * 1.2, 1.8);
    v.finish(() => undefined);
  }

  /** Switch pattern on the next `quantum` boundary (16 = bar, 4 = beat). */
  setStem(stem: MusicStem, quantum = 16): void {
    if (!this.running) {
      this.stem = stem;
      this.pattern = PATTERNS[stem];
      this.table = COMPILED[stem];
      this.pending = null;
      this.trim.gain.value = this.pattern.gain * BUS_LEVELS.groove;
      return;
    }
    if (stem === this.stem && !this.pending) return;
    this.pending = stem === this.stem ? null : { stem, quantum };
  }

  /** Schedule every step that starts before `until` (context time). */
  schedule(until: number): void {
    if (!this.running) return;
    const now = this.g.ac.currentTime;
    // after a stall, drop steps that are already late instead of flamming them
    while (this.next < now - 0.02) this.advance();
    while (this.next < until) {
      this.applyPending();
      this.playStep(this.next);
      this.advance();
    }
  }

  private stepDur(): number {
    return 60 / this.pattern.bpm / 4;
  }

  private advance(): void {
    this.next += this.stepDur();
    this.pos = (this.pos + 1) % this.pattern.steps;
    if (this.pos % 16 === 0) this.bar++;
  }

  private applyPending(): void {
    const p = this.pending;
    if (!p || this.pos % p.quantum !== 0) return;
    this.stem = p.stem;
    this.pattern = PATTERNS[p.stem];
    this.table = COMPILED[p.stem];
    this.pending = null;
    this.pos = 0;
    this.bar = 0;
    this.crashNext = true;
    this.trim.gain.setTargetAtTime(this.pattern.gain * BUS_LEVELS.groove, this.next, 0.05);
  }

  private playStep(t0: number): void {
    const p = this.pattern;
    const e = this.table[this.pos];
    if (!e) return;
    const sd = this.stepDur();
    const barStep = this.pos % 16;
    const energy = Math.max(p.energy, this.energy);
    const rnd = this.random;
    const t = t0 + (this.pos % 2 === 1 ? p.swing * sd : 0);
    const human = (): number => (rnd() - 0.5) * 0.005;
    const velJ = (vel: number): number => vel * (0.94 + rnd() * 0.12);

    const fill = p.fillEvery > 0 && this.bar % p.fillEvery === p.fillEvery - 1 && barStep >= 13 ? [0.34, 0.5, 0.72][barStep - 13] ?? 0 : 0;
    const crashNow = (this.crashNext || (p.crashEvery > 0 && barStep === 0 && this.bar > 0 && this.bar % p.crashEvery === 0)) && barStep === 0;
    const shake = energy >= 1;
    const hype = energy >= 2 ? e.hypeHat : 0;
    const clavOn = energy >= 3 && e.clav;

    const any = e.kick || e.snare || e.hat || e.openHat || hype || e.bass || e.keys || clavOn || fill || crashNow || shake;
    if (!any) return;

    const v = new Voice(this.g.ac, this.out, null, this.g.noise, t, rnd);
    if (e.kick) kick(v, this.drums, t0, { f0: 150, f1: 48, drop: 0.06, decay: 0.26, level: LEVEL.kick * e.kick, click: 0.25, clickFreq: 3000 });
    const sn = Math.max(e.snare, fill);
    if (sn) snare(v, this.drums, t + (sn < 0.5 ? human() : 0), velJ(LEVEL.snare * sn), sn < 0.5 ? 0.1 : 0.17);
    if (e.openHat || hype) hat(v, this.drums, t + human(), velJ(LEVEL.hat * Math.max(e.openHat, hype)), true);
    else if (e.hat) hat(v, this.drums, t + human(), velJ(LEVEL.hat * e.hat));
    if (shake) shaker(v, this.drums, t + human(), velJ(LEVEL.shaker * (this.pos % 2 ? 0.9 : 0.5)));
    if (crashNow) {
      crash(v, this.drums, t0, LEVEL.crash, 1.6);
      this.crashNext = false;
    }
    if (e.bass) {
      const [, midi, len, vel] = e.bass;
      bass(v, this.bassIn, t, mtof(midi), LEVEL.bass * vel, len * sd * 0.85, 0.6 + vel * 0.5);
    }
    if (e.keys) {
      const [, midis, len, vel] = e.keys;
      midis.forEach((m, i) => rhodes(v, this.keys, t + i * 0.004, mtof(m), velJ(LEVEL.keys * vel), len * sd * 0.9));
    }
    if (clavOn && e.clav) {
      const [, midis, , vel] = e.clav;
      clav(v, v.pan(this.drums, -0.35), t, midis.map(mtof), velJ(LEVEL.clav * vel));
    }
    v.finish(() => undefined);
  }
}
