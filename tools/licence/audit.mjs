#!/usr/bin/env node
// licence-audit: art/manifest.json <-> art/manifest.schema.json <-> licenses/{allowlist,denylist}.json
// <-> public/assets. Intended as a REQUIRED CI status check (docs/PIPELINE.md 0.3 / 8.1).
import fs from 'node:fs';
import path from 'node:path';
import { denylistHits } from '../gen/lib/genlib.mjs';
import { REPO, digestFiles, isMain, sha256File } from '../gen/lib/provenance.mjs';
import { validate } from './schema-lite.mjs';

const HELP = `Usage: node tools/licence/audit.mjs [options]
Fails (exit 1) on:
  * art/manifest.json (if present) not valid against art/manifest.schema.json, duplicate row ids;
  * a licenseId missing from licenses/allowlist.json or present in licenses/denylist.json;
  * a row whose model/vendor matches a denylist entry (incl. model families across resellers,
    e.g. higgsfield:gpt_image_2, openai_*, hunyuan*, rembg's default bria model);
  * a model not listed in its allowlist entry's modelIds;
  * a dangling parent id; a sha256 that no longer matches the file / frame folder on disk;
  * a shipped row (or any row covering a file in public/assets) whose licence or ANY ancestor's
    licence is not 'cleared' / 'not-required' (clearances gate shipping, not building);
  * a shipped chain containing a vendor generation with tosVersion null, or any tosVersion file
    that does not exist;
  * a file in public/assets with no row (and no entry in tools/licence/exemptions.json);
    --release additionally fails on 'placeholder' exemptions;
  * a package.json dependency named in the denylist.
Options:
  --root DIR          repo root for row paths (default: this repo)
  --manifest FILE     default <root>/art/manifest.json (missing file = no rows)
  --public DIR        default <root>/public/assets
  --exemptions FILE   default tools/licence/exemptions.json
  --allowlist FILE    --denylist FILE   --schema FILE   --package FILE (default <root>/package.json)
  --release           placeholder exemptions become errors
  --strict            warnings become errors
  --no-sha            skip the sha256 drift check (fast)
  --json FILE         write the full report as JSON
Exit codes: 0 clean, 1 findings, 2 usage/unreadable input.`;

function args(argv) {
  const o = { flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (['--release', '--strict', '--no-sha', '--help', '-h'].includes(a)) { o.flags.add(a.replace(/^-+/, '')); continue; }
    const m = /^--(root|manifest|public|exemptions|allowlist|denylist|schema|package|json)(?:=(.*))?$/.exec(a);
    if (!m) throw new Error(`unknown option ${a}`);
    o[m[1]] = m[2] ?? argv[++i];
    if (o[m[1]] === undefined) throw new Error(`${a} needs a value`);
  }
  return o;
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const posix = (p) => p.split(path.sep).join('/');
const walk = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const p = path.join(dir, d.name);
  return d.isDirectory() ? walk(p) : [p];
}) : []);

export function globToRe(g) {
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') { re += '.*'; i++; if (g[i + 1] === '/') i++; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

const VENDOR_KINDS = new Set(['service', 'hosted-model', 'commercial-software']);
// rows made locally from other rows (their licence is inherited from the upstream generation)
const LOCAL_ROUTES = new Set(['code', 'ffmpeg', 'blender', 'spine-cli', 'human', 'comfyui-local']);
const OK_CLEARANCE = new Set(['cleared', 'not-required']);

export function audit(opt) {
  const root = path.resolve(opt.root ?? REPO);
  const files = {
    manifest: path.resolve(opt.manifest ?? path.join(root, 'art/manifest.json')),
    public: path.resolve(opt.public ?? path.join(root, 'public/assets')),
    exemptions: path.resolve(opt.exemptions ?? path.join(REPO, 'tools/licence/exemptions.json')),
    allowlist: path.resolve(opt.allowlist ?? path.join(REPO, 'licenses/allowlist.json')),
    denylist: path.resolve(opt.denylist ?? path.join(REPO, 'licenses/denylist.json')),
    schema: path.resolve(opt.schema ?? path.join(REPO, 'art/manifest.schema.json')),
    package: path.resolve(opt.package ?? path.join(root, 'package.json')),
  };
  const errors = [];
  const warnings = [];
  const info = {};
  const E = (m) => errors.push(m);
  const W = (m) => warnings.push(m);
  const allow = readJson(files.allowlist);
  const deny = readJson(files.denylist);
  const schema = readJson(files.schema);
  const allowById = new Map(allow.entries.map((e) => [e.id, e]));
  const denyIds = new Set(deny.entries.map((e) => e.id));
  for (const id of allowById.keys()) if (denyIds.has(id)) E(`licenses: '${id}' is in BOTH allowlist and denylist`);
  for (const e of allow.entries) {
    if (!e.id || !e.licenseId || !e.clearance) E(`allowlist entry ${JSON.stringify(e.id)} lacks id/licenseId/clearance`);
    if (e.clearance === 'cleared' && !fs.existsSync(path.join(REPO, 'licenses/clearances'))) W(`allowlist '${e.id}' is 'cleared' but licenses/clearances/ does not exist`);
  }

  // ---------------------------------------------------------------- manifest rows
  let rows = [];
  if (fs.existsSync(files.manifest)) {
    let doc;
    try { doc = readJson(files.manifest); } catch (e) { E(`${posix(path.relative(root, files.manifest))}: not JSON (${e.message})`); doc = null; }
    if (doc) {
      for (const m of validate(schema, doc)) E(`schema ${m}`);
      rows = Array.isArray(doc.rows) ? doc.rows : [];
    }
  } else {
    info.manifest = 'absent (no rows)';
  }
  const byId = new Map();
  for (const r of rows) {
    if (byId.has(r.id)) E(`row ${r.id}: duplicate id`);
    byId.set(r.id, r);
  }
  const clearOf = (r) => allowById.get(r.licenseId)?.clearance;
  const ancestry = (r) => {
    const out = [];
    const seen = new Set([r.id]);
    const stack = [...(r.parents ?? [])];
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      const p = byId.get(id);
      if (!p) continue;
      out.push(p);
      stack.push(...(p.parents ?? []));
    }
    return out;
  };
  const vendorMade = (x) => !LOCAL_ROUTES.has(String(x.route ?? '')) && VENDOR_KINDS.has(allowById.get(x.licenseId)?.kind);
  const shipCheck = (r, why) => {
    for (const x of [r, ...ancestry(r)]) {
      const c = clearOf(x);
      const who = x === r ? '' : `ancestor ${x.id} `;
      if (!OK_CLEARANCE.has(c)) E(`${why} row ${r.id}: ${who}licence '${x.licenseId}' has clearance '${c ?? 'unknown'}' (file the written clearance, then set 'cleared')`);
      if (vendorMade(x) && !x.tosVersion) E(`${why} row ${r.id}: ${who}vendor generation has no archived ToS (tosVersion null)`);
    }
  };
  const digestOf = (abs) => {
    const st = fs.statSync(abs);
    return st.isDirectory() ? digestFiles(walk(abs).sort(), abs) : sha256File(abs);
  };
  const pubRel = posix(path.relative(root, files.public));
  let checkedSha = 0;
  for (const r of rows) {
    const tag = `row ${r.id ?? '?'}`;
    if (typeof r.licenseId !== 'string' || !r.licenseId) { E(`${tag}: empty licenseId`); continue; }
    if (denyIds.has(r.licenseId)) E(`${tag}: licenseId '${r.licenseId}' is DENYLISTED`);
    const entry = allowById.get(r.licenseId);
    if (!entry && !denyIds.has(r.licenseId)) E(`${tag}: licenseId '${r.licenseId}' is not in licenses/allowlist.json`);
    const scope = String(r.route ?? r.vendor ?? '').toLowerCase();
    if (typeof r.model === 'string') {
      const hits = denylistHits(scope, r.model, deny);
      if (hits.length) E(`${tag}: model '${r.model}' matches denylist ${JSON.stringify(hits)}`);
    }
    // modelIds bind the vendor call itself; derivatives (route code/ffmpeg/...) inherit the licence id
    if (entry?.modelIds && !LOCAL_ROUTES.has(String(r.route ?? '')) && !entry.modelIds.includes(r.model)) {
      E(`${tag}: model '${r.model}' is not in allowlist['${entry.id}'].modelIds ${JSON.stringify(entry.modelIds)}`);
    }
    for (const p of r.parents ?? []) if (!byId.has(p)) E(`${tag}: parent '${p}' has no row`);
    if (r.tosVersion) {
      if (!fs.existsSync(path.join(root, r.tosVersion)) && !fs.existsSync(path.join(REPO, r.tosVersion))) E(`${tag}: tosVersion ${r.tosVersion} does not exist`);
    } else if (entry && vendorMade(r) && !r.shipped) {
      W(`${tag}: vendor '${entry.id}' generation has no archived ToS (tosVersion null); it cannot ship like this`);
    }
    if (r.shipped) shipCheck(r, 'shipped');
    if (typeof r.path === 'string') {
      const abs = path.join(root, r.path);
      if (fs.existsSync(abs)) {
        if (!opt.noSha && /^[a-f0-9]{64}$/.test(r.sha256 ?? '')) {
          checkedSha++;
          const d = digestOf(abs);
          // an older row for a path that was regenerated is history, not drift, when a newer row matches
          const newer = rows.some((o) => o !== r && o.path === r.path && o.sha256 === d);
          if (d !== r.sha256 && !newer) E(`${tag}: sha256 mismatch for ${r.path} (file changed after its row was written)`);
        }
      } else if (r.path.startsWith(`${pubRel}/`)) {
        W(`${tag}: ${r.path} is not on disk (stale row?)`);
      }
    }
  }
  info.rows = rows.length;
  info.shaChecked = checkedSha;

  // ---------------------------------------------------------------- public/assets coverage
  const ex = readJson(files.exemptions).exemptions ?? [];
  const exRes = ex.map((e) => ({ ...e, re: e.paths.map(globToRe) }));
  for (const e of ex) {
    if (e.allowlistId && !allowById.has(e.allowlistId)) E(`exemption '${e.id}': allowlistId '${e.allowlistId}' not in allowlist`);
    if (!e.allowlistId && !e.licence) E(`exemption '${e.id}': needs allowlistId or licence`);
    for (const lf of e.licenceFiles ?? []) if (!fs.existsSync(path.join(root, lf))) E(`exemption '${e.id}': licence file ${lf} missing`);
  }
  const rowsByPath = new Map();
  for (const r of rows) if (typeof r.path === 'string') (rowsByPath.get(r.path) ?? rowsByPath.set(r.path, []).get(r.path)).push(r);
  const folderRows = rows.filter((r) => typeof r.path === 'string' && fs.existsSync(path.join(root, r.path)) && fs.statSync(path.join(root, r.path)).isDirectory());
  const pub = walk(files.public).filter((f) => !path.basename(f).startsWith('.')).sort();
  const coverage = { rows: 0, folderRows: 0, exempt: 0, uncovered: 0 };
  const folderDigest = new Map();
  for (const abs of pub) {
    const relp = posix(path.relative(root, abs));
    const direct = rowsByPath.get(relp);
    if (direct?.length) {
      const d = opt.noSha ? null : sha256File(abs);
      const match = opt.noSha ? direct[direct.length - 1] : direct.find((r) => r.sha256 === d);
      if (!match) { E(`${relp}: changed since its manifest row(s) ${direct.map((r) => r.id).join(', ')}`); continue; }
      if (!match.shipped) W(`${relp}: row ${match.id} covers a shipped file but has shipped:false`);
      shipCheck(match, `public file ${relp} ->`);
      coverage.rows++;
      continue;
    }
    const folder = folderRows.find((r) => relp.startsWith(`${r.path.replace(/\/$/, '')}/`));
    if (folder) {
      const fabs = path.join(root, folder.path);
      if (!opt.noSha && !folderDigest.has(fabs)) folderDigest.set(fabs, digestFiles(walk(fabs).sort(), fabs));
      if (!opt.noSha && folderDigest.get(fabs) !== folder.sha256) { E(`${relp}: folder ${folder.path} changed since row ${folder.id}`); continue; }
      shipCheck(folder, `public file ${relp} ->`);
      coverage.folderRows++;
      continue;
    }
    const e = exRes.find((x) => x.re.some((re) => re.test(relp)));
    if (e) {
      if (e.licencePerFile) {
        const family = path.basename(relp).split(/[-.]/)[0];
        const re = globToRe(e.licencePerFile.replace('{family}', family));
        if (!walk(path.dirname(path.join(root, e.licencePerFile))).some((f) => re.test(posix(path.relative(root, f))))) {
          E(`${relp}: exemption '${e.id}' requires a licence file matching ${e.licencePerFile.replace('{family}', family)}`);
        }
      }
      if (e.placeholder) (opt.release ? E : W)(`${relp}: placeholder asset (exemption '${e.id}')${opt.release ? ' must be replaced before release' : ''}`);
      coverage.exempt++;
      continue;
    }
    coverage.uncovered++;
    E(`${relp}: shipped file has no art/manifest.json row and no exemption (write provenance with the tool that produced it)`);
  }
  info.publicFiles = pub.length;
  info.coverage = coverage;

  // ---------------------------------------------------------------- dependencies
  if (fs.existsSync(files.package)) {
    const pkg = readJson(files.package);
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies });
    for (const e of deny.entries) {
      for (const item of e.appliesTo ?? []) {
        const hit = names.find((n) => n.toLowerCase() === String(item).toLowerCase());
        if (hit) E(`package.json: dependency '${hit}' is denylisted (${e.id})`);
      }
    }
    info.dependencies = names.length;
  }
  if (opt.strict) { errors.push(...warnings.map((w) => `(strict) ${w}`)); }
  return { root: posix(root), files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, posix(path.relative(REPO, v) || '.')])), info, errors, warnings, passed: errors.length === 0 };
}

if (isMain(import.meta.url)) {
  let o;
  try { o = args(process.argv.slice(2)); } catch (e) { console.error(`error: ${e.message}`); process.exit(2); }
  if (o.flags.has('help') || o.flags.has('h')) { console.log(HELP); process.exit(0); }
  let rep;
  try {
    rep = audit({ ...o, release: o.flags.has('release'), strict: o.flags.has('strict'), noSha: o.flags.has('no-sha') });
  } catch (e) { console.error(`error: ${e.message}`); process.exit(2); }
  if (o.json) { fs.mkdirSync(path.dirname(path.resolve(o.json)), { recursive: true }); fs.writeFileSync(o.json, `${JSON.stringify(rep, null, 2)}\n`); }
  for (const w of rep.warnings) console.log(`warning: ${w}`);
  for (const e of rep.errors) console.log(`error:   ${e}`);
  const c = rep.info.coverage ?? {};
  console.log(`licence-audit: ${rep.info.rows} rows, ${rep.info.publicFiles} public files (rows ${c.rows}, folder rows ${c.folderRows}, exempt ${c.exempt}, uncovered ${c.uncovered}), ${rep.errors.length} error(s), ${rep.warnings.length} warning(s) -> ${rep.passed ? 'PASS' : 'FAIL'}`);
  process.exit(rep.passed ? 0 : 1);
}
