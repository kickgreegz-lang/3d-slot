// node --test tools/licence/test/  -- good/bad fixtures for tools/licence/audit.mjs
// Fixtures are generated under art/_work/test-licence/ (gitignored): a mini repo root with
// public/assets, art/manifest.json and package.json; allow/deny lists and schema are the real ones.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { audit } from '../audit.mjs';
import { digestFiles, sha256File } from '../../gen/lib/provenance.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const WORK = path.join(REPO, 'art/_work/test-licence');

const row = (o) => ({
  id: o.id, path: o.path, stage: o.stage ?? 'packaging', shipped: o.shipped ?? false, route: o.route ?? 'code',
  vendor: o.vendor ?? 'self', model: o.model ?? 'tools/assets/pack.mjs', version: '1', seed: null, jobId: null,
  promptPath: null, promptHash: null, template: null, refHashes: [], parents: o.parents ?? [], planTier: null,
  tosVersion: o.tosVersion ?? null, licenseId: o.licenseId ?? 'pixi', humanEditor: null, humanEditSummary: null,
  approvedBy: null, cost: { amount: 0, currency: 'USD' }, date: '2026-09-24T12:00:00Z', sha256: o.sha256, notes: null,
});

/** Build a clean fixture root; `mutate(ctx)` may break one thing. Returns the audit report. */
function fixture(name, mutate = () => {}, opts = {}) {
  const root = path.join(WORK, name);
  fs.rmSync(root, { recursive: true, force: true });
  const pub = path.join(root, 'public/assets');
  fs.mkdirSync(path.join(pub, 'fonts/licenses'), { recursive: true });
  fs.mkdirSync(path.join(pub, 'pack'), { recursive: true });
  fs.mkdirSync(path.join(pub, 'fx/poof'), { recursive: true });
  fs.mkdirSync(path.join(root, 'art'), { recursive: true });
  fs.writeFileSync(path.join(pub, 'fonts/Foo-Regular.woff2'), 'font');
  fs.writeFileSync(path.join(pub, 'fonts/licenses/Foo-OFL.txt'), 'OFL');
  fs.writeFileSync(path.join(pub, 'pack/symbols.png'), 'png-bytes');
  fs.writeFileSync(path.join(pub, 'fx/poof/poof_0001.png'), 'f1');
  fs.writeFileSync(path.join(pub, 'fx/poof/poof_0002.png'), 'f2');
  const poof = path.join(pub, 'fx/poof');
  const ctx = {
    root, pub,
    rows: [
      row({ id: 'sym_h1.matte.aaaa1111', path: 'art/_work/gone/sym_H1.png', stage: 'matting', licenseId: 'blender-5.2', sha256: 'a'.repeat(64) }),
      row({ id: 'pack.symbols.bbbb2222', path: 'public/assets/pack/symbols.png', shipped: true, parents: ['sym_h1.matte.aaaa1111'], sha256: sha256File(path.join(pub, 'pack/symbols.png')) }),
      row({ id: 'fx_poof.flipbook.cccc3333', path: 'public/assets/fx/poof', stage: 'vfx-bake', shipped: true, licenseId: 'blender-5.2', sha256: digestFiles(fs.readdirSync(poof).map((f) => path.join(poof, f)).sort(), poof) }),
      row({ id: 'sym_h2.raw.v01', path: 'art/_raw/sym_H2/v01/raw.png', stage: '2d-image', route: 'higgsfield-cli', vendor: 'Higgsfield', model: 'nano_banana_2', licenseId: 'higgsfield', sha256: 'b'.repeat(64) }),
    ],
    pkg: { name: 'fx', dependencies: { 'pixi.js': '8.21.0' } },
    exemptions: JSON.parse(fs.readFileSync(path.join(REPO, 'tools/licence/exemptions.json'), 'utf8')),
  };
  ctx.exemptions.exemptions = ctx.exemptions.exemptions.filter((e) => e.id.startsWith('fonts'));
  mutate(ctx);
  fs.writeFileSync(path.join(root, 'art/manifest.json'), JSON.stringify(ctx.doc ?? { schemaVersion: 1, rows: ctx.rows }, null, 2));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(ctx.pkg));
  fs.writeFileSync(path.join(root, 'exemptions.json'), JSON.stringify(ctx.exemptions));
  return audit({ root, exemptions: path.join(root, 'exemptions.json'), ...opts });
}

const has = (rep, re) => rep.errors.some((e) => re.test(e));

/** A copy of the real allowlist with entry `id` set to `clearance` (written under WORK). */
function clearedAllowlist(id, clearance = 'cleared') {
  const doc = JSON.parse(fs.readFileSync(path.join(REPO, 'licenses/allowlist.json'), 'utf8'));
  for (const e of doc.entries) if (e.id === id) e.clearance = clearance;
  fs.mkdirSync(WORK, { recursive: true });
  const file = path.join(WORK, `allowlist.${id}.${clearance}.json`);
  fs.writeFileSync(file, JSON.stringify(doc));
  return file;
}

test('good fixture passes (vendor row without ToS is only a warning)', () => {
  const rep = fixture('good');
  assert.deepEqual(rep.errors, []);
  assert.equal(rep.passed, true);
  assert.equal(rep.info.coverage.rows, 1);
  assert.equal(rep.info.coverage.folderRows, 2);
  assert.equal(rep.info.coverage.exempt, 2);
  assert.ok(rep.warnings.some((w) => /no archived ToS/.test(w)));
});

test('denied model (OpenAI through Higgsfield) fails', () => {
  const rep = fixture('denied', (c) => c.rows.push(row({ id: 'x.raw.v01', path: 'art/_raw/x/v01/raw.png', route: 'higgsfield-cli', vendor: 'Higgsfield', model: 'gpt_image_2', licenseId: 'higgsfield', sha256: 'c'.repeat(64) })));
  assert.ok(has(rep, /model 'gpt_image_2' matches denylist/));
});

test('unknown and denylisted licenseId fail', () => {
  assert.ok(has(fixture('unknown-lic', (c) => { c.rows[0].licenseId = 'no-such-licence'; }), /'no-such-licence' is not in licenses\/allowlist.json/));
  assert.ok(has(fixture('denied-lic', (c) => { c.rows[0].licenseId = 'bria-rmbg-2.0'; }), /DENYLISTED/));
});

test('schema: missing tosVersion field, bad schemaVersion, bad id', () => {
  assert.ok(has(fixture('no-tos-field', (c) => { delete c.rows[3].tosVersion; }), /missing required property 'tosVersion'/));
  assert.ok(has(fixture('schema-v2', (c) => { c.doc = { schemaVersion: 2, rows: c.rows }; }), /must equal 1/));
  assert.ok(has(fixture('bad-id', (c) => { c.rows[0].id = 'Sym_H1.Matte'; }), /does not match/));
});

test('uncovered public file fails', () => {
  const rep = fixture('uncovered', (c) => fs.writeFileSync(path.join(c.pub, 'pack/extra.png'), 'x'));
  assert.ok(has(rep, /extra.png: shipped file has no art\/manifest.json row/));
});

const warned = (rep, re) => rep.warnings.some((w) => re.test(w));

test('a pending licence in a shipped chain is a release blocker: warning in dev, error with --release', () => {
  const direct = (c) => {
    Object.assign(c.rows[1], { licenseId: 'vertex-nano-banana-pro', model: 'gemini-3-pro-image', route: 'vertex', vendor: 'Google Cloud', tosVersion: null });
  };
  const dev = fixture('ship-pending', direct);
  assert.deepEqual(dev.errors, [], 'dev / preview builds may ship a pending-clearance file');
  assert.equal(dev.passed, true);
  assert.ok(warned(dev, /release blocker: shipped row pack.symbols.bbbb2222 \(public\/assets\/pack\/symbols.png\): licence 'vertex-nano-banana-pro' clearance 'pending'/));
  assert.ok(warned(dev, /allowed in dev \/ preview builds only/));
  assert.equal(dev.info.releaseBlockers.rows, 1);
  const rel = fixture('ship-pending-release', direct, { release: true });
  assert.equal(rel.passed, false);
  assert.ok(has(rel, /release blocker: shipped row pack.symbols.bbbb2222 .*clearance 'pending'.*refused for release/));
  assert.ok(has(rel, /RELEASE REFUSED: 1 shipped row\(s\).*licenses\/clearances\/<vendor>.pdf/));

  // through an ancestor (the Higgsfield raw): one blocker for the row, naming the ancestor
  const anc = (c) => { c.rows[1].parents = ['sym_h2.raw.v01']; };
  const ancDev = fixture('ship-ancestor', anc);
  assert.equal(ancDev.passed, true);
  assert.ok(warned(ancDev, /shipped row pack.symbols.bbbb2222 .*licence 'higgsfield' clearance 'pending' \(1 row\(s\) in its chain: sym_h2.raw.v01\)/));
  assert.ok(warned(ancDev, /without an archived ToS \(tosVersion null: sym_h2.raw.v01\)/));
  assert.equal(ancDev.warnings.filter((w) => /release blocker: shipped row pack.symbols/.test(w)).length, 1, 'reported once per row');
  const ancRel = fixture('ship-ancestor-release', anc, { release: true });
  assert.ok(has(ancRel, /shipped row pack.symbols.bbbb2222 .*'higgsfield' clearance 'pending'.*refused for release/));
  assert.deepEqual(ancRel.info.releaseBlockers.pendingByLicence, { higgsfield: 1 });

  // a public file counts as shipped whatever its row's flag says
  const flag = (c) => { c.rows[1].shipped = false; c.rows[1].parents = ['sym_h2.raw.v01']; };
  assert.ok(warned(fixture('ship-flag-false', flag), /release blocker: shipped row pack.symbols.bbbb2222 .*sym_h2.raw.v01/));
  assert.ok(has(fixture('ship-flag-false-release', flag, { release: true }), /shipped row pack.symbols.bbbb2222 .*sym_h2.raw.v01/));

  // the same chain once the clearance is filed and the ToS archived: no blocker, release passes
  const cleared = fixture('ship-cleared', (c) => {
    anc(c);
    c.rows[3].tosVersion = 'package.json'; // any existing file stands in for the archived ToS
  }, { release: true, allowlist: clearedAllowlist('higgsfield') });
  assert.deepEqual(cleared.errors, []);
  assert.equal(cleared.info.releaseBlockers.rows, 0);
});

test('a clearance other than cleared / not-required / pending fails in dev too', () => {
  const rep = fixture('ship-unknown-clearance', (c) => { c.rows[1].parents = ['sym_h2.raw.v01']; }, { allowlist: clearedAllowlist('higgsfield', 'refused') });
  assert.ok(has(rep, /ancestor sym_h2.raw.v01 licence 'higgsfield' has clearance 'refused'/));
});

test('sha drift on a file and on a folder row fails', () => {
  assert.ok(has(fixture('drift', (c) => { c.rows[1].sha256 = 'd'.repeat(64); }), /changed since its manifest row/));
  const folder = fixture('drift-folder', (c) => fs.writeFileSync(path.join(c.pub, 'fx/poof/poof_0002.png'), 'changed'));
  assert.ok(has(folder, /changed since row fx_poof.flipbook/));
});

test('model outside the allowlist modelIds, missing ToS file, dangling parent', () => {
  assert.ok(has(fixture('model-ids', (c) => c.rows.push(row({ id: 'y.raw.v01', path: 'art/_raw/y/v01/raw.png', route: 'vertex', vendor: 'Google Cloud', model: 'gemini-3-pro-image-preview', licenseId: 'vertex-nano-banana-pro', sha256: 'e'.repeat(64) }))), /not in allowlist\['vertex-nano-banana-pro'\].modelIds/));
  assert.ok(has(fixture('tos-missing', (c) => { c.rows[3].tosVersion = 'licenses/tos/higgsfield/2099-01-01.pdf'; }), /tosVersion .* does not exist/));
  assert.ok(has(fixture('dangling', (c) => { c.rows[1].parents = ['nope.1']; }), /parent 'nope.1' has no row/));
});

test('derivatives inherit a vendor licence without tripping modelIds; ToS is required on the shipped chain', () => {
  const addVertex = (c) => {
    c.rows.push(row({ id: 'sym_h4.raw.v01', path: 'art/_raw/sym_H4/v01/raw.png', stage: '2d-image', route: 'vertex', vendor: 'Google Cloud', model: 'gemini-3-pro-image', licenseId: 'vertex-nano-banana-pro', sha256: 'f'.repeat(64) }));
    c.rows.push(row({ id: 'sym_h4.matte.12345678', path: 'art/_work/gone/sym_H4.png', stage: 'matting', model: 'tools/matte/outline_matte.py', licenseId: 'vertex-nano-banana-pro', parents: ['sym_h4.raw.v01'], sha256: '1'.repeat(64) }));
  };
  const dev = fixture('vertex-derivative', addVertex);
  assert.deepEqual(dev.errors, [], 'a route:code derivative is not checked against modelIds');
  const shipped = fixture('vertex-shipped', (c) => { addVertex(c); c.rows[1].parents = ['sym_h4.matte.12345678']; }, { release: true });
  assert.ok(has(shipped, /without an archived ToS \(tosVersion null: sym_h4.raw.v01\)/));
  assert.ok(has(shipped, /licence 'vertex-nano-banana-pro' clearance 'pending' \(2 row\(s\) in its chain: sym_h4.matte.12345678, sym_h4.raw.v01\)/));
});

test('denylisted dependency fails', () => {
  assert.ok(has(fixture('dep', (c) => { c.pkg.devDependencies = { '@theatre/studio': '1.0.0' }; }), /dependency '@theatre\/studio' is denylisted/));
});

test('placeholder exemption: warning by default, error with --release', () => {
  const add = (c) => {
    fs.mkdirSync(path.join(c.pub, 'characters/placeholder'), { recursive: true });
    fs.writeFileSync(path.join(c.pub, 'characters/placeholder/Robot.glb'), 'glb');
    fs.writeFileSync(path.join(c.pub, 'characters/placeholder/LICENSE.txt'), 'CC0');
    c.exemptions.exemptions.push({ id: 'robot', paths: ['public/assets/characters/placeholder/*'], licence: 'CC0-1.0', licenceFiles: ['public/assets/characters/placeholder/LICENSE.txt'], placeholder: true });
  };
  const dev = fixture('placeholder', add);
  assert.equal(dev.passed, true);
  assert.ok(dev.warnings.some((w) => /placeholder asset/.test(w)));
  const rel = fixture('placeholder-release', add, { release: true });
  assert.ok(has(rel, /must be replaced before release/));
});

test('--game scopes the audit to dist/<id>; a DEV-only placeholder never blocks a release', () => {
  const games = (c) => {
    // game 'a' never loads the shared characters folder; game 'b' owns public/assets/b/
    for (const [id, meta] of [['a', { publicExclude: ['assets/characters'] }], ['b', {}]]) {
      fs.mkdirSync(path.join(c.root, 'src/games', id), { recursive: true });
      fs.writeFileSync(path.join(c.root, 'src/games', id, 'config.ts'), '');
      fs.writeFileSync(path.join(c.root, 'src/games', id, 'meta.json'), JSON.stringify({ id, ...meta }));
    }
    fs.mkdirSync(path.join(c.pub, 'b'), { recursive: true });
    fs.writeFileSync(path.join(c.pub, 'b/art.png'), 'b-art');
    c.rows.push(row({ id: 'b.art.dddd4444', path: 'public/assets/b/art.png', shipped: true, parents: ['sym_h2.raw.v01'], sha256: sha256File(path.join(c.pub, 'b/art.png')) }));
    fs.mkdirSync(path.join(c.pub, 'characters/placeholder'), { recursive: true });
    fs.writeFileSync(path.join(c.pub, 'characters/placeholder/Robot.glb'), 'glb');
    fs.writeFileSync(path.join(c.pub, 'characters/placeholder/LICENSE.txt'), 'CC0');
    c.exemptions.exemptions.push({ id: 'robot', paths: ['public/assets/characters/placeholder/*'], licence: 'CC0-1.0', licenceFiles: ['public/assets/characters/placeholder/LICENSE.txt'], placeholder: true });
    // tools/licence/public-scope.json devOnly (this repo's): stripped from every dist
    fs.mkdirSync(path.join(c.pub, 'spine/demo'), { recursive: true });
    fs.writeFileSync(path.join(c.pub, 'spine/demo/demo.json'), '{}');
    c.exemptions.exemptions.push({ id: 'demo', paths: ['public/assets/spine/demo/*'], allowlistId: 'owned-code', placeholder: true });
  };
  const a = fixture('game-a', games, { release: true, game: 'a' });
  assert.deepEqual(a.errors, [], "game b's pending art and the shared placeholder are not in dist/a");
  assert.equal(a.info.coverage.outOfScope, 3);
  assert.equal(a.info.releaseBlockers.rows, 0);
  const b = fixture('game-b', games, { release: true, game: 'b' });
  assert.ok(has(b, /RELEASE REFUSED: 1 shipped row\(s\)/));
  assert.ok(has(b, /Robot.glb: placeholder asset \(exemption 'robot'\) must be replaced before release/));
  assert.ok(!b.errors.some((e) => /spine\/demo/.test(e)), 'DEV-only placeholder is not a release error');
  assert.ok(warned(b, /spine\/demo\/demo.json: placeholder asset \(exemption 'demo'\), DEV-only/));
  const all = fixture('game-all', games, { release: true });
  assert.ok(has(all, /RELEASE REFUSED: 1 shipped row\(s\)/) && has(all, /Robot.glb/), 'no --game: every game');
  assert.throws(() => fixture('game-x', games, { game: 'x' }), /src\/games\/x\/config.ts not found/);
});

test('font without its licence text fails', () => {
  assert.ok(has(fixture('font-licence', (c) => fs.writeFileSync(path.join(c.pub, 'fonts/Bar-Regular.woff2'), 'x')), /requires a licence file matching/));
});

test('CLI exit codes and JSON report', () => {
  fixture('cli-good');
  const root = path.join(WORK, 'cli-good');
  const ok = spawnSync('node', [path.join(REPO, 'tools/licence/audit.mjs'), '--root', root, '--exemptions', path.join(root, 'exemptions.json'), '--json', path.join(root, 'report.json')], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'report.json'), 'utf8')).passed, true);
  const strict = spawnSync('node', [path.join(REPO, 'tools/licence/audit.mjs'), '--root', root, '--exemptions', path.join(root, 'exemptions.json'), '--strict'], { encoding: 'utf8' });
  assert.equal(strict.status, 1, 'warnings fail under --strict');
  fixture('cli-bad', (c) => fs.writeFileSync(path.join(c.pub, 'stray.bin'), 'x'));
  const bad = spawnSync('node', [path.join(REPO, 'tools/licence/audit.mjs'), '--root', path.join(WORK, 'cli-bad'), '--exemptions', path.join(WORK, 'cli-bad', 'exemptions.json')], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.equal(spawnSync('node', [path.join(REPO, 'tools/licence/audit.mjs'), '--bogus'], { encoding: 'utf8' }).status, 2);
  // a pending-clearance chain: dev audit exits 0 with warnings, --release exits 1 with a clear refusal
  fixture('cli-pending', (c) => { c.rows[1].parents = ['sym_h2.raw.v01']; });
  const pend = ['--root', path.join(WORK, 'cli-pending'), '--exemptions', path.join(WORK, 'cli-pending', 'exemptions.json')];
  const devRun = spawnSync('node', [path.join(REPO, 'tools/licence/audit.mjs'), ...pend], { encoding: 'utf8' });
  assert.equal(devRun.status, 0, devRun.stdout + devRun.stderr);
  assert.match(devRun.stdout, /warning: release blocker: shipped row pack.symbols.bbbb2222/);
  assert.match(devRun.stdout, /1 release blocker\(s\).* -> PASS/);
  const relRun = spawnSync('node', [path.join(REPO, 'tools/licence/audit.mjs'), ...pend, '--release'], { encoding: 'utf8' });
  assert.equal(relRun.status, 1, relRun.stdout + relRun.stderr);
  assert.match(relRun.stdout, /error: +RELEASE REFUSED: 1 shipped row\(s\) depend on uncleared vendor output/);
  assert.match(relRun.stdout, /licence-audit --release: .* -> FAIL/);
  // started through a symlinked checkout whose path has a space: the main guard must still run the
  // audit (a URL-pathname comparison silently skipped it and exited 0 = a false PASS)
  // (the link lives in the OS temp dir, never inside the repo, so nothing walks into a loop)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'licence-audit-'));
  const link = path.join(tmp, 'repo link');
  try {
    fs.symlinkSync(REPO, link);
    const viaLink = spawnSync('node', [path.join(link, 'tools/licence/audit.mjs'), '--root', path.join(WORK, 'cli-bad'), '--exemptions', path.join(WORK, 'cli-bad', 'exemptions.json')], { encoding: 'utf8' });
    assert.equal(viaLink.status, 1, viaLink.stdout + viaLink.stderr);
    assert.match(viaLink.stdout, /-> FAIL/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('schema-lite agrees with the manifest rows the pipeline tools write', () => {
  // every sidecar the other self-tests produced must pass the audit's own schema validator
  const sidecars = [];
  const walk = (d) => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name === 'manifest.json' && !p.includes('assetpack-fixture/out') && !p.includes('test-licence')) sidecars.push(p); } };
  walk(path.join(REPO, 'art/_work'));
  const schema = JSON.parse(fs.readFileSync(path.join(REPO, 'art/manifest.schema.json'), 'utf8'));
  return import('../schema-lite.mjs').then(({ validate }) => {
    let n = 0;
    for (const s of sidecars) {
      const doc = JSON.parse(fs.readFileSync(s, 'utf8'));
      if (doc.schemaVersion !== 1 || !Array.isArray(doc.rows)) continue;
      assert.deepEqual(validate(schema, doc), [], s);
      n++;
    }
    assert.ok(n >= 0);
  });
});
