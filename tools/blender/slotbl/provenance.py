"""Provenance rows for art/manifest.json (schema: art/manifest.schema.json). No bpy import.

Scripts never edit art/manifest.json implicitly. Each run writes a *sidecar* manifest
document (`{"schemaVersion":1,"generatedBy":...,"rows":[...]}`) next to its QA output;
`--manifest art/manifest.json` additionally appends the rows (append-only, by id).

Idempotency: a row id embeds the first 8 hex chars of the output digest, so an identical
re-render yields the same id; the original `date` is kept when the sidecar already holds
that id, so re-running a deterministic step rewrites byte-identical sidecars.
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import re
from pathlib import Path

from .cli import REPO, TOOLS_BLENDER, rel

SCHEMA_PATH = REPO / "art" / "manifest.schema.json"
TOOLKIT_GLOBS = ("*.py", "slotbl/*.py", "*.json", "*.sh")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_text(text: str) -> str:
    return sha256_bytes(text.encode("utf-8"))


def sha256_file(path: str | Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(chunk), b""):
            h.update(block)
    return h.hexdigest()


def digest_files(paths, base: Path | None = None) -> str:
    """sha256 over lines '<name>:<sha256>\\n' of the files, sorted by name.

    Used as the row sha256 of a frame-sequence folder (one row per clip, documented in
    tools/blender/README.md)."""
    lines = []
    for p in paths:
        p = Path(p)
        name = p.relative_to(base).as_posix() if base else p.name
        lines.append(f"{name}:{sha256_file(p)}\n")
    return sha256_text("".join(sorted(lines)))


def toolkit_version() -> str:
    """Short content hash of the committed tools/blender sources (the 'version' pin of a row)."""
    files = []
    for g in TOOLKIT_GLOBS:
        files += [p for p in TOOLS_BLENDER.glob(g) if p.is_file()]
    return digest_files(sorted(set(files)), TOOLS_BLENDER)[:12]


def now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def row_id(prefix: str, name: str, digest: str) -> str:
    rid = f"{prefix}.{name}.{digest[:8]}".lower()
    rid = re.sub(r"[^a-z0-9_.-]+", "_", rid)
    return rid.lstrip("._-") or "row"


def make_row(*, id: str, path: str | Path, stage: str, sha256: str, model: str, version: str,
             route: str = "blender", vendor: str = "Blender Foundation", seed=None,
             ref_hashes=(), parents=(), license_id: str = "blender-5.2", notes: str | None = None,
             qa: dict | None = None, shipped: bool = False, date: str | None = None,
             cost_unit: str = "local compute", human_editor: str | None = None) -> dict:
    row = {
        "id": id,
        "path": rel(path) if isinstance(path, Path) or Path(str(path)).is_absolute() else str(path),
        "stage": stage,
        "shipped": shipped,
        "route": route,
        "vendor": vendor,
        "model": model,
        "version": version,
        "seed": seed,
        "jobId": None,
        "promptPath": None,
        "promptHash": None,
        "template": None,
        "refHashes": list(ref_hashes),
        "parents": list(parents),
        "planTier": None,
        "tosVersion": None,
        "licenseId": license_id,
        "humanEditor": human_editor,
        "humanEditSummary": None,
        "approvedBy": None,
        "cost": {"amount": 0, "currency": "USD", "unit": cost_unit, "estimated": False},
        "date": date or now_iso(),
        "sha256": sha256,
        "notes": notes,
    }
    if qa is not None:
        row["qa"] = qa
    return row


# --------------------------------------------------------------------------------------
# Minimal JSON-Schema (2020-12 subset) validator: enough for art/manifest.schema.json and
# tools/blender/anim.schema.json without a jsonschema dependency.
# --------------------------------------------------------------------------------------
_DATE_TIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$")
_TYPES = {
    "string": lambda v: isinstance(v, str),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "boolean": lambda v: isinstance(v, bool),
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
    "null": lambda v: v is None,
}


def validate(instance, schema: dict, root: dict | None = None, where: str = "$") -> list[str]:
    root = root or schema
    errs: list[str] = []
    if "$ref" in schema:
        ref = schema["$ref"]
        if not ref.startswith("#/"):
            return [f"{where}: unsupported $ref {ref}"]
        node = root
        for part in ref[2:].split("/"):
            node = node[part]
        return validate(instance, node, root, where)
    if "const" in schema and instance != schema["const"]:
        errs.append(f"{where}: must equal {schema['const']!r}")
    if "enum" in schema and instance not in schema["enum"]:
        errs.append(f"{where}: {instance!r} not in {schema['enum']}")
    t = schema.get("type")
    if t is not None:
        types = t if isinstance(t, list) else [t]
        if not any(_TYPES[x](instance) for x in types):
            return errs + [f"{where}: expected {types}, got {type(instance).__name__}"]
    if isinstance(instance, str):
        if "pattern" in schema and instance is not None and not re.search(schema["pattern"], instance):
            errs.append(f"{where}: {instance!r} does not match {schema['pattern']}")
        if schema.get("format") == "date-time" and not _DATE_TIME.match(instance):
            errs.append(f"{where}: not an RFC3339 date-time: {instance!r}")
        if "minLength" in schema and len(instance) < schema["minLength"]:
            errs.append(f"{where}: shorter than {schema['minLength']}")
    if isinstance(instance, (int, float)) and not isinstance(instance, bool):
        if "minimum" in schema and instance < schema["minimum"]:
            errs.append(f"{where}: {instance} < minimum {schema['minimum']}")
        if "maximum" in schema and instance > schema["maximum"]:
            errs.append(f"{where}: {instance} > maximum {schema['maximum']}")
        if "exclusiveMinimum" in schema and instance <= schema["exclusiveMinimum"]:
            errs.append(f"{where}: {instance} <= exclusiveMinimum {schema['exclusiveMinimum']}")
    if isinstance(instance, dict):
        for k in schema.get("required", []):
            if k not in instance:
                errs.append(f"{where}: missing required '{k}'")
        props = schema.get("properties", {})
        for k, v in instance.items():
            if k in props:
                errs += validate(v, props[k], root, f"{where}.{k}")
            elif schema.get("additionalProperties") is False:
                errs.append(f"{where}: unexpected property '{k}'")
            elif isinstance(schema.get("additionalProperties"), dict):
                errs += validate(v, schema["additionalProperties"], root, f"{where}.{k}")
    if isinstance(instance, list):
        if "minItems" in schema and len(instance) < schema["minItems"]:
            errs.append(f"{where}: fewer than {schema['minItems']} items")
        if "maxItems" in schema and len(instance) > schema["maxItems"]:
            errs.append(f"{where}: more than {schema['maxItems']} items")
        if "items" in schema:
            for i, v in enumerate(instance):
                errs += validate(v, schema["items"], root, f"{where}[{i}]")
    for sub in schema.get("allOf", []):
        errs += validate(instance, sub, root, where)
    if "anyOf" in schema:
        results = [validate(instance, sub, root, where) for sub in schema["anyOf"]]
        if all(results):
            errs.append(f"{where}: matches none of anyOf ({results[0][0] if results[0] else ''})")
    if "oneOf" in schema:
        ok = sum(1 for sub in schema["oneOf"] if not validate(instance, sub, root, where))
        if ok != 1:
            errs.append(f"{where}: must match exactly one of oneOf (matched {ok})")
    return errs


def load_schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text())


def validate_rows(rows: list[dict]) -> list[str]:
    schema = load_schema()
    doc = {"schemaVersion": 1, "generatedBy": "check", "rows": rows}
    return validate(doc, schema)


def write_sidecar(path: str | Path, rows: list[dict], generated_by: str) -> Path:
    """Write a manifest-shaped document; keep the date of rows whose id+sha256 already exist."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    old = {}
    if path.exists():
        try:
            for r in json.loads(path.read_text()).get("rows", []):
                old[(r.get("id"), r.get("sha256"))] = r
        except (json.JSONDecodeError, OSError):
            pass
    for r in rows:
        prev = old.get((r["id"], r["sha256"]))
        if prev and "date" in prev:
            r["date"] = prev["date"]
    errs = validate_rows(rows)
    if errs:
        raise ValueError("manifest rows do not match art/manifest.schema.json:\n  " + "\n  ".join(errs))
    doc = {"schemaVersion": 1, "generatedBy": generated_by, "rows": rows}
    path.write_text(json.dumps(doc, indent=2, sort_keys=False) + "\n")
    return path


def append_to_manifest(manifest: str | Path, rows: list[dict], generated_by: str) -> int:
    """Append rows whose id is not yet present (art/manifest.json is append-only)."""
    manifest = Path(manifest)
    doc = {"schemaVersion": 1, "generatedBy": generated_by, "rows": []}
    if manifest.exists():
        doc = json.loads(manifest.read_text())
    have = {r.get("id") for r in doc.get("rows", [])}
    added = [r for r in rows if r["id"] not in have]
    doc.setdefault("rows", []).extend(added)
    doc["generatedBy"] = generated_by
    errs = validate(doc, load_schema())
    if errs:
        raise ValueError("manifest would become invalid:\n  " + "\n  ".join(errs[:20]))
    manifest.parent.mkdir(parents=True, exist_ok=True)
    manifest.write_text(json.dumps(doc, indent=2) + "\n")
    return len(added)


def file_ref(path: str | Path) -> dict:
    return {"path": rel(path), "sha256": sha256_file(path)}
