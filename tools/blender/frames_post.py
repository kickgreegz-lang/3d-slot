#!/usr/bin/env python3
"""Post-process a render_symbol.py raw render: Lanczos-down to final size, QA gates,
contact sheet, anim.json and the manifest row. Pure Python (numpy + Pillow), no bpy, so it
also runs outside the Blender binary:

    python tools/blender/frames_post.py --meta art/_work/blender/raw/L2_turn/meta.json

Gates (docs/PIPELINE.md §5.1, ART_BIBLE §10 "Baked 3D insert"):
    frameCount      frames written == F
    alphaBounds     no opaque pixel within 1 px of the canvas edge (no clipping), non-empty frames
    loopSeamExact   loops: frame F+1 (rendered, not shipped) == frame 1   (MAD <= 0.5/255)
    loopSeamRatio   loops: MAD(F->1) / median MAD(f->f+1) in [0.25, 2.0]
    frame1VsRest    shatter: frame 1 == intact rest render                (MAD <= 1.5/255)
    frame1VsStatic  with --static: frame 1 == static sprite               (MAD <= 3/255)
    outlineWidth    median hull width >= outline_min_px (default 3 px) at final size
    hullBleed       no counter/hole closed up by the hull
    pivotDrift      turn/spin: union bbox centred on the pivot column; land: bottom row fixed
    endsEmpty       shatter: last frame (almost) fully transparent
Exit codes: 0 pass, 3 gate failure (outputs are still written), 1 error.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from slotbl import cli  # noqa: E402

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from slotbl import imgtools as it  # noqa: E402
from slotbl import provenance as prov  # noqa: E402

LIMITS = {
    "seam_exact": 0.5,
    "seam_ratio": (0.25, 2.0),
    "frame1_vs_rest": 1.5,
    "frame1_vs_static": 3.0,
    "pivot_px": 1.5,
    "end_coverage": 0.002,
}


def process(meta: dict) -> int:
    log = cli.Log("frames_post")
    prefix = meta["prefix"]
    F = int(meta["frames"])
    S = int(meta["size_final"])
    raw = Path(meta["raw_dir"])
    out = Path(meta["out_dir"])
    qa_dir = Path(meta["qa_dir"])
    out.mkdir(parents=True, exist_ok=True)
    qa_dir.mkdir(parents=True, exist_ok=True)
    for stale in out.glob(f"{prefix}_*.png"):
        stale.unlink()
    for stale in out.iterdir():
        if stale.is_file():
            log.warn(f"unexpected file in the frame folder (AssetPack packs it): {stale.name}")

    frames, files = [], []
    for f in range(1, F + 1):
        src = raw / meta["raw_pattern"].format(f)
        if not src.exists():
            raise cli.ToolError(f"missing raw frame {src}")
        with Image.open(src) as im:
            small = it.downscale_premult(im, S)
        path = it.save_png(small, out / f"{prefix}_{f:04d}.png")
        files.append(path)
        frames.append(np.asarray(small))
    extras = {}
    for k, p in meta.get("extras", {}).items():
        with Image.open(p) as im:
            small = it.downscale_premult(im, S)
        it.save_png(small, qa_dir / f"qa_{k}.png")
        extras[k] = np.asarray(small)

    gates: dict[str, dict] = {}

    def gate(name, ok, value, limit):
        gates[name] = {"pass": bool(ok), "value": value, "limit": limit}

    gate("frameCount", len(files) == F, len(files), F)
    masks = [it.mask(a, 0.02) for a in frames]
    union = np.logical_or.reduce(masks)
    bb = it.bbox(union)
    empty = [i + 1 for i, m in enumerate(masks) if not m.any()]
    allowed_empty = {F} if meta["clip"] == "shatter" else set()
    gate("alphaBounds", bb is not None and not it.edge_touch(union, 1) and not (set(empty) - allowed_empty),
         {"unionBBox": bb, "emptyFrames": empty}, "inside canvas with >= 1 px margin")

    metrics: dict = {"unionBBox": bb, "coverage": [round(it.coverage(a), 4) for a in frames]}
    if meta.get("loop") and "next" in extras:
        seam_exact = it.mad(extras["next"], frames[0])
        consec = [it.mad(frames[i], frames[i + 1]) for i in range(F - 1)]
        seam = it.mad(frames[-1], frames[0])
        med = float(np.median(consec)) if consec else 0.0
        ratio = seam / med if med > 1e-6 else 0.0
        gate("loopSeamExact", seam_exact <= LIMITS["seam_exact"], round(seam_exact, 4), LIMITS["seam_exact"])
        lo, hi = LIMITS["seam_ratio"]
        gate("loopSeamRatio", lo <= ratio <= hi, round(ratio, 3), [lo, hi])
        metrics.update({"seamMAD": round(seam, 3), "medianStepMAD": round(med, 3)})
    if "rest" in extras:
        d = it.mad(frames[0], extras["rest"])
        gate("frame1VsRest", d <= LIMITS["frame1_vs_rest"], round(d, 4), LIMITS["frame1_vs_rest"])
    if meta.get("static_ref"):
        with Image.open(meta["static_ref"]) as im:
            st = it.downscale_premult(im, int(meta["size"]))
        if st.width != S:
            canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
            canvas.alpha_composite(st, ((S - st.width) // 2, (S - st.height) // 2))
            st = canvas
        d = it.mad(frames[0], np.asarray(st))
        gate("frame1VsStatic", d <= LIMITS["frame1_vs_static"], round(d, 4), LIMITS["frame1_vs_static"])
    if "nohull" in extras:
        ref = frames[0]
        hw = it.hull_width(ref, extras["nohull"])
        lim = float(meta.get("gates", {}).get("outline_min_px", 3.0))
        gate("outlineWidth", hw["median"] >= lim, hw, f">= {lim} px (median)")
        hb = it.hull_bleed(ref, extras["nohull"], min_area=max(6, (S // 64) ** 2))
        gate("hullBleed", hb["closed"] == 0, hb, "no counter closed by the hull")
    px, py = meta["pivot_px"]
    if meta["clip"] in ("turn", "spin") and bb:
        cx = (bb[0] + bb[2]) / 2
        tol = max(LIMITS["pivot_px"], 0.006 * S)
        gate("pivotDrift", abs(cx - px) <= tol, round(abs(cx - px), 3), tol)
    elif meta["clip"] == "land":
        bottoms = [it.bbox(m)[3] for m in masks if m.any()]
        drift = max(bottoms) - min(bottoms) if bottoms else 0
        gate("pivotDrift", drift <= 2, drift, 2)
    if meta["clip"] == "shatter":
        cov = it.coverage(frames[-1])
        gate("endsEmpty", cov <= LIMITS["end_coverage"], round(cov, 5), LIMITS["end_coverage"])

    passed = all(g["pass"] for g in gates.values())
    failed = [k for k, g in gates.items() if not g["pass"]]

    # ---- contact sheet: all frames, then the QA extras
    sheet_imgs = [Image.fromarray(a) for a in frames]
    labels = [str(i + 1) for i in range(F)]
    for k in ("next", "rest", "nohull"):
        if k in extras:
            sheet_imgs.append(Image.fromarray(extras[k]))
            labels.append({"next": f"{F + 1} (seam QA)", "rest": "rest (intact)", "nohull": "no hull"}[k])
    title = (f"{prefix}  {meta['engine']}/{meta['shading']}  {S}px  {F}f@{meta['fps']}fps  "
             f"{'PASS' if passed else 'FAIL: ' + ','.join(failed)}")
    sheet = it.contact_sheet(sheet_imgs, labels, cols=min(8, len(sheet_imgs)), cell=min(S, 256), title=title)
    sheet_path = qa_dir / "sheet.png"
    sheet.save(sheet_path, format="PNG", compress_level=6)

    anim = {
        "id": meta["sym"], "clip": meta["clip"], "prefix": prefix, "fps": meta["fps"], "frames": F,
        "loop": bool(meta.get("loop")), "size": S, "canvasScale": meta.get("canvas_scale", 1.0),
        "anchor": [0.5, 0.5], "pivot": [round(px / S, 5), round(py / S, 5)],
        "frameNames": [p.name for p in files],
        "note": "Frame 1 == rest pose on the static-sprite framing; display at canvasScale x the static "
                "canvas so content scale matches. pivot = object origin (bottom-centre) in normalised px.",
    }
    (qa_dir / "anim.json").write_text(json.dumps(anim, indent=2) + "\n")

    digest = prov.digest_files(files, out)
    inputs = ", ".join(r["path"] for r in meta.get("inputs", [])) or "procedural geometry"
    notes = (f"{F} frames {S}px {meta['clip']} ({meta['engine']}/{meta['shading']}, {meta['samples']} spp); "
             f"inputs: {inputs}; sha256 = digest of '<file>:<sha256>' lines of the frame folder")
    qa_report = {
        "tool": meta.get("tool"), "prefix": prefix, "passed": passed, "failed": failed, "gates": gates,
        "metrics": metrics, "frames": F, "size": S, "engine": meta["engine"], "shading": meta["shading"],
        "outlinePxTarget": meta["outline_px"], "fill": meta["fill"], "camera": {"azim": meta["azim"], "elev": meta["elev"]},
        "renderSeconds": meta.get("render_seconds"), "digest": digest,
    }
    (qa_dir / "qa.json").write_text(json.dumps(qa_report, indent=2) + "\n")

    row = prov.make_row(
        id=prov.row_id("frames", prefix, digest), path=cli.rel(out) + "/", stage="3d-render",
        sha256=digest, model=f"blender-{meta['blender'].split()[0]}",
        version=f"bpy {meta['blender']}; tools/blender@{meta['toolkit']}",
        seed=meta.get("seed"), ref_hashes=[r["sha256"] for r in meta.get("inputs", [])],
        parents=meta.get("parents", []),
        notes=notes,
        qa={"passed": passed, "report": cli.rel(qa_dir / "qa.json"), "failed": failed},
    )
    prov.write_sidecar(qa_dir / "manifest.json", [row], "tools/blender/frames_post.py")
    if meta.get("manifest"):
        n = prov.append_to_manifest(meta["manifest"], [row], "tools/blender/frames_post.py")
        log(f"appended {n} row(s) to {meta['manifest']}")
    if not meta.get("keep_raw"):
        shutil.rmtree(meta["raw_dir"], ignore_errors=True)

    for k, g in gates.items():
        v = g["value"]
        if isinstance(v, dict):
            v = {kk: vv for kk, vv in v.items() if kk != "detail"}
        log(f"  {'PASS' if g['pass'] else 'FAIL'} {k}: {v} (limit {g['limit']})")
    log(f"{len(files)} frames -> {cli.rel(out)}/ ; sheet {cli.rel(sheet_path)} ; row {row['id']}")
    if not passed:
        log.error(f"gates failed: {', '.join(failed)}")
        return 0 if meta.get("no_gates") else 3
    return 0


def main(argv):
    ap = argparse.ArgumentParser(prog="frames_post.py", description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--meta", required=True, help="meta.json written by render_symbol.py")
    ap.add_argument("--no-gates", action="store_true", help="exit 0 even if gates fail")
    args = ap.parse_args(argv)
    meta = json.loads(Path(args.meta).read_text())
    if args.no_gates:
        meta["no_gates"] = True
    return process(meta)


if __name__ == "__main__":
    cli.run(main)
