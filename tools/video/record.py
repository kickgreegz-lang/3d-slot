#!/usr/bin/env python3
"""Write a provenance row for a file or a frame folder (used by the tools/video and tools/audio shell
scripts). Stdlib only. A folder row's sha256 is the tools/blender folder digest (sorted
'<name>:<sha256>' lines), so it matches what the licence audit recomputes.

  python3 tools/video/record.py --path build/frames/W_turn --stage video --model tools/video/key_video.sh \\
      --inputs in.mp4 --sidecar build/qa/video/W_turn/manifest.json [--manifest art/manifest.json] \\
      [--parent-id ID] [--license-id ffmpeg] [--asset-id W_turn] [--qa-json qa.json] [--notes TEXT]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "gen"))
import provenance as prov  # noqa: E402


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--path", required=True, nargs="+", help="file(s) or frame folder(s); one row each")
    ap.add_argument("--stage", required=True)
    ap.add_argument("--model", required=True, help="tool that produced the file, e.g. tools/video/key_video.sh")
    ap.add_argument("--version", help="default: content hash of the tool folder")
    ap.add_argument("--inputs", nargs="*", default=[])
    ap.add_argument("--parent-id", action="append", default=[])
    ap.add_argument("--license-id", help="default: parent's licenseId, else ffmpeg")
    ap.add_argument("--asset-id")
    ap.add_argument("--kind", default="out", help="id middle part, e.g. frames, stacked; 'ext' = file extension")
    ap.add_argument("--sidecar", required=True)
    ap.add_argument("--manifest", default="none")
    ap.add_argument("--qa-json", help="QA report; its 'passed' goes into the row")
    ap.add_argument("--notes")
    ap.add_argument("--shipped", action="store_true")
    a = ap.parse_args(argv)
    digests = []
    for p in map(Path, a.path):
        if p.is_dir():
            files = sorted(f for f in p.rglob("*") if f.is_file())
            if not files:
                print(f"error: {p} is empty", file=sys.stderr)
                return 2
            digests.append((p, prov.digest_files(files, p)))
        elif p.is_file():
            digests.append((p, prov.sha256_file(p)))
        else:
            print(f"error: {p} not found", file=sys.stderr)
            return 2
    tool_dir = (prov.REPO / a.model).parent
    version = a.version or prov.digest_files(sorted(f for f in tool_dir.glob("*") if f.is_file()), tool_dir)[:12]
    qa = None
    if a.qa_json:
        rep = json.loads(Path(a.qa_json).read_text(encoding="utf-8"))
        qa = {"passed": bool(rep.get("passed", False)), "report": prov.rel(a.qa_json)}
    lic = a.license_id or prov.inherit_license(a.parent_id, default="ffmpeg")
    rows = []
    for p, digest in digests:
        kind = p.suffix.lstrip(".") if a.kind == "ext" else a.kind
        rows.append(prov.make_row(
            id=prov.safe_id(a.asset_id or p.stem, kind, digest[:8]), path=p, stage=a.stage, sha256=digest,
            vendor="self", model=a.model, version=version, license_id=lic, route="ffmpeg",
            ref_hashes=[prov.sha256_file(i) for i in a.inputs if Path(i).is_file()], parents=a.parent_id,
            qa=qa, notes=a.notes, shipped=a.shipped))
    added = prov.record(rows, sidecar=a.sidecar, manifest=a.manifest, generated_by=a.model)
    print(json.dumps({"ids": [r["id"] for r in rows], "manifestRowsAdded": added}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
