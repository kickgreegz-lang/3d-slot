// Shared helpers for the Dragonspire Frostfall study captures (STUDY ONLY: output stays in
// art/_reference/, never committed). Used by df-*.mjs next to this file.
//
// Control points are fractions of the game canvas, VERIFIED on the live demo (1280x720,
// 2026-09-26, runs s2-a-intro-idle and s2-i-explore: shots/*.grid.png). Override with
// --point name=x,y. Env knobs: DF_SPIN=click|key, DF_BIGWIN (x bet, default 10),
// DF_BUY="buy,buyPick,buyConfirm" (point names clicked in order to buy the bonus; the defaults
// below buy the $100-at-$1 DRAGON BONUS), DF_RENDER_ALL=1 (no render skip), DF_BTN_TOL.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = process.env.DF_REPO ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');
const { decodePng, downsample } = await import(pathToFileURL(path.join(REPO, 'tools/reference/lib/png.mjs')).href);

export const POINTS = {
  intro: [0.5, 0.958], // "PRESS TO CONTINUE" (blinking text under the three intro cards)
  spin: [0.735, 0.915], // big round spin button. Disabled (grey arrows) for the whole round,
  //                       so a 2nd click does nothing; Space starts a spin and slam-stops one
  autoplay: [0.797, 0.884], // small ring with a play arrow: opens a rounds panel (inf/10/25/50/
  //                       100/250/500/1000) above it; the spin button then shows a play icon;
  //                       clicking autoplay again closes the panel
  turbo: [0.797, 0.946], // lightning circle: 2-state toggle (white = normal, yellow = turbo); no
  //                       third ("super turbo") state, no toast
  betUp: [0.671, 0.896], // bet steps from the RGS betLevels ($1.00 -> $1.20)
  betDown: [0.671, 0.938],
  menu: [0.29, 0.915], // hamburger: popup with INFO, SFX and music sliders; becomes an X (close)
  info: [0.289, 0.714], // INFO row in the menu popup: full-screen rules/paytable, X at `close`
  close: [0.945, 0.085], // X top right of full-screen pages (info, buy menu, buy confirm)
  buy: [0.617, 0.915], // the BET box: opens the feature menu (Extra Chance $3 / Dragon's Call
  //                     $250 / Dragon's Call X $1000: ACTIVATE; Dragon Bonus $100 / Dragon
  //                     Super $500: BUY; prices at $1 bet)
  buyPick: [0.675, 0.592], // DRAGON BONUS "BUY" (4th card)
  buySuper: [0.85, 0.592], // DRAGON SUPER "BUY" (5th card)
  buyConfirm: [0.5, 0.758], // CONFIRM in the confirm card (X at `close` goes back one level)
  logo: [0.214, 0.915], // big yellow paperclip square: publisher badge, no action on click
  cont: [0.5, 0.45], // "continue" tap on feature screens (centre)
  resume: [0.572, 0.567], // "Resume Active Game?" dialog (unfinished round at load): Resume;
  //                         Cancel is at [0.427, 0.567]
};
export const REGIONS = {
  grid: [0.3, 0.141, 0.402, 0.705], // 5x5 cells, measured on the live demo: pitch 102.8 x 101.4 px at 1280x720 (was the s.22 still ROI [0.302,0.123,0.402,0.733])
  meter: [0.095, 0.17, 0.14, 0.27], // stone ring "0/35" (checked on the live demo)
  mini: [0.105, 0.5, 0.125, 0.3], // 5x5 position map under the dragon crest: shows each spin's powerup cells (X clear / W wild / snowflake freeze)
  hud: [0.24, 0.84, 0.62, 0.16],
  spinBtn: [0.707, 0.868, 0.055, 0.097], // inside the round spin button (luminance = enabled/disabled)
  ptc: [0.4, 0.945, 0.2, 0.03], // "PRESS TO CONTINUE" text band (intro, bonus intro/outro screens)
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

/* ---------------------------------------------------------- render skip */
// The game is a Pixi v8 WebGL app that costs ~1 s of SwiftShader GPU time per frame on the
// shared CPUs. While the clock is paused (manual stepping) every frame still runs the game's
// ticker (logic, tweens, Spine, timers: frame-exact), but the on-screen render of the stage is
// deferred and done only for frames that are looked at (captured frame, stillness sample,
// screenshot) or before an input event. Renders into render textures are never skipped.
// Needs window.__PIXI_APP__ (the Pixi devtools hook the game exposes). DF_RENDER_ALL=1 disables it.
export async function installRenderSkip(ref) {
  const d = ref.driver;
  if (env('DF_RENDER_ALL', '0') === '1' || d._dfSkip) return;
  const r = await d.page.evaluate(() => {
    const app = globalThis.__PIXI_APP__;
    const R = app?.renderer;
    if (!R || typeof R.render !== 'function') return 'no __PIXI_APP__.renderer';
    if (R.__refPatched) return 'ok (already)';
    const orig = R.render;
    let pending = null;
    const toScreen = (o) => o === app.stage || (!!o && typeof o === 'object' && !o.target && o.container === app.stage);
    R.render = function (...a) {
      if (globalThis.__ref?.stats().manual && toScreen(a[0])) {
        pending = a;
        return;
      }
      pending = null;
      return orig.apply(this, a);
    };
    globalThis.__refRenderNow = () => {
      if (!pending) return false;
      const a = pending;
      pending = null;
      orig.apply(R, a);
      return true;
    };
    R.__refPatched = true;
    return 'ok';
  });
  log(`render skip: ${r}`);
  if (!String(r).startsWith('ok')) return;
  d._dfSkip = true;
  const now = () => renderNow(ref);
  for (const k of ['shoot', 'click', 'key']) {
    const f = d[k].bind(d);
    d[k] = async (...a) => {
      await now();
      return f(...a);
    };
  }
  await ref.note('render skip on: the stage is rendered only for captured/sampled frames and before input (logic still steps every frame)');
}
export async function renderNow(ref) {
  const d = ref.driver;
  if (!d._dfSkip) return false;
  return d.page.evaluate(() => globalThis.__refRenderNow?.() ?? false);
}

/* ------------------------------------------------------------- stillness */
async function sample(ref, region) {
  const d = ref.driver;
  await renderNow(ref);
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

const AWAY = [0.5, 0.03]; // mouse parking spot (background above the frame): no hover on the HUD
const mean = (img) => {
  let s = 0;
  for (let i = 0; i < img.data.length; i++) s += img.data[i];
  return s / img.data.length;
};
/** Mean luminance of the spin button: ~157 enabled, ~197 disabled (grey arrows), ~232 hovered. */
export async function buttonLum(ref) {
  return mean(await sample(ref, REGIONS.spinBtn));
}
const BTN_TOL = Number(env('DF_BTN_TOL', 15));
/**
 * Share of bright pixels (mean RGB > 200) in the "PRESS TO CONTINUE" band at the bottom centre:
 * ~0.42 while the text shows (game intro, bonus intro, bonus end), 0.05-0.09 on the base-game HUD.
 */
export async function pressToContinue(ref) {
  const d = ref.driver;
  await renderNow(ref);
  const c = d.canvas ?? (await d.findCanvas());
  const [x, y, w, h] = REGIONS.ptc;
  const clip = { x: c.x + x * c.width, y: c.y + y * c.height, width: w * c.width, height: h * c.height };
  const img = decodePng(await d.page.screenshot({ type: 'png', clip, scale: 'css', animations: 'allow', timeout: 60_000 }));
  let n = 0, k = 0;
  for (let i = 0; i < img.data.length; i += 4, k++) if (img.data[i] + img.data[i + 1] + img.data[i + 2] > 600) n++;
  return n / k;
}
const PTC_ON = Number(env('DF_PTC', 0.25));
const enabledLum = (ref, lum) => {
  const c = ref.driver.dfCal ? ref.driver.dfCal.btn : 157;
  return c != null && Math.abs(lum - c) < BTN_TOL;
};

/** Measure idle motion of the grid and the full canvas plus the idle spin-button luminance. */
export async function calibrate(ref, ms = 1500) {
  const d = ref.driver;
  await d.ensurePaused();
  await ref.move(AWAY, { note: 'park the mouse (calibration)' });
  const g = [], f = [], b = [];
  let pg = null, pf = null;
  for (let i = 0; i < nf(ms); i++) {
    await d.step();
    if (i % 6) continue;
    const cg = await sample(ref, REGIONS.grid), cf = await sample(ref, [0, 0, 1, 1]);
    b.push(await buttonLum(ref));
    if (pg) g.push(diff(cg, pg)), f.push(diff(cf, pf));
    pg = cg, pf = cf;
  }
  const btn = pct(b, 0.5);
  const cal = { grid: Math.max(1.0, 2.5 * pct(g, 0.9)), full: Math.max(1.0, 2.5 * pct(f, 0.9)), btn, idleGrid: g, idleFull: f };
  if (!(btn > 135 && btn < 180)) {
    log(`WARNING spin button luminance at idle is ${btn.toFixed(1)} (expected ~157): round-end detection falls back to grid stillness`);
    cal.btn = null;
  }
  ref.driver.dfCal = cal;
  log(`calibrated: spin button idle lum ${btn.toFixed(1)}; still thresholds grid ${cal.grid.toFixed(2)} full ${cal.full.toFixed(2)} (idle p90 grid ${pct(g, 0.9).toFixed(2)}, full ${pct(f, 0.9).toFixed(2)})`);
  await ref.note(`calibration: spin button lum ${btn.toFixed(1)}, still thresholds grid ${cal.grid.toFixed(2)} full ${cal.full.toFixed(2)}`);
  return cal;
}

/** Step (no capture) until the spin button is enabled; returns the frames waited. */
export async function waitEnabled(ref, name, maxMs = 30_000) {
  const d = ref.driver;
  if (d.dfCal && d.dfCal.btn == null) return 0;
  await d.ensurePaused();
  if (enabledLum(ref, await buttonLum(ref))) return 0;
  const seg = d.beginSegment({ name: `${name}-wait-ready`, type: 'hold', every: 0, notes: 'spin button still disabled: waiting' });
  let i = 0;
  for (; i < nf(maxMs); i++) {
    await d.step();
    if (i % 6 === 5 && enabledLum(ref, await buttonLum(ref))) break;
  }
  d.endSegment(seg);
  log(`[${name}] waited ${Math.round((i + 1) * FMS)} ms for the spin button to enable${i >= nf(maxMs) ? ' (gave up)' : ''}`);
  return i + 1;
}

/**
 * Live intervention for long unattended segments: if the file named by DF_POKE exists, its
 * lines ("click x,y" | "pt <point>" | "key <Key>" | "note <text>") are executed at the next
 * check and the file is deleted. Every poke is logged as an action with a "poke" note.
 */
async function poke(ref, where) {
  const f = env('DF_POKE', '');
  if (!f || !fs.existsSync(f)) return;
  const lines = fs.readFileSync(f, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  fs.unlinkSync(f);
  for (const l of lines) {
    const [op, a, ...rest] = l.split(/\s+/);
    const note = `poke (${where}): ${l}`;
    log(note);
    if (op === 'click') await ref.click(a.split(',').map(Number), { note });
    else if (op === 'pt') await ref.click(a, { note });
    else if (op === 'key') await ref.key(a, { note });
    else if (op === 'note') await ref.note(`${a} ${rest.join(' ')}`);
    if (op === 'click' || op === 'pt') await ref.move(AWAY, {});
  }
}

/**
 * One segment from now until the round is over. every = 0 captures nothing (hunt).
 * Round over = the spin button is enabled again (calibrated idle luminance) for enabledMs
 * (default 250 ms) after minMs, then tailMs more. Without a button calibration it falls back to
 * grid stillness (stillMs under the calibrated threshold). A play response with a bonus (or a
 * payout >= DF_BIGWIN x) switches to feature mode: every `featureEvery`, the button must stay
 * enabled for 2 s, and a "continue" tap is sent when the whole canvas has been still for
 * `contStillMs` while the button is not enabled (press-to-continue screens).
 * seg.btn records the button state changes: [[frame offset, 'on'|'off', lum]].
 */
export async function capture(ref, name, o = {}) {
  const d = ref.driver;
  // preset = values calibrated on the s2 runs (1280x720), used before calibrate() ran
  const cal = d.dfCal ?? { grid: 7.9, full: 2.2, btn: 157 };
  const useBtn = cal.btn != null && o.endOn !== 'still';
  const st = {
    every: o.every ?? 3,
    minN: nf(o.minMs ?? 1500),
    maxN: nf(o.maxMs ?? 30_000),
    stillN: nf(o.stillMs ?? 700),
    enN: nf(o.enabledMs ?? 250),
    tailN: nf(o.tailMs ?? 1000),
    region: REGIONS.grid,
    thr: cal.grid,
    feature: false,
  };
  const checkEvery = o.checkEvery ?? 6;
  const playsBefore = o.playsBefore ?? plays(ref).length;
  await d.ensurePaused();
  if (!d.canvas) await d.findCanvas();
  const seg = d.beginSegment({ name, type: st.every ? 'frames' : 'hold', every: st.every, notes: o.notes });
  seg.btn = [];
  seg.ptc = []; // [frame offset, bright share] when a "press to continue" screen was seen
  let ptcOn = 0;
  let prev = null, still = 0, enabled = 0, lastState = null, doneAt = -1, lastCont = -1e9, info = null, i = 0, conts = 0;
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
    await poke(ref, seg.name);
    if (!info) {
      const p = o.startRound ?? plays(ref).slice(playsBefore).find((r) => r.response !== undefined);
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
          st.enN = nf(o.featureEnabledMs ?? 2000);
          seg.feature = info.bonus ? 'bonus' : 'bigwin';
          seg.type = 'frames';
          seg.every = st.every;
          log(`[${seg.name}] ${seg.feature.toUpperCase()} detected: mode ${info.mode} x${info.pm} events ${info.n} -> every ${st.every}, max ${Math.round((st.maxN * FMS) / 1000)} s`);
          await ref.note(`${seg.feature} detected in ${seg.name}: mode ${info.mode} x${info.pm}`);
          if (o.onFeature) await o.onFeature(info, st, seg);
        }
      }
    }
    if (useBtn) {
      const lum = await buttonLum(ref);
      const on = enabledLum(ref, lum);
      if (on !== lastState) seg.btn.push([i, on ? 'on' : 'off', Math.round(lum)]), (lastState = on);
      enabled = on ? enabled + checkEvery : 0;
    }
    // stillness: needed for the fallback end rule and for continue taps in feature mode
    if (!useBtn || st.feature) {
      const cur = await sample(ref, st.region);
      const e = diff(cur, prev);
      prev = cur;
      if (Number.isFinite(e)) still = e < st.thr ? still + checkEvery : 0;
    }
    if (!st.feature) {
      if ((useBtn ? enabled >= st.enN : still >= st.stillN) && i + 1 >= st.minN) doneAt = i;
      continue;
    }
    // "PRESS TO CONTINUE" on screen for contAfterMs (default 2 s, so the screen itself is
    // captured) -> tap the text. Fallback: whole canvas still for contStillMs -> tap the centre.
    const ptc = enabled ? 0 : await pressToContinue(ref);
    ptcOn = ptc >= PTC_ON ? ptcOn + checkEvery : 0;
    if (ptcOn && !seg.ptc.some((p) => i - p[0] < nf(3000))) seg.ptc.push([i, Math.round(ptc * 100) / 100]);
    const byText = ptcOn >= nf(o.contAfterMs ?? 2000);
    const byStill = still >= nf(o.contStillMs ?? 4000);
    if ((byText || byStill) && i - lastCont >= nf(3000) && !enabled) {
      const why = byText ? `"press to continue" shown ${Math.round(ptcOn * FMS)} ms` : `screen still ${Math.round(still * FMS)} ms`;
      await ref.click(byText ? 'intro' : 'cont', { note: `continue tap (${why}) in ${seg.name}` });
      log(`[${seg.name}] continue tap at +${Math.round(i * FMS)} ms (${why})`);
      await ref.move(AWAY, {});
      lastCont = i;
      still = 0;
      ptcOn = 0;
      conts++;
    }
    if ((useBtn ? enabled >= st.enN : still >= st.stillN) && i + 1 >= st.minN) doneAt = i;
  }
  d.endSegment(seg);
  if (conts) seg.continueTaps = conts;
  if (i >= st.maxN) seg.hitMax = true;
  else seg.stoppedEarly = useBtn ? `spin button enabled ${Math.round(st.enN * FMS)} ms + ${Math.round(st.tailN * FMS)} ms tail` : `idle (${st.feature ? 'full canvas' : 'grid'} still ${Math.round(st.stillN * FMS)} ms + ${Math.round(st.tailN * FMS)} ms tail)`;
  const firstOn = seg.btn.find((b, k) => k > 0 && b[1] === 'on');
  seg.roundMs = firstOn ? Math.round(firstOn[0] * FMS) : null; // press -> button enabled again (check grid: 6 frames)
  log(`[${seg.name}] ${seg.durationMs} ms virtual, round ${seg.roundMs ?? '?'} ms, ${seg.captured} captured, ${((Date.now() - t0) / 1000).toFixed(0)} s wall${seg.hitMax ? ' (HIT MAX)' : ''}${info ? ` · x${info.pm} ${info.n} events${info.bonus ? ' BONUS' : ''}` : ' · no play response seen'}`);
  return seg;
}

/**
 * Wait until the spin button is enabled, press spin (click or Space: DF_SPIN / o.pressWith),
 * park the mouse and capture until the round is over. quickMs: press again that many ms after
 * the first press, with o.quickWith ('key' = Space, the default; the button itself is disabled
 * while a round runs, so a second click does nothing).
 */
export async function spin(ref, name, o = {}) {
  await waitEnabled(ref, name);
  const playsBefore = plays(ref).length, endsBefore = endRounds(ref).length;
  const how = o.pressWith ?? env('DF_SPIN', 'click');
  const press = async (what, k) => (k === 'key' ? ref.key('Space', { note: `${name} ${what}` }) : ref.click('spin', { note: `${name} ${what}` }));
  await press('press', how);
  if (how !== 'key') await ref.move(AWAY, {});
  const qn = o.quickMs != null ? nf(o.quickMs) : -1;
  const quickWith = o.quickWith ?? 'key';
  const onFrame = qn > 0 ? async (i) => i === qn - 1 && press(`quick-stop press (+${o.quickMs} ms, ${quickWith})`, quickWith) : undefined;
  return capture(ref, name, { ...o, playsBefore, endsBefore, onFrame });
}

/** Boot, fail loudly on a dead session, grid screenshot of the intro. */
export async function boot(ref) {
  // the game polls /wallet/balance every ~5 s, so "network quiet" is rarely true: short quiet
  // window, bounded wait (the intro needs ~60-120 s of real time under SwiftShader to build)
  await ref.waitReady({ timeout: Number(env('DF_BOOT_MS', 150_000)), minMs: Number(env('DF_BOOT_MIN_MS', 60_000)), quietMs: 1200, response: '/wallet/authenticate', canvasMinArea: 0.3 });
  await netSettled(ref);
  const auth = rgs(ref).find((r) => r.endpoint === 'wallet-authenticate');
  if (!auth) throw new Error('no /wallet/authenticate call seen: the game did not reach its RGS');
  if (auth.status >= 400) throw new Error(`RGS authenticate failed: HTTP ${auth.status} ${JSON.stringify(auth.response)} (sessionID expired: get a fresh demo URL)`);
  await ref.waitReal(4000); // let the intro finish building in real time
  await installRenderSkip(ref);
  await ref.screenshot('intro', { grid: true });
}

/** Dismiss the intro (click "press to continue") and settle into the base game. */
export async function enterGame(ref, { captureMs = 0 } = {}) {
  await ref.click('intro', { note: 'press to continue' });
  // an unfinished round (e.g. a bonus cut off by an aborted run) comes back in authenticate and
  // the game replays it after the intro: capture it in full before calibrating
  const auth = rgs(ref).find((r) => r.endpoint === 'wallet-authenticate');
  const act = auth?.response?.round;
  if (act && act.active !== false && Array.isArray(act.state) && act.state.length) {
    const rec = { seq: auth.seq, response: { round: act } };
    const info = roundOf(rec);
    log(`authenticate returned an active round (mode ${info?.mode} x${info?.pm}, ${info?.n} events${info?.bonus ? ', bonus' : ''}): capturing the resume`);
    // the "Resume Active Game?" dialog comes ~0.9 s after the intro click: wait for its cyan
    // Resume button, then click it (the capture below starts with the click)
    const d = ref.driver;
    let seen = false;
    for (let i = 0; i < nf(10_000) && !seen; i++) {
      await d.step();
      if (i % 6 === 5) {
        const img = await sample(ref, [0.54, 0.55, 0.07, 0.03]);
        let g = 0, b = 0;
        for (let k = 0; k < img.data.length; k += 3) (g += img.data[k + 1]), (b += img.data[k + 2]);
        seen = g / (img.data.length / 3) > 180 && b / (img.data.length / 3) > 220;
      }
    }
    log(seen ? 'resume dialog seen: clicking Resume' : 'no resume dialog within 10 s');
    if (seen) await ref.click('resume', { note: 'Resume Active Game? -> Resume' });
    await ref.move(AWAY, {});
    await capture(ref, 'resume-round', { startRound: rec, forceFeature: true, every: 2, minMs: 5000, featureMaxMs: 420_000, notes: `round resumed after the intro (authenticate): mode ${info?.mode} x${info?.pm}` });
  }
  if (captureMs) await ref.frames('intro-dismiss', nf(captureMs), { every: 1, notes: 'intro out -> base game, every frame' });
  else await ref.wait(2500);
  await ref.screenshot('base-game', { grid: true });
  await calibrate(ref);
}

export async function toggleTurbo(ref, label) {
  await ref.click('turbo', { note: `turbo toggle (${label})` });
  await ref.move(AWAY, {});
  await ref.frames(`turbo-toggle-${label}`, nf(600), { every: 3 });
  await ref.screenshot(`turbo-${label}`, { grid: true });
}
