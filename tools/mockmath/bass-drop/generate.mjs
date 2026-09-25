#!/usr/bin/env node
/**
 * SWAMP FUNK: BASS DROP — deterministic mock book generator.
 *
 *   node tools/mockmath/bass-drop/generate.mjs [--out mock/games/bass-drop/books] [--search 400000] [--dry]
 *
 * Writes (every book passes validate.mjs before anything is written):
 *   base_fixtures.json    {scenario: book}: loss, small_win, tumble_chain, meter_10, meter_30,
 *                         bonus_trigger, super_trigger, bonus_upgrade, bigwin, wincap
 *   books_base_200.json   200 random BASE rounds            (ids 10001..)
 *   books_bonus_50.json   50 BONUS buys  (Juke Jam forced)   (ids 20001..)
 *   books_super_50.json   50 SUPER buys  (Mega Mix forced)   (ids 30001..)
 * Scenario books are found by searching base seeds in order (capped by --search); the wincap
 * book re-plays the first Mega Mix trigger's free spins on the `wcap` reelset until the round
 * caps (math-sdk style forcing reelset). Same code + same config = byte-identical output.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BET_MODES, WINCAP } from './config.mjs';
import { buildStrips, playRound } from './engine.mjs';
import { validateBook } from './validate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : dflt;
};
const OUT = path.resolve(arg('out', path.resolve(here, '../../../mock/games/bass-drop/books')));
const SEARCH_CAP = Number(arg('search', 400000));
const WINCAP_CAP = Number(arg('wincap-search', 20000));
const BUY_CAP = 2_000_000;
const DRY = process.argv.includes('--dry');
const out = (s = '') => process.stdout.write(`${s}\n`);
const x = (u) => `${(u / 100).toFixed(2)}x`;

/**
 * Scenario predicates on a round summary, in assignment order. `strict` is the preferred
 * (more illustrative) match, `loose` the fallback when the search cap runs out first.
 */
const SCENARIOS = [
  {
    key: 'loss',
    loose: (m) => m.payout === 0,
    strict: (m) => m.payout === 0,
  },
  {
    key: 'small_win',
    loose: (m) => !m.feature && m.baseTumbles === 1 && m.payout > 0 && m.payout < 100,
    strict: (m) => !m.feature && m.baseTumbles === 1 && m.payout >= 40 && m.payout < 100,
  },
  {
    key: 'tumble_chain',
    loose: (m) => !m.feature && m.baseTumbles >= 3 && m.baseMeter < 20,
    strict: (m) => !m.feature && m.baseTumbles >= 4 && m.baseMeter < 30 && m.baseDropWildWins >= 1,
  },
  {
    key: 'meter_10',
    loose: (m) => !m.feature && m.baseMeter >= 10 && m.baseMeter < 20 && m.baseDrops === 1,
    strict: (m) => !m.feature && m.baseMeter >= 10 && m.baseMeter < 20 && m.baseDrops === 1 && m.baseDropWildWins >= 1,
  },
  {
    key: 'meter_30',
    loose: (m) => !m.feature && m.baseMeter >= 30 && m.baseMeter < 40 && m.baseDrops === 3,
    strict: (m) => !m.feature && m.baseMeter >= 30 && m.baseMeter < 40 && m.baseDrops === 3 && m.baseDropWildWins >= 2,
  },
  {
    key: 'bonus_trigger',
    loose: (m) => m.feature === 'bonus' && !m.upgraded && !m.capped,
    strict: (m) => m.feature === 'bonus' && !m.upgraded && !m.capped && m.multWins >= 3 && m.payout >= 2000 && m.payout <= 30000,
  },
  {
    key: 'super_trigger',
    loose: (m) => m.feature === 'super' && !m.capped,
    strict: (m) => m.feature === 'super' && !m.capped && m.maxSticky >= 4 && m.stickyGrowths >= 3 && m.payout >= 10000 && m.payout <= 100000,
  },
  {
    key: 'bonus_upgrade',
    loose: (m) => m.feature === 'bonus' && m.upgraded && !m.capped,
    strict: (m) => m.feature === 'bonus' && m.upgraded && !m.capped && m.maxSticky >= 2 && m.stickyGrowths >= 1,
  },
  {
    key: 'bigwin',
    loose: (m) => m.payout >= 1500 && !m.capped,
    strict: (m) => !m.feature && m.payout >= 1500,
  },
];

const summaryLine = (key, book, m) =>
  `${key.padEnd(14)} id ${String(book.id).padEnd(6)} ${x(book.payoutMultiplier).padStart(9)}  base meter ${String(m.baseMeter).padStart(3)}  tumbles ${m.baseTumbles}  drops ${m.drops}${m.feature ? `  ${m.feature}${m.upgraded ? '->super' : ''} fs ${m.fsSpins} fsMeter ${m.featureMeter} sticky ${m.maxSticky} (max x${m.maxStickyMult})` : ''}  events ${book.events.length}${m.capped ? '  CAPPED' : ''}`;

const main = () => {
  const strips = buildStrips();
  const t0 = performance.now();

  // ---- scenario fixtures -------------------------------------------------------------------
  const strict = new Map();
  const loose = new Map();
  const used = new Set();
  /** first base seed that triggers Mega Mix (the wincap search replays its free spins) */
  let firstSuper = null;
  let seed = 0;
  for (; seed < SEARCH_CAP; seed++) {
    if (SCENARIOS.every((s) => strict.has(s.key)) && firstSuper !== null) break;
    const r = playRound({ strips, seed: ['fixture', seed], id: 0 });
    const m = r.summary;
    if (m.feature === 'super' && firstSuper === null) firstSuper = seed;
    for (const s of SCENARIOS) {
      if (!strict.has(s.key) && s.strict(m)) {
        strict.set(s.key, { seed, m });
        used.add(seed);
        break;
      }
      if (!loose.has(s.key) && s.loose(m)) loose.set(s.key, { seed, m });
    }
  }
  const fixtures = {};
  const fixtureInfo = [];
  let nextId = 1001;
  const assigned = new Set();
  for (const s of SCENARIOS) {
    let hit = strict.get(s.key);
    if (!hit && loose.has(s.key) && !used.has(loose.get(s.key).seed) && !assigned.has(loose.get(s.key).seed)) hit = loose.get(s.key);
    if (!hit) {
      out(`  WARNING: no book for scenario "${s.key}" within ${SEARCH_CAP} seeds`);
      continue;
    }
    assigned.add(hit.seed);
    const r = playRound({ strips, seed: ['fixture', hit.seed], id: nextId++ });
    fixtures[s.key] = r.book;
    fixtureInfo.push(summaryLine(s.key, r.book, r.summary) + (strict.has(s.key) ? '' : '  (fallback match)') + `  seed ${hit.seed}`);
  }

  // ---- wincap: first Mega Mix trigger, free spins forced onto the wcap reelset ---------------
  if (firstSuper !== null) {
    let capped = null;
    for (let a = 0; a < WINCAP_CAP && !capped; a++) {
      const r = playRound({ strips, seed: ['fixture', firstSuper], id: nextId, fsReelset: 'wcap', featureSeed: ['wincap', a] });
      if (r.summary.capped) capped = { r, a };
    }
    if (capped) {
      fixtures.wincap = capped.r.book;
      fixtureInfo.push(summaryLine('wincap', capped.r.book, capped.r.summary) + `  seed ${firstSuper} / wcap attempt ${capped.a}`);
      nextId++;
    } else out(`  WARNING: no capped round within ${WINCAP_CAP} forced attempts`);
  } else out('  WARNING: no Mega Mix trigger found — wincap fixture skipped');
  const t1 = performance.now();

  // ---- pools -------------------------------------------------------------------------------
  const pool = (mode, n, idBase) => {
    const { require } = BET_MODES[mode];
    const books = [];
    let attempts = 0;
    const counts = {};
    for (let i = 0; i < n; i++) {
      const r = playRound({ strips, seed: [`pool-${mode}`, i], id: idBase + i + 1, require, maxAttempts: require ? BUY_CAP : 1 });
      if (!r) throw new Error(`${mode} book ${i}: no base spin earned "${require}" within ${BUY_CAP} re-draws`);
      attempts += r.attempts;
      counts[r.book.criteria] = (counts[r.book.criteria] ?? 0) + 1;
      books.push(r);
    }
    const pays = books.map((b) => b.book.payoutMultiplier);
    const avg = pays.reduce((a, b) => a + b, 0) / n;
    return {
      books: books.map((b) => b.book),
      line: `${mode.padEnd(5)} x${n}: avg ${x(avg)} (${((avg / (BET_MODES[mode].cost * 100)) * 100).toFixed(1)}% of cost), max ${x(Math.max(...pays))}, criteria ${JSON.stringify(counts)}${require ? `, avg base re-draws ${(attempts / n).toFixed(0)}` : ''}, upgrades ${books.filter((b) => b.summary.upgraded).length}`,
    };
  };
  const base = pool('BASE', 200, 10000);
  const bonus = pool('BONUS', 50, 20000);
  const sup = pool('SUPER', 50, 30000);
  const t2 = performance.now();

  // ---- validate everything before writing ----------------------------------------------------
  const files = {
    'base_fixtures.json': fixtures,
    'books_base_200.json': base.books,
    'books_bonus_50.json': bonus.books,
    'books_super_50.json': sup.books,
  };
  let errors = 0;
  for (const [file, content] of Object.entries(files)) {
    const list = Array.isArray(content) ? content.map((b) => [`id ${b.id}`, b]) : Object.entries(content);
    for (const [label, book] of list) {
      const errs = validateBook(book, `${file} ${label}`);
      errors += errs.length;
      for (const m of errs.slice(0, 10)) out(`  INVALID ${m}`);
    }
  }
  if (errors) {
    out(`generation aborted: ${errors} validation errors`);
    process.exitCode = 1;
    return;
  }

  out(`BASS DROP mock books (${((t2 - t0) / 1000).toFixed(1)}s; fixture search ${seed} seeds in ${((t1 - t0) / 1000).toFixed(1)}s)`);
  out('fixtures (base_fixtures.json):');
  for (const l of fixtureInfo) out(`  ${l}`);
  out('pools:');
  for (const p of [base, bonus, sup]) out(`  ${p.line}`);
  out(`win cap ${x(WINCAP)}`);

  if (DRY) return;
  fs.mkdirSync(OUT, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(OUT, file);
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(content));
    fs.renameSync(tmp, target);
    out(`wrote ${path.relative(process.cwd(), target)} (${(fs.statSync(target).size / 1024).toFixed(0)} KB)`);
  }
};

main();
