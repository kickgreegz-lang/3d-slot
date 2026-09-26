// Shared helpers for the Dragonspire Frostfall study captures (STUDY ONLY: output stays in
// art/_reference/, never committed). Used by df-*.mjs next to this file.
//
// Control points are fractions of the game canvas. They were read off the user's 1079x607
// base-game screenshot (ref_dragon_2.png) and the intro screenshot (ref_dragon_1.png), NOT from
// a live probe (the demo session had expired). Verify them on shots/*.grid.png of df-a and
// override with --point name=x,y. Env knobs: DF_SPIN=click|key, DF_BIGWIN (x bet, default 10),
// DF_BUY="buy,buyPick,buyConfirm" (point names clicked in order to buy the bonus).
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = process.env.DF_REPO ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');
const { decodePng, downsample } = await import(pathToFileURL(path.join(REPO, 'tools/reference/lib/png.mjs')).href);

export const POINTS = {
  intro: [0.5, 0.955], // "PRESS TO CONTINUE" (intro screen, any click probably works)
  spin: [0.751, 0.914], // big round spin button, HUD right
  autoplay: [0.817, 0.873], // small circle above the lightning
  turbo: [0.817, 0.942], // lightning circle (turbo / quick spin)
  betUp: [0.684, 0.885],
  betDown: [0.684, 0.934],
  menu: [0.275, 0.906], // hamburger in the HUD bar
  buy: [0.196, 0.909], // big yellow paperclip square left of the HUD bar: bonus buy OR publisher button (unverified)
  cont: [0.5, 0.45], // "continue" tap on feature screens (centre)
  close: [0.95, 0.07],
};
export const REGIONS = {
  grid: [0.302, 0.123, 0.402, 0.733], // 5x5 reel area (DESIGN.md s.22 ROI)
  meter: [0.095, 0.17, 0.14, 0.27], // stone ring "0/35"
  mini: [0.105, 0.5, 0.125, 0.3], // mini blue 5-col grid under the dragon crest
  hud: [0.24, 0.84, 0.62, 0.16],
};
export const meta = { viewport: '1280x720', points: POINTS, regions: REGIONS, columns: 5 };

const FMS = 1000 / 60;
export const nf = (ms) => Math.max(1, Math.round(ms / FMS));
const env = (k, d) => process.env[k] ?? d;
const BIGWIN = Number(env('DF_BIGWIN', 10));
const log = (...a) => console.log('   ', ...a);

/* ------------------------------------------------------------------ RGS */
export const rgs = (ref) => ref.driver.net.rgs;
export const plays = (ref) => rgs(ref).filter((r) => r.endpoint === 'wallet-play');
export const endRounds = (ref) => rgs(ref).filter((r) => r.endpoint === 'wallet-end-round');
export async function netSettled(ref) {
  await Promise.allSettled([...ref.driver.net.pending]);
}
/** Summary of a play response: mode, payout multiplier, book event types, bonus flag. */
export function roundOf(rec) {
  const res = rec?.response;
  if (!res || typeof res !== 'object') return null;
  const r = res.round ?? res;
  const evs = Array.isArray(r.state) ? r.state : Array.isArray(r.events) ? r.events : [];
  const types = evs.map((e) => (e && typeof e === 'object' ? e.type ?? '?' : typeof e));
  const bonus = types.some((t) => /free|bonus|feature|trigger|scatter/i.test(t)) || (!!r.mode && !/^base$/i.test(String(r.mode)));
  return { mode: r.mode ?? null, pm: Number(r.payoutMultiplier ?? 0), active: r.active ?? null, n: evs.length, types, bonus };
}

/* ------------------------------------------------------------- stillness */
async function sample(ref, region) {
  const d = ref.driver;
  const c = d.canvas ?? (await d.findCanvas());
  const [x, y, w, h] = region;
  const clip = { x: c.x + x * c.width, y: c.y + y * c.height, width: Math.max(1, w * c.width), height: Math.max(1, h * c.height) };
  const buf = await d.page.screenshot({ type: 'png', clip, scale: 'css', animations: 'allow', timeout: 60_000 });
  return downsample(decodePng(buf), 64);
}
function diff(a, b) {
  if (!a || !b || a.data.length !== b.data.length) return Infinity;
  let s = 0;
  for (let i = 0; i < a.data.length; i++) s += Math.abs(a.data[i] - b.data[i]);
  return s / a.data.length;
}
const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0;
};

/** Measure idle motion of the grid and the full canvas (no capture) and set thresholds. */
export async function calibrate(ref, ms = 1500) {
  const d = ref.driver;
  await d.ensurePaused();
  const g = [], f = [];
  let pg = null, pf = null;
  for (let i = 0; i < nf(ms); i++) {
    await d.step();
    if (i % 6) continue;
    const cg = await sample(ref, REGIONS.grid), cf = await sample(ref, [0, 0, 1, 1]);
    if (pg) g.push(diff(cg, pg)), f.push(diff(cf, pf));
    pg = cg, pf = cf;
  }
  const cal = { grid: Math.max(1.0, 2.5 * pct(g, 0.9)), full: Math.max(1.0, 2.5 * pct(f, 0.9)), idleGrid: g, idleFull: f };
  ref.driver.dfCal = cal;
  log(`calibrated still thresholds: grid ${cal.grid.toFixed(2)} full ${cal.full.toFixed(2)} (idle p90 grid ${pct(g, 0.9).toFixed(2)}, full ${pct(f, 0.9).toFixed(2)})`);
  await ref.note(`still thresholds grid ${cal.grid.toFixed(2)} full ${cal.full.toFixed(2)}`);
  return cal;
}

/**
 * One segment from now until the game is idle again. every = 0 captures nothing (hunt).
 * Ends after minMs once the grid diff stayed under the calibrated threshold for stillMs, then
 * keeps tailMs more. A play response with a bonus (or payout >= DF_BIGWIN x) switches the
 * segment to feature mode: every `featureEvery`, full-canvas stillness, end-round required,
 * and a "continue" tap only after the whole canvas has been still for `contStillMs`.
 */
export async function capture(ref, name, o = {}) {
  const d = ref.driver;
  const cal = d.dfCal ?? { grid: 1.5, full: 1.5 };
  const st = {
    every: o.every ?? 3,
    minN: nf(o.minMs ?? 1500),
    maxN: nf(o.maxMs ?? 30_000),
    stillN: nf(o.stillMs ?? 700),
    tailN: nf(o.tailMs ?? 1000),
    region: REGIONS.grid,
    thr: cal.grid,
    feature: false,
  };
  const checkEvery = o.checkEvery ?? 6;
  const playsBefore = o.playsBefore ?? plays(ref).length;
  const endsBefore = o.endsBefore ?? endRounds(ref).length;
  await d.ensurePaused();
  if (!d.canvas) await d.findCanvas();
  const seg = d.beginSegment({ name, type: st.every ? 'frames' : 'hold', every: st.every, notes: o.notes });
  let prev = null, still = 0, fullStill = 0, prevFull = null, doneAt = -1, lastCont = -1e9, info = null, i = 0, peak = 0;
  const t0 = Date.now();
  for (; i < st.maxN; i++) {
    await d.step();
    if (st.every && i % st.every === 0) await d.captureFrame(seg);
    if (o.onFrame) await o.onFrame(i, seg, st);
    if (doneAt >= 0) {
      if (i - doneAt >= st.tailN) break;
      continue;
    }
    if (i % checkEvery) continue;
    if (!info) {
      const p = plays(ref).slice(playsBefore).find((r) => r.response !== undefined);
      if (p) {
        info = roundOf(p);
        seg.round = { seq: p.seq, ...info, types: undefined, typeCounts: info ? Object.fromEntries([...new Set(info.types)].map((t) => [t, info.types.filter((x) => x === t).length])) : null };
        if (info && (info.bonus || info.pm >= BIGWIN || o.forceFeature)) {
          st.feature = true;
          st.every = o.featureEvery ?? (st.every ? Math.min(st.every, 2) : 2);
          st.maxN = Math.max(st.maxN, nf(o.featureMaxMs ?? (info.bonus ? 360_000 : 90_000)));
          st.region = [0, 0, 1, 1];
          st.thr = cal.full;
          st.stillN = nf(2000);
          seg.feature = info.bonus ? 'bonus' : 'bigwin';
          seg.type = 'frames';
          seg.every = st.every;
          log(`[${seg.name}] ${seg.feature.toUpperCase()} detected: mode ${info.mode} x${info.pm} events ${info.n} -> every ${st.every}, max ${Math.round((st.maxN * FMS) / 1000)} s`);
          await ref.note(`${seg.feature} detected in ${seg.name}: mode ${info.mode} x${info.pm}`);
          if (o.onFeature) await o.onFeature(info, st, seg);
        }
      }
    }
    const cur = await sample(ref, st.region);
    const e = diff(cur, prev);
    prev = cur;
    if (!Number.isFinite(e)) continue;
    peak = Math.max(peak, e);
    still = e < st.thr ? still + checkEvery : 0;
    if (!st.feature) {
      if (still >= st.stillN && i + 1 >= st.minN) doneAt = i;
      continue;
    }
    // feature mode: full-canvas stillness; tap "continue" when waiting; end after end-round
    const ended = endRounds(ref).length > endsBefore;
    if (still >= nf(o.contStillMs ?? 4000) && i - lastCont >= nf(5000) && !(ended && still >= st.stillN)) {
      await ref.click('cont', { note: `continue tap (screen still ${Math.round(still * FMS)} ms) in ${seg.name}` });
      lastCont = i;
      still = 0;
    }
    if (ended && still >= st.stillN && i + 1 >= st.minN) doneAt = i;
  }
  d.endSegment(seg);
  if (i >= st.maxN) seg.hitMax = true;
  else seg.stoppedEarly = `idle (${st.feature ? 'full canvas' : 'grid'} still ${Math.round(st.stillN * FMS)} ms + ${Math.round(st.tailN * FMS)} ms tail)`;
  log(`[${seg.name}] ${seg.durationMs} ms virtual, ${seg.captured} captured, ${((Date.now() - t0) / 1000).toFixed(0)} s wall${seg.hitMax ? ' (HIT MAX)' : ''}${info ? ` · x${info.pm} ${info.n} events${info.bonus ? ' BONUS' : ''}` : ' · no play response seen'}`);
  return seg;
}

/** Press spin (click or Space) and capture until idle. quickMs: press again that many ms later. */
export async function spin(ref, name, o = {}) {
  const playsBefore = plays(ref).length, endsBefore = endRounds(ref).length;
  const press = async (what) => (env('DF_SPIN', 'click') === 'key' ? ref.key('Space', { note: `${name} ${what}` }) : ref.click('spin', { note: `${name} ${what}` }));
  await press('press');
  const qn = o.quickMs != null ? nf(o.quickMs) : -1;
  const onFrame = qn > 0 ? async (i) => i === qn - 1 && press(`quick-stop press (+${o.quickMs} ms)`) : undefined;
  return capture(ref, name, { ...o, playsBefore, endsBefore, onFrame });
}

/** Boot, fail loudly on a dead session, grid screenshot of the intro. */
export async function boot(ref) {
  await ref.waitReady({ timeout: 300_000, quietMs: 2500, response: '/wallet/authenticate', canvasMinArea: 0.3 });
  await netSettled(ref);
  const auth = rgs(ref).find((r) => r.endpoint === 'wallet-authenticate');
  if (!auth) throw new Error('no /wallet/authenticate call seen: the game did not reach its RGS');
  if (auth.status >= 400) throw new Error(`RGS authenticate failed: HTTP ${auth.status} ${JSON.stringify(auth.response)} (sessionID expired: get a fresh demo URL)`);
  await ref.waitReal(4000); // let the intro finish building in real time
  await ref.screenshot('intro', { grid: true });
}

/** Dismiss the intro (click "press to continue") and settle into the base game. */
export async function enterGame(ref, { captureMs = 0 } = {}) {
  await ref.click('intro', { note: 'press to continue' });
  if (captureMs) await ref.frames('intro-dismiss', nf(captureMs), { every: 1, notes: 'intro out -> base game, every frame' });
  else await ref.wait(2500);
  await ref.screenshot('base-game', { grid: true });
  await calibrate(ref);
}

export async function toggleTurbo(ref, label) {
  await ref.click('turbo', { note: `turbo toggle (${label})` });
  await ref.frames(`turbo-toggle-${label}`, nf(600), { every: 3 });
  await ref.screenshot(`turbo-${label}`, { grid: true });
}
