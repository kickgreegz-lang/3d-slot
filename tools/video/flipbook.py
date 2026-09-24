#!/usr/bin/env python3
"""RGBA frame sequence -> trimmed, uniform frames for ONE AssetPack {tps} folder (one clip).

  python tools/video/flipbook.py build/frames/W_turn build/pack/W_turn{tps} --name W_turn --pivot bottom-center
  python tools/video/flipbook.py art/_work/fx/poof_seed1 build/pack/fx_poof{tps} --name fx_poof --size 256 --every 2

* Every frame gets the SAME crop: the union of all frames' alpha bounds, grown symmetrically
  around the pivot, so a single anchor stays valid for the whole clip (center -> anchor 0.5,0.5;
  bottom-center -> anchor 0.5,1, the docs/ANIMATION_CONTRACT.md 8.1 baked-insert pivot).
* Frame edges are rounded up to a multiple of 8 (default), so the @0.5x AssetPack variant is
  exact and atlas pages stay multiples of 4.
* --size scales the cropped clip (max side, premultiplied Lanczos, never upscales);
  --every K keeps every K-th frame (animating "on twos").
* Output frames are <name>_0001.png ... - AssetPack detects the animation <name> from them.
  Metadata (frame count, size, pivot, anchor) goes to the QA folder, never into the {tps} folder.
Exit codes: 0 ok, 1 QA failed (--expect-frames mismatch), 2 usage.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "gen"))
import provenance as prov  # noqa: E402

TOOL = "tools/video/flipbook.py"


def frame_files(src: Path) -> list[Path]:
    files = sorted(src.glob("*.png")) if src.is_dir() else sorted(Path().glob(str(src)))
    num = re.compile(r"(\d+)\.png$")
    files = [f for f in files if num.search(f.name)]
    return sorted(files, key=lambda f: int(num.search(f.name).group(1)))


def round_up(x: float, m: int) -> int:
    return int(math.ceil(x / m) * m)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src", help="folder of RGBA PNG frames (numbered), or a glob")
    ap.add_argument("out_dir", help="the clip's AssetPack folder, e.g. build/pack/fx_poof{tps}")
    ap.add_argument("--name", required=True, help="animation name -> <name>_0001.png")
    ap.add_argument("--pivot", choices=["center", "bottom-center", "none"], default="center")
    ap.add_argument("--pad", type=int, default=2, help="transparent margin around the union bounds (px)")
    ap.add_argument("--multiple", type=int, default=8, help="round frame edges up to this multiple")
    ap.add_argument("--size", type=int, help="max side of the output frame content (downscale only)")
    ap.add_argument("--allow-upscale", action="store_true")
    ap.add_argument("--every", type=int, default=1, help="keep every K-th frame")
    ap.add_argument("--expect-frames", type=int, help="fail unless exactly this many frames are written")
    ap.add_argument("--qa-dir", help="default build/qa/flipbook/<name>")
    ap.add_argument("--manifest", default="none", help="also append the row (e.g. art/manifest.json)")
    ap.add_argument("--parent-id", action="append", default=[])
    ap.add_argument("--license-id", help="default: parent's licenseId, else blender-5.2")
    a = ap.parse_args(argv)
    if a.multiple < 1 or a.pad < 0 or a.every < 1 or (a.size is not None and a.size < 1):
        print("error: --multiple/--every/--size must be >= 1 and --pad >= 0", file=sys.stderr)
        return 2
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", a.name):
        print("error: --name must match [A-Za-z0-9][A-Za-z0-9_-]*", file=sys.stderr)
        return 2
    files = frame_files(Path(a.src))[:: max(1, a.every)]
    if not files:
        print(f"error: no numbered PNG frames in {a.src}", file=sys.stderr)
        return 2
    frames = [np.asarray(Image.open(f).convert("RGBA"), np.float32) / 255.0 for f in files]
    H, W = frames[0].shape[:2]
    if any(f.shape[:2] != (H, W) for f in frames):
        print("error: frames differ in size", file=sys.stderr)
        return 2
    union = np.zeros((H, W), bool)
    for f in frames:
        union |= f[..., 3] > 0
    if not union.any():
        print("error: every frame is fully transparent", file=sys.stderr)
        return 2
    ys, xs = np.nonzero(union)
    x0, x1, y0, y1 = xs.min() - a.pad, xs.max() + 1 + a.pad, ys.min() - a.pad, ys.max() + 1 + a.pad
    if a.pivot == "none":
        box = [x0, y0, x1, y1]
        pivot = [W / 2, H / 2]
    else:
        px = W / 2
        hw = max(px - x0, x1 - px)
        if a.pivot == "center":
            py = H / 2
            hh = max(py - y0, y1 - py)
            box = [px - hw, py - hh, px + hw, py + hh]
        else:
            py = float(H)
            box = [px - hw, min(y0, py - 1), px + hw, py]
        pivot = [px, py]
    bw, bh = box[2] - box[0], box[3] - box[1]
    scale = 1.0
    if a.size:
        scale = a.size / max(bw, bh)
        if scale > 1 and not a.allow_upscale:
            scale = 1.0
    ow, oh = round_up(bw * scale, a.multiple), round_up(bh * scale, a.multiple)
    # grow the crop so the rounded output keeps the pivot where the anchor says it is
    gw, gh = ow / scale - bw, oh / scale - bh
    if a.pivot == "bottom-center":
        box = [box[0] - gw / 2, box[1] - gh, box[2] + gw / 2, box[3]]
    else:
        box = [box[0] - gw / 2, box[1] - gh / 2, box[2] + gw / 2, box[3] + gh / 2]
    # integer source window (pad the source where the box leaves the frame)
    ix0, iy0 = math.floor(box[0]), math.floor(box[1])
    ix1, iy1 = math.ceil(box[2]), math.ceil(box[3])
    padl, padt = max(0, -ix0), max(0, -iy0)
    padr, padb = max(0, ix1 - W), max(0, iy1 - H)
    out_dir = Path(a.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob(f"{a.name}_[0-9][0-9][0-9][0-9].png"):
        old.unlink()
    written = []
    aligned = scale == 1.0 and all(float(v).is_integer() for v in box)
    sb = (box[0] - ix0, box[1] - iy0, box[2] - ix0, box[3] - iy0)
    for i, f in enumerate(frames, 1):
        g = np.pad(f, ((padt, padb), (padl, padr), (0, 0)))
        win = g[iy0 + padt:iy1 + padt, ix0 + padl:ix1 + padl]
        if aligned:
            crop = win[:oh, :ow]
        else:  # exact sub-pixel window -> output size, premultiplied Lanczos
            al = win[..., 3:4]
            pm = np.concatenate([win[..., :3] * al, al], -1)
            o = np.clip(np.dstack([np.asarray(Image.fromarray(pm[..., c], "F").resize(
                (ow, oh), Image.Resampling.LANCZOS, box=sb), np.float32) for c in range(4)]), 0, 1)
            al = o[..., 3:4]
            rgb = np.where(al > 1e-4, np.clip(np.minimum(o[..., :3], al) / np.maximum(al, 1e-4), 0, 1), 0)
            crop = np.concatenate([rgb, np.where(al < 1 / 512, 0, al)], -1)
        p = out_dir / f"{a.name}_{i:04d}.png"
        Image.fromarray(np.clip(np.round(crop * 255), 0, 255).astype(np.uint8), "RGBA").save(p, optimize=False)
        written.append(p)
    anchor = [round((pivot[0] - box[0]) / (box[2] - box[0]), 4), round((pivot[1] - box[1]) / (box[3] - box[1]), 4)]
    first = np.asarray(Image.open(written[0]), np.float32)
    last = np.asarray(Image.open(written[-1]), np.float32)
    meta = {"tool": TOOL, "name": a.name, "src": prov.rel(a.src), "frames": len(written), "size": [ow, oh],
            "pivot": a.pivot, "anchor": anchor, "scale": round(scale, 5), "every": a.every,
            "sourceBox": [round(v, 3) for v in box], "seamMAD": round(float(np.abs(first - last).mean()), 3),
            "multipleOk": ow % a.multiple == 0 and oh % a.multiple == 0}
    meta["passed"] = meta["multipleOk"] and (a.expect_frames is None or a.expect_frames == len(written))
    qa_dir = Path(a.qa_dir) if a.qa_dir else prov.REPO / "build" / "qa" / "flipbook" / a.name
    qa_dir.mkdir(parents=True, exist_ok=True)
    (qa_dir / "flipbook.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    digest = prov.digest_files(written, out_dir)
    version = prov.digest_files(sorted(p for p in HERE.glob("*") if p.is_file()), HERE)[:12]
    row = prov.make_row(
        id=prov.safe_id(a.name, "flipbook", digest[:8]), path=out_dir, stage="vfx-bake", sha256=digest, vendor="self",
        model=TOOL, version=version, license_id=a.license_id or prov.inherit_license(a.parent_id, manifest=prov.lookup_manifest(a.manifest), default="blender-5.2"),
        route="code", ref_hashes=[prov.sha256_file(f) for f in files], parents=a.parent_id,
        qa={"passed": meta["passed"], "report": prov.rel(qa_dir / "flipbook.json")},
        notes=f"{len(written)} frames {ow}x{oh}, pivot {a.pivot}, anchor {anchor}")
    prov.record([row], sidecar=qa_dir / "manifest.json", manifest=a.manifest, generated_by=TOOL)
    print(json.dumps(meta))
    if not meta["passed"]:
        print("error: flipbook QA failed", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
