/**
 * SWAMP FUNK: BASS DROP — round simulator that writes Stake book events.
 *
 * One RoundSim = one book. Rules (all numbers in config.mjs):
 *  - 6x6 cluster pays (5+ orthogonal, W substitutes, pure-wild groups pay nothing), tumbles
 *    with the Stake web-sdk refill rule: per reel combined = newSymbols ++ survivors of the
 *    8 padded slots, newSymbols taken from the reel strip directly above the current stop.
 *  - GROOVE METER += exploding count after every winInfo; each crossed drop threshold emits
 *    one wildDrop AFTER the tumbleBoard refill; each wild replaces the symbol at its cell.
 *  - base round end: meter >= 60 -> Mega Mix (super), >= 40 -> Juke Jam (bonus).
 *  - features start with a fresh meter (0) that persists across their free spins; the
 *    upgrade to Mega Mix restarts it at 0. Drop thresholds are 10..60 only.
 *  - Juke Jam: drop wilds x2..x5; win = base pay x sum of the multiplier wilds in the cluster;
 *    meter >= 60 at the end of a free spin -> featureUpgrade to Mega Mix (+4 spins, once).
 *  - Mega Mix: drop wilds x2..x10; the first FEATURES.super.maxSticky of them are STICKY (later
 *    ones are one-shot): the cell a sticky wild dropped on is its home for the rest of the feature. Inside a spin it behaves like any wild (explodes when it wins, counts
 *    for the meter, falls with gravity); every later free-spin reveal re-places it at its home
 *    (the reveal board holds it, stickyWilds lists the set). Each winInfo it is part of adds +1
 *    to its multiplier (cap x25) from the next reveal on. Later drops never land on a home.
 *  - win cap: the round total is truncated to WINCAP and the round stops (no tumbleBoard after
 *    the capping winInfo, no further spins / features).
 */
import {
  BASE_WILD_MULT,
  FEATURES,
  GRID,
  METER,
  MIN_CLUSTER,
  PAY_SYMBOLS,
  REELSETS,
  STRIP_SEED,
  WILD,
  WINCAP,
  crossedThresholds,
  payFor,
  winLevel,
  wildsForThreshold,
} from './config.mjs';
import { createRng } from './rng.mjs';

const R = GRID.reels;
const PR = GRID.paddedRows;
const V0 = GRID.firstVisibleRow;
const V1 = GRID.lastVisibleRow;

/**
 * Reel strips per reelset (deterministic): each symbol's count is split into runs (vertical
 * stacks of 1..n, REELSETS[set].runs weights), the runs are shuffled, and a run that would sit
 * next to a run of the same symbol merges into it. Stacks are what make 6x6 clusters and long
 * tumble chains frequent enough.
 */
export const buildStrips = () => {
  const out = {};
  for (const [set, def] of Object.entries(REELSETS)) {
    out[set] = [];
    for (let reel = 0; reel < R; reel++) {
      const rng = createRng(STRIP_SEED, set, reel);
      const runs = [];
      for (const [sym, n] of Object.entries(def.counts)) {
        let left = n;
        while (left > 0) {
          const len = Math.min(left, Number(rng.weighted(sym === WILD ? { 1: 1 } : def.runs)));
          runs.push({ sym, len });
          left -= len;
        }
      }
      rng.shuffle(runs);
      const strip = [];
      for (const { sym, len } of runs) for (let i = 0; i < len; i++) strip.push(sym);
      out[set].push(strip);
    }
  }
  return out;
};

/** cell: {name} or a wild {name:'W', wild, mult, sticky: false | its Mega Mix registry entry} */
const plainCell = (name) => (name === WILD ? { name: WILD, wild: true, mult: BASE_WILD_MULT, sticky: false } : { name });

/** engine cell -> book RawSymbol */
export const rawSymbol = (c) => {
  if (!c.wild) return { name: c.name };
  return c.mult > 1 ? { name: WILD, wild: true, multiplier: c.mult } : { name: WILD, wild: true };
};

const rawBoard = (board) => board.map((col) => col.map(rawSymbol));

/**
 * All paying clusters of the visible board, scan order reel-major / row-down, BFS order inside.
 * @returns {{symbol:string, cells:{reel:number,row:number}[]}[]}
 */
export const findClusters = (board) => {
  const clusters = [];
  const seen = {};
  for (const s of PAY_SYMBOLS) seen[s] = new Uint8Array(R * PR);
  for (let reel = 0; reel < R; reel++) {
    for (let row = V0; row <= V1; row++) {
      const c = board[reel][row];
      if (c.wild) continue;
      const sym = c.name;
      const mark = seen[sym];
      if (mark[reel * PR + row]) continue;
      const cells = [];
      const queue = [[reel, row]];
      mark[reel * PR + row] = 1;
      while (queue.length) {
        const [r0, w0] = queue.shift();
        cells.push({ reel: r0, row: w0 });
        for (const [dr, dw] of [
          [0, -1],
          [1, 0],
          [0, 1],
          [-1, 0],
        ]) {
          const r1 = r0 + dr;
          const w1 = w0 + dw;
          if (r1 < 0 || r1 >= R || w1 < V0 || w1 > V1) continue;
          if (mark[r1 * PR + w1]) continue;
          const n = board[r1][w1];
          if (n.name !== sym && !n.wild) continue;
          mark[r1 * PR + w1] = 1;
          queue.push([r1, w1]);
        }
      }
      if (cells.length >= MIN_CLUSTER) clusters.push({ symbol: sym, cells });
    }
  }
  return clusters;
};

/** cluster cell nearest to the cluster centroid (win label anchor) */
const overlayCell = (cells) => {
  let cx = 0;
  let cy = 0;
  for (const p of cells) {
    cx += p.reel;
    cy += p.row;
  }
  cx /= cells.length;
  cy /= cells.length;
  let best = cells[0];
  let bestD = Infinity;
  for (const p of cells) {
    const d = (p.reel - cx) ** 2 + (p.row - cy) ** 2;
    if (d < bestD - 1e-9) {
      bestD = d;
      best = p;
    }
  }
  return { reel: best.reel, row: best.row };
};

/** Priced wins of a board (winInfo.wins shape). */
export const evaluateBoard = (board) =>
  findClusters(board).map(({ symbol, cells }) => {
    let wildMult = 0;
    for (const p of cells) {
      const c = board[p.reel][p.row];
      if (c.wild && c.mult > 1) wildMult += c.mult;
    }
    const clusterMult = wildMult > 0 ? wildMult : 1;
    const base = payFor(symbol, cells.length);
    return {
      symbol,
      clusterSize: cells.length,
      win: base * clusterMult,
      positions: cells.map((p) => ({ reel: p.reel, row: p.row })),
      meta: {
        globalMult: 1,
        clusterMult,
        winWithoutMult: base,
        overlay: overlayCell(cells),
        wildMult,
      },
    };
  });

export class RoundSim {
  /**
   * @param {{strips: Record<string,string[][]>, rng: ReturnType<typeof createRng>}} opts
   */
  constructor({ strips, rng }) {
    this.strips = strips;
    this.rng = rng;
    this.events = [];
    this.roundTotal = 0;
    this.baseWin = 0;
    this.fsWin = 0;
    this.capped = false;
    /** 'base' | 'bonus' | 'super' */
    this.phase = 'base';
    this.meter = 0;
    /** Mega Mix sticky registry: home cell + current multiplier, {reel,row,multiplier}[] */
    this.sticky = [];
    this.board = null;
    this.stops = null;
    this.summary = {
      baseTumbles: 0,
      baseMeter: 0,
      baseDrops: 0,
      feature: null,
      upgraded: false,
      fsSpins: 0,
      fsTumbles: 0,
      featureMeter: 0,
      drops: 0,
      wildsDropped: 0,
      maxSticky: 0,
      maxStickyMult: 0,
      maxClusterMult: 1,
      maxTumbles: 0,
      /** winning clusters that used a bass-drop wild (base / free spins) */
      baseDropWildWins: 0,
      fsDropWildWins: 0,
      /** winning clusters with a multiplier (wildMult > 0) */
      multWins: 0,
      /** sticky multiplier increments */
      stickyGrowths: 0,
    };
  }

  emit(type, payload) {
    this.events.push({ index: this.events.length, type, ...payload });
  }

  /** One base or free spin: reveal, tumble loop, setWin/setTotalWin. Returns the spin win. */
  spin(gameType, reelset) {
    const strips = this.strips[reelset];
    this.stops = strips.map((s) => this.rng.int(s.length));
    this.board = strips.map((s, reel) => {
      const col = [];
      for (let row = 0; row < PR; row++) col.push(plainCell(s[(this.stops[reel] + row) % s.length]));
      return col;
    });
    if (this.phase === 'super') {
      for (const w of this.sticky) {
        this.board[w.reel][w.row] = { name: WILD, wild: true, mult: w.multiplier, sticky: w, dropped: true };
      }
    }
    this.emit('reveal', {
      board: rawBoard(this.board),
      paddingPositions: [...this.stops],
      gameType,
      anticipation: new Array(R).fill(0),
    });
    if (this.phase === 'super') this.emit('stickyWilds', { wilds: this.sticky.map((w) => ({ ...w })) });

    let spinWin = 0;
    let tumbles = 0;
    for (;;) {
      const wins = evaluateBoard(this.board);
      if (!wins.length) break;
      const stepWin = wins.reduce((a, w) => a + w.win, 0);
      for (const w of wins) {
        this.summary.maxClusterMult = Math.max(this.summary.maxClusterMult, w.meta.clusterMult);
        if (w.meta.wildMult > 0) this.summary.multWins++;
        if (w.positions.some((p) => this.board[p.reel][p.row].dropped)) {
          if (gameType === 'basegame') this.summary.baseDropWildWins++;
          else this.summary.fsDropWildWins++;
        }
      }
      this.emit('winInfo', { totalWin: stepWin, wins });

      // every winning cell explodes (wilds included); sticky wilds grow for their next respawn
      const explode = new Set();
      const stickyHit = new Set();
      for (const w of wins) {
        for (const p of w.positions) {
          explode.add(p.reel * PR + p.row);
          const { sticky } = this.board[p.reel][p.row];
          if (sticky) stickyHit.add(sticky);
        }
      }
      const exploding = [...explode].sort((a, b) => a - b).map((k) => ({ reel: Math.floor(k / PR), row: k % PR }));
      const prev = this.meter;
      this.meter += exploding.length;
      const thresholds = crossedThresholds(prev, this.meter, this.phase);
      this.emit('meterUpdate', { value: this.meter, delta: exploding.length, thresholds });

      spinWin += stepWin;
      if (this.roundTotal + spinWin >= WINCAP) {
        spinWin = WINCAP - this.roundTotal;
        this.capped = true;
        this.emit('updateTumbleWin', { amount: spinWin });
        this.emit('wincap', { amount: WINCAP });
        break;
      }
      this.emit('updateTumbleWin', { amount: spinWin });

      for (const entry of stickyHit) {
        const grown = Math.min(FEATURES.super.multCap, entry.multiplier + FEATURES.super.growPerWin);
        if (grown > entry.multiplier) this.summary.stickyGrowths++;
        entry.multiplier = grown;
        this.summary.maxStickyMult = Math.max(this.summary.maxStickyMult, entry.multiplier);
      }

      this.tumble(exploding, strips);
      tumbles++;
      for (const t of thresholds) this.wildDrop(t);
    }

    if (spinWin > 0) this.emit('setWin', { amount: spinWin, winLevel: winLevel(spinWin, 'standard') });
    this.roundTotal += spinWin;
    this.emit('setTotalWin', { amount: this.roundTotal });

    this.summary.maxSticky = Math.max(this.summary.maxSticky, this.sticky.length);
    this.summary.maxTumbles = Math.max(this.summary.maxTumbles, tumbles);
    if (gameType === 'basegame') this.summary.baseTumbles = tumbles;
    else this.summary.fsTumbles += tumbles;
    return spinWin;
  }

  /** Stake web-sdk tumble: survivors fall, new symbols from the strip directly above the stop. */
  tumble(exploding, strips) {
    const gone = Array.from({ length: R }, () => new Set());
    for (const p of exploding) gone[p.reel].add(p.row);
    const newSymbols = [];
    for (let reel = 0; reel < R; reel++) {
      const k = gone[reel].size;
      const strip = strips[reel];
      const survivors = this.board[reel].filter((_, row) => !gone[reel].has(row));
      this.stops[reel] = (((this.stops[reel] - k) % strip.length) + strip.length) % strip.length;
      const added = [];
      for (let i = 0; i < k; i++) added.push(plainCell(strip[(this.stops[reel] + i) % strip.length]));
      newSymbols.push(added.map(rawSymbol));
      this.board[reel] = [...added, ...survivors];
    }
    this.emit('tumbleBoard', { newSymbols, explodingSymbols: exploding });
  }

  /** BASS DROP: wilds replace random non-wild visible cells of the refilled board. */
  wildDrop(threshold) {
    const n = wildsForThreshold(threshold, this.phase);
    const homes = new Set(this.sticky.map((w) => w.reel * PR + w.row));
    const cand = [];
    for (let reel = 0; reel < R; reel++) {
      for (let row = V0; row <= V1; row++) {
        if (!this.board[reel][row].wild && !homes.has(reel * PR + row)) cand.push({ reel, row });
      }
    }
    const wilds = [];
    for (let i = 0; i < n && cand.length; i++) {
      const j = this.rng.int(cand.length);
      const { reel, row } = cand[j];
      cand[j] = cand[cand.length - 1];
      cand.pop();
      const feat = this.phase === 'base' ? null : FEATURES[this.phase];
      const multiplier = feat ? Number(this.rng.weighted(feat.multipliers)) : BASE_WILD_MULT;
      const sticky = Boolean(feat?.sticky) && this.sticky.length < feat.maxSticky;
      let entry = false;
      if (sticky) {
        entry = { reel, row, multiplier };
        this.sticky.push(entry);
        this.summary.maxStickyMult = Math.max(this.summary.maxStickyMult, multiplier);
      }
      this.board[reel][row] = { name: WILD, wild: true, mult: multiplier, sticky: entry, dropped: true };
      wilds.push({ reel, row, multiplier, sticky });
    }
    this.summary.drops++;
    this.summary.wildsDropped += wilds.length;
    if (this.phase === 'base') this.summary.baseDrops++;
    this.emit('wildDrop', { threshold, wilds });
  }

  /** Base spin; returns the feature it earned (null when none or capped). */
  baseSpin() {
    this.phase = 'base';
    this.meter = 0;
    this.baseWin = this.spin('basegame', 'basegame');
    this.summary.baseMeter = this.meter;
    if (this.capped) return null;
    if (this.meter >= METER.superAt) return 'super';
    if (this.meter >= METER.bonusAt) return 'bonus';
    return null;
  }

  /**
   * Free spins of a feature (featureTrigger .. freeSpinEnd). Juke Jam spins use the `bonus`
   * reelset, Mega Mix spins the `super` one (after an upgrade too); `reelset` forces one.
   */
  feature(kind, reelset = null) {
    this.summary.feature = kind;
    let total = FEATURES[kind].freeSpins;
    this.emit('featureTrigger', { feature: kind, meter: this.meter, totalFs: total });
    this.phase = kind;
    this.meter = 0;
    this.sticky = [];
    for (let i = 1; i <= total; i++) {
      this.emit('updateFreeSpin', { amount: i, total });
      this.fsWin += this.spin('freegame', reelset ?? this.phase);
      this.summary.fsSpins = i;
      if (this.capped) break;
      if (this.phase === 'bonus' && this.meter >= METER.superAt) {
        this.phase = 'super';
        this.sticky = [];
        this.meter = 0;
        total += FEATURES.upgradeAddFs;
        this.summary.upgraded = true;
        this.emit('featureUpgrade', { from: 'bonus', to: 'super', addFs: FEATURES.upgradeAddFs });
      }
    }
    this.summary.featureMeter = this.meter;
    this.emit('freeSpinEnd', { amount: this.fsWin, winLevel: winLevel(this.fsWin, 'endFeature') });
  }

  finish(id) {
    this.emit('finalWin', { amount: this.roundTotal });
    let criteria = 'basegame';
    if (this.capped) criteria = 'wincap';
    else if (this.summary.feature) criteria = this.summary.feature;
    else if (this.roundTotal === 0) criteria = '0';
    return {
      id,
      payoutMultiplier: this.roundTotal,
      events: this.events,
      criteria,
      baseGameWins: this.baseWin / 100,
      freeGameWins: this.fsWin / 100,
    };
  }
}

/**
 * Plays one full round.
 *  - `seed`: seed parts (string | number | array); the RNG is createRng('bass-drop', ...seed, attempt)
 *  - `require` ('bonus' | 'super' | null) = bonus-buy forcing: base spins are re-drawn (attempt
 *    0, 1, 2 ... up to `maxAttempts`) until the base meter earns exactly that feature — the
 *    math-sdk "repeat until criteria" approach, so a buy book's base spin is a genuine trigger.
 *  - `fsReelset` forces the free-spin reelset (the wincap search uses 'wcap'); `featureSeed`
 *    re-seeds the RNG for the free spins only (same base spin, different feature).
 * @returns {{book: object, summary: object, attempts: number} | null} null when maxAttempts ran out
 */
export const playRound = ({ strips, seed, id, require = null, maxAttempts = 1, fsReelset = null, featureSeed = null }) => {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rng = createRng('bass-drop', ...[].concat(seed), attempt);
    const sim = new RoundSim({ strips, rng });
    const feature = sim.baseSpin();
    if (require !== null && feature !== require) continue;
    if (feature) {
      if (featureSeed !== null) sim.rng = createRng('bass-drop-fs', ...[].concat(featureSeed));
      sim.feature(feature, fsReelset);
    }
    const book = sim.finish(id);
    return { book, summary: { ...sim.summary, payout: sim.roundTotal, capped: sim.capped }, attempts: attempt + 1 };
  }
  return null;
};
