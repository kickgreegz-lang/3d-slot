#!/usr/bin/env python3
"""Technical audit of the Bass Drop art sources (phase C): provenance, size policy and git hygiene.

    tools/.venv/bin/python tools/artqa/check_art.py [--json build/qa/artqa/check_art.json] [--strict]

Checks every image / Spine runtime file under art/source (and art/source/spine|env|mascots images):
  provenance  a row in art/manifest.json whose path is the file and whose sha256 is the file's current sha256;
              its parent chain reaches a generation row (route higgsfield-mcp with jobId + promptHash) unless the
              row is owned-code / a font licence; every parent id exists;
  size        each file <= 1.5 MB; symbols / parts / UI <= 1024 px on the long side; characters <= 2048 px tall;
              backgrounds <= 2560 px wide; atlas pages and the frame's 3-slice strips (2x runtime size) <= 2048
              (docs: phase C GIT/SIZE POLICY);
  git         nothing from art/_raw, art/_work, art/_reference, build/ or tools/.venv is tracked or staged.
Exit 1 on any error with --strict (warnings never fail).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
IMG = {".png", ".webp", ".jpg", ".jpeg"}
SPINE = {".atlas"}
MAX_BYTES = 1_500_000


def sha(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def img_size(p: Path):
    try:
        from PIL import Image
        with Image.open(p) as im:
            return im.size
    except Exception:  # noqa: BLE001
        return None


def size_rule(rel: str):
    """(limit_kind, px) for the size policy."""
    if rel.startswith("art/source/backgrounds/"):
        return ("width", 2560)
    if rel.startswith("art/source/mascots/") and not rel.endswith(".atlas"):
        if "/spine/" in rel:  # atlas pages
            return ("long", 2048)
        return ("height", 2048)
    if rel.startswith("art/source/ui/bass-drop/frame/"):
        return ("long", 2048)  # 3-slice strips at the 2x runtime size (1876 x 132): halving them would force upscaling
    if "/spine/" in rel and rel.endswith(".png") and rel.count("/") <= 5:
        return ("long", 2048)  # atlas page
    return ("long", 1024)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json")
    ap.add_argument("--strict", action="store_true")
    a = ap.parse_args()
    man = json.loads((REPO / "art/manifest.json").read_text())
    rows = man["rows"]
    by_id = {r["id"]: r for r in rows}
    by_path: dict[str, list[dict]] = {}
    for r in rows:
        by_path.setdefault(r["path"], []).append(r)

    def chain_ok(r, stack=frozenset()) -> tuple[bool, str]:
        if r["id"] in stack:
            return False, f"{r['id']}: parent cycle"
        seen = stack | {r["id"]}
        if r.get("route") == "higgsfield-mcp":
            ok = bool(r.get("jobId")) and bool(r.get("promptHash"))
            return ok, "" if ok else f"{r['id']}: generation row without jobId/promptHash"
        pars = r.get("parents") or []
        if not pars:
            if r.get("licenseId") in ("owned-code", "fonts-bundled"):
                return True, ""
            return False, f"{r['id']}: derived row ({r.get('licenseId')}) has no parents"
        for pid in pars:
            if pid not in by_id:
                return False, f"{r['id']}: parent {pid} missing"
            ok, why = chain_ok(by_id[pid], seen)
            if not ok:
                return ok, why
        return True, ""

    appr = json.loads((REPO / "art/plan/approvals.json").read_text())
    approved_ids = {v["job_id"] for v in appr.get("approvals", {}).values() if v.get("job_id")}
    appr_text = json.dumps(appr)

    def gen_ancestors(r, stack=frozenset()):
        if r["id"] in stack:
            return set()
        if r.get("route") == "higgsfield-mcp":
            return {r.get("jobId")}
        out = set()
        for pid in r.get("parents") or []:
            if pid in by_id:
                out |= gen_ancestors(by_id[pid], stack | {r["id"]})
        return out

    files = sorted(p for p in (REPO / "art/source").rglob("*") if p.is_file() and p.suffix.lower() in IMG | SPINE)
    # spine skeleton JSONs are runtime files too
    files += sorted(p for p in (REPO / "art/source").rglob("*/spine/*.json"))
    errors, warns, report = [], [], []
    for p in files:
        rel = p.relative_to(REPO).as_posix()
        item = {"path": rel, "bytes": p.stat().st_size}
        s = sha(p)
        rs = by_path.get(rel, [])
        match = [r for r in rs if r.get("sha256") == s]
        if not rs:
            errors.append(f"provenance: no manifest row for {rel}")
            item["prov"] = "missing"
        elif not match:
            errors.append(f"provenance: {rel} changed since its manifest row(s) {[r['id'] for r in rs]} (stale sha256)")
            item["prov"] = "stale"
        else:
            ok, why = chain_ok(match[-1])
            item["prov"] = "ok" if ok else f"chain: {why}"
            jobs = sorted(j for j in gen_ancestors(match[-1]) if j)
            item["jobs"] = jobs
            for j in jobs:
                if j in approved_ids:
                    continue
                if j[:8] in appr_text:
                    warns.append(f"approval: {rel} uses job {j[:8]} that approvals.json names only in a note (partial use)")
                else:
                    errors.append(f"approval: {rel} derives from job {j} that is not approved in art/plan/approvals.json")
            if not ok:
                errors.append(f"provenance: {rel}: {why}")
            if len(rs) > len(match):
                warns.append(f"provenance: {rel} also has stale rows {[r['id'] for r in rs if r not in match]}")
        if item["bytes"] > MAX_BYTES:
            errors.append(f"size: {rel} is {item['bytes'] / 1e6:.2f} MB (> 1.5 MB)")
        if p.suffix.lower() in IMG:
            wh = img_size(p)
            item["wh"] = wh
            kind, lim = size_rule(rel)
            if wh:
                v = {"width": wh[0], "height": wh[1], "long": max(wh)}[kind]
                if v > lim:
                    errors.append(f"size: {rel} {wh[0]}x{wh[1]} exceeds {kind} {lim}")
        report.append(item)

    bad_prefix = ("art/_raw/", "art/_work/", "art/_reference/", "build/", "tools/.venv/")
    tracked = subprocess.run(["git", "ls-files"], cwd=REPO, capture_output=True, text=True).stdout.split()
    staged = subprocess.run(["git", "diff", "--cached", "--name-only"], cwd=REPO, capture_output=True, text=True).stdout.split()
    for f in sorted(set(tracked) | set(staged)):
        if f.startswith(bad_prefix):
            errors.append(f"git: {f} is tracked or staged (policy: never commit raws, work files, build output or reference captures)")
    total = sum(i["bytes"] for i in report)
    out = {"files": len(report), "bytes": total, "errors": errors, "warnings": warns, "items": report}
    if a.json:
        Path(a.json).parent.mkdir(parents=True, exist_ok=True)
        Path(a.json).write_text(json.dumps(out, indent=1) + "\n")
    print(f"check_art: {len(report)} files, {total / 1e6:.1f} MB, {len(errors)} errors, {len(warns)} warnings")
    for e in errors:
        print("  ERROR", e)
    for w in warns:
        print("  warn ", w)
    return 1 if (errors and a.strict) else 0


if __name__ == "__main__":
    sys.exit(main())
