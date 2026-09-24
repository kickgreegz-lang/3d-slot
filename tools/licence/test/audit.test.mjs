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
  assert.ok(has(fixture('unknown-lic', (c) => { c.rows[0].licenseId = 'owned-code'; }), /'owned-code' is not in licenses\/allowlist.json/));
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

test('shipping a pending licence (directly or through an ancestor) fails', () => {
  const direct = fixture('ship-pending', (c) => {
    Object.assign(c.rows[1], { licenseId: 'vertex-nano-banana-pro', model: 'gemini-3-pro-image', route: 'vertex', vendor: 'Google Cloud', tosVersion: null });
  });
  assert.ok(has(direct, /clearance 'pending'/));
  const anc = fixture('ship-ancestor', (c) => { c.rows[1].parents = ['sym_h2.raw.v01']; });
  assert.ok(has(anc, /ancestor sym_h2.raw.v01 licence 'higgsfield' has clearance 'pending'/));
  const flag = fixture('ship-flag-false', (c) => { c.rows[1].shipped = false; c.rows[1].parents = ['sym_h2.raw.v01']; });
  assert.ok(has(flag, /ancestor sym_h2.raw.v01/), 'a file in public/assets is shipped whatever the flag says');
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
  const shipped = fixture('vertex-shipped', (c) => { addVertex(c); c.rows[1].parents = ['sym_h4.matte.12345678']; });
  assert.ok(has(shipped, /ancestor sym_h4.raw.v01 vendor generation has no archived ToS/));
  assert.ok(has(shipped, /ancestor sym_h4.matte.12345678 licence 'vertex-nano-banana-pro' has clearance 'pending'/));
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
