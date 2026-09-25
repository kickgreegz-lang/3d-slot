#!/usr/bin/env node
/**
 * Book checker for SWAMP FUNK: BASS DROP (mock/games/bass-drop/books/*.json).
 *
 *   node tools/mockmath/bass-drop/validate.mjs            generated files (base_fixtures + books_*)
 *   node tools/mockmath/bass-drop/validate.mjs --all      every *.json in the books folder (incl. dev_fixture.json)
 *   node tools/mockmath/bass-drop/validate.mjs a.json ... given files
 *
 * Replays every book on its own board model (independent of engine.mjs: own flood fill, own
 * tumble, own flow state machine) and checks:
 *  - shapes: board 6 reels x 8 padded rows, symbols known, W <-> wild flag, multiplier only on W;
 *    event indexes 0..n-1; positions on visible rows 1..6
 *  - every winInfo equals a fresh evaluation of the replayed board (same clusters, sizes,
 *    positions, pays, wildMult / clusterMult, totals): every position holds the claimed symbol or W
 *  - event order per step: winInfo -> meterUpdate -> updateTumbleWin -> [wincap] tumbleBoard -> wildDrop*
 *  - tumbleBoard: explodingSymbols = union of the winning positions, newSymbols count per reel =
 *    exploded count, web-sdk refill rule (combined = new ++ survivors, 8 rows)
 *  - meter: value = previous + delta, delta = exploding count, thresholds = drop thresholds crossed,
 *    resets on every base reveal / featureTrigger / featureUpgrade, monotonic inside a phase
 *  - wildDrop: one per listed threshold, in order, wild count per threshold, target cells visible,
 *    distinct, not already wild, not a sticky home; multiplier range per phase; sticky flag (Mega Mix,
 *    registry cap)
 *  - Mega Mix: reveal holds every sticky wild at its home with its multiplier; stickyWilds = registry;
 *    +1 growth (cap) for every winInfo a sticky wild is part of
 *  - a spin only ends (setWin / setTotalWin) on a board without wins (unless capped)
 *  - amounts: updateTumbleWin cumulative, setWin = spin win + win level, setTotalWin running sum,
 *    freeSpinEnd = free-spin wins + end-feature level, finalWin = last setTotalWin = payoutMultiplier,
 *    baseGameWins / freeGameWins, wincap truncation at 5000x
 *  - features: featureTrigger iff base meter >= 40 (super >= 60), free-spin counter, upgrade at 60
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALL_SYMBOLS,
  FEATURES,
  GRID,
  METER,
  MIN_CLUSTER,
  PAY_SYMBOLS,
  WILD,
  WINCAP,
  payFor,
  winLevel,
  wildsForThreshold,
} from './config.mjs';

const R = GRID.reels;
const PR = GRID.paddedRows;
const V0 = GRID.firstVisibleRow;
const V1 = GRID.lastVisibleRow;
const key = (reel, row) => `${reel},${row}`;
const isInt = (v) => Number.isInteger(v);

/** independent cluster evaluation: {symbol, cells:Set<key>, wildMult}[] */
const clustersOf = (board) => {
  const out = [];
  for (const sym of PAY_SYMBOLS) {
    const done = new Set();
    for (let reel = 0; reel < R; reel++) {
      for (let row = V0; row <= V1; row++) {
        if (board[reel][row].name !== sym || done.has(key(reel, row))) continue;
        const cells = new Set([key(reel, row)]);
        const stack = [[reel, row]];
        while (stack.length) {
          const [r, w] = stack.pop();
          for (const [nr, nw] of [
            [r + 1, w],
            [r - 1, w],
            [r, w + 1],
            [r, w - 1],
          ]) {
            if (nr < 0 || nr >= R || nw < V0 || nw > V1 || cells.has(key(nr, nw))) continue;
            const c = board[nr][nw];
            if (c.name === sym || c.name === WILD) {
              cells.add(key(nr, nw));
              stack.push([nr, nw]);
            }
          }
        }
        for (const k of cells) done.add(k);
        if (cells.size < MIN_CLUSTER) continue;
        let wildMult = 0;
        for (const k of cells) {
          const [r, w] = k.split(',').map(Number);
          const c = board[r][w];
          if (c.name === WILD && c.mult > 1) wildMult += c.mult;
        }
        out.push({ symbol: sym, cells, wildMult });
      }
    }
  }
  return out;
};

/** thrown when the replay cannot continue (the reason is already in the error list) */
class Abort extends Error {}

const cellFromRaw = (s) => ({ name: s.name, mult: s.name === WILD ? (s.multiplier ?? 1) : 0, sticky: null });

const checkRaw = (s, where, err) => {
  if (!s || typeof s !== 'object' || typeof s.name !== 'string') return err(`${where}: not a symbol object`);
  if (!ALL_SYMBOLS.includes(s.name)) err(`${where}: unknown symbol "${s.name}"`);
  if ((s.name === WILD) !== (s.wild === true)) err(`${where}: wild flag mismatch for ${s.name}`);
  if (s.multiplier !== undefined && (s.name !== WILD || !isInt(s.multiplier) || s.multiplier < 2)) {
    err(`${where}: bad multiplier ${s.multiplier} on ${s.name}`);
  }
  for (const k of Object.keys(s)) if (!['name', 'wild', 'multiplier'].includes(k)) err(`${where}: unexpected field "${k}"`);
};

const checkPos = (p, where, err) => {
  if (!p || !isInt(p.reel) || !isInt(p.row)) return err(`${where}: bad position ${JSON.stringify(p)}`);
  if (p.reel < 0 || p.reel >= R || p.row < V0 || p.row > V1) err(`${where}: position ${key(p.reel, p.row)} off the visible grid`);
};

/**
 * @param {object} book
 * @param {string} name label for messages
 * @returns {string[]} errors (empty = valid)
 */
export const validateBook = (book, name = `book ${book?.id}`) => {
  const errors = [];
  let ctx = name;
  const err = (msg) => {
    if (errors.length < 40) errors.push(`${ctx}: ${msg}`);
  };
  if (!book || typeof book !== 'object') return [`${name}: not an object`];
  if (!isInt(book.id)) err('id must be an integer');
  if (!isInt(book.payoutMultiplier) || book.payoutMultiplier < 0) err('payoutMultiplier must be a non-negative integer');
  if (!Array.isArray(book.events) || !book.events.length) return [...errors, `${name}: no events`];
  if (typeof book.criteria !== 'string') err('criteria must be a string');

  const st = {
    phase: 'base', // base | bonus | super
    board: null,
    meter: 0,
    baseMeter: 0,
    roundTotal: 0,
    spinWin: 0,
    baseWins: 0,
    fsWins: 0,
    fsTotal: 0,
    fsCurrent: 0,
    feature: null,
    upgraded: false,
    capped: false,
    capHitPending: false,
    /** Map key -> {reel,row,multiplier} */
    sticky: new Map(),
    step: null, // last winInfo: {explode:Set<key>, total, stickyHit:Set<entry>}
    pendingThresholds: [],
    spinOpen: false,
    setWinSeen: false,
    spinsDone: 0,
    reveals: 0,
    wincapSeen: false,
    finalSeen: false,
  };
  let prev = null;

  const spinBoardHasWins = () => st.board && clustersOf(st.board).length > 0;

  const replay = (e, i) => {
    ctx = `${name} #${i} ${e?.type}`;
    if (!e || typeof e !== 'object') return err('event is not an object');
    if (e.index !== i) err(`index ${e.index} != position ${i}`);
    if (st.finalSeen) err('event after finalWin');
    const after = prev?.type;
    switch (e.type) {
      case 'reveal': {
        if (st.spinOpen) err('reveal while the previous spin is still open');
        const free = st.reveals > 0;
        if (free && after !== 'updateFreeSpin') err('free-spin reveal must follow updateFreeSpin');
        if (e.gameType !== (free ? 'freegame' : 'basegame')) err(`gameType ${e.gameType} (expected ${free ? 'freegame' : 'basegame'})`);
        if (!Array.isArray(e.anticipation) || e.anticipation.length !== R || !e.anticipation.every((a) => typeof a === 'number')) {
          err('anticipation must be number[6]');
        }
        if (!Array.isArray(e.board) || e.board.length !== R) {
          err(`board has ${e.board?.length} reels`);
          throw new Abort();
        }
        let shapeOk = true;
        e.board.forEach((col, r) => {
          if (!Array.isArray(col) || col.length !== PR) {
            err(`reel ${r} has ${col?.length} rows (expected ${PR})`);
            shapeOk = false;
          } else col.forEach((s, w) => checkRaw(s, `board[${r}][${w}]`, err));
        });
        if (!shapeOk) throw new Abort();
        if (e.paddingPositions !== undefined && (!Array.isArray(e.paddingPositions) || e.paddingPositions.length !== R)) {
          err('paddingPositions must be number[6]');
        }
        st.board = e.board.map((col) => col.map(cellFromRaw));
        // multiplier wilds on a reveal are exactly the Mega Mix sticky homes
        for (let r = 0; r < R; r++) {
          for (let w = 0; w < PR; w++) {
            const c = st.board[r][w];
            const home = st.sticky.get(key(r, w));
            if (home && st.phase === 'super') {
              if (c.name !== WILD || c.mult !== home.multiplier) {
                err(`sticky home ${key(r, w)} shows ${c.name} x${c.mult} (expected W x${home.multiplier})`);
              }
              c.sticky = home;
            } else if (c.mult > 1) err(`multiplier wild at ${key(r, w)} is not a sticky home`);
          }
        }
        if (!free) {
          st.meter = 0;
          st.phase = 'base';
        }
        st.reveals++;
        st.spinOpen = true;
        st.spinWin = 0;
        st.setWinSeen = false;
        st.step = null;
        st.pendingThresholds = [];
        break;
      }
      case 'stickyWilds': {
        if (st.phase !== 'super') err('stickyWilds outside Mega Mix');
        if (after !== 'reveal') err('stickyWilds must directly follow the free-spin reveal');
        if (!Array.isArray(e.wilds)) return err('wilds must be an array');
        const seen = new Set();
        for (const w of e.wilds) {
          checkPos(w, 'stickyWilds', err);
          const home = st.sticky.get(key(w.reel, w.row));
          if (!home) err(`sticky ${key(w.reel, w.row)} is not in the registry`);
          else if (home.multiplier !== w.multiplier) err(`sticky ${key(w.reel, w.row)} x${w.multiplier} (expected x${home.multiplier})`);
          seen.add(key(w.reel, w.row));
        }
        if (seen.size !== e.wilds.length) err('duplicate sticky cells');
        if (seen.size !== st.sticky.size) err(`stickyWilds lists ${seen.size} wilds, registry has ${st.sticky.size}`);
        break;
      }
      case 'winInfo': {
        if (!st.spinOpen) err('winInfo outside a spin');
        if (st.capped) err('winInfo after the win cap');
        if (st.pendingThresholds.length) err(`winInfo before the wildDrop of threshold ${st.pendingThresholds[0]}`);
        if (!Array.isArray(e.wins) || !e.wins.length) return err('wins must be a non-empty array');
        const expected = clustersOf(st.board);
        const sig = (symbol, keys) => `${symbol}:${[...keys].sort().join(' ')}`;
        const exp = new Map(expected.map((c) => [sig(c.symbol, c.cells), c]));
        const explode = new Set();
        const stickyHit = new Set();
        let total = 0;
        const claimed = new Set();
        for (const w of e.wins) {
          if (!Array.isArray(w.positions)) {
            err('win without positions');
            continue;
          }
          const keys = new Set();
          for (const p of w.positions) {
            checkPos(p, `win ${w.symbol}`, err);
            const c = st.board[p.reel]?.[p.row];
            if (c && c.name !== w.symbol && c.name !== WILD) err(`position ${key(p.reel, p.row)} holds ${c.name}, win claims ${w.symbol}`);
            keys.add(key(p.reel, p.row));
            explode.add(key(p.reel, p.row));
            if (c?.sticky) stickyHit.add(c.sticky);
          }
          if (keys.size !== w.positions.length) err(`win ${w.symbol} has duplicate positions`);
          if (w.clusterSize !== keys.size) err(`clusterSize ${w.clusterSize} != ${keys.size} positions`);
          const s = sig(w.symbol, keys);
          const c = exp.get(s);
          if (!c) {
            err(`cluster ${w.symbol} x${keys.size} is not a maximal cluster of the board`);
            continue;
          }
          claimed.add(s);
          const base = payFor(w.symbol, keys.size);
          const clusterMult = c.wildMult > 0 ? c.wildMult : 1;
          const m = w.meta ?? {};
          if (m.winWithoutMult !== base) err(`${w.symbol} x${keys.size}: winWithoutMult ${m.winWithoutMult} (paytable ${base})`);
          if (m.wildMult !== c.wildMult) err(`${w.symbol} x${keys.size}: wildMult ${m.wildMult} (board ${c.wildMult})`);
          if (m.clusterMult !== clusterMult) err(`${w.symbol} x${keys.size}: clusterMult ${m.clusterMult} (expected ${clusterMult})`);
          if (m.globalMult !== 1) err(`globalMult ${m.globalMult} (expected 1)`);
          if (!m.overlay || !keys.has(key(m.overlay.reel, m.overlay.row))) err(`overlay ${JSON.stringify(m.overlay)} not in the cluster`);
          if (w.win !== base * clusterMult) err(`${w.symbol} x${keys.size}: win ${w.win} (expected ${base * clusterMult})`);
          total += w.win;
        }
        for (const s of exp.keys()) if (!claimed.has(s)) err(`board cluster ${s} missing from winInfo`);
        if (e.totalWin !== total) err(`totalWin ${e.totalWin} != sum ${total}`);
        st.step = { explode, total, stickyHit, phase: 'winInfo' };
        break;
      }
      case 'meterUpdate': {
        if (after !== 'winInfo' || !st.step) return err('meterUpdate must directly follow winInfo');
        const delta = st.step.explode.size;
        if (e.delta !== delta) err(`delta ${e.delta} (exploding ${delta})`);
        const value = st.meter + delta;
        if (e.value !== value) err(`value ${e.value} (expected ${st.meter} + ${delta} = ${value})`);
        const thresholds = [];
        for (let t = METER.step; t <= value; t += METER.step) {
          if (t > st.meter && wildsForThreshold(t, st.phase) > 0) thresholds.push(t);
        }
        if (JSON.stringify(e.thresholds) !== JSON.stringify(thresholds)) {
          err(`thresholds ${JSON.stringify(e.thresholds)} (expected ${JSON.stringify(thresholds)})`);
        }
        st.meter = value;
        st.step.thresholds = thresholds;
        st.step.phase = 'meter';
        break;
      }
      case 'updateTumbleWin': {
        if (after !== 'meterUpdate' || st.step?.phase !== 'meter') return err('updateTumbleWin must follow meterUpdate');
        st.spinWin += st.step.total;
        let expect = st.spinWin;
        if (st.roundTotal + st.spinWin >= WINCAP) {
          expect = WINCAP - st.roundTotal;
          st.spinWin = expect;
          st.capHitPending = true;
        }
        if (e.amount !== expect) err(`amount ${e.amount} (expected ${expect})`);
        if (!st.capHitPending) {
          for (const entry of st.step.stickyHit) {
            entry.multiplier = Math.min(FEATURES.super.multCap, entry.multiplier + FEATURES.super.growPerWin);
          }
        }
        st.step.phase = 'win';
        break;
      }
      case 'wincap': {
        if (!st.capHitPending) err('wincap without reaching the cap');
        if (e.amount !== WINCAP) err(`amount ${e.amount} (expected ${WINCAP})`);
        st.capped = true;
        st.capHitPending = false;
        st.wincapSeen = true;
        st.step = null;
        break;
      }
      case 'tumbleBoard': {
        if (st.capHitPending || st.capped) err('tumbleBoard after the win cap was reached');
        if (after !== 'updateTumbleWin' || st.step?.phase !== 'win') return err('tumbleBoard must follow updateTumbleWin');
        const expl = e.explodingSymbols ?? [];
        const keys = new Set();
        for (const p of expl) {
          checkPos(p, 'explodingSymbols', err);
          keys.add(key(p.reel, p.row));
        }
        if (keys.size !== expl.length) err('duplicate exploding positions');
        const want = st.step.explode;
        if (keys.size !== want.size || [...want].some((k) => !keys.has(k))) err('explodingSymbols != union of the winning positions');
        if (!Array.isArray(e.newSymbols) || e.newSymbols.length !== R) return err('newSymbols must have 6 reels');
        const next = [];
        for (let r = 0; r < R; r++) {
          const gone = new Set(expl.filter((p) => p.reel === r).map((p) => p.row));
          const add = e.newSymbols[r];
          if (!Array.isArray(add) || add.length !== gone.size) err(`reel ${r}: ${add?.length} new symbols for ${gone.size} exploded`);
          (add ?? []).forEach((s, j) => checkRaw(s, `newSymbols[${r}][${j}]`, err));
          if ((add ?? []).some((s) => s.multiplier !== undefined)) err(`reel ${r}: new symbols cannot carry multipliers`);
          const col = [...(add ?? []).map(cellFromRaw), ...st.board[r].filter((_, w) => !gone.has(w))];
          if (col.length !== PR) {
            err(`reel ${r} has ${col.length} rows after the tumble`);
            throw new Abort();
          }
          next.push(col);
        }
        st.board = next;
        st.pendingThresholds = [...st.step.thresholds];
        st.step = null;
        break;
      }
      case 'wildDrop': {
        if (after !== 'tumbleBoard' && after !== 'wildDrop') err('wildDrop must follow tumbleBoard (or another wildDrop)');
        const t = st.pendingThresholds.shift();
        if (t === undefined) return err('wildDrop without a crossed threshold');
        if (e.threshold !== t) err(`threshold ${e.threshold} (expected ${t})`);
        if (!Array.isArray(e.wilds)) return err('wilds must be an array');
        const homes = new Set(st.sticky.keys());
        let candidates = 0;
        for (let r = 0; r < R; r++) for (let w = V0; w <= V1; w++) if (st.board[r][w].name !== WILD && !homes.has(key(r, w))) candidates++;
        const want = Math.min(wildsForThreshold(t, st.phase), candidates);
        if (e.wilds.length !== want) err(`${e.wilds.length} wilds (expected ${want})`);
        const feat = st.phase === 'base' ? null : FEATURES[st.phase];
        const allowed = feat ? Object.keys(feat.multipliers).map(Number) : [1];
        const used = new Set();
        for (const w of e.wilds) {
          checkPos(w, 'wildDrop', err);
          const k = key(w.reel, w.row);
          if (used.has(k)) err(`two wilds on ${k}`);
          used.add(k);
          const c = st.board[w.reel]?.[w.row];
          if (!c) continue;
          if (c.name === WILD) err(`target ${k} is already wild`);
          if (homes.has(k)) err(`target ${k} is a sticky home`);
          if (!allowed.includes(w.multiplier)) err(`multiplier ${w.multiplier} not allowed in ${st.phase}`);
          const sticky = Boolean(feat?.sticky) && st.sticky.size < feat.maxSticky;
          if (w.sticky !== sticky) err(`${k}: sticky ${w.sticky} (expected ${sticky})`);
          const cell = { name: WILD, mult: w.multiplier, sticky: null };
          if (sticky) {
            cell.sticky = { reel: w.reel, row: w.row, multiplier: w.multiplier };
            st.sticky.set(k, cell.sticky);
          }
          st.board[w.reel][w.row] = cell;
        }
        break;
      }
      case 'setWin': {
        if (!st.spinOpen) err('setWin outside a spin');
        if (st.pendingThresholds.length) err('setWin before all wildDrops');
        if (!st.capped && spinBoardHasWins()) err('spin ended on a board that still has wins');
        if (e.amount !== st.spinWin || e.amount <= 0) err(`amount ${e.amount} (spin win ${st.spinWin})`);
        if (e.winLevel !== winLevel(e.amount, 'standard')) err(`winLevel ${e.winLevel} (expected ${winLevel(e.amount, 'standard')})`);
        st.setWinSeen = true;
        break;
      }
      case 'setTotalWin': {
        if (!st.spinOpen) err('setTotalWin outside a spin');
        if (st.pendingThresholds.length) err('setTotalWin before all wildDrops');
        if (st.spinWin > 0 && !st.setWinSeen) err('winning spin without setWin');
        if (st.spinWin === 0 && spinBoardHasWins()) err('spin ended on a board that still has wins');
        st.roundTotal += st.spinWin;
        if (e.amount !== st.roundTotal) err(`amount ${e.amount} (running total ${st.roundTotal})`);
        if (st.phase === 'base' && st.reveals === 1) {
          st.baseWins = st.spinWin;
          st.baseMeter = st.meter;
        } else st.fsWins += st.spinWin;
        st.spinOpen = false;
        st.spinsDone++;
        break;
      }
      case 'featureTrigger': {
        if (st.reveals !== 1 || st.spinOpen || after !== 'setTotalWin') err('featureTrigger must follow the base spin');
        if (st.capped) err('featureTrigger after the win cap');
        const f = st.meter >= METER.superAt ? 'super' : st.meter >= METER.bonusAt ? 'bonus' : null;
        if (e.feature !== f) err(`feature ${e.feature} for base meter ${st.meter} (expected ${f})`);
        if (e.meter !== st.meter) err(`meter ${e.meter} (base meter ${st.meter})`);
        if (!FEATURES[e.feature] || e.totalFs !== FEATURES[e.feature].freeSpins) err(`totalFs ${e.totalFs}`);
        st.feature = e.feature;
        st.phase = e.feature;
        st.meter = 0;
        st.fsTotal = e.totalFs;
        st.fsCurrent = 0;
        st.sticky.clear();
        break;
      }
      case 'updateFreeSpin': {
        if (!st.feature) err('updateFreeSpin outside a feature');
        if (st.spinOpen) err('updateFreeSpin inside a spin');
        if (st.capped) err('free spin after the win cap');
        if (st.phase === 'bonus' && st.meter >= METER.superAt && !st.upgraded) err('missing featureUpgrade before the next spin');
        if (e.amount !== st.fsCurrent + 1) err(`amount ${e.amount} (expected ${st.fsCurrent + 1})`);
        if (e.total !== st.fsTotal) err(`total ${e.total} (expected ${st.fsTotal})`);
        st.fsCurrent = e.amount;
        break;
      }
      case 'featureUpgrade': {
        if (st.phase !== 'bonus' || st.upgraded) err('featureUpgrade outside Juke Jam / twice');
        if (after !== 'setTotalWin') err('featureUpgrade must follow the free spin setTotalWin');
        if (st.meter < METER.superAt) err(`upgrade at meter ${st.meter}`);
        if (e.from !== 'bonus' || e.to !== 'super' || e.addFs !== FEATURES.upgradeAddFs) err(`bad payload ${JSON.stringify(e)}`);
        st.upgraded = true;
        st.phase = 'super';
        st.meter = 0;
        st.fsTotal += e.addFs;
        st.sticky.clear();
        break;
      }
      case 'freeSpinEnd': {
        if (!st.feature) err('freeSpinEnd without a feature');
        if (st.spinOpen) err('freeSpinEnd inside a spin');
        if (!st.capped && st.fsCurrent !== st.fsTotal) err(`freeSpinEnd after ${st.fsCurrent}/${st.fsTotal} spins`);
        if (!st.capped && st.phase === 'bonus' && st.meter >= METER.superAt && !st.upgraded) err('missing featureUpgrade');
        if (e.amount !== st.fsWins) err(`amount ${e.amount} (free-spin wins ${st.fsWins})`);
        if (e.winLevel !== winLevel(e.amount, 'endFeature')) err(`winLevel ${e.winLevel} (expected ${winLevel(e.amount, 'endFeature')})`);
        st.feature = null;
        st.phase = 'base';
        break;
      }
      case 'finalWin': {
        if (i !== book.events.length - 1) err('finalWin is not the last event');
        if (st.spinOpen) err('finalWin inside a spin');
        if (st.feature) err('finalWin before freeSpinEnd');
        if (e.amount !== st.roundTotal) err(`amount ${e.amount} (round total ${st.roundTotal})`);
        if (e.amount !== book.payoutMultiplier) err(`amount ${e.amount} != payoutMultiplier ${book.payoutMultiplier}`);
        st.finalSeen = true;
        break;
      }
      default:
        err('unknown event type');
    }
    prev = e;
  };
  try {
    book.events.forEach(replay);
  } catch (e) {
    // Abort: the board model is broken beyond this point (already reported); anything else is a crash
    if (!(e instanceof Abort)) err(`checker crashed: ${e instanceof Error ? e.message : String(e)}`);
    return errors;
  }

  ctx = name;
  if (!st.finalSeen) err('no finalWin');
  if (st.capHitPending) err('cap reached without a wincap event');
  if (st.reveals === 0) err('no reveal');
  if (!st.capped && st.baseMeter >= METER.bonusAt && !book.events.some((e) => e.type === 'featureTrigger')) {
    err(`base meter ${st.baseMeter} but no featureTrigger`);
  }
  if (st.capped !== (book.payoutMultiplier === WINCAP && st.wincapSeen)) err('wincap book must pay exactly the cap');
  if (book.baseGameWins !== undefined && Math.round(book.baseGameWins * 100) !== st.baseWins) err(`baseGameWins ${book.baseGameWins} (${st.baseWins / 100})`);
  if (book.freeGameWins !== undefined && Math.round(book.freeGameWins * 100) !== st.fsWins) err(`freeGameWins ${book.freeGameWins} (${st.fsWins / 100})`);
  const trig = book.events.find((e) => e.type === 'featureTrigger');
  const expCriteria = st.wincapSeen ? 'wincap' : trig ? trig.feature : book.payoutMultiplier === 0 ? '0' : 'basegame';
  if (!['dev_fixture'].includes(book.criteria) && book.criteria !== expCriteria) err(`criteria "${book.criteria}" (expected "${expCriteria}")`);
  return errors;
};

/** books of a file: array (pool), {scenario: book} (fixtures) or a single book */
export const booksOfFile = (json) => {
  if (Array.isArray(json)) return json.map((b, i) => [`[${i}] id ${b?.id}`, b]);
  if (json && Array.isArray(json.events)) return [[`id ${json.id}`, json]];
  if (json && typeof json === 'object') return Object.entries(json).map(([k, b]) => [`${k} (id ${b?.id})`, b]);
  return [];
};

const main = () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = path.resolve(here, '../../../mock/games/bass-drop/books');
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  let files = args.filter((a) => !a.startsWith('--'));
  if (!files.length) {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json') && (all || /^books_.*\.json$|_fixtures\.json$/.test(f)))
      .sort()
      .map((f) => path.join(dir, f));
  }
  let bad = 0;
  let total = 0;
  const ids = new Map();
  for (const file of files) {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    const books = booksOfFile(json);
    let fileBad = 0;
    for (const [label, book] of books) {
      total++;
      const errs = validateBook(book, `${path.basename(file)} ${label}`);
      if (errs.length) {
        fileBad++;
        for (const m of errs.slice(0, 12)) process.stdout.write(`  ${m}\n`);
      }
      if (isInt(book?.id)) {
        const prevFile = ids.get(book.id);
        if (prevFile && prevFile !== path.basename(file)) process.stdout.write(`  note: id ${book.id} appears in ${prevFile} and ${path.basename(file)}\n`);
        ids.set(book.id, path.basename(file));
      }
    }
    bad += fileBad;
    process.stdout.write(`${fileBad ? 'FAIL' : 'ok  '} ${path.relative(process.cwd(), file)}: ${books.length - fileBad}/${books.length} books valid\n`);
  }
  process.stdout.write(`${bad ? 'FAILED' : 'ALL VALID'}: ${total - bad}/${total} books\n`);
  process.exitCode = bad ? 1 : 0;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
