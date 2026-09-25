/**
 * Capture-script DSL. A script is JSON (or an .mjs module) of this shape:
 *
 *   { "name": "...", "viewport": "1920x1080", "fps": 60,
 *     "points":  { "spin": [0.5, 0.9], ... },          // named click targets, 0..1 of the canvas
 *     "regions": { "grid": [x, y, w, h], ... },        // analysis rects for timings.mjs (optional)
 *     "columns": 5,                                      // split regions.grid into N columns (optional)
 *     "steps": [ { "do": "...", ... }, ... ] }
 *
 * Steps (see README for the full table):
 *   waitReady {timeout, quietMs, minMs, response, canvasMinArea}
 *   frames {name, n | ms, every, notes, untilStill:{threshold, frames, minFrames}}
 *   wait {ms | n, name}     (advance time frame by frame, nothing captured)
 *   waitReal {ms}           (let the clock run in real time, then pause again)
 *   click {at, button, holdMs, note}  move {at}  wheel {at, dy, dx}  key {key, holdMs}
 *   screenshot {name, grid} note {text}  eval {js}  pause  resume
 *   repeat {times, start, steps:[...]}   — "{i}" in names = loop index (zero-padded)
 * An .mjs script may instead `export default async function (ref, ctx) {...}` using the same
 * verbs as methods: ref.frames('spin', 360, {every: 1}), ref.key('Space'), ref.click('spin'), …
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const VERBS = new Set(['waitReady', 'frames', 'wait', 'hold', 'waitReal', 'click', 'move', 'wheel', 'key', 'type', 'screenshot', 'note', 'eval', 'pause', 'resume', 'repeat', 'log']);

export async function loadScript(spec, scriptsDir) {
  let file = spec;
  if (!fs.existsSync(file)) {
    const cands = [path.join(scriptsDir, spec), path.join(scriptsDir, `${spec}.json`), path.join(scriptsDir, `${spec}.mjs`)];
    file = cands.find((c) => fs.existsSync(c));
    if (!file) throw new Error(`script not found: ${spec} (looked in ${scriptsDir})`);
  }
  file = path.resolve(file);
  if (/\.m?js$/.test(file)) {
    const mod = await import(pathToFileURL(file).href);
    const d = mod.default;
    if (typeof d === 'function') return { file, ...(mod.meta ?? {}), fn: d };
    return { file, ...d };
  }
  return { file, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
}

export function resolvePoint(at, points) {
  if (at == null || at === 'center') return [0.5, 0.5];
  if (Array.isArray(at) && at.length === 2) return at.map(Number);
  if (typeof at === 'object' && 'x' in at) return [Number(at.x), Number(at.y)];
  if (typeof at === 'string') {
    const p = points?.[at];
    if (!p) throw new Error(`unknown point "${at}" (define it in the script's "points" or with --point ${at}=x,y)`);
    return resolvePoint(p, points);
  }
  throw new Error(`bad point: ${JSON.stringify(at)}`);
}

/** Validate before launching a browser; returns a flat count of captured frames for the estimate. */
export function validate(steps, points, fps = 60, where = 'steps') {
  let frames = 0, captured = 0;
  if (!Array.isArray(steps)) throw new Error(`${where} must be an array`);
  steps.forEach((s, i) => {
    const w = `${where}[${i}]`;
    if (!s || typeof s !== 'object' || !VERBS.has(s.do)) throw new Error(`${w}: unknown "do": ${JSON.stringify(s?.do)} (one of ${[...VERBS].join(', ')})`);
    if (['click', 'move', 'wheel'].includes(s.do)) resolvePoint(s.at, points);
    if (s.do === 'key' && !s.key) throw new Error(`${w}: key step needs "key"`);
    if (s.do === 'frames') {
      const n = s.n ?? Math.round((s.ms ?? 0) / (1000 / fps));
      if (!(n > 0)) throw new Error(`${w}: frames step needs n or ms`);
      frames += n;
      captured += Math.ceil(n / Math.max(1, s.every ?? 1));
    }
    if (s.do === 'wait' || s.do === 'hold') frames += s.n ?? Math.round((s.ms ?? 0) / (1000 / fps));
    if (s.do === 'repeat') {
      const r = validate(s.steps, points, fps, `${w}.steps`);
      frames += r.frames * (s.times ?? 1);
      captured += r.captured * (s.times ?? 1);
    }
  });
  return { frames, captured };
}

export class Runner {
  constructor(driver, { points = {}, framesScale = 1, fps = 60, log = console.log } = {}) {
    this.d = driver;
    this.points = points;
    this.scale = framesScale;
    this.fps = fps;
    this.log = log;
  }

  n(step) {
    const n = step.n ?? Math.round((step.ms ?? 0) / (1000 / this.fps));
    return Math.max(1, Math.round(n * this.scale));
  }

  fmt(name, vars) {
    if (!name) return name;
    return String(name).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  }

  async run(steps, vars = {}) {
    for (const s of steps) await this.exec(s, vars);
  }

  async exec(s, vars) {
    const d = this.d;
    d.checkAbort();
    const at = () => resolvePoint(s.at, this.points);
    switch (s.do) {
      case 'waitReady':
        return d.waitReady(s);
      case 'frames':
        return d.frames({ name: this.fmt(s.name, vars), n: this.n(s), every: s.every ?? 1, notes: this.fmt(s.notes, vars), untilStill: s.untilStill });
      case 'wait':
      case 'hold':
        return d.wait({ n: this.n(s), name: this.fmt(s.name, vars) });
      case 'waitReal':
        return d.waitReal(s.ms ?? 1000);
      case 'click':
        return d.click(at(), { button: s.button, holdMs: s.holdMs, note: this.fmt(s.note, vars) ?? (typeof s.at === 'string' ? s.at : undefined) });
      case 'move':
        return d.move(at(), { note: this.fmt(s.note, vars) });
      case 'wheel':
        return d.wheel(at(), s.dy ?? 0, s.dx ?? 0, { note: this.fmt(s.note, vars) });
      case 'key':
        return d.key(s.key, { holdMs: s.holdMs, note: this.fmt(s.note, vars) });
      case 'type':
        await d.ensurePaused();
        await d.page.keyboard.type(String(s.text ?? ''));
        return d.logAction({ type: 'type', text: s.text });
      case 'screenshot':
        return d.screenshot(this.fmt(s.name, vars), { grid: s.grid });
      case 'note':
      case 'log':
        this.log(`  # ${this.fmt(s.text ?? s.msg ?? '', vars)}`);
        return d.note(this.fmt(s.text ?? s.msg ?? '', vars));
      case 'eval':
        return d.evalJs(s.js);
      case 'pause':
        return d.ensurePaused();
      case 'resume':
        return d.resume();
      case 'repeat': {
        const times = s.times ?? 1, start = s.start ?? 1;
        const width = String(start + times - 1).length < 2 ? 2 : String(start + times - 1).length;
        for (let k = 0; k < times; k++) {
          const i = start + k;
          await this.run(s.steps, { ...vars, i: String(i).padStart(width, '0') });
        }
        return;
      }
      default:
        throw new Error(`unknown step ${s.do}`);
    }
  }

  /** Method API for .mjs scripts. */
  api() {
    const d = this.d, r = this;
    return {
      page: d.page,
      driver: d,
      points: this.points,
      waitReady: (o) => d.waitReady(o),
      frames: (name, n, o = {}) => d.frames({ name, n: Math.max(1, Math.round(n * r.scale)), every: o.every ?? 1, notes: o.notes, untilStill: o.untilStill }),
      wait: (ms) => d.wait({ n: Math.max(1, Math.round((ms / (1000 / r.fps)) * r.scale)) }),
      waitReal: (ms) => d.waitReal(ms),
      click: (at, o) => d.click(resolvePoint(at, r.points), o),
      move: (at, o) => d.move(resolvePoint(at, r.points), o),
      wheel: (at, dy, dx, o) => d.wheel(resolvePoint(at, r.points), dy, dx, o),
      key: (k, o) => d.key(k, o),
      screenshot: (name, o) => d.screenshot(name, o),
      note: (t) => d.note(t),
      pause: () => d.ensurePaused(),
      resume: () => d.resume(),
      step: () => d.step(),
      run: (steps) => r.run(steps),
    };
  }
}
