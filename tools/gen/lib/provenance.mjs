// Provenance rows for art/manifest.json (schema: art/manifest.schema.json). Node >= 22, no deps.
// JS twin of tools/gen/provenance.py: same row shape, same id rules, same append-only +
// O_EXCL-lock + atomic-rename writes, so Python and Node tools can append concurrently.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const MANIFEST = path.join(REPO, 'art', 'manifest.json');

export const REQUIRED = ['id', 'path', 'stage', 'vendor', 'model', 'version', 'seed', 'promptHash', 'refHashes',
  'planTier', 'tosVersion', 'licenseId', 'humanEditor', 'cost', 'date', 'sha256'];
export const ID_RE = /^[a-z0-9][a-z0-9_.-]*$/;

export const sha256Bytes = (buf) => createHash('sha256').update(buf).digest('hex');
export const sha256Text = (text) => sha256Bytes(Buffer.from(text, 'utf8'));
export const sha256File = (p) => sha256Bytes(fs.readFileSync(p));

/** sha256 over sorted lines '<name>:<sha256>\n' (folder rows; same rule as the Python twin). */
export const digestFiles = (files, base = null) =>
  sha256Text(files.map((f) => `${base ? path.relative(base, f).split(path.sep).join('/') : path.basename(f)}:${sha256File(f)}\n`).sort().join(''));

/** Absolute path with symlinks resolved as far as the path exists (REPO itself is a realpath, so a
 *  path reached through a symlinked checkout or cwd must be resolved the same way to compare). */
export const realish = (p) => {
  let abs = path.resolve(p);
  const tail = [];
  while (!fs.existsSync(abs)) {
    const parent = path.dirname(abs);
    if (parent === abs) break;
    tail.unshift(path.basename(abs));
    abs = parent;
  }
  try { abs = fs.realpathSync(abs); } catch { /* keep the resolved path */ }
  return path.join(abs, ...tail);
};

/** True when `metaUrl` (import.meta.url) is the script node was started with. Compares real paths:
 *  `new URL(u).pathname` is percent-encoded (spaces -> %20) and import.meta.url is symlink-resolved
 *  while process.argv[1] is not, so a naive comparison silently skips main() and exits 0. */
export function isMain(metaUrl) {
  if (!process.argv[1]) return false;
  try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(metaUrl)); } catch { return false; }
}

export const rel = (p) => {
  const abs = realish(p);
  const r = path.relative(REPO, abs);
  return r.startsWith('..') || path.isAbsolute(r) ? abs.split(path.sep).join('/') : r.split(path.sep).join('/');
};

export const nowIso = () => {
  const epoch = process.env.SOURCE_DATE_EPOCH;
  const d = epoch ? new Date(Number(epoch) * 1000) : new Date();
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
};

export const safeId = (...parts) => {
  const rid = parts.filter(Boolean).join('.').toLowerCase().replace(/[^a-z0-9_.-]+/g, '_').replace(/^[._-]+|[._-]+$/g, '');
  return rid || 'row';
};

export function makeRow(o) {
  if (!ID_RE.test(o.id)) throw new Error(`row id ${JSON.stringify(o.id)} does not match ${ID_RE}`);
  const row = {
    id: o.id,
    path: path.isAbsolute(o.path) ? rel(o.path) : o.path,
    stage: o.stage,
    shipped: Boolean(o.shipped),
    vendor: o.vendor,
    model: o.model,
    version: o.version,
    seed: o.seed ?? null,
    jobId: o.jobId ?? null,
    promptPath: o.promptPath ?? null,
    promptHash: o.promptHash ?? null,
    template: o.template ?? null,
    refHashes: [...(o.refHashes ?? [])],
    parents: [...(o.parents ?? [])],
    planTier: o.planTier ?? null,
    tosVersion: o.tosVersion ?? null,
    licenseId: o.licenseId,
    humanEditor: o.humanEditor ?? null,
    humanEditSummary: null,
    approvedBy: null,
    cost: o.cost ?? { amount: 0, currency: 'USD', unit: 'local compute', estimated: false },
    date: o.date ?? nowIso(),
    sha256: o.sha256,
    notes: o.notes ?? null,
  };
  if (o.route) row.route = o.route;
  if (o.qa) row.qa = o.qa;
  const missing = REQUIRED.filter((k) => !(k in row) || row[k] === undefined);
  if (missing.length) throw new Error(`row ${o.id} missing ${missing.join(', ')}`);
  return row;
}

export function readManifest(p) {
  if (!fs.existsSync(p)) return { schemaVersion: 1, generatedBy: '', rows: [] };
  const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (doc.schemaVersion !== 1 || !Array.isArray(doc.rows)) throw new Error(`${p}: not a schemaVersion 1 manifest`);
  return doc;
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** O_EXCL lock file '<target>.lock' around fn() (stale after timeoutMs). Also used by the Higgsfield ledger. */
export function withLock(target, fn, timeoutMs = 30000) {
  const lock = `${target}.lock`;
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const t0 = Date.now();
  for (;;) {
    try {
      fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > timeoutMs) { fs.rmSync(lock, { force: true }); continue; }
      } catch { continue; }
      if (Date.now() - t0 > timeoutMs) throw new Error(`could not lock ${lock}`);
      sleep(50);
    }
  }
  try { return fn(); } finally { fs.rmSync(lock, { force: true }); }
}

/** Write JSON (2-space, trailing newline) via a temp file + rename. */
export const writeAtomic = (p, doc) => {
  const tmp = path.join(path.dirname(p), `.${path.basename(p)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`);
  fs.renameSync(tmp, p);
};

/** Append rows whose id is not yet present (append-only). Returns the number added. */
export function appendRows(p, rows, generatedBy) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  return withLock(p, () => {
    const exists = fs.existsSync(p);
    const doc = exists ? readManifest(p) : { schemaVersion: 1, generatedBy, rows: [] };
    const have = new Map(doc.rows.map((r) => [r.id, r]));
    for (const r of rows) {
      const old = have.get(r.id);
      if (old && old.sha256 !== r.sha256) throw new Error(`${p}: row id '${r.id}' already exists with a different sha256 (rows are immutable; write a new version instead)`);
    }
    const added = rows.filter((r) => !have.has(r.id));
    if (added.length || !exists) {
      doc.rows.push(...added);
      doc.generatedBy = generatedBy;
      writeAtomic(p, doc);
    }
    return added.length;
  });
}

/** Manifest-shaped sidecar; unchanged rows keep their original date (byte-identical re-runs). */
export function writeSidecar(p, rows, generatedBy) {
  let old = new Map();
  try { old = new Map(readManifest(p).rows.map((r) => [r.id, r])); } catch { /* fresh */ }
  const out = rows.map((r) => {
    const prev = old.get(r.id);
    return prev && prev.sha256 === r.sha256 ? { ...r, date: prev.date ?? r.date } : r;
  });
  fs.mkdirSync(path.dirname(p), { recursive: true });
  writeAtomic(p, { schemaVersion: 1, generatedBy, rows: out });
}

export function record(rows, { sidecar, manifest, generatedBy }) {
  if (sidecar) writeSidecar(sidecar, rows, generatedBy);
  if (manifest && String(manifest).toLowerCase() !== 'none') return appendRows(manifest, rows, generatedBy);
  return 0;
}
