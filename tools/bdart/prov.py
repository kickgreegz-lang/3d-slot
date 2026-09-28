"""Provenance rows for tools/bdart outputs, written through the shared writer tools/gen/provenance.py (append-only,
O_EXCL lock + atomic rename, so other tracks can append to art/manifest.json at the same time).

Row id = <id_prefix>.<sha256[:8]>, so a rebuild that changes a file writes a new row (rows are immutable) and an
unchanged file is skipped.
"""
from __future__ import annotations

import subprocess
import sys

from bglib import REPO, sha256_file

sys.path.insert(0, str(REPO / "tools/gen"))
import provenance as P  # noqa: E402


def _script_version(script: str) -> str:
    try:
        out = subprocess.run(["git", "hash-object", str(REPO / script)], capture_output=True, text=True, cwd=REPO)
        return out.stdout.strip()[:12] or "unversioned"
    except OSError:
        return "unversioned"


def add_rows(rows: list[dict]) -> int:
    """rows: {id_prefix, path (repo-relative), stage, parents, script, notes, [qa], [license]}. Returns the number appended.
    license defaults to higgsfield (inherited from generated parents); purely procedural art passes owned-code."""
    doc = P.read_manifest(P.MANIFEST)
    by_id = {r["id"]: r for r in doc["rows"]}
    out = []
    for spec in rows:
        sha = sha256_file(REPO / spec["path"])
        for par in spec["parents"]:
            if par not in by_id:
                raise SystemExit(f"prov: parent row {par!r} of {spec['path']} is not in art/manifest.json")
        refs = [by_id[p]["sha256"] for p in spec["parents"] if by_id[p].get("sha256")]
        out.append(P.make_row(
            id=P.safe_id(f"{spec['id_prefix']}.{sha[:8]}"), path=spec["path"], stage=spec["stage"], sha256=sha,
            vendor="self", model=spec["script"], version=_script_version(spec["script"]),
            license_id=spec.get("license", "higgsfield"),
            route="code", ref_hashes=refs, parents=spec["parents"], qa=spec.get("qa"), notes=spec["notes"]))
    return P.append_rows(P.MANIFEST, out, generated_by="tools/bdart")
