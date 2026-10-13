#!/usr/bin/env python3
"""Background layers -> shipped plates for LayeredEnvironment (docs/new-slot/HIGGSFIELD_PLAYBOOK.md §3.3).

One spec per look and orientation (docs/games/<game>/bg/<look>_<orient>.layers.json):

  {"game": "my-game", "look": "base", "orient": "landscape", "maxSize": 2560,
   "layers": [
     {"id": "sky",    "src": "art/source/bg/my-game/base_sky_landscape.png",  "depth": 0,   "role": "plate", "blur": 10, "parentId": "bg_base.raw.v01"},
     {"id": "lights", "src": "art/source/bg/my-game/base_light_landscape.png", "depth": 0.35, "role": "light", "blur": 2},
     {"id": "near",   "src": "art/source/bg/my-game/base_near_landscape.png", "depth": 0.6, "role": "plate"}
   ]}

For each layer: optional Gaussian blur (`blur` px at the output size; done in PREMULTIPLIED alpha so
transparent edges never pick up a dark halo; this is the offline soft-focus, never a runtime filter),
downscale (Lanczos) so the long side is <= maxSize, then WebP: lossy q88 with alpha only when the layer
has transparency (opaque back plates drop alpha), lossless never. Output:
public/assets/<game>/bg/<look>_<id>_<orient>.webp, a QA report, provenance rows (stage `backgrounds`,
licence inherited from `parentId`, so Higgsfield-derived plates stay unshippable until cleared), and the
`src` lines to paste into src/games/<game>/environment.ts.

  tools/.venv/bin/python tools/bg/layers.py --spec docs/games/<game>/bg/base_landscape.layers.json \\
      [--out public/assets/<game>/bg] [--manifest art/manifest.json] [--shipped] [--license-id ID] [--dry-run]

Exit: 0 ok · 1 a layer failed a gate (missing file, too small, wrong role) · 2 usage.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "gen"))
import provenance as prov  # noqa: E402

ROLES = {"plate", "light"}
ORIENTS = {"landscape", "portrait"}
# the smallest long side worth shipping for a cover-fitted plate (1080p screens at DPR 1)
MIN_LONG_SIDE = 1600


def premultiplied_blur(img: Image.Image, radius: float) -> Image.Image:
    """Gaussian blur in premultiplied alpha (rgb*a and a blurred together, then un-premultiplied), so
    transparent edges never bleed dark fringes into the layer."""
    if radius <= 0:
        return img
    if img.split()[3].getextrema() == (255, 255):
        return img.filter(ImageFilter.GaussianBlur(radius))
    arr = np.asarray(img, dtype=np.float32) / 255.0
    pm = np.dstack([arr[..., :3] * arr[..., 3:4], arr[..., 3:4]])
    blurred = Image.fromarray((pm * 255.0 + 0.5).clip(0, 255).astype("uint8"), "RGBA").filter(ImageFilter.GaussianBlur(radius))
    out = np.asarray(blurred, dtype=np.float32) / 255.0
    alpha = out[..., 3:4]
    rgb = np.where(alpha > 1e-4, out[..., :3] / np.maximum(alpha, 1e-4), 0.0)
    return Image.fromarray((np.dstack([rgb, alpha]) * 255.0 + 0.5).clip(0, 255).astype("uint8"), "RGBA")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--spec", required=True)
    ap.add_argument("--out", help="default public/assets/<game>/bg")
    ap.add_argument("--manifest", default="none", help="art/manifest.json to append rows (default: sidecar only)")
    ap.add_argument("--license-id", help="override the licence inherited from parentId (e.g. for code-made test plates)")
    ap.add_argument("--shipped", action="store_true")
    ap.add_argument("--quality", type=int, default=88)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)

    spec = json.loads(Path(a.spec).read_text(encoding="utf-8"))
    game, look, orient = spec.get("game"), spec.get("look"), spec.get("orient")
    if not game or not look or orient not in ORIENTS or not spec.get("layers"):
        print("error: spec needs game, look, orient (landscape|portrait) and layers[]", file=sys.stderr)
        return 2
    max_size = int(spec.get("maxSize", 2560))
    out_dir = Path(a.out or prov.REPO / "public/assets" / game / "bg")
    report = {"spec": prov.rel(a.spec), "game": game, "look": look, "orient": orient, "layers": [], "passed": True}
    rows, snippet = [], []

    for layer in spec["layers"]:
        lid, src, role = layer.get("id"), layer.get("src"), layer.get("role", "plate")
        entry = {"id": lid, "src": src, "role": role, "problems": []}
        report["layers"].append(entry)
        if role not in ROLES:
            entry["problems"].append(f"role {role!r} not in {sorted(ROLES)}")
        src_path = prov.REPO / src if src and not Path(src).is_absolute() else Path(src or "")
        if not src or not src_path.is_file():
            entry["problems"].append(f"source {src!r} not found")
        if entry["problems"]:
            report["passed"] = False
            continue
        img = Image.open(src_path).convert("RGBA")
        scale = min(1.0, max_size / max(img.size))
        if scale < 1.0:
            img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
        if max(img.size) < MIN_LONG_SIDE:
            entry["problems"].append(f"long side {max(img.size)} px < {MIN_LONG_SIDE} (regenerate at 4k or upscale the master)")
            report["passed"] = False
        img = premultiplied_blur(img, float(layer.get("blur", 0)))
        opaque = img.split()[3].getextrema() == (255, 255)
        if role == "plate" and layer.get("depth", 0) == 0 and not opaque:
            entry["problems"].append("the back plate (depth 0) has transparency: fill it or parallax will show holes")
            report["passed"] = False
        name = f"{look}_{lid}_{orient}.webp"
        dst = out_dir / name
        entry.update({"out": prov.rel(dst), "size": list(img.size), "alpha": not opaque, "blur": layer.get("blur", 0)})
        if not a.dry_run:
            out_dir.mkdir(parents=True, exist_ok=True)
            (img.convert("RGB") if opaque else img).save(dst, "WEBP", quality=a.quality, method=6)
            entry["bytes"] = dst.stat().st_size
            parents = [layer["parentId"]] if layer.get("parentId") else []
            lic = a.license_id or prov.inherit_license(parents, manifest=prov.lookup_manifest(a.manifest), default=None)
            if not lic:
                entry["problems"].append("no licence: give the layer a parentId (its source row) or pass --license-id")
                report["passed"] = False
                continue
            digest = prov.sha256_file(dst)
            rows.append(prov.make_row(
                id=prov.safe_id(f"{game}.bg.{look}.{lid}.{orient}", "webp", digest[:8]), path=dst, stage="backgrounds",
                sha256=digest, vendor="self", model="tools/bg/layers.py", version="1", license_id=lic,
                ref_hashes=[prov.sha256_file(src_path)], parents=parents, shipped=a.shipped,
                notes=f"depth {layer.get('depth', 0)}, role {role}, blur {layer.get('blur', 0)} px, {img.width}x{img.height}"))
        snippet.append(f"// {lid}: src: {{ {orient}: './assets/{game}/bg/{name}' }},")

    qa_dir = prov.REPO / "build/qa/bg" / f"{game}_{look}_{orient}"
    if not a.dry_run:
        qa_dir.mkdir(parents=True, exist_ok=True)
        (qa_dir / "qa.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        if rows:
            prov.record(rows, sidecar=qa_dir / "manifest.json", manifest=a.manifest, generated_by="tools/bg/layers.py")
    for e in report["layers"]:
        state = "ok " if not e["problems"] else "FAIL"
        print(f"{state} {e['id']}: {e.get('out', '-')} {e.get('size', '')} {'; '.join(e['problems'])}")
    print("\nenvironment.ts (merge per layer id):\n" + "\n".join(snippet))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
