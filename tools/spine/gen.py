#!/usr/bin/env python3
"""Generate a Spine 4.3 skeleton JSON from rig.yaml + parts.json (ANIMATION_CONTRACT sections 2-4).

    python tools/spine/gen.py art/source/symbols/H1/rig.yaml -o build/spine/sym_H1.json
    python tools/spine/gen.py RIG -o OUT [--images-path P] [--spine-version 4.3.23]
                              [--provenance FILE] [--manifest art/manifest.json] [--license-id ID]
                              [--check] [--quiet]

What it writes (deterministic: same inputs -> byte-identical output):
  * bones root / squash (feet) / body (centre) + rig bones (ctrl_, ik_, phys_, face_, fx_);
  * slots in z order, region or mesh attachments (grid or alpha-traced, weighted), blur variants;
  * ONE root `constraints[]` ordered IK -> transform -> physics (-> slider); physics from
    f / zeta: strength = (2*pi*f)^2 * mass, damping = exp(-2*zeta*2*pi*f/60);
  * the contract animation set (idle, land, win, win_loop, anticipation(+_intro/_out),
    explode, appear, blur, blink) with events, curves as absolute beziers.
Exit codes: 0 ok, 1 rig/contract error, 2 usage error. `--check` generates in memory and
exits 1 if OUT differs (CI drift check).
"""
from __future__ import annotations

import argparse
import sys

sys.dont_write_bytecode = True  # never leave __pycache__ in tools/
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from spinegen import provenance as prov  # noqa: E402
from spinegen.rig import GEN_VERSION, RigBuilder, RigError, dump  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="gen.py", description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__.split("\n", 2)[2])
    ap.add_argument("rig", help="rig.yaml (parts.json path is read from it, default: parts.json next to it)")
    ap.add_argument("-o", "--out", required=True, help="output skeleton JSON (e.g. build/spine/sym_H1.json)")
    ap.add_argument("--images-path", default=None,
                    help="skeleton.images value; default = path of the parts image root relative to --out")
    ap.add_argument("--spine-version", default=None, help="skeleton.spine (default: rig.yaml spine_version or contract.json)")
    ap.add_argument("--provenance", default=None, help="append a provenance row to this rows file (manifest-shaped JSON)")
    ap.add_argument("--manifest", default=None, help="also append the row to this manifest (e.g. art/manifest.json)")
    ap.add_argument("--license-id", default="owned-code", help="licenseId for the row (must exist in licenses/allowlist.json)")
    ap.add_argument("--shipped", action="store_true", help="mark the provenance row shipped: true")
    ap.add_argument("--check", action="store_true", help="do not write; exit 1 if --out is missing or differs")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args(argv)

    try:
        rb = RigBuilder(a.rig, out_path=a.out, images_path=a.images_path, spine_version=a.spine_version)
        doc = rb.build()
    except (RigError, ValueError, FileNotFoundError, KeyError) as e:
        print(f"gen.py: ERROR: {e}", file=sys.stderr)
        return 1
    text = dump(doc)
    out = Path(a.out)
    if a.check:
        cur = out.read_text(encoding="utf-8") if out.exists() else None
        if cur != text:
            print(f"gen.py: DRIFT: {out} is not what {a.rig} generates", file=sys.stderr)
            return 1
        if not a.quiet:
            print(f"gen.py: {out} up to date")
        return 0
    out.parent.mkdir(parents=True, exist_ok=True)
    if not out.exists() or out.read_text(encoding="utf-8") != text:
        out.write_text(text, encoding="utf-8")
    st = rb.report.stats
    if not a.quiet:
        print(f"gen.py: wrote {out}  ({rb.skel_name}, kind {rb.kind}, spine {doc['skeleton']['spine']})")
        print(f"  bones {st['bones']}  slots {st['slots']}  mesh vertices {st['meshVertices']}  "
              f"feet_y {st['feet_y']}  body_y {st['body_y']}")
        print(f"  constraints: {', '.join(st['constraints']) or '-'}")
        print(f"  animations: {', '.join(st['animations'])}")
        for m, info in (st.get("meshes") or {}).items():
            print(f"  mesh {m}: {info['vertices']} verts, {info['triangles']} tris, hull {info['hull']}, "
                  f"{'weighted' if info['weighted'] else 'unweighted'}")
        for w in rb.report.warnings:
            print(f"  warning: {w}")
        print(f"  next: node tools/spine/validate.mjs {out} --kind {rb.kind}")
    if a.provenance or a.manifest:
        inputs = [p for p in dict.fromkeys(rb.report.inputs)]
        row = prov.make_row(asset_id=f"{rb.skel_name}.skeleton-json", path=out, stage="spine-authoring",
                            model="tools/spine/gen.py", version=GEN_VERSION, inputs=inputs, license_id=a.license_id,
                            shipped=a.shipped, notes=f"spine {doc['skeleton']['spine']}; inputs: "
                            + ", ".join(prov.rel(p) for p in inputs[:2]) + f" (+{max(0, len(inputs) - 2)} images)")
        for f in (a.provenance, a.manifest):
            if f:
                n = prov.append_rows(f, [row], "tools/spine/gen.py")
                if not a.quiet:
                    print(f"  provenance: {'added' if n else 'unchanged'} {row['id']} -> {f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
