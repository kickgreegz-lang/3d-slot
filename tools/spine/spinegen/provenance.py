"""Provenance rows compatible with art/manifest.schema.json (append-only, content-addressed).

Row ids end in the first 8 hex chars of the file's sha256, so re-running a deterministic
tool on unchanged inputs produces the same id and the row is not appended twice (the
original row, with its original date, is kept). A changed output gets a new row whose
`parents` / `refHashes` point at its inputs.
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import os
import re
from pathlib import Path


def sha256_file(path: str | os.PathLike) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def repo_root(start: str | os.PathLike | None = None) -> Path:
    p = Path(start or __file__).resolve()
    for d in [p] + list(p.parents):
        if (d / "package.json").exists() and (d / "art").exists():
            return d
        if (d / ".git").exists():
            return d
    return Path.cwd()


def rel(path: str | os.PathLike, root: Path | None = None) -> str:
    root = root or repo_root()
    p = Path(path).resolve()
    try:
        return p.relative_to(root).as_posix()
    except ValueError:
        return p.as_posix()


def now_iso() -> str:
    epoch = os.environ.get("SOURCE_DATE_EPOCH")
    t = _dt.datetime.fromtimestamp(int(epoch), _dt.timezone.utc) if epoch else _dt.datetime.now(_dt.timezone.utc)
    return t.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def make_row(*, asset_id: str, path: str | os.PathLike, stage: str, model: str, version: str,
             inputs: list[str | os.PathLike] = (), parents: list[str] = (), license_id: str = "owned-code",
             shipped: bool = False, route: str = "code", notes: str | None = None, qa: dict | None = None,
             human_editor: str | None = None) -> dict:
    digest = sha256_file(path)
    safe = re.sub(r"[^a-z0-9_.-]", "_", asset_id.lower())
    row = {
        "id": f"{safe}.{digest[:8]}",
        "path": rel(path),
        "stage": stage,
        "shipped": bool(shipped),
        "route": route,
        "vendor": "self",
        "model": model,
        "version": version,
        "seed": None,
        "jobId": None,
        "promptPath": None,
        "promptHash": None,
        "template": None,
        "refHashes": [sha256_file(p) for p in inputs],
        "parents": list(parents),
        "planTier": None,
        "tosVersion": None,
        "licenseId": license_id,
        "humanEditor": human_editor,
        "humanEditSummary": None,
        "approvedBy": None,
        "cost": {"amount": 0, "currency": "USD", "estimated": False},
        "date": now_iso(),
        "sha256": digest,
        "notes": notes,
    }
    if qa is not None:
        row["qa"] = qa
    return row


def append_rows(file: str | os.PathLike, rows: list[dict], generated_by: str) -> int:
    """Append rows to a manifest-shaped file ({schemaVersion:1, rows:[...]}); rows whose id is
    already present are skipped. Returns the number of rows added. Writes only on change."""
    p = Path(file)
    if p.exists():
        doc = json.loads(p.read_text(encoding="utf-8"))
        if doc.get("schemaVersion") != 1 or not isinstance(doc.get("rows"), list):
            raise ValueError(f"{file}: not a schemaVersion 1 manifest")
    else:
        doc = {"schemaVersion": 1, "generatedBy": generated_by, "rows": []}
    have = {r.get("id") for r in doc["rows"]}
    added = 0
    for r in rows:
        if r["id"] in have:
            continue
        doc["rows"].append(r)
        have.add(r["id"])
        added += 1
    if added or not p.exists():
        doc["generatedBy"] = generated_by
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return added
