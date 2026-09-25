#!/usr/bin/env node
/**
 * Sanity statistics of the bass-drop mock math (no RTP tuning — just "does it feel like a slot").
 *
 *   node tools/mockmath/bass-drop/stats.mjs [--spins 100000] [--buys 300] [--seed stats]
 *
 * Base: hit rate, average win (RTP estimate), tumble / meter distributions, feature frequency
 * per 1000 spins, max win. Buys: average payout vs cost of BONUS / SUPER (feature EV).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BET_MODES, METER, WINCAP } from './config.mjs';
import { buildStrips, playRound } from './engine.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : dflt;
};

const SPINS = Number(arg('spins', 100000));
const BUYS = Number(arg('buys', 300));
const SEED = arg('seed', 'stats');
const out = (s = '') => process.stdout.write(`${s}\n`);
const pct = (n, d) => `${((100 * n) / Math.max(1, d)).toFixed(2)}%`;
const x = (units) => `${(units / 100).toFixed(2)}x`;

/** base-game statistics over SPINS natural rounds */
export const baseStats = (strips, spins, seed) => {
  const s = {
    spins,
    hits: 0,
    total: 0,
    baseTotal: 0,
    fsTotal: 0,
    max: 0,
    maxId: -1,
    capped: 0,
    bonus: 0,
    super: 0,
    upgraded: 0,
    bigwins: 0,
    meterBuckets: new Array(8).fill(0),
    tumbleHist: new Array(8).fill(0),
    drops: 0,
    featurePay: { bonus: [], super: [] },
  };
  for (let i = 0; i < spins; i++) {
    const r = playRound({ strips, seed: [seed, 'BASE', i], id: i });
    const { summary: m } = r;
    if (m.baseTumbles > 0) s.hits++;
    s.total += m.payout;
    s.baseTotal += r.book.baseGameWins * 100;
    s.fsTotal += r.book.freeGameWins * 100;
    if (m.payout > s.max) {
      s.max = m.payout;
      s.maxId = i;
    }
    if (m.payout >= 1500) s.bigwins++;
    if (m.capped) s.capped++;
    if (m.feature) {
      s[m.feature]++;
      s.featurePay[m.feature].push(m.payout);
    }
    if (m.upgraded) s.upgraded++;
    s.meterBuckets[Math.min(7, m.baseMeter === 0 ? 0 : Math.floor(m.baseMeter / 10) + 1)]++;
    s.tumbleHist[Math.min(7, m.baseTumbles)]++;
    s.drops += m.baseDrops;
  }
  return s;
};

/** forced-feature statistics (bonus buys) */
export const buyStats = (strips, mode, n, seed) => {
  const { require, cost } = BET_MODES[mode];
  let total = 0;
  let attempts = 0;
  let upgraded = 0;
  let capped = 0;
  let max = 0;
  let fsSpins = 0;
  let maxSticky = 0;
  let maxStickyMult = 0;
  let wilds = 0;
  let featureMeter = 0;
  const pays = [];
  for (let i = 0; i < n; i++) {
    const r = playRound({ strips, seed: [seed, mode, i], id: i, require, maxAttempts: 2_000_000 });
    if (!r) throw new Error(`${mode} buy ${i}: no base spin reached the ${require} meter within the attempt cap`);
    attempts += r.attempts;
    total += r.summary.payout;
    pays.push(r.summary.payout);
    if (r.summary.upgraded) upgraded++;
    if (r.summary.capped) capped++;
    max = Math.max(max, r.summary.payout);
    fsSpins += r.summary.fsSpins;
    maxSticky = Math.max(maxSticky, r.summary.maxSticky);
    maxStickyMult = Math.max(maxStickyMult, r.summary.maxStickyMult);
    wilds += r.summary.wildsDropped;
    featureMeter += r.summary.featureMeter;
  }
  pays.sort((a, b) => a - b);
  return {
    mode,
    n,
    cost,
    avg: total / n,
    rtp: total / n / (cost * 100),
    median: pays[Math.floor(n / 2)],
    max,
    upgraded,
    capped,
    avgAttempts: attempts / n,
    avgFs: fsSpins / n,
    maxSticky,
    maxStickyMult,
    avgWilds: wilds / n,
    avgFeatureMeter: featureMeter / n,
  };
};

const main = () => {
  const strips = buildStrips();
  const t0 = performance.now();
  const s = baseStats(strips, SPINS, SEED);
  const t1 = performance.now();
  out(`BASS DROP mock math — ${SPINS} base spins (seed "${SEED}", ${((t1 - t0) / 1000).toFixed(1)}s)`);
  out(`  hit rate          ${pct(s.hits, s.spins)}   (1 in ${(s.spins / Math.max(1, s.hits)).toFixed(2)})`);
  out(`  avg win / spin    ${x(s.total / s.spins)}  (RTP est. ${pct(s.total, s.spins * 100)}; base ${pct(s.baseTotal, s.spins * 100)}, features ${pct(s.fsTotal, s.spins * 100)})`);
  out(`  max win           ${x(s.max)} (spin ${s.maxId})${s.capped ? `, capped ${s.capped}x` : ''}   big wins (>=15x) ${s.bigwins}`);
  out(`  wild drops / spin ${(s.drops / s.spins).toFixed(3)}`);
  out(`  tumbles per spin  ${s.tumbleHist.map((n, i) => `${i === 7 ? '7+' : i}:${pct(n, s.spins)}`).join('  ')}`);
  const labels = ['0', '1-9', '10-19', '20-29', '30-39', '40-49', '50-59', '60+'];
  out(`  base meter        ${s.meterBuckets.map((n, i) => `${labels[i]}:${pct(n, s.spins)}`).join('  ')}`);
  const per1000 = (n) => ((1000 * n) / s.spins).toFixed(2);
  out(`  features / 1000   Juke Jam ${per1000(s.bonus)} (1 in ${(s.spins / Math.max(1, s.bonus)).toFixed(0)})   Mega Mix ${per1000(s.super)} (1 in ${(s.spins / Math.max(1, s.super)).toFixed(0)})   upgrades ${s.upgraded}`);
  for (const k of ['bonus', 'super']) {
    const p = s.featurePay[k];
    if (p.length) out(`  natural ${k.padEnd(5)}     n=${p.length} avg ${x(p.reduce((a, b) => a + b, 0) / p.length)}`);
  }
  if (BUYS > 0) {
    for (const mode of ['BONUS', 'SUPER']) {
      const t2 = performance.now();
      const b = buyStats(strips, mode, BUYS, SEED);
      const t3 = performance.now();
      out(
        `  buy ${mode.padEnd(5)} (${b.cost}x) n=${b.n}: avg ${x(b.avg)} (RTP est. ${(b.rtp * 100).toFixed(1)}%), median ${x(b.median)}, max ${x(b.max)}, upgraded ${b.upgraded}, capped ${b.capped}, avg fs ${b.avgFs.toFixed(1)}, avg feature meter ${b.avgFeatureMeter.toFixed(1)}, avg wilds ${b.avgWilds.toFixed(1)}, max sticky ${b.maxSticky} (max x${b.maxStickyMult}), base re-draws/book ${b.avgAttempts.toFixed(0)} (${((t3 - t2) / 1000).toFixed(1)}s)`,
      );
    }
  }
  out(`  win cap ${x(WINCAP)}; meter thresholds bonus ${METER.bonusAt} / super ${METER.superAt}`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
