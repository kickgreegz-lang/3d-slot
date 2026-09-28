#!/usr/bin/env python3
"""Ship approved source art into public/assets with a provenance row per shipped file.

    tools/.venv/bin/python tools/licence/ship.py tools/licence/ship/bass_drop_env.json [--dry-run] [--check]

A spec lists `{src, dst, encode}` items (repo-relative paths). For each item the tool:
  1. finds the source file's current row in art/manifest.json (same path AND same sha256; a source without a
     current row is refused: provenance first, shipping second);
  2. writes dst: `"copy"` = byte-identical copy, `{"webp": {...}}` = WebP re-encode with PIL (deterministic for
     the same input and options, so a re-run writes the same bytes);
  3. appends one row through the shared locked writer tools/gen/provenance.py (O_EXCL lock + atomic rename, so
     other tracks can append at the same time): stage `packaging`, route `code`, `shipped: true`, parent = the
     source row, licenseId inherited from the source row. Row id = `ship.<dst path>.<sha256[:8]>`, so an
     unchanged re-run adds nothing and a changed output gets a new row (rows are immutable).

Licensing is not decided here: tools/licence/audit.mjs walks every shipped chain. A chain holding a 'pending'
clearance (e.g. Higgsfield) is a release blocker: a warning in the dev audit, an error with `--release`.

--check  verify only (exit 1 on drift): every dst exists, equals what the spec would write, and has a row.
"""
from __future__ import annotations

import argparse
import io
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "tools/gen"))
import provenance as P  # noqa: E402

TOOL = "tools/licence/ship.py"


def _version() -> str:
    try:
        out = subprocess.run(["git", "hash-object", str(REPO / TOOL)], capture_output=True, text=True, cwd=REPO)
        return out.stdout.strip()[:12] or "unversioned"
    except OSError:
        return "unversioned"


def encode(src: Path, how) -> bytes:
    if how == "copy":
        return src.read_bytes()
    if isinstance(how, dict) and "webp" in how:
        from PIL import Image  # noqa: PLC0415 (only needed for re-encodes)

        opts = {"quality": 92, "method": 6, "alpha_quality": 100, "exact": False, **how["webp"]}
        with Image.open(src) as im:
            im.load()
            buf = io.BytesIO()
            im.save(buf, "WEBP", **opts)
            return buf.getvalue()
    raise SystemExit(f"ship: unknown encode {how!r} for {src}")


def source_row(rows: list[dict], src_rel: str, sha: str) -> dict:
    hit = [r for r in rows if r.get("path") == src_rel and r.get("sha256") == sha]
    if not hit:
        raise SystemExit(f"ship: {src_rel} has no art/manifest.json row with its current sha256 {sha[:12]}… "
                         "(write its provenance with the tool that produced it first)")
    return hit[-1]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("spec")
    ap.add_argument("--dry-run", action="store_true", help="print what would be written, write nothing")
    ap.add_argument("--check", action="store_true", help="verify the shipped files and rows, write nothing")
    a = ap.parse_args()
    spec = json.loads((REPO / a.spec if not Path(a.spec).is_absolute() else Path(a.spec)).read_text())
    rows = P.read_manifest(P.MANIFEST)["rows"]
    by_path_sha = {(r.get("path"), r.get("sha256")) for r in rows}
    version = _version()
    out_rows, problems, total = [], [], 0
    for item in spec["items"]:
        src_rel, dst_rel, how = item["src"], item["dst"], item.get("encode", "copy")
        if not dst_rel.startswith("public/assets/"):
            raise SystemExit(f"ship: dst {dst_rel} is not under public/assets/")
        src, dst = REPO / src_rel, REPO / dst_rel
        parent = source_row(rows, src_rel, P.sha256_file(src))
        data = encode(src, how)
        sha = P.sha256_bytes(data)
        total += len(data)
        if a.check:
            if not dst.exists() or P.sha256_file(dst) != sha:
                problems.append(f"{dst_rel}: missing or differs from what the spec writes")
            elif (dst_rel, sha) not in by_path_sha:
                problems.append(f"{dst_rel}: no provenance row for its sha256")
            continue
        verb = "same" if dst.exists() and P.sha256_file(dst) == sha else "write"
        print(f"{verb:5} {dst_rel}  {len(data) / 1024:.0f} KiB  <- {src_rel} ({parent['licenseId']}, row {parent['id']})")
        if a.dry_run:
            continue
        if verb == "write":
            dst.parent.mkdir(parents=True, exist_ok=True)
            tmp = dst.with_name(f".{dst.name}.tmp")
            tmp.write_bytes(data)
            tmp.replace(dst)
        rid = P.safe_id(f"ship.{dst_rel.removeprefix('public/assets/').rsplit('.', 1)[0].replace('/', '.')}.{sha[:8]}")
        how_txt = "byte-identical copy" if how == "copy" else f"WebP re-encode {json.dumps(how['webp'], sort_keys=True)}"
        out_rows.append(P.make_row(
            id=rid, path=dst_rel, stage="packaging", sha256=sha, vendor="self", model=TOOL, version=version,
            license_id=parent["licenseId"], route="code", ref_hashes=[parent["sha256"]], parents=[parent["id"]],
            shipped=True, notes=f"{spec.get('name', 'ship')}: {how_txt} of {src_rel}"
                                + (f"; {item['note']}" if item.get("note") else "")))
    if a.check:
        for p in problems:
            print(f"error: {p}")
        print(f"ship --check: {len(spec['items'])} item(s), {total / 1048576:.2f} MiB, "
              f"{len(problems)} problem(s) -> {'FAIL' if problems else 'OK'}")
        return 1 if problems else 0
    if a.dry_run:
        print(f"(dry run) {len(spec['items'])} item(s), {total / 1048576:.2f} MiB")
        return 0
    added = P.append_rows(P.MANIFEST, out_rows, generated_by=TOOL)
    print(f"ship: {len(spec['items'])} item(s), {total / 1048576:.2f} MiB, {added} new provenance row(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
