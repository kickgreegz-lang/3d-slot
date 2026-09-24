"""Provenance rows for art/manifest.json (schema: art/manifest.schema.json). Stdlib only.

Shared by tools/gen, tools/matte and tools/video (JS twin: tools/gen/lib/provenance.mjs).

Conventions (compatible with tools/spine and tools/blender):
  * every row carries all 16 schema-required keys;
  * ids are lowercase `^[a-z0-9][a-z0-9_.-]*$`; derived rows end in the first 8 hex chars of
    the output sha256, so re-running a deterministic step on unchanged inputs yields the same
    id and the row is not appended twice (the original row and its date are kept);
  * each run writes a *sidecar* manifest document next to its output and, unless told not to,
    appends to art/manifest.json. Appends are atomic (tmp + rename) under an O_EXCL lock file,
    so parallel generators never lose rows.
"""
from __future__ import annotations

import contextlib
import datetime as _dt
import hashlib
import json
import os
import re
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
MANIFEST = REPO / "art" / "manifest.json"
SCHEMA = REPO / "art" / "manifest.schema.json"

REQUIRED = ("id", "path", "stage", "vendor", "model", "version", "seed", "promptHash", "refHashes",
            "planTier", "tosVersion", "licenseId", "humanEditor", "cost", "date", "sha256")
ID_RE = re.compile(r"^[a-z0-9][a-z0-9_.-]*$")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_text(text: str) -> str:
    return sha256_bytes(text.encode("utf-8"))


def sha256_file(path: str | os.PathLike, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(chunk), b""):
            h.update(block)
    return h.hexdigest()


def digest_files(paths, base: str | os.PathLike | None = None) -> str:
    """sha256 over sorted lines '<name>:<sha256>\\n' (same rule as tools/blender for folder rows)."""
    lines = []
    for p in paths:
        p = Path(p)
        name = p.relative_to(base).as_posix() if base else p.name
        lines.append(f"{name}:{sha256_file(p)}\n")
    return sha256_text("".join(sorted(lines)))


def rel(path: str | os.PathLike) -> str:
    """Repo-relative POSIX path (absolute path if outside the repo)."""
    p = Path(path).resolve()
    try:
        return p.relative_to(REPO).as_posix()
    except ValueError:
        return p.as_posix()


def now_iso() -> str:
    """UTC timestamp; SOURCE_DATE_EPOCH pins it for reproducible test output."""
    epoch = os.environ.get("SOURCE_DATE_EPOCH")
    t = _dt.datetime.fromtimestamp(int(epoch), _dt.timezone.utc) if epoch else _dt.datetime.now(_dt.timezone.utc)
    return t.replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def safe_id(*parts: str) -> str:
    rid = ".".join(p for p in parts if p).lower()
    rid = re.sub(r"[^a-z0-9_.-]+", "_", rid).strip("._-")
    return rid or "row"


def make_row(*, id: str, path: str | os.PathLike, stage: str, sha256: str, vendor: str, model: str,
             version: str, license_id: str, route: str | None = None, seed=None, job_id: str | None = None,
             prompt_path: str | None = None, prompt_hash: str | None = None, template: str | None = None,
             ref_hashes=(), parents=(), plan_tier: str | None = None, tos_version: str | None = None,
             human_editor: str | None = None, cost: dict | None = None, shipped: bool = False,
             qa: dict | None = None, notes: str | None = None, date: str | None = None) -> dict:
    if not ID_RE.match(id):
        raise ValueError(f"row id {id!r} does not match {ID_RE.pattern}")
    row = {
        "id": id,
        "path": rel(path) if Path(str(path)).is_absolute() else str(path),
        "stage": stage,
        "shipped": bool(shipped),
        "vendor": vendor,
        "model": model,
        "version": version,
        "seed": seed,
        "jobId": job_id,
        "promptPath": prompt_path,
        "promptHash": prompt_hash,
        "template": template,
        "refHashes": list(ref_hashes),
        "parents": list(parents),
        "planTier": plan_tier,
        "tosVersion": tos_version,
        "licenseId": license_id,
        "humanEditor": human_editor,
        "humanEditSummary": None,
        "approvedBy": None,
        "cost": cost or {"amount": 0, "currency": "USD", "unit": "local compute", "estimated": False},
        "date": date or now_iso(),
        "sha256": sha256,
        "notes": notes,
    }
    if route:
        row["route"] = route
    if qa is not None:
        row["qa"] = qa
    missing = [k for k in REQUIRED if k not in row]
    assert not missing, missing
    return row


def _empty(generated_by: str) -> dict:
    return {"schemaVersion": 1, "generatedBy": generated_by, "rows": []}


def read_manifest(path: str | os.PathLike) -> dict:
    p = Path(path)
    if not p.exists():
        return _empty("")
    doc = json.loads(p.read_text(encoding="utf-8"))
    if doc.get("schemaVersion") != 1 or not isinstance(doc.get("rows"), list):
        raise ValueError(f"{path}: not a schemaVersion 1 manifest")
    return doc


def find_row(row_id: str, path: str | os.PathLike = MANIFEST) -> dict | None:
    for r in read_manifest(path)["rows"]:
        if r.get("id") == row_id:
            return r
    return None


@contextlib.contextmanager
def _lock(target: Path, timeout: float = 30.0):
    lock = target.with_name(target.name + ".lock")
    lock.parent.mkdir(parents=True, exist_ok=True)
    t0 = time.monotonic()
    while True:
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, str(os.getpid()).encode())
            os.close(fd)
            break
        except FileExistsError:
            # stale lock (holder died): older than the timeout -> take it over
            try:
                if time.time() - lock.stat().st_mtime > timeout:
                    lock.unlink(missing_ok=True)
                    continue
            except FileNotFoundError:
                continue
            if time.monotonic() - t0 > timeout:
                raise TimeoutError(f"could not lock {lock}")
            time.sleep(0.05)
    try:
        yield
    finally:
        lock.unlink(missing_ok=True)


def _write_atomic(path: Path, doc: dict) -> None:
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def append_rows(path: str | os.PathLike, rows: list[dict], generated_by: str) -> int:
    """Append rows whose id is not yet present (append-only). Returns the number added."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with _lock(p):
        doc = read_manifest(p) if p.exists() else _empty(generated_by)
        have = {r.get("id"): r for r in doc["rows"]}
        for r in rows:
            old = have.get(r["id"])
            if old is not None and old.get("sha256") != r["sha256"]:
                raise ValueError(f"{p}: row id {r['id']!r} already exists with a different sha256 "
                                 f"(rows are immutable; write a new version instead)")
        added = [r for r in rows if r["id"] not in have]
        if added or not p.exists():
            doc["rows"].extend(added)
            doc["generatedBy"] = generated_by
            _write_atomic(p, doc)
    return len(added)


def write_sidecar(path: str | os.PathLike, rows: list[dict], generated_by: str) -> None:
    """Write a manifest-shaped sidecar. Rows already present keep their original date, so a
    deterministic re-run rewrites a byte-identical file."""
    p = Path(path)
    old = {}
    if p.exists():
        try:
            old = {r["id"]: r for r in read_manifest(p)["rows"]}
        except (ValueError, json.JSONDecodeError, KeyError):
            old = {}
    out = []
    for r in rows:
        prev = old.get(r["id"])
        if prev and prev.get("sha256") == r["sha256"]:
            r = {**r, "date": prev.get("date", r["date"])}
        out.append(r)
    p.parent.mkdir(parents=True, exist_ok=True)
    _write_atomic(p, {"schemaVersion": 1, "generatedBy": generated_by, "rows": out})


def record(rows: list[dict], *, sidecar: str | os.PathLike | None, manifest: str | os.PathLike | None,
           generated_by: str) -> int:
    """Sidecar + optional append to the project manifest. `manifest` None/'none' skips it."""
    if sidecar:
        write_sidecar(sidecar, rows, generated_by)
    if manifest and str(manifest).lower() != "none":
        return append_rows(manifest, rows, generated_by)
    return 0


def inherit_license(parent_ids, manifest: str | os.PathLike = MANIFEST, default: str | None = None) -> str | None:
    """The licence of a derivative is governed by its upstream generation: return the first
    parent row's licenseId found in the manifest (or `default`)."""
    try:
        rows = {r.get("id"): r for r in read_manifest(manifest)["rows"]}
    except (ValueError, json.JSONDecodeError):
        rows = {}
    for pid in parent_ids or ():
        r = rows.get(pid)
        if r and r.get("licenseId"):
            return r["licenseId"]
    return default
