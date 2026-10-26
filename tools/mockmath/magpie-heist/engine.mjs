/**
 * MAGPIE HEIST — round simulator that writes Stake book events (mock math, not certified).
 *
 * One RoundSim = one book. Rules (numbers in config.mjs, contract in mock/games/magpie-heist/README.md):
 *  - 6x5 cluster pays (5+ orthogonal, W substitutes, a group of wilds alone pays nothing; S and R
 *    block clusters), tumbles with the Stake web-sdk refill rule (per reel combined =
 *    newSymbols ++ survivors of the 7 padded slots, newSymbols from the strip above the stop).
 *  - SUPER CASCADE: every instance of a winning symbol type explodes, not only the cluster;
 *    wilds explode when they are part of a winning cluster.
 *  - GLINT SQUARES: every winning cluster position becomes a glint square (glintSquares after
 *    winInfo). When the cascade sequence ends with a Shooting Star (R) on the board, the
 *    squares reveal coins / diamonds / nests (starActivate, glintReveal, diamondBoost,
 *    nestCollect, re-reveals, glintPayout). A nest collects every coin on the board (each nest
 *    of a round collects the full sum); the emptied squares then reveal again.
 *  - squares reset at the end of a base spin; Night Prowl keeps them until a star activates
 *    them; Vault Raid and Starfall never reset them (only the paid items are cleared).
 *  - scatters on the final board: base 3 / 4 / 5 -> Night Prowl / Vault Raid / Starfall;
 *    free spins retrigger, Night Prowl upgrades to Vault Raid with 4+.
 *  - win cap: the round total is truncated to WINCAP and the round stops.
 */
import {
  FEATURES,
  FORCED_STAR,
  GRID,
  ITEMS,
  MIN_CLUSTER,
  PAY_SYMBOLS,
  REELSETS,
  SCATTER,
  STAR,
  STAR_CHANCE,
  STRIP_SEED,
  WILD,
  WINCAP,
  payFor,
  triggerFor,
  winLevel,
} from './config.mjs';
import { createRng } from './rng.mjs';

const R = GRID.reels;
const PR = GRID.paddedRows;
const V0 = GRID.firstVisibleRow;
const V1 = GRID.lastVisibleRow;
const key = (reel, row) => reel * PR + row;
const unkey = (k) => ({ reel: Math.floor(k / PR), row: k % PR });
const byReading = (a, b) => a.row - b.row || a.reel - b.reel;

/** Reel strips per reelset (deterministic, stacked runs; S and R in runs of 1). */
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
          const single = sym === WILD || sym === SCATTER || sym === STAR;
          const len = Math.min(left, Number(rng.weighted(single ? { 1: 1 } : def.runs)));
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

const cell = (name) => {
  if (name === WILD) return { name, wild: true };
  if (name === SCATTER) return { name, scatter: true };
  return { name };
};
export const rawSymbol = (c) => ({ ...c });
const rawBoard = (board) => board.map((col) => col.map(rawSymbol));

/** All paying clusters of the visible board (reel-major scan, BFS order inside). */
export const findClusters = (board) => {
  const clusters = [];
  const seen = {};
  for (const s of PAY_SYMBOLS) seen[s] = new Uint8Array(R * PR);
  for (let reel = 0; reel < R; reel++) {
    for (let row = V0; row <= V1; row++) {
      const c = board[reel][row];
      if (!seen[c.name]) continue;
      const sym = c.name;
      const mark = seen[sym];
      if (mark[key(reel, row)]) continue;
      const cells = [];
      const queue = [[reel, row]];
      mark[key(reel, row)] = 1;
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
          if (mark[key(r1, w1)]) continue;
          const n = board[r1][w1];
          if (n.name !== sym && !n.wild) continue;
          mark[key(r1, w1)] = 1;
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

export const evaluateBoard = (board) =>
  findClusters(board).map(({ symbol, cells }) => {
    const base = payFor(symbol, cells.length);
    return {
      symbol,
      clusterSize: cells.length,
      win: base,
      positions: cells.map((p) => ({ reel: p.reel, row: p.row })),
      meta: { globalMult: 1, clusterMult: 1, winWithoutMult: base, overlay: overlayCell(cells) },
    };
  });

const visible = (board, pred) => {
  const out = [];
  for (let reel = 0; reel < R; reel++) for (let row = V0; row <= V1; row++) if (pred(board[reel][row])) out.push({ reel, row });
  return out;
};

/** Stake-style anticipation: reels after the second scatter count up 1, 2, 3 ... */
const anticipationFor = (board) => {
  const out = new Array(R).fill(0);
  let seen = 0;
  let n = 0;
  for (let reel = 0; reel < R; reel++) {
    if (seen >= 2) out[reel] = ++n;
    for (let row = V0; row <= V1; row++) if (board[reel][row].scatter) seen++;
  }
  return out;
};

export class RoundSim {
  constructor({ strips, rng, mode = 'BASE', reelset = 'basegame', forcedStar = false }) {
    this.strips = strips;
    this.rng = rng;
    this.mode = mode;
    this.baseReelset = reelset;
    this.forcedStar = forcedStar;
    this.events = [];
    this.roundTotal = 0;
    this.baseWin = 0;
    this.fsWin = 0;
    this.capped = false;
    /** 'base' | 'prowl' | 'vault' | 'starfall' */
    this.phase = 'base';
    /** glint squares: Set of padded keys */
    this.squares = new Set();
    this.board = null;
    this.stops = null;
    this.summary = {
      baseTumbles: 0,
      baseScatters: 0,
      superCascades: 0,
      squaresMax: 0,
      activations: 0,
      baseActivations: 0,
      activationRounds: 0,
      maxRounds: 0,
      diamonds: 0,
      nests: 0,
      baseNests: 0,
      bestActivation: 0,
      feature: null,
      upgraded: false,
      retriggers: 0,
      fsSpins: 0,
      fsTotal: 0,
      maxTumbles: 0,
    };
  }

  emit(type, payload) {
    this.events.push({ index: this.events.length, type, ...payload });
  }

  squareList() {
    return [...this.squares].map(unkey).sort(byReading);
  }

  /** room left under the win cap (book units) */
  room() {
    return WINCAP - this.roundTotal;
  }

  /** One base or free spin. Returns the spin win. */
  spin(gameType, reelset) {
    const strips = this.strips[reelset];
    this.stops = strips.map((s) => this.rng.int(s.length));
    this.board = strips.map((s, reel) => {
      const col = [];
      for (let row = 0; row < PR; row++) col.push(cell(s[(this.stops[reel] + row) % s.length]));
      return col;
    });
    const forced = gameType === 'basegame' ? this.forcedStar : FORCED_STAR[this.phase] === 1;
    const chance = STAR_CHANCE[this.phase];
    if (forced || this.rng.next() < chance.reveal) {
      const cand = visible(this.board, (c) => !c.scatter);
      const p = cand[this.rng.int(cand.length)];
      this.board[p.reel][p.row] = cell(STAR);
    }
    this.emit('reveal', {
      board: rawBoard(this.board),
      paddingPositions: [...this.stops],
      gameType,
      anticipation: gameType === 'basegame' ? anticipationFor(this.board) : new Array(R).fill(0),
    });
    if (gameType === 'freegame') this.emit('glintState', { squares: this.squareList() });

    let spinWin = 0;
    let tumbles = 0;
    for (;;) {
      const wins = evaluateBoard(this.board);
      if (!wins.length) break;
      const stepWin = wins.reduce((a, w) => a + w.win, 0);
      this.emit('winInfo', { totalWin: stepWin, wins });

      // glint squares: every winning cluster position
      const added = [];
      for (const w of wins) {
        for (const p of w.positions) {
          const k = key(p.reel, p.row);
          if (!this.squares.has(k)) {
            this.squares.add(k);
            added.push({ reel: p.reel, row: p.row });
          }
        }
      }
      added.sort(byReading);
      this.emit('glintSquares', { added, squares: this.squareList() });
      this.summary.squaresMax = Math.max(this.summary.squaresMax, this.squares.size);

      spinWin += stepWin;
      if (spinWin >= this.room()) {
        spinWin = this.room();
        this.capped = true;
        this.emit('updateTumbleWin', { amount: spinWin });
        this.emit('wincap', { amount: WINCAP });
        break;
      }
      this.emit('updateTumbleWin', { amount: spinWin });

      // super cascade: every instance of a winning symbol type + the cluster cells (wilds)
      const explode = new Set();
      const types = new Set(wins.map((w) => w.symbol));
      for (const w of wins) for (const p of w.positions) explode.add(key(p.reel, p.row));
      let extra = 0;
      for (const p of visible(this.board, (c) => types.has(c.name))) {
        const k = key(p.reel, p.row);
        if (!explode.has(k)) {
          explode.add(k);
          extra++;
        }
      }
      if (extra) this.summary.superCascades++;
      const exploding = [...explode].sort((a, b) => a - b).map(unkey);
      this.tumble(exploding, strips);
      tumbles++;
    }

    if (!this.capped) {
      const stars = visible(this.board, (c) => c.name === STAR);
      if (stars.length && this.squares.size) {
        const pay = this.activate(stars, gameType);
        spinWin += pay;
        if (spinWin >= this.room()) {
          spinWin = this.room();
          this.capped = true;
        }
        this.emit('updateTumbleWin', { amount: spinWin });
        if (this.capped) this.emit('wincap', { amount: WINCAP });
        // after an activation: base and Night Prowl clear the squares, Vault Raid / Starfall keep them
        const keep = this.phase === 'vault' || this.phase === 'starfall';
        if (!keep) this.squares.clear();
        this.emit('glintReset', { squares: this.squareList(), keep });
      } else if (this.phase === 'base' && this.squares.size) {
        this.squares.clear();
        this.emit('glintReset', { squares: [], keep: false });
      }
    } else if (this.phase === 'base' && this.squares.size) {
      this.squares.clear();
      this.emit('glintReset', { squares: [], keep: false });
    }

    if (spinWin > 0) this.emit('setWin', { amount: spinWin, winLevel: winLevel(spinWin, 'standard') });
    this.roundTotal += spinWin;
    this.emit('setTotalWin', { amount: this.roundTotal });

    this.summary.maxTumbles = Math.max(this.summary.maxTumbles, tumbles);
    if (gameType === 'basegame') this.summary.baseTumbles = tumbles;
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
      for (let i = 0; i < k; i++) added.push(cell(strip[(this.stops[reel] + i) % strip.length]));
      newSymbols.push(added);
      this.board[reel] = [...added, ...survivors];
    }
    // a Shooting Star can ride in with the refill (on a new symbol that lands on a visible row)
    if (this.rng.next() < STAR_CHANCE[this.phase].tumble) {
      const cand = [];
      for (let reel = 0; reel < R; reel++) {
        for (let i = 0; i < newSymbols[reel].length; i++) {
          if (i >= V0 && i <= V1 && !newSymbols[reel][i].scatter) cand.push([reel, i]);
        }
      }
      if (cand.length) {
        const [reel, i] = cand[this.rng.int(cand.length)];
        newSymbols[reel][i] = cell(STAR);
        this.board[reel][i] = newSymbols[reel][i];
      }
    }
    this.emit('tumbleBoard', { newSymbols: newSymbols.map((col) => col.map(rawSymbol)), explodingSymbols: exploding });
  }

  drawItem(table) {
    const kind = this.rng.weighted(table);
    if (kind === 'diamond') return { kind: 'diamond', mult: Number(this.rng.weighted(ITEMS.diamonds)) };
    if (kind === 'nest') return { kind: 'nest', value: 0 };
    return { kind: 'coin', tier: kind, value: Number(this.rng.weighted(ITEMS.coins[kind])) };
  }

  /**
   * SHOOTING STAR activation over the current glint squares. Returns the payout (book units).
   * Items live in `items` (padded key -> item) for the duration of the activation.
   */
  activate(stars, gameType) {
    this.summary.activations++;
    if (gameType === 'basegame') this.summary.baseActivations++;
    const phase = this.phase;
    this.emit('starActivate', { stars, squares: this.squareList() });
    const items = new Map();
    let round = 0;
    for (;;) {
      round++;
      // reveal every empty square
      const table = round === 1 ? ITEMS.kinds[phase] : ITEMS.rerevealKinds[phase];
      const revealed = [];
      const newNests = [];
      for (const p of this.squareList()) {
        const k = key(p.reel, p.row);
        if (items.has(k)) continue;
        const it = this.drawItem(table);
        items.set(k, it);
        revealed.push({ reel: p.reel, row: p.row, ...it });
        if (it.kind === 'nest') newNests.push(k);
      }
      this.emit('glintReveal', { round, items: revealed });
      if (!revealed.length) break;

      // diamonds (reading order): multiply coins and nests in the 8 surrounding cells
      const diamonds = revealed.filter((it) => it.kind === 'diamond');
      for (const d of diamonds) {
        this.summary.diamonds++;
        const targets = [];
        for (let dr = -1; dr <= 1; dr++) {
          for (let dw = -1; dw <= 1; dw++) {
            if (!dr && !dw) continue;
            if (d.reel + dr < 0 || d.reel + dr >= R || d.row + dw < V0 || d.row + dw > V1) continue;
            const t = items.get(key(d.reel + dr, d.row + dw));
            if (!t || t.kind === 'diamond' || t.value <= 0) continue;
            const from = t.value;
            t.value = from * d.mult;
            targets.push({ reel: d.reel + dr, row: d.row + dw, kind: t.kind, from, to: t.value });
          }
        }
        targets.sort(byReading);
        this.emit('diamondBoost', { reel: d.reel, row: d.row, mult: d.mult, targets });
      }
      // spent diamonds leave their square empty
      for (const d of diamonds) items.delete(key(d.reel, d.row));

      if (!newNests.length) break;
      // nests (reading order): each new nest collects every coin on the board
      for (const nk of newNests.map(unkey).sort(byReading).map((p) => key(p.reel, p.row))) {
        this.summary.nests++;
        if (gameType === 'basegame') this.summary.baseNests++;
        const nest = items.get(nk);
        const sources = [];
        for (const [k, it] of [...items.entries()].sort((a, b) => byReading(unkey(a[0]), unkey(b[0])))) {
          if (k === nk || it.kind !== 'coin') continue;
          if (it.value > 0) sources.push({ ...unkey(k), kind: it.kind, value: it.value });
        }
        const from = nest.value;
        nest.value = from + sources.reduce((a, s) => a + s.value, 0);
        const p = unkey(nk);
        this.emit('nestCollect', { reel: p.reel, row: p.row, from, to: nest.value, sources });
      }
      // collected coins leave their squares: they reveal again next round
      for (const [k, it] of [...items.entries()]) if (it.kind === 'coin') items.delete(k);
      if (round >= ITEMS.maxRounds) break;
    }
    this.summary.activationRounds += round;
    this.summary.maxRounds = Math.max(this.summary.maxRounds, round);
    const paid = [...items.entries()]
      .map(([k, it]) => ({ ...unkey(k), kind: it.kind, value: it.value }))
      .filter((it) => it.value > 0)
      .sort(byReading);
    const amount = paid.reduce((a, it) => a + it.value, 0);
    this.summary.bestActivation = Math.max(this.summary.bestActivation, amount);
    this.emit('glintPayout', { amount, items: paid });
    return amount;
  }

  /** Base spin; returns the feature it earned (null when none or capped). */
  baseSpin() {
    this.phase = 'base';
    this.squares.clear();
    this.baseWin = this.spin('basegame', this.baseReelset);
    const scatters = visible(this.board, (c) => c.scatter);
    this.summary.baseScatters = scatters.length;
    if (this.capped) return null;
    const f = triggerFor(scatters.length);
    return f ? { feature: f, positions: scatters } : null;
  }

  /** Free spins of a feature (featureTrigger .. freeSpinEnd). */
  feature({ feature, positions }, reelset = 'freegame') {
    this.summary.feature = feature;
    let total = FEATURES[feature].freeSpins;
    this.emit('featureTrigger', { feature, scatters: positions.length, totalFs: total, positions });
    this.phase = feature;
    this.squares.clear();
    for (let i = 1; i <= total; i++) {
      this.emit('updateFreeSpin', { amount: i, total });
      this.fsWin += this.spin('freegame', reelset);
      this.summary.fsSpins = i;
      if (this.capped) break;
      const scat = visible(this.board, (c) => c.scatter);
      const f = FEATURES[this.phase];
      if (f.upgradeAt && scat.length >= f.upgradeAt) {
        const add = f.upgradeAddFs;
        total += add;
        this.summary.upgraded = true;
        this.emit('featureUpgrade', { from: this.phase, to: f.upgradeTo, addFs: add, total, positions: scat });
        this.phase = f.upgradeTo;
      } else {
        const add = f.retrigger[Math.min(scat.length, 3)] ?? 0;
        if (scat.length >= 2 && add) {
          total += add;
          this.summary.retriggers++;
          this.emit('featureRetrigger', { feature: this.phase, addFs: add, total, positions: scat });
        }
      }
    }
    this.summary.fsTotal = total;
    if (this.squares.size) {
      this.squares.clear();
      this.emit('glintReset', { squares: [], keep: false });
    }
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
 *  - `require` ('prowl' | 'vault' | null): bonus-buy forcing, base spins are re-drawn until the base
 *    board earns exactly that feature (math-sdk "repeat until criteria").
 *  - `fsReelset` forces the free-spin reelset (wincap search: 'wcap'); `featureSeed` re-seeds the
 *    RNG for the free spins only.
 */
export const playRound = ({ strips, seed, id, mode = 'BASE', reelset = 'basegame', forcedStar = false, require = null, maxAttempts = 1, fsReelset = 'freegame', featureSeed = null }) => {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rng = createRng('magpie-heist', ...[].concat(seed), attempt);
    const sim = new RoundSim({ strips, rng, mode, reelset, forcedStar });
    const trig = sim.baseSpin();
    if (require !== null && trig?.feature !== require) continue;
    if (trig) {
      if (featureSeed !== null) sim.rng = createRng('magpie-heist-fs', ...[].concat(featureSeed));
      sim.feature(trig, fsReelset);
    }
    const book = sim.finish(id);
    return { book, summary: { ...sim.summary, payout: sim.roundTotal, capped: sim.capped }, attempts: attempt + 1 };
  }
  return null;
};
