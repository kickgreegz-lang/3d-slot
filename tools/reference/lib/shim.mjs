/**
 * In-page shim, installed with context.addInitScript() so it runs at document start in every
 * frame, BEFORE any game script. It never changes behaviour on its own (pass-through); the
 * capture driver switches it to manual mode when it wants frame-exact stepping.
 *
 * Why a shim on top of Playwright's Clock API:
 *   Playwright's fake requestAnimationFrame fires on a fixed 16 ms grid (ticks % 16), so
 *   runFor(16.67) would sometimes run 0 or 2 game frames per captured frame and the rendered
 *   state would lag the capture time by 0..15 ms. The shim owns the rAF queue instead: in manual
 *   mode the driver advances the Playwright clock (timers, Date, performance.now) with runFor()
 *   and then flushes the rAF queue exactly once with timestamp = performance.now(). One game
 *   frame per captured frame, always.
 *
 * Pieces:
 *  - requestAnimationFrame / cancelAnimationFrame become accessor properties. Reads return the
 *    shim; writes (e.g. Playwright's clock installing its fake later) are captured as the
 *    "inner" implementation that drives the queue while NOT in manual mode. Code that caches
 *    `window.requestAnimationFrame` (GSAP does) therefore still goes through the shim.
 *  - Date.now indirection (only when the clock is not installed yet, i.e. --clock after-boot or
 *    realtime): libraries that cache `Date.now` at load (GSAP: `_getTime = Date.now`) keep
 *    following whatever `window.Date` is — so after a late clock.install() they see virtual time.
 *  - __ref.exposeInner(true) makes the accessor return the inner rAF; the driver sets it while a
 *    late clock.install() snapshots its "originals", so Playwright's own builtins stay native.
 */
export function pageShim() {
  const W = globalThis;
  if (W.__ref || typeof W.requestAnimationFrame !== 'function') return;
  const clockFirst = !!W.__pwClock;
  let innerRaf = W.requestAnimationFrame;
  let innerCaf = W.cancelAnimationFrame;
  let exposeInner = false;
  let manual = false;
  let pump = 0;
  let nextId = 1;
  let flushes = 0;
  let lastTs = 0;
  const queue = new Map();
  const report = (e) => {
    try {
      (W.reportError || W.console.error)(e);
    } catch {}
  };
  const run = (ts) => {
    lastTs = ts;
    const cbs = Array.from(queue.values());
    queue.clear();
    for (const cb of cbs) {
      try {
        cb(ts);
      } catch (e) {
        report(e);
      }
    }
    flushes++;
  };
  const schedule = () => {
    if (pump || manual || !queue.size) return;
    pump = innerRaf.call(W, (ts) => {
      pump = 0;
      if (manual) return; // manual mode: the driver flushes; ignore the stray inner frame
      run(ts);
      schedule();
    });
  };
  const raf = function requestAnimationFrame(cb) {
    if (typeof cb !== 'function') throw new TypeError("Failed to execute 'requestAnimationFrame': callback is not a function");
    const id = nextId++;
    queue.set(id, cb);
    schedule();
    return id;
  };
  const caf = function cancelAnimationFrame(id) {
    queue.delete(id);
  };
  Object.defineProperty(W, 'requestAnimationFrame', {
    configurable: true,
    enumerable: true,
    get: () => (exposeInner ? innerRaf : raf),
    set: (v) => {
      if (typeof v === 'function' && v !== raf) innerRaf = v;
    },
  });
  Object.defineProperty(W, 'cancelAnimationFrame', {
    configurable: true,
    enumerable: true,
    get: () => (exposeInner ? innerCaf : caf),
    set: (v) => {
      if (typeof v === 'function' && v !== caf) innerCaf = v;
    },
  });

  const ND = W.Date;
  const nativeDateNow = ND.now.bind(ND);
  const perf = W.performance;
  const nativePerfNow = perf.now.bind(perf);
  if (!ND.isFake) {
    let busy = false;
    ND.now = function now() {
      const D = W.Date;
      if (D === ND || busy || !D || typeof D.now !== 'function') return nativeDateNow();
      busy = true;
      try {
        return D.now();
      } finally {
        busy = false;
      }
    };
  }

  Object.defineProperty(W, '__ref', {
    configurable: true,
    enumerable: false,
    value: {
      version: 1,
      clockFirst,
      setManual(on) {
        manual = !!on;
        if (!manual) schedule();
        return queue.size;
      },
      /** Run every queued rAF callback once (callbacks queued meanwhile wait for the next flush). */
      flush(ts) {
        run(typeof ts === 'number' ? ts : W.performance.now());
        return queue.size;
      },
      pending: () => queue.size,
      exposeInner(on) {
        exposeInner = !!on;
      },
      stats: () => ({ manual, flushes, pending: queue.size, lastTs, clockFirst, clock: !!W.__pwClock }),
      /** Native (pre-clock) time sources, captured at document start. */
      nativeDateNow,
      nativePerfNow,
    },
  });
}
