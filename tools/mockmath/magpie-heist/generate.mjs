#!/usr/bin/env node
/**
 * MAGPIE HEIST — deterministic mock book generator.
 *
 *   node tools/mockmath/magpie-heist/generate.mjs [--out mock/games/magpie-heist/books] [--search 400000] [--dry]
 *
 * Writes (every book passes validate.mjs before anything is written):
 *   base_fixtures.json    {scenario: book} (see SCENARIOS; ids 1001..)
 *   books_base_300.json   300 random BASE rounds                    (ids 10001..)
 *   books_hunt_100.json   100 Bonus Hunt rounds (x3, more scatters)  (ids 40001..)
 *   books_stars_100.json  100 Star Spins rounds (x50, a star a spin) (ids 50001..)
 *   books_prowl_50.json   50 Night Prowl buys (x100)                 (ids 20001..)
 *   books_vault_50.json   50 Vault Raid buys (x250)                  (ids 30001..)
 * Same code + same config = byte-identical output.
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
const OUT = path.resolve(arg('out', path.resolve(here, '../../../mock/games/magpie-heist/books')));
const SEARCH_CAP = Number(arg('search', 400000));
const BUY_CAP = 5_000_000;
const DRY = process.argv.includes('--dry');
const out = (s = '') => process.stdout.write(`${s}\n`);
const x = (u) => `${(u / 100).toFixed(2)}x`;

/** base-game facts of a book (events before featureTrigger) + whole-round facts */
const scan = (book) => {
  const f = { tumbles: 0, extraCascade: 0, acts: 0, diamonds: 0, boosts: 0, nests: 0, rounds: 0, squares: 0, fsActs: 0, fsNests: 0, retrig: 0, upgrade: false, keepActs: 0 };
  let inFs = false;
  for (const e of book.events) {
    if (e.type === 'featureTrigger') inFs = true;
    if (e.type === 'featureRetrigger') f.retrig++;
    if (e.type === 'featureUpgrade') f.upgrade = true;
    if (inFs) {
      if (e.type === 'starActivate') f.fsActs++;
      if (e.type === 'nestCollect') f.fsNests++;
      if (e.type === 'glintReset' && e.keep) f.keepActs++;
      continue;
    }
    if (e.type === 'tumbleBoard') f.tumbles++;
    if (e.type === 'starActivate') {
      f.acts++;
      f.squares = Math.max(f.squares, e.squares.length);
    }
    if (e.type === 'glintReveal') f.rounds = Math.max(f.rounds, e.round);
    if (e.type === 'diamondBoost') {
      f.diamonds++;
      if (e.targets.length) f.boosts++;
    }
    if (e.type === 'nestCollect') f.nests++;
  }
  return f;
};

/** scenario predicates on (summary m, scan f) in assignment order */
const SCENARIOS = [
  { key: 'loss', test: (m) => m.payout === 0 },
  { key: 'small_win', test: (m, f) => !m.feature && f.tumbles === 1 && !f.acts && m.payout >= 30 && m.payout < 100 },
  { key: 'cascade_chain', test: (m, f) => !m.feature && f.tumbles >= 4 && m.superCascades >= 2 && !f.acts },
  { key: 'star_coins', test: (m, f) => !m.feature && f.acts === 1 && !f.diamonds && !f.nests && f.squares >= 7 && m.payout < 3000 },
  { key: 'star_diamond', test: (m, f) => !m.feature && f.acts === 1 && f.boosts >= 1 && !f.nests && f.squares >= 6 },
  { key: 'star_nest', test: (m, f) => !m.feature && f.acts === 1 && f.nests >= 1 && f.rounds >= 2 && f.squares >= 6 },
  { key: 'prowl_trigger', test: (m, f) => m.feature === 'prowl' && !m.upgraded && !m.capped && f.fsActs >= 2 && f.retrig === 0 && m.payout >= 3000 && m.payout <= 40000 },
  { key: 'prowl_retrigger', test: (m, f) => m.feature === 'prowl' && !m.upgraded && !m.capped && f.retrig >= 1 && f.fsActs >= 1 },
  { key: 'prowl_upgrade', test: (m, f) => m.feature === 'prowl' && m.upgraded && !m.capped && f.keepActs >= 1 },
  { key: 'vault_trigger', test: (m, f) => m.feature === 'vault' && !m.capped && f.keepActs >= 2 && m.payout >= 5000 },
  { key: 'bigwin', test: (m, f) => !m.feature && m.payout >= 2000 && !m.capped },
];

const line = (key, book, m, f) =>
  `${key.padEnd(16)} id ${String(book.id).padEnd(6)} ${x(book.payoutMultiplier).padStart(10)}  tumbles ${f.tumbles}  acts ${f.acts} (sq ${f.squares}, rounds ${f.rounds}, diamonds ${f.diamonds}, nests ${f.nests})${m.feature ? `  ${m.feature}${m.upgraded ? '->vault' : ''} fs ${m.fsSpins}/${m.fsTotal} fsActs ${f.fsActs} retrig ${f.retrig}` : ''}  events ${book.events.length}${m.capped ? '  CAPPED' : ''}`;

const main = () => {
  const strips = buildStrips();
  const t0 = performance.now();
  const fixtures = {};
  const info = [];
  let nextId = 1001;

  // ---- scenario fixtures (BASE seeds in order) ---------------------------------------------
  const found = new Map();
  let seed = 0;
  for (; seed < SEARCH_CAP && found.size < SCENARIOS.length; seed++) {
    const r = playRound({ strips, seed: ['fixture', seed], id: 0 });
    const f = scan(r.book);
    for (const s of SCENARIOS) {
      if (!found.has(s.key) && s.test(r.summary, f)) {
        found.set(s.key, seed);
        break;
      }
    }
  }
  for (const s of SCENARIOS) {
    if (!found.has(s.key)) {
      out(`  WARNING: no book for scenario "${s.key}" within ${SEARCH_CAP} seeds`);
      continue;
    }
    const r = playRound({ strips, seed: ['fixture', found.get(s.key)], id: nextId++ });
    fixtures[s.key] = r.book;
    info.push(`${line(s.key, r.book, r.summary, scan(r.book))}  seed ${found.get(s.key)}`);
  }

  // ---- Starfall: Bonus Hunt base spins re-drawn until 5+ scatters land -----------------------
  {
    let hit = null;
    for (let a = 0; a < 200 && !hit; a++) {
      const r = playRound({ strips, seed: ['starfall', a], id: nextId, mode: 'HUNT', reelset: 'hunt', require: 'starfall', maxAttempts: BUY_CAP });
      if (r && !r.summary.capped && scan(r.book).fsActs >= 3) hit = r;
    }
    if (hit) {
      fixtures.starfall_trigger = hit.book;
      info.push(line('starfall_trigger', hit.book, hit.summary, scan(hit.book)));
      nextId++;
    } else out('  WARNING: no Starfall book');
  }

  // ---- win cap: a Vault Raid buy, free spins forced onto the wcap reelset ---------------------
  {
    let hit = null;
    for (let a = 0; a < 4000 && !hit; a++) {
      const r = playRound({ strips, seed: ['wincap', 0], id: nextId, require: 'vault', maxAttempts: BUY_CAP, fsReelset: 'wcap', featureSeed: ['wincap', a] });
      if (r?.summary.capped) hit = r;
    }
    if (hit) {
      fixtures.wincap = hit.book;
      info.push(line('wincap', hit.book, hit.summary, scan(hit.book)));
      nextId++;
    } else out('  WARNING: no capped round');
  }
  const t1 = performance.now();

  // ---- pools -------------------------------------------------------------------------------
  const pool = (mode, n, idBase) => {
    const m = BET_MODES[mode];
    const books = [];
    let attempts = 0;
    const counts = {};
    for (let i = 0; i < n; i++) {
      const r = playRound({
        strips, seed: [`pool-${mode}`, i], id: idBase + i + 1, mode, reelset: m.reelset, forcedStar: Boolean(m.forcedStar),
        require: m.require, maxAttempts: m.require ? BUY_CAP : 1,
      });
      if (!r) throw new Error(`${mode} book ${i}: no base spin earned "${m.require}" within ${BUY_CAP} re-draws`);
      attempts += r.attempts;
      counts[r.book.criteria] = (counts[r.book.criteria] ?? 0) + 1;
      books.push(r.book);
    }
    const pays = books.map((b) => b.payoutMultiplier);
    const avg = pays.reduce((a, b) => a + b, 0) / n;
    return {
      file: `books_${m.pool}_${n}.json`,
      books,
      line: `${mode.padEnd(5)} x${n}: avg ${x(avg)} (${((avg / (m.cost * 100)) * 100).toFixed(1)}% of cost), max ${x(Math.max(...pays))}, criteria ${JSON.stringify(counts)}${m.require ? `, avg base re-draws ${(attempts / n).toFixed(0)}` : ''}`,
    };
  };
  const pools = [pool('BASE', 300, 10000), pool('HUNT', 100, 40000), pool('STARS', 100, 50000), pool('PROWL', 50, 20000), pool('VAULT', 50, 30000)];
  const t2 = performance.now();

  const files = { 'base_fixtures.json': fixtures };
  for (const p of pools) files[p.file] = p.books;
  let errors = 0;
  for (const [file, content] of Object.entries(files)) {
    const list = Array.isArray(content) ? content.map((b) => [`id ${b.id}`, b]) : Object.entries(content);
    for (const [label, book] of list) {
      const errs = validateBook(book, `${file} ${label}`);
      errors += errs.length;
      for (const msg of errs.slice(0, 10)) out(`  INVALID ${msg}`);
    }
  }
  if (errors) {
    out(`generation aborted: ${errors} validation errors`);
    process.exitCode = 1;
    return;
  }

  out(`MAGPIE HEIST mock books (${((t2 - t0) / 1000).toFixed(1)}s; fixture search ${seed} seeds in ${((t1 - t0) / 1000).toFixed(1)}s)`);
  out('fixtures (base_fixtures.json):');
  for (const l of info) out(`  ${l}`);
  out('pools:');
  for (const p of pools) out(`  ${p.line}`);
  out(`win cap ${x(WINCAP)}`);
  if (DRY) return;
  fs.mkdirSync(OUT, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(OUT, file);
    fs.writeFileSync(`${target}.tmp`, JSON.stringify(content));
    fs.renameSync(`${target}.tmp`, target);
    out(`wrote ${path.relative(process.cwd(), target)} (${(fs.statSync(target).size / 1024).toFixed(0)} KB)`);
  }
};

main();
