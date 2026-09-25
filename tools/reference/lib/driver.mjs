/**
 * Capture driver: owns the virtual clock, frame stepping, input actions, segments and the
 * frame/shot index. The script runner (script.mjs) and JS scripts call these methods.
 *
 * Clock modes
 *   virtual     clock.install() BEFORE navigation (time flows naturally during boot); the first
 *               action/frames step pauses it and from then on every frame is exactly
 *               runFor(round-to-ms of 1000/fps) + one rAF flush. Default.
 *   after-boot  boot runs fully native; clock.install() on the live page at the first action.
 *   realtime    no clock; frames are whatever the browser renders (CDP screencast timestamps).
 *
 * Timeline: `frame` counts virtual frames since the first pause (frame 0); `t` is virtual ms
 * since frame 0 (= performance.now() delta in the page). Frame n is at t = round(n*1000/fps):
 * Playwright's clock has 1 ms resolution, so steps are 17,16,17,… ms and never drift.
 */
import fs from 'node:fs';
import path from 'node:path';
import { decodePng, downsample } from './png.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export class Aborted extends Error {}

export class Driver {
  constructor(o) {
    Object.assign(this, {
      page: o.page,
      context: o.context,
      outDir: o.outDir,
      mode: o.mode ?? 'virtual',
      fps: o.fps ?? 60,
      format: o.format ?? 'png',
      quality: o.quality ?? 90,
      net: o.net,
      netSync: o.netSync ?? true,
      netSyncTimeout: o.netSyncTimeout ?? 5000,
      clipMode: o.clip ?? 'viewport',
      log: o.log ?? console.log,
    });
    this.frameMs = 1000 / this.fps;
    this.frame = 0;
    this.ticks = null;
    this.ticks0 = null;
    this.anchor = null;
    this.paused = false;
    this.clockInstalled = this.mode === 'virtual';
    this.segments = [];
    this.actions = [];
    this.shots = [];
    this.framesIndex = [];
    this.warnings = [];
    this.aborted = false;
    this.wallStart = Date.now();
    this.canvas = null;
    this.stats = { steps: 0, captured: 0, netWaits: 0, netTimeouts: 0, timerErrors: 0 };
    this._warned = new Set();
    fs.mkdirSync(path.join(this.outDir, 'frames'), { recursive: true });
    fs.mkdirSync(path.join(this.outDir, 'shots'), { recursive: true });
  }

  warn(key, msg) {
    if (this._warned.has(key)) return;
    this._warned.add(key);
    this.warnings.push(msg);
    this.log(`  ! ${msg}`);
  }

  checkAbort() {
    if (this.aborted) throw new Aborted('aborted');
  }

  /** Current timeline position (used by the network logger too). */
  pos() {
    if (this.mode === 'realtime') {
      const t = Date.now() - this.wallStart;
      return { frame: Math.round(t / this.frameMs), t };
    }
    if (this.ticks0 == null) return { frame: null, t: null };
    return { frame: this.frame, t: this.ticks - this.ticks0 };
  }

  /** Virtual ms (since frame 0) of a frame on the current anchor's schedule. */
  tOf(frame) {
    return this.anchor.ticks + Math.round((frame - this.anchor.frame) * this.frameMs) - this.ticks0;
  }

  async evalAll(fn, arg) {
    for (const f of this.page.frames()) {
      try {
        await f.evaluate(fn, arg);
      } catch {}
    }
  }

  /* ------------------------------------------------------------------ clock */

  /** --clock after-boot: install Playwright's clock on the live page, keeping time monotonic. */
  async installLate() {
    const { dn, pn } = await this.page.evaluate(() => ({ dn: globalThis.__ref.nativeDateNow(), pn: globalThis.__ref.nativePerfNow() }));
    await this.evalAll(() => globalThis.__ref?.setManual(true));
    await this.evalAll(() => globalThis.__ref?.exposeInner(true));
    try {
      // wall time chosen so that after the pauseAt below both Date.now() and performance.now()
      // continue from their native values (Pixi's ticker ignores time going backwards).
      await this.context.clock.install({ time: dn - pn });
    } finally {
      await this.evalAll(() => globalThis.__ref?.exposeInner(false));
    }
    this.clockInstalled = true;
    const dn2 = await this.page.evaluate(() => globalThis.__ref.nativeDateNow());
    await this.page.clock.pauseAt(dn2 + 100);
  }

  async ensurePaused() {
    if (this.mode === 'realtime' || this.paused) return;
    if (!this.clockInstalled) {
      await this.installLate();
    } else {
      await this.evalAll(() => globalThis.__ref?.setManual(true));
      const now = await this.page.evaluate(() => Date.now());
      await this.page.clock.pauseAt(now + 100);
    }
    const ticks = await this.page.evaluate(() => performance.now());
    if (this.ticks0 == null) {
      this.ticks0 = ticks;
      this.frame = 0;
    } else {
      this.frame += Math.max(1, Math.ceil((ticks - this.ticks) / this.frameMs));
    }
    this.anchor = { frame: this.frame, ticks };
    this.ticks = ticks;
    this.paused = true;
    const st = await this.page.evaluate(() => globalThis.__ref?.stats());
    if (!st) this.warn('noshim', 'rAF shim missing in the page (game in a sandboxed frame?) — frame stepping falls back to the clock grid');
  }

  async resume() {
    if (this.mode === 'realtime' || !this.paused) return;
    await this.page.clock.resume();
    await this.evalAll(() => globalThis.__ref?.setManual(false));
    this.paused = false;
  }

  /** Yield a few real macrotasks in the page (NOT timers — those are frozen while paused). */
  async settleTasks(n = 3) {
    await this.page.evaluate(
      (k) =>
        new Promise((resolve) => {
          const ch = new MessageChannel();
          let left = k;
          ch.port1.onmessage = () => (--left > 0 ? ch.port2.postMessage(0) : resolve());
          ch.port2.postMessage(0);
        }),
      n,
    );
  }

  /** Advance exactly one frame: timers up to the frame time, then one rAF flush. */
  async step() {
    this.checkAbort();
    this.frame++;
    const target = this.anchor.ticks + Math.round((this.frame - this.anchor.frame) * this.frameMs);
    const dt = target - this.ticks;
    if (dt > 0) {
      try {
        await this.page.clock.runFor(dt);
      } catch (e) {
        this.stats.timerErrors++;
        this.warn('timererr', `a page timer threw during runFor (continuing): ${String(e.message ?? e).split('\n')[0]}`);
      }
    }
    this.ticks = target;
    if (this.netSync && this.net) {
      const waited = await this.net.waitIdle({ timeout: this.netSyncTimeout });
      if (waited > 0) {
        this.stats.netWaits++;
        await this.settleTasks(4);
      } else if (waited < 0) {
        this.stats.netTimeouts++;
        this.warn('nettimeout', `net-sync: a fetch/xhr stayed in flight > ${this.netSyncTimeout} ms; not waiting for it`);
      }
    }
    const frames = this.page.frames();
    if (frames.length === 1) await this.page.evaluate(() => globalThis.__ref?.flush());
    else await this.evalAll(() => globalThis.__ref?.flush());
    this.stats.steps++;
  }

  /* --------------------------------------------------------------- geometry */

  async findCanvas() {
    let best = null;
    for (const f of this.page.frames()) {
      let hs = [];
      try {
        hs = await f.$$('canvas');
      } catch {
        continue;
      }
      for (const h of hs) {
        const b = await h.boundingBox().catch(() => null);
        if (b && b.width * b.height > (best ? best.width * best.height : 0)) best = { x: b.x, y: b.y, width: b.width, height: b.height };
      }
    }
    if (best) this.canvas = best;
    return best;
  }

  viewport() {
    return this.page.viewportSize() ?? { width: 1920, height: 1080 };
  }

  /** Normalised canvas coords -> page CSS px. `at` = [x,y] (0..1 of the game canvas). */
  async toPage(at) {
    const c = (await this.findCanvas()) ?? { x: 0, y: 0, ...this.viewport() };
    return { x: c.x + at[0] * c.width, y: c.y + at[1] * c.height };
  }

  /* ----------------------------------------------------------------- output */

  clip() {
    if (this.clipMode !== 'canvas' || !this.canvas) return undefined;
    const c = this.canvas, v = this.viewport();
    const x = Math.max(0, Math.floor(c.x)), y = Math.max(0, Math.floor(c.y));
    return { x, y, width: Math.min(v.width - x, Math.round(c.width)), height: Math.min(v.height - y, Math.round(c.height)) };
  }

  ext() {
    return this.format === 'jpeg' ? 'jpg' : 'png';
  }

  async shoot(file, { full = false } = {}) {
    const opts = { path: file, type: this.format, clip: full ? undefined : this.clip(), animations: 'allow', caret: 'initial', scale: 'device', timeout: 120_000 };
    if (this.format === 'jpeg') opts.quality = this.quality;
    return this.page.screenshot(opts);
  }

  frameFile(frame) {
    return `frames/f${String(frame).padStart(5, '0')}.${this.ext()}`;
  }

  async captureFrame(seg) {
    const { frame, t } = this.pos();
    const rel = this.frameFile(frame);
    const buf = await this.shoot(path.join(this.outDir, rel));
    this.framesIndex.push({ file: rel, frame, t, seg: seg.index });
    seg.captured++;
    this.stats.captured++;
    return buf;
  }

  uniqueName(name) {
    const base = String(name || `seg${this.segments.length + 1}`).replace(/[^\w.-]+/g, '-');
    let n = base, k = 2;
    while (this.segments.some((s) => s.name === n)) n = `${base}-${k++}`;
    return n;
  }

  beginSegment({ name, type, every, notes }) {
    const p = this.pos();
    const seg = {
      index: this.segments.length + 1,
      name: this.uniqueName(name),
      type,
      every: every ?? 0,
      frameStart: type === 'realtime' ? p.frame : this.frame + 1,
      frameEnd: null,
      tStart: type === 'realtime' ? p.t : this.tOf(this.frame + 1),
      tEnd: null,
      captured: 0,
      notes: notes ?? undefined,
    };
    this.segments.push(seg);
    return seg;
  }

  endSegment(seg) {
    const p = this.pos();
    seg.frameEnd = p.frame;
    seg.tEnd = p.t;
    seg.durationMs = seg.type === 'realtime' ? seg.tEnd - seg.tStart : Math.round((seg.frameEnd - seg.frameStart + 1) * this.frameMs);
  }

  logAction(a) {
    const rec = { ...this.pos(), ...a };
    this.actions.push(rec);
    return rec;
  }

  /* ---------------------------------------------------------------- actions */

  async waitReady({ timeout = 120_000, quietMs = 1500, minMs = 0, response, canvasMinArea = 0.3, requireStill = false } = {}) {
    await this.resume();
    const start = Date.now();
    const v = this.viewport();
    let last = '';
    let blankChecks = 0;
    this.log(`  waiting for the game (canvas >= ${Math.round(canvasMinArea * 100)}% of the viewport${quietMs ? `, network quiet ${quietMs} ms` : ''}${response ? `, response ~ ${response}` : ''})`);
    while (true) {
      this.checkAbort();
      const c = await this.findCanvas().catch(() => null);
      const bigEnough = !!c && (c.width * c.height) / (v.width * v.height) >= canvasMinArea;
      const quiet = !quietMs || !this.net ? true : this.net.busy(['fetch', 'xhr', 'script', 'image', 'media', 'font', 'stylesheet', 'other'], 20_000) === 0 && Date.now() - this.net.lastActivity >= quietMs;
      const gotResponse = !response || (this.net && this.net.seen(response));
      let painted = false;
      if (bigEnough) {
        try {
          const buf = await this.page.screenshot({ type: 'png', clip: { x: c.x, y: c.y, width: Math.max(1, Math.min(c.width, v.width - c.x)), height: Math.max(1, Math.min(c.height, v.height - c.y)) }, scale: 'css', timeout: 30_000 });
          const img = downsample(decodePng(buf), 48);
          let s = 0, s2 = 0;
          for (let i = 0; i < img.data.length; i++) {
            s += img.data[i];
            s2 += img.data[i] * img.data[i];
          }
          const n = img.data.length;
          painted = Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)) > 6;
          if (!painted) blankChecks++;
        } catch {}
      }
      const state = `canvas=${bigEnough ? `${Math.round(c.width)}x${Math.round(c.height)}` : 'no'} painted=${painted} quiet=${quiet}${response ? ` response=${gotResponse}` : ''}`;
      if (state !== last) {
        this.log(`    ${((Date.now() - start) / 1000).toFixed(1)}s ${state}`);
        last = state;
      }
      if (bigEnough && painted && quiet && gotResponse && Date.now() - start >= minMs) break;
      if (Date.now() - start > timeout) {
        this.warn('readytimeout', `waitReady timed out after ${timeout} ms (${state}); continuing anyway`);
        break;
      }
      await sleep(250);
    }
    this.logAction({ type: 'ready', wall: Date.now() - this.wallStart, canvas: this.canvas });
  }

  /** Let the clock run in real time for `ms` (e.g. a mid-game loading screen), then pause again. */
  async waitReal(ms) {
    if (this.mode !== 'realtime') await this.resume();
    await sleep(ms);
    this.logAction({ type: 'waitReal', ms });
    if (this.mode !== 'realtime') await this.ensurePaused();
  }

  async wait({ ms, n, name } = {}) {
    const count = n ?? Math.max(1, Math.round((ms ?? 0) / this.frameMs));
    if (this.mode === 'realtime') {
      await sleep(count * this.frameMs);
      return;
    }
    await this.ensurePaused();
    const seg = this.beginSegment({ name: name ?? 'wait', type: 'hold', every: 0 });
    for (let i = 0; i < count; i++) await this.step();
    this.endSegment(seg);
  }

  async holdFrames(ms) {
    const n = Math.round((ms ?? 0) / this.frameMs);
    if (this.mode === 'realtime') return sleep(ms ?? 0);
    for (let i = 0; i < n; i++) await this.step();
  }

  async click(at, { button = 'left', holdMs = 0, note } = {}) {
    await this.ensurePaused();
    const p = await this.toPage(at);
    await this.page.mouse.move(p.x, p.y);
    await this.page.mouse.down({ button });
    await this.holdFrames(holdMs);
    await this.page.mouse.up({ button });
    this.logAction({ type: 'click', at, px: [Math.round(p.x), Math.round(p.y)], note });
  }

  async move(at, { note } = {}) {
    await this.ensurePaused();
    const p = await this.toPage(at);
    await this.page.mouse.move(p.x, p.y);
    this.logAction({ type: 'move', at, px: [Math.round(p.x), Math.round(p.y)], note });
  }

  async key(key, { holdMs = 0, note } = {}) {
    await this.ensurePaused();
    await this.page.keyboard.down(key);
    await this.holdFrames(holdMs);
    await this.page.keyboard.up(key);
    this.logAction({ type: 'key', key, note });
  }

  async wheel(at, dy = 0, dx = 0, { note } = {}) {
    await this.ensurePaused();
    const p = await this.toPage(at);
    await this.page.mouse.move(p.x, p.y);
    await this.page.mouse.wheel(dx, dy);
    this.logAction({ type: 'wheel', at, dx, dy, note });
  }

  async note(text) {
    this.logAction({ type: 'note', text });
  }

  async evalJs(js) {
    const r = await this.page.evaluate(js);
    this.logAction({ type: 'eval', js: js.slice(0, 200) });
    return r;
  }

  async screenshot(name, { grid = false } = {}) {
    const idx = this.shots.length + 1;
    const safe = String(name ?? 'shot').replace(/[^\w.-]+/g, '-');
    const rel = `shots/${String(idx).padStart(3, '0')}-${safe}.png`;
    if (!this.canvas) await this.findCanvas().catch(() => null);
    const saveFmt = this.format;
    this.format = 'png';
    try {
      await this.shoot(path.join(this.outDir, rel), { full: true });
    } finally {
      this.format = saveFmt;
    }
    const rec = { file: rel, name: safe, grid: !!grid, ...this.pos(), canvas: this.canvas };
    this.shots.push(rec);
    this.logAction({ type: 'screenshot', file: rel });
    return rec;
  }

  /* ----------------------------------------------------------------- frames */

  async frames({ name, n, every = 1, notes, untilStill } = {}) {
    every = Math.max(1, Math.round(every));
    if (this.mode === 'realtime') return this.framesRealtime({ name, n, every, notes });
    await this.ensurePaused();
    if (!this.canvas) await this.findCanvas().catch(() => null);
    const seg = this.beginSegment({ name, type: 'frames', every, notes });
    const t0 = Date.now();
    let prev = null, still = 0;
    const us = untilStill ? { threshold: 0.8, frames: 45, minFrames: 30, ...untilStill } : null;
    for (let i = 0; i < n; i++) {
      await this.step();
      if (i % every !== 0) continue;
      const buf = await this.captureFrame(seg);
      if (us && this.format === 'png') {
        const img = downsample(decodePng(buf), 160);
        if (prev) {
          let s = 0;
          for (let k = 0; k < img.data.length; k++) s += Math.abs(img.data[k] - prev.data[k]);
          const e = s / img.data.length;
          still = e < us.threshold ? still + every : 0;
          if (still >= us.frames && i + 1 >= us.minFrames) {
            seg.stoppedEarly = `still for ${still} frames (diff < ${us.threshold})`;
            break;
          }
        }
        prev = img;
      }
    }
    this.endSegment(seg);
    const wall = (Date.now() - t0) / 1000;
    this.log(`  [${seg.name}] frames ${seg.frameStart}-${seg.frameEnd} (${seg.durationMs} ms virtual, ${seg.captured} captured, ${wall.toFixed(1)} s wall${seg.stoppedEarly ? `, ${seg.stoppedEarly}` : ''})`);
    return seg;
  }

  async cdp() {
    if (!this._cdp) this._cdp = await this.context.newCDPSession(this.page);
    return this._cdp;
  }

  /** Realtime capture: CDP screencast (frame swap timestamps), falling back to a screenshot loop. */
  async framesRealtime({ name, n, every, notes }) {
    if (!this.canvas) await this.findCanvas().catch(() => null);
    const seg = this.beginSegment({ name, type: 'realtime', every, notes });
    const dur = n * this.frameMs;
    const got = [];
    let usedScreencast = false;
    try {
      const cdp = await this.cdp();
      const v = this.viewport();
      const onFrame = (ev) => {
        cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});
        got.push({ data: Buffer.from(ev.data, 'base64'), wall: (ev.metadata.timestamp ?? Date.now() / 1000) * 1000 });
      };
      cdp.on('Page.screencastFrame', onFrame);
      await cdp.send('Page.startScreencast', { format: this.format === 'jpeg' ? 'jpeg' : 'png', quality: this.quality, everyNthFrame: every, maxWidth: v.width * 4, maxHeight: v.height * 4 });
      usedScreencast = true;
      await sleep(dur);
      await cdp.send('Page.stopScreencast');
      cdp.off('Page.screencastFrame', onFrame);
    } catch (e) {
      this.warn('screencast', `screencast unavailable (${String(e.message ?? e).split('\n')[0]}); using a screenshot loop`);
    }
    if (!usedScreencast || !got.length) {
      const end = Date.now() + (usedScreencast ? 0 : dur);
      do {
        const wall = Date.now();
        got.push({ data: await this.page.screenshot({ type: this.format, quality: this.format === 'jpeg' ? this.quality : undefined, clip: this.clip() }), wall });
      } while (Date.now() < end);
    }
    let lastFrame = -1;
    for (const g of got) {
      const t = Math.round(g.wall - this.wallStart);
      const frame = Math.max(lastFrame + 1, Math.round(t / this.frameMs));
      lastFrame = frame;
      const rel = this.frameFile(frame);
      fs.writeFileSync(path.join(this.outDir, rel), g.data);
      this.framesIndex.push({ file: rel, frame, t, seg: seg.index });
      seg.captured++;
      this.stats.captured++;
    }
    this.frame = Math.max(lastFrame, this.pos().frame);
    this.endSegment(seg);
    const fpsGot = got.length / (dur / 1000);
    seg.realFps = Number(fpsGot.toFixed(1));
    this.log(`  [${seg.name}] realtime ${Math.round(dur)} ms: ${got.length} frames (${seg.realFps} fps${usedScreencast ? ', screencast' : ', screenshots'})`);
    return seg;
  }
}
