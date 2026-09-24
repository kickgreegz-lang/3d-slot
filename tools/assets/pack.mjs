#!/usr/bin/env node
// Run AssetPack with tools/assets/assetpack.config.mjs, then gate the result and write provenance.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AssetPack } from '@assetpack/core';
import { GenError, parseArgs } from '../gen/lib/genlib.mjs';
import { MANIFEST, REPO, isMain, makeRow, readManifest, realish, record, rel, safeId, sha256File, digestFiles } from '../gen/lib/provenance.mjs';
import { makeConfig } from './assetpack.config.mjs';

const TOOL = 'tools/assets/pack.mjs';
const HELP = `Usage: node ${TOOL} [--entry build/pack] [--output public/assets/pack] [options]
Packs the entry tree with AssetPack 1.7.0, then checks (exit 1 on failure):
  * manifest.json exists, every src is relative (no '/', '..' or scheme) and exists;
  * every atlas page is <= 2048 px (and a multiple of 4 with --strict-pages; warned otherwise);
  * every {tps} clip folder with frames <clip>_NNNN.png yields animations.<clip> of exactly that
    many frames at every resolution (ANIMATION_CONTRACT 8.1: animation length == rendered frames);
  * mastered audio (.webm/.m4a/.ogg) is copied byte-identical (never re-encoded).
Writes one provenance row per output file (stage packaging, licence 'pixi'); parents are the rows
in --parents-from whose sha256 matches an input file packed into that output.
Options:
  --entry DIR          default build/pack             --output DIR       default public/assets/pack
  --cache-dir DIR      default build/.assetpack-cache  --no-cache         cold build (clears the output)
  --cache-bust         hashed file names (default off)
  --strict-pages       fail (not warn) on pages that are not multiples of 4
  --qa-dir DIR         default build/qa/assetpack      --manifest FILE    also append rows (default none)
  --parents-from FILE  manifest to look up input rows (default art/manifest.json)
  --shipped            mark the rows shipped (use when --output is under public/assets)`;

const SPEC = {
  help: { type: 'boolean', alias: 'h' }, entry: { type: 'string' }, output: { type: 'string' }, 'cache-dir': { type: 'string' },
  'no-cache': { type: 'boolean' }, 'cache-bust': { type: 'boolean' }, 'strict-pages': { type: 'boolean' },
  'qa-dir': { type: 'string' }, manifest: { type: 'string', default: 'none' }, 'parents-from': { type: 'string' },
  shipped: { type: 'boolean' },
};

/** [w, h] of a PNG or WebP file (header only). */
export function imageSize(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32BE(0) === 0x89504e47) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
    if (kind === 'VP8L') {
      const [b0, b1, b2, b3] = [b[21], b[22], b[23], b[24]];
      return [1 + (((b1 & 0x3f) << 8) | b0), 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6))];
    }
    if (kind === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
  }
  return null;
}

const walk = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const p = path.join(dir, d.name);
  return d.isDirectory() ? walk(p) : [p];
}) : []);
const stripTags = (p) => p.replace(/\{[^}]*\}/g, '');
const within = (child, parent) => {
  const r = path.relative(parent, child);
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
};

/**
 * AssetPack rm -rf's its output folder on a cold cache and, with --no-cache, the cache folder too
 * (@assetpack/core AssetPack.js constructor). Refuse any folder whose deletion could lose other work:
 * one that is or contains the repo, public/assets, the entry tree, $HOME or a filesystem root; inside
 * the repo only strict subfolders of public/assets/, build/ and art/_work/ (script-owned) are allowed;
 * outside the repo an existing non-empty folder must already be an AssetPack output (manifest.json).
 */
export function assertDisposable(dir, what, entry, { output = false } = {}) {
  const d = realish(dir);
  const guarded = [[REPO, 'the repository'], [path.join(REPO, 'public', 'assets'), 'public/assets'],
    [realish(entry), 'the --entry tree'], [realish(os.homedir()), 'your home folder'], [path.parse(d).root, 'the filesystem root']];
  for (const [g, label] of guarded) {
    if (within(g, d)) throw new GenError(`refusing ${what} ${rel(d) || '.'}: AssetPack deletes this folder and it is or contains ${label}`);
  }
  if (within(d, realish(entry))) throw new GenError(`refusing ${what} ${rel(d)}: it lies inside the --entry tree`);
  if (within(d, REPO)) {
    const ok = ['public/assets', 'build', 'art/_work'].some((x) => within(d, path.join(REPO, x)) && d !== path.join(REPO, x));
    if (!ok) throw new GenError(`refusing ${what} ${rel(d)}: inside the repo it must be a subfolder of public/assets/, build/ or art/_work/ (AssetPack deletes it)`);
  } else if (output && fs.existsSync(d) && fs.readdirSync(d).length && !fs.existsSync(path.join(d, 'manifest.json'))) {
    throw new GenError(`refusing ${what} ${d}: non-empty and not an AssetPack output (no manifest.json); AssetPack would delete it`);
  }
}
const keyOf = (p) => stripTags(p).split(path.sep).join('/').replace(/@[\d.]+x/g, '').replace(/(\.[A-Za-z0-9]+)+$/, '');

async function main(argv) {
  const a = parseArgs(argv, SPEC);
  if (a.help) { console.log(HELP); return 0; }
  const entry = path.resolve(a.entry ?? path.join(REPO, 'build/pack'));
  const output = path.resolve(a.output ?? path.join(REPO, 'public/assets/pack'));
  if (!fs.existsSync(entry)) throw new GenError(`entry ${rel(entry)} does not exist`);
  const qaDir = path.resolve(a['qa-dir'] ?? path.join(REPO, 'build/qa/assetpack'));
  const cacheLocation = path.resolve(a['cache-dir'] ?? path.join(REPO, 'build/.assetpack-cache'));
  assertDisposable(output, '--output', entry, { output: true });
  assertDisposable(cacheLocation, '--cache-dir', entry);
  const cfg = makeConfig({ entry, output, cache: !a['no-cache'], cacheBust: Boolean(a['cache-bust']), cacheLocation });

  // expected clips: {tps} folders holding <clip>_NNNN.png frames
  const inputs = walk(entry).filter((f) => !cfg.ignore.some((g) => path.matchesGlob?.(path.relative(entry, f), g)));
  const clips = {};
  for (const f of inputs) {
    const dir = path.dirname(f);
    if (!/\{[^}]*\btps\b[^}]*\}/.test(path.basename(dir))) continue;
    const m = /^(.*)_(\d{4})\.png$/.exec(path.basename(f));
    if (m) (clips[m[1]] ??= { folder: rel(dir), frames: 0 }).frames++;
  }
  const t0 = Date.now();
  await new AssetPack(cfg).run();
  const ms = Date.now() - t0;

  const errors = [];
  const warnings = [];
  const outFiles = walk(output);
  const manifestPath = path.join(output, 'manifest.json');
  if (!fs.existsSync(manifestPath)) errors.push('no manifest.json in the output');
  const srcs = [];
  if (fs.existsSync(manifestPath)) {
    const man = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const b of man.bundles ?? []) for (const as of b.assets ?? []) for (const s of as.src ?? []) srcs.push(typeof s === 'string' ? s : s.src);
    for (const s of srcs) {
      if (s.startsWith('/') || s.includes('..') || /^[a-z][a-z0-9+.-]*:/i.test(s)) errors.push(`manifest src not relative: ${s}`);
      else if (!fs.existsSync(path.join(output, s))) errors.push(`manifest src missing: ${s}`);
    }
  }
  const pages = [];
  const animations = {};
  for (const f of outFiles.filter((x) => x.endsWith('.json') && x !== manifestPath)) {
    let j;
    try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
    if (!j.frames || !j.meta?.image) continue;
    const img = path.join(path.dirname(f), j.meta.image);
    const size = fs.existsSync(img) ? imageSize(img) : null;
    if (!size) { errors.push(`page image missing or unreadable: ${rel(img)}`); continue; }
    pages.push({ json: rel(f), image: rel(img), size, frames: Object.keys(j.frames).length });
    if (size[0] > 2048 || size[1] > 2048) errors.push(`page ${rel(img)} is ${size.join('x')} (> 2048)`);
    if (size[0] % 4 || size[1] % 4) (a['strict-pages'] ? errors : warnings).push(`page ${rel(img)} is ${size.join('x')} (not a multiple of 4)`);
    for (const [name, frames] of Object.entries(j.animations ?? {})) {
      (animations[name] ??= []).push({ json: rel(f), frames: frames.length });
    }
  }
  for (const [clip, info] of Object.entries(clips)) {
    const got = animations[clip];
    if (!got) { errors.push(`clip ${clip} (${info.folder}): no animations.${clip} in any spritesheet`); continue; }
    // one sheet per resolution x format; multi-pack sheets split a clip across pages: sum those
    const byVariant = {};
    for (const g of got) {
      const res = /@([\d.]+)x/.exec(g.json)?.[1] ?? '1';
      const fmt = /\.(\w+)\.json$/.exec(g.json)?.[1] ?? '?';
      const k = `@${res}x ${fmt}`;
      byVariant[k] = (byVariant[k] ?? 0) + g.frames;
    }
    for (const [k, n] of Object.entries(byVariant)) {
      if (n !== info.frames) errors.push(`clip ${clip} ${k}: ${n} animation frames != ${info.frames} rendered frames`);
    }
  }
  for (const f of inputs.filter((x) => /\.(webm|m4a|ogg|mp3)$/.test(x))) {
    const relOut = stripTags(path.relative(entry, f));
    const out = path.join(output, relOut);
    if (!fs.existsSync(out)) errors.push(`audio ${relOut} missing from the output`);
    else if (sha256File(out) !== sha256File(f)) errors.push(`audio ${relOut} was re-encoded (must be copied byte-identical)`);
  }

  // provenance
  // parents: rows whose sha256 matches an input file, or folder rows (flipbook clips) whose path is
  // the packed {tps} folder and whose folder digest still matches
  const parentRows = new Map();
  const folderRows = new Map();
  const pf = a['parents-from'] ?? MANIFEST;
  try {
    for (const r of readManifest(pf).rows) {
      parentRows.set(r.sha256, r.id);
      folderRows.set(`${r.path}|${r.sha256}`, r.id);
    }
  } catch { /* no manifest yet */ }
  const inputsByKey = new Map();
  const foldersByKey = new Map();
  for (const f of inputs) {
    const relIn = path.relative(entry, f);
    const isTps = /\{[^}]*\btps\b[^}]*\}/.test(path.basename(path.dirname(f)));
    const top = isTps ? path.dirname(relIn) : relIn;
    const k = keyOf(top);
    (inputsByKey.get(k) ?? inputsByKey.set(k, []).get(k)).push(f);
    if (isTps) foldersByKey.set(k, path.dirname(f));
  }
  const folderParent = new Map();
  for (const [k, dir] of foldersByKey) {
    const id = folderRows.get(`${rel(dir)}|${digestFiles(walk(dir).sort(), dir)}`);
    if (id) folderParent.set(k, id);
  }
  const version = `@assetpack/core ${JSON.parse(fs.readFileSync(path.join(REPO, 'node_modules/@assetpack/core/package.json'), 'utf8')).version}; config ${digestFiles([path.join(REPO, 'tools/assets/assetpack.config.mjs')]).slice(0, 12)}`;
  const rows = outFiles.filter((f) => !f.endsWith(`${path.sep}.DS_Store`)).sort().map((f) => {
    const relOut = path.relative(output, f);
    const ins = inputsByKey.get(keyOf(relOut)) ?? [];
    const digest = sha256File(f);
    return makeRow({
      id: safeId('pack', relOut.replace(/[^A-Za-z0-9_.-]+/g, '_'), digest.slice(0, 8)), path: rel(f), stage: 'packaging', route: 'code',
      vendor: 'self', model: 'tools/assets/pack.mjs (@assetpack/core)', version, licenseId: 'pixi', sha256: digest,
      refHashes: ins.map((i) => sha256File(i)),
      parents: [...new Set([folderParent.get(keyOf(relOut)), ...ins.map((i) => parentRows.get(sha256File(i)))].filter(Boolean))],
      shipped: a.shipped, qa: { passed: errors.length === 0, report: rel(path.join(qaDir, 'qa.json')) },
    });
  });
  const qa = { tool: TOOL, entry: rel(entry), output: rel(output), ms, clips, animations, pages, manifestSrcs: srcs.length, errors, warnings, passed: errors.length === 0 };
  fs.mkdirSync(qaDir, { recursive: true });
  fs.writeFileSync(path.join(qaDir, 'qa.json'), `${JSON.stringify(qa, null, 2)}\n`);
  record(rows, { sidecar: path.join(qaDir, 'manifest.json'), manifest: a.manifest, generatedBy: TOOL });
  for (const w of warnings) console.error(`warning: ${w}`);
  for (const e of errors) console.error(`error: ${e}`);
  console.log(JSON.stringify({ output: rel(output), files: outFiles.length, pages: pages.length, clips: Object.keys(clips).length, ms, qa: rel(path.join(qaDir, 'qa.json')), passed: qa.passed }, null, 2));
  return qa.passed ? 0 : 1;
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => {
    console.error(`error: ${e.message}`);
    process.exit(e instanceof GenError ? e.code : 2);
  });
}
