#!/usr/bin/env node
/**
 * MAGPIE HEIST — replay checker for the mock books (the contract in mock/games/magpie-heist/README.md).
 *
 *   node tools/mockmath/magpie-heist/validate.mjs [--all] [--dir mock/games/magpie-heist/books]
 *
 * Replays every book on its own board model and checks: cluster evaluation and pays, the super
 * cascade explosion set, the Stake refill rule, glint squares (added / full set / reset rules per
 * phase), star activations (a star on the board, items only on empty squares, diamond targets and
 * products, nest sums, payout = remaining items), running tumble wins, setWin / setTotalWin,
 * scatter triggers, retriggers and upgrades, free-spin numbering, freeSpinEnd, finalWin, the win
 * cap, criteria and the base / free game split. Exit 1 on any error.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEATURES, GRID, ITEMS, SCATTER, STAR, WINCAP, triggerFor, winLevel } from './config.mjs';
import { evaluateBoard } from './engine.mjs';

const R = GRID.reels;
const PR = GRID.paddedRows;
const V0 = GRID.firstVisibleRow;
const V1 = GRID.lastVisibleRow;
const key = (p) => p.reel * PR + p.row;
const unkey = (k) => ({ reel: Math.floor(k / PR), row: k % PR });
const byReading = (a, b) => a.row - b.row || a.reel - b.reel;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sortedKeys = (list) => list.map(key).sort((a, b) => a - b);

const COIN_VALUES = Object.fromEntries(Object.entries(ITEMS.coins).map(([t, v]) => [t, new Set(Object.keys(v).map(Number))]));
const DIAMOND_MULTS = new Set(Object.keys(ITEMS.diamonds).map(Number));

const visible = (board, pred) => {
  const out = [];
  for (let reel = 0; reel < R; reel++) for (let row = V0; row <= V1; row++) if (pred(board[reel][row])) out.push({ reel, row });
  return out;
};

/** @returns {string[]} error messages */
export const validateBook = (book, label = `book ${book?.id}`) => {
  const errs = [];
  const err = (i, m) => errs.push(`${label} event ${i}: ${m}`);
  if (!book || !Array.isArray(book.events)) return [`${label}: no events`];
  const ev = book.events;
  ev.forEach((e, i) => {
    if (e.index !== i) err(i, `index ${e.index} != ${i}`);
  });

  let board = null;
  let squares = new Set();
  let phase = 'base';
  let gameType = 'basegame';
  let roundTotal = 0;
  let spinClusterWin = 0;
  let spinWin = 0;
  let lastTumbleWin = 0;
  let baseWin = 0;
  let fsWin = 0;
  let fsTotal = 0;
  let fsCurrent = 0;
  let capped = false;
  let pendingWins = null;
  /** activation state */
  let act = null;
  let featureSeen = null;

  const settledNoWins = () => board && evaluateBoard(board).length === 0;

  for (let i = 0; i < ev.length; i++) {
    const e = ev[i];
    switch (e.type) {
      case 'reveal': {
        if (!Array.isArray(e.board) || e.board.length !== R || e.board.some((c) => c.length !== PR)) err(i, 'board shape');
        board = e.board.map((col) => col.map((c) => ({ ...c })));
        gameType = e.gameType;
        if (gameType === 'basegame' && phase !== 'base') err(i, 'basegame reveal inside a feature');
        if (gameType === 'freegame' && phase === 'base') err(i, 'freegame reveal outside a feature');
        if (!Array.isArray(e.anticipation) || e.anticipation.length !== R) err(i, 'anticipation length');
        spinClusterWin = 0;
        spinWin = 0;
        lastTumbleWin = 0;
        pendingWins = null;
        if (phase === 'base' && squares.size) err(i, 'glint squares left over at a base reveal');
        break;
      }
      case 'glintState': {
        if (gameType !== 'freegame') err(i, 'glintState outside free spins');
        if (!same(sortedKeys(e.squares), [...squares].sort((a, b) => a - b))) err(i, 'glintState != tracked squares');
        break;
      }
      case 'winInfo': {
        const want = evaluateBoard(board);
        const got = e.wins.map((w) => ({ symbol: w.symbol, n: w.clusterSize, win: w.win, pos: sortedKeys(w.positions) }));
        const exp = want.map((w) => ({ symbol: w.symbol, n: w.clusterSize, win: w.win, pos: sortedKeys(w.positions) }));
        if (!same(got, exp)) err(i, `wins differ from the board: got ${JSON.stringify(got)} want ${JSON.stringify(exp)}`);
        if (e.totalWin !== e.wins.reduce((a, w) => a + w.win, 0)) err(i, 'totalWin != sum of wins');
        spinClusterWin += e.totalWin;
        pendingWins = e.wins;
        if (ev[i + 1]?.type !== 'glintSquares') err(i, 'winInfo not followed by glintSquares');
        break;
      }
      case 'glintSquares': {
        if (!pendingWins) {
          err(i, 'glintSquares without winInfo');
          break;
        }
        const added = [];
        for (const w of pendingWins) {
          for (const p of w.positions) {
            const k = key(p);
            if (!squares.has(k) && !added.includes(k)) added.push(k);
          }
        }
        for (const k of added) squares.add(k);
        if (!same(sortedKeys(e.added), added.sort((a, b) => a - b))) err(i, 'added squares differ');
        if (!same(sortedKeys(e.squares), [...squares].sort((a, b) => a - b))) err(i, 'square set differs');
        break;
      }
      case 'updateTumbleWin': {
        if (e.amount < lastTumbleWin) err(i, 'tumble win decreased');
        const want = Math.min(spinClusterWin + (act?.paid ?? 0), WINCAP - roundTotal);
        if (e.amount !== want) err(i, `updateTumbleWin ${e.amount} != ${want}`);
        lastTumbleWin = e.amount;
        spinWin = e.amount;
        break;
      }
      case 'wincap': {
        capped = true;
        if (e.amount !== WINCAP) err(i, 'wincap amount');
        if (roundTotal + spinWin !== WINCAP) err(i, `capped round total ${roundTotal + spinWin} != ${WINCAP}`);
        break;
      }
      case 'tumbleBoard': {
        if (!pendingWins) err(i, 'tumbleBoard without winInfo');
        const types = new Set(pendingWins.map((w) => w.symbol));
        const want = new Set();
        for (const w of pendingWins) for (const p of w.positions) want.add(key(p));
        for (const p of visible(board, (c) => types.has(c.name))) want.add(key(p));
        if (!same(sortedKeys(e.explodingSymbols), [...want].sort((a, b) => a - b))) err(i, 'super cascade explosion set differs');
        for (let reel = 0; reel < R; reel++) {
          const gone = new Set(e.explodingSymbols.filter((p) => p.reel === reel).map((p) => p.row));
          if ((e.newSymbols[reel] ?? []).length !== gone.size) err(i, `reel ${reel}: ${e.newSymbols[reel]?.length} new for ${gone.size} exploded`);
          board[reel] = [...e.newSymbols[reel].map((c) => ({ ...c })), ...board[reel].filter((_, row) => !gone.has(row))];
          if (board[reel].length !== PR) err(i, `reel ${reel} length ${board[reel].length}`);
        }
        pendingWins = null;
        break;
      }
      case 'starActivate': {
        if (!settledNoWins()) err(i, 'star activation before the cascade settled');
        const stars = visible(board, (c) => c.name === STAR);
        if (!same(sortedKeys(e.stars), sortedKeys(stars))) err(i, 'stars differ from the board');
        if (!squares.size) err(i, 'activation with no squares');
        if (!same(sortedKeys(e.squares), [...squares].sort((a, b) => a - b))) err(i, 'activation squares differ');
        act = { items: new Map(), round: 0, paid: 0, newNests: [] };
        break;
      }
      case 'glintReveal': {
        if (!act) {
          err(i, 'glintReveal without starActivate');
          break;
        }
        act.round++;
        if (e.round !== act.round) err(i, `round ${e.round} != ${act.round}`);
        const empty = [...squares].filter((k) => !act.items.has(k)).sort((a, b) => byReading(unkey(a), unkey(b)));
        if (!same(e.items.map(key), empty)) err(i, 'revealed cells != empty squares (reading order)');
        act.newNests = [];
        for (const it of e.items) {
          if (it.kind === 'coin') {
            if (!COIN_VALUES[it.tier]?.has(it.value)) err(i, `bad coin ${it.tier} ${it.value}`);
            if (phase === 'starfall' && it.tier === 'bronze') err(i, 'bronze coin in Starfall');
          } else if (it.kind === 'diamond') {
            if (!DIAMOND_MULTS.has(it.mult)) err(i, `bad diamond x${it.mult}`);
          } else if (it.kind === 'nest') {
            if (it.value !== 0) err(i, 'a new nest starts at 0');
            act.newNests.push(key(it));
          } else err(i, `unknown item ${it.kind}`);
          act.items.set(key(it), { ...it });
        }
        break;
      }
      case 'diamondBoost': {
        const d = act?.items.get(key(e));
        if (!d || d.kind !== 'diamond' || d.mult !== e.mult) err(i, 'diamondBoost not on a diamond');
        const want = [];
        for (let dr = -1; dr <= 1; dr++) {
          for (let dw = -1; dw <= 1; dw++) {
            if (!dr && !dw) continue;
            const p = { reel: e.reel + dr, row: e.row + dw };
            if (p.reel < 0 || p.reel >= R || p.row < V0 || p.row > V1) continue;
            const t = act.items.get(key(p));
            if (!t || t.kind === 'diamond' || t.value <= 0) continue;
            want.push({ ...p, kind: t.kind, from: t.value, to: t.value * e.mult });
            t.value *= e.mult;
          }
        }
        want.sort(byReading);
        if (!same(e.targets, want)) err(i, `diamond targets differ: ${JSON.stringify(e.targets)} vs ${JSON.stringify(want)}`);
        // a spent diamond leaves its square once every diamond of the round has fired
        if (ev[i + 1]?.type !== 'diamondBoost') for (const [k, it] of [...act.items]) if (it.kind === 'diamond') act.items.delete(k);
        break;
      }
      case 'nestCollect': {
        const n = act?.items.get(key(e));
        if (!n || n.kind !== 'nest') err(i, 'nestCollect not on a nest');
        if (!act.newNests.includes(key(e))) err(i, 'only a newly revealed nest collects');
        const want = [...act.items.entries()]
          .filter(([, it]) => it.kind === 'coin' && it.value > 0)
          .map(([k, it]) => ({ ...unkey(k), kind: it.kind, value: it.value }))
          .sort(byReading);
        if (!same(e.sources, want)) err(i, 'nest sources != every coin on the board');
        if (e.from !== n.value || e.to !== n.value + want.reduce((a, s) => a + s.value, 0)) err(i, 'nest from/to');
        n.value = e.to;
        if (ev[i + 1]?.type !== 'nestCollect') for (const [k, it] of [...act.items]) if (it.kind === 'coin') act.items.delete(k);
        break;
      }
      case 'glintPayout': {
        if (!act) {
          err(i, 'glintPayout without activation');
          break;
        }
        for (const [k, it] of [...act.items]) if (it.kind === 'diamond') act.items.delete(k);
        const want = [...act.items.entries()]
          .map(([k, it]) => ({ ...unkey(k), kind: it.kind, value: it.value }))
          .filter((it) => it.value > 0)
          .sort(byReading);
        if (!same(e.items, want)) err(i, 'payout items differ');
        if (e.amount !== want.reduce((a, it) => a + it.value, 0)) err(i, 'payout amount');
        act.paid = e.amount;
        break;
      }
      case 'glintReset': {
        const keep = phase === 'vault' || phase === 'starfall';
        if (act) {
          if (e.keep !== keep) err(i, `reset keep ${e.keep} in ${phase}`);
          if (!keep) squares.clear();
        } else if (phase === 'base' || ev[i + 1]?.type === 'freeSpinEnd') squares.clear();
        else err(i, 'glintReset without activation inside a feature');
        if (!same(sortedKeys(e.squares), [...squares].sort((a, b) => a - b))) err(i, 'squares after reset differ');
        act = null;
        break;
      }
      case 'setWin': {
        if (e.amount !== spinWin) err(i, `setWin ${e.amount} != spin win ${spinWin}`);
        if (e.winLevel !== winLevel(e.amount, 'standard')) err(i, 'setWin level');
        break;
      }
      case 'setTotalWin': {
        if (act) err(i, 'activation not closed by glintReset');
        if (phase === 'base' && squares.size) err(i, 'base spin ended with squares');
        roundTotal += spinWin;
        if (gameType === 'basegame') baseWin += spinWin;
        else fsWin += spinWin;
        if (e.amount !== roundTotal) err(i, `setTotalWin ${e.amount} != ${roundTotal}`);
        spinWin = 0;
        break;
      }
      case 'featureTrigger': {
        const sc = visible(board, (c) => c.name === SCATTER);
        if (e.scatters !== sc.length || !same(sortedKeys(e.positions), sortedKeys(sc))) err(i, 'trigger scatters differ from the board');
        if (triggerFor(sc.length) !== e.feature) err(i, `${sc.length} scatters do not trigger ${e.feature}`);
        if (e.totalFs !== FEATURES[e.feature].freeSpins) err(i, 'totalFs');
        phase = e.feature;
        featureSeen = e.feature;
        fsTotal = e.totalFs;
        fsCurrent = 0;
        squares.clear();
        break;
      }
      case 'updateFreeSpin': {
        fsCurrent++;
        if (e.amount !== fsCurrent || e.total !== fsTotal) err(i, `updateFreeSpin ${e.amount}/${e.total} != ${fsCurrent}/${fsTotal}`);
        break;
      }
      case 'featureRetrigger': {
        const sc = visible(board, (c) => c.name === SCATTER);
        const add = FEATURES[phase].retrigger[Math.min(sc.length, 3)] ?? 0;
        if (e.feature !== phase || e.addFs !== add || sc.length < 2) err(i, 'retrigger amount');
        fsTotal += e.addFs;
        if (e.total !== fsTotal) err(i, 'retrigger total');
        break;
      }
      case 'featureUpgrade': {
        const f = FEATURES[phase];
        const sc = visible(board, (c) => c.name === SCATTER);
        if (!f.upgradeAt || sc.length < f.upgradeAt || e.from !== phase || e.to !== f.upgradeTo || e.addFs !== f.upgradeAddFs) err(i, 'bad upgrade');
        fsTotal += e.addFs;
        if (e.total !== fsTotal) err(i, 'upgrade total');
        phase = e.to;
        break;
      }
      case 'freeSpinEnd': {
        if (squares.size) err(i, 'squares left at freeSpinEnd');
        if (e.amount !== fsWin) err(i, `freeSpinEnd ${e.amount} != ${fsWin}`);
        if (e.winLevel !== winLevel(e.amount, 'endFeature')) err(i, 'freeSpinEnd level');
        if (!capped && fsCurrent !== fsTotal) err(i, `played ${fsCurrent} of ${fsTotal} spins`);
        phase = 'base';
        break;
      }
      case 'finalWin': {
        if (e.amount !== roundTotal || e.amount !== book.payoutMultiplier) err(i, 'finalWin');
        if (i !== ev.length - 1) err(i, 'finalWin is not last');
        break;
      }
      default:
        err(i, `unknown event type ${e.type}`);
    }
  }
  const criteria = capped ? 'wincap' : featureSeen ?? (roundTotal === 0 ? '0' : 'basegame');
  if (book.criteria !== criteria) errs.push(`${label}: criteria ${book.criteria} != ${criteria}`);
  if (Math.round(book.baseGameWins * 100) !== baseWin || Math.round(book.freeGameWins * 100) !== fsWin) errs.push(`${label}: base/free split`);
  if (book.payoutMultiplier > WINCAP) errs.push(`${label}: over the win cap`);
  return errs;
};

const main = () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const i = process.argv.indexOf('--dir');
  const dir = path.resolve(i >= 0 ? process.argv[i + 1] : path.resolve(here, '../../../mock/games/magpie-heist/books'));
  const all = process.argv.includes('--all');
  let n = 0;
  let bad = 0;
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    if (f === 'dev_fixture.json' && !all) continue;
    const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const list = Array.isArray(data) ? data.map((b) => [`${f} id ${b.id}`, b]) : Object.entries(data).map(([k, b]) => [`${f} ${k}`, b]);
    for (const [label, book] of list) {
      n++;
      const errs = validateBook(book, label);
      if (errs.length) {
        bad++;
        for (const m of errs.slice(0, 8)) console.log(m);
      }
    }
  }
  console.log(`${n} books, ${bad} invalid`);
  if (bad) process.exitCode = 1;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
