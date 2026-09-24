#!/usr/bin/env python3
"""Matte a cel-shaded, black-outlined image on a flat key colour and fit it onto the symbol canvas.

  python tools/matte/outline_matte.py art/_raw/sym_H1/v03/raw.png build/pack/symbols{tps}/sym_H1.png --symbol H1
  python tools/matte/outline_matte.py raw.png out.png --kind special --key FF00FF --emit-master master_2048.png

Steps (tools/matte/README.md has the rationale):
  1. key colour: --key (the SAME hex that went into the prompt) or auto = border median;
  2. background = regions the (sealed) outline separates from the border + enclosed key holes;
     the seal radius closing outline gaps is chosen automatically (--seal N to force);
  3. soft edge: alpha unmixed along the ink->key line, edge colour = ink (zero spill),
     despill within a few px of the edge, 1 px alpha erosion, colour bleed under alpha 0;
  4. fit: content max side (or --fit height) scaled to cellScale x 300 px (src/config/game.ts)
     and centred on the 360x360 @2x canvas; premultiplied Lanczos, never upscaled; straight alpha out;
  5. QA gates: halo (zero key-tinted edge pixels on black and white) and canvas/pivot. Any failure
     exits 1 (use --no-strict to keep the output anyway).
--alpha-from PATH takes the alpha of an external matte instead (ToonOut / BiRefNet via
`rembg i -m birefnet-general -dc`; NEVER rembg's default model) and runs steps 3-5 on it.

Outputs: OUT (RGBA PNG), --emit-master (full-resolution straight-alpha matte), and
QA_DIR/{qa.json, manifest.json (provenance sidecar), qa_on_black.png, qa_on_white.png};
--manifest art/manifest.json also appends the row. Exit codes: 0 ok, 1 QA failed, 2 usage/input.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "gen"))
import mattelib as ml  # noqa: E402
import provenance as prov  # noqa: E402

TOOL = "tools/matte/outline_matte.py"


def tool_version() -> str:
    files = sorted(HERE.glob("*.py"))
    return prov.digest_files(files, HERE)[:12]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src", help="RGB image on a flat key colour (PNG/JPEG/WebP)")
    ap.add_argument("dst", help="output RGBA PNG (canvas-fitted unless --no-fit)")
    ap.add_argument("--key", default="auto", help="RRGGBB, or 'auto' (border median). Use the prompt's KEY_HEX")
    size = ap.add_mutually_exclusive_group()
    size.add_argument("--symbol", help="symbol id: content = cellScale x 300 px from src/config/game.ts")
    size.add_argument("--kind", choices=["royal", "high", "special", "wild", "scatter"], help="bible cellFill midpoint")
    size.add_argument("--content-px", type=int, help="explicit content size on the canvas")
    ap.add_argument("--fit", choices=["max", "height"], default="max",
                    help="which content dimension hits the target (runtime SymbolRig fits max(w,h); default max)")
    ap.add_argument("--canvas", type=int, default=ml.CANVAS)
    ap.add_argument("--no-fit", action="store_true", help="write the full-resolution matte to DST instead")
    ap.add_argument("--emit-master", help="also write the full-resolution straight-alpha matte here")
    ap.add_argument("--alpha-from", help="use this image's alpha (external matting model) instead of the key matte")
    ap.add_argument("--dark", type=int, default=70, help="ink threshold on max(R,G,B) (0-255), default 70")
    ap.add_argument("--hole-dist", type=int, default=90, help="RGB distance to the key that marks a hole (0-441)")
    ap.add_argument("--seal", default="auto", help="outline-gap closing radius in px, or 'auto' (0..--max-seal)")
    ap.add_argument("--max-seal", type=int, default=4)
    ap.add_argument("--band", type=int, default=2, help="soft-edge band (px each side)")
    ap.add_argument("--erode", type=int, default=1, help="alpha erosion in px at input resolution (default 1)")
    ap.add_argument("--allow-upscale", action="store_true", help="drafts only: the bible forbids upscaling masters")
    ap.add_argument("--no-strict", action="store_true", help="exit 0 even when a QA gate fails")
    ap.add_argument("--qa-dir", help="default build/qa/matte/<dst stem>/")
    ap.add_argument("--manifest", default="none", help="also append the row here (e.g. art/manifest.json)")
    ap.add_argument("--asset-id", help="row id prefix (default: dst stem)")
    ap.add_argument("--parent-id", action="append", default=[], help="manifest row id(s) of the input")
    ap.add_argument("--license-id", help="default: the parent row's licenseId, else python-geometry")
    ap.add_argument("--stage", default="matting")
    a = ap.parse_args(argv)

    try:
        src = Path(a.src)
        rgb = ml.load_rgb(src)
        key = ml.auto_key(rgb) if a.key == "auto" else ml.parse_hex(a.key)
        if a.alpha_from:
            res = ml.matte_from_alpha(rgb, ml.load_alpha(a.alpha_from), key, erode=a.erode)
        else:
            p = ml.MatteParams(key=key, dark=a.dark / 255, hole_dist=a.hole_dist / 255,
                               seal=None if a.seal == "auto" else int(a.seal), max_seal=a.max_seal, band=a.band,
                               erode=a.erode)
            res = ml.matte(rgb, p)
        dst = Path(a.dst)
        qa_dir = Path(a.qa_dir) if a.qa_dir else prov.REPO / "build" / "qa" / "matte" / dst.stem
        qa = {"tool": TOOL, "version": tool_version(), "src": prov.rel(src), "matte": res.info}
        if a.emit_master:
            ml.save_rgba(a.emit_master, res.rgb, res.alpha)
        if a.no_fit:
            out_rgb, out_a = res.rgb, res.alpha
            qa["canvas"] = {"size": list(out_a.shape[::-1]), "canvasOk": True, "fit": None}
        else:
            if a.symbol:
                content = ml.content_px_for(symbol=a.symbol)
            elif a.kind:
                content = ml.content_px_for(kind=a.kind)
            elif a.content_px:
                content = a.content_px
            else:
                raise ValueError("pass --symbol, --kind or --content-px (or --no-fit)")
            out_rgb, out_a, tf = ml.fit_canvas(res.rgb, res.alpha, content, a.canvas, a.fit, a.allow_upscale, key=res.key)
            qa["transform"] = tf
            qa["canvas"] = ml.canvas_report(out_a, content, a.canvas, a.fit)
            if tf["limitedBy"]:
                qa["canvas"]["canvasOk"] = False
                qa["canvas"]["note"] = "content would overflow the canvas: fitted smaller than the target"
        ml.save_rgba(dst, out_rgb, out_a)
        halo = ml.halo_report(out_rgb, out_a, res.key)
        qa["halo"] = halo
        passed = halo["keyTintedEdgePx"] == 0 and qa["canvas"]["canvasOk"]
        qa["passed"] = passed
        qa_dir.mkdir(parents=True, exist_ok=True)
        for name, bgc in (("qa_on_black.png", 0.0), ("qa_on_white.png", 1.0)):
            comp = out_rgb * out_a[..., None] + bgc * (1 - out_a[..., None])
            ml.save_rgba(qa_dir / name, comp, np.ones_like(out_a))
        (qa_dir / "qa.json").write_text(json.dumps(qa, indent=2) + "\n", encoding="utf-8")

        digest = prov.sha256_file(dst)
        lic = a.license_id or prov.inherit_license(a.parent_id, manifest=prov.lookup_manifest(a.manifest), default="python-geometry")
        row = prov.make_row(
            id=prov.safe_id(a.asset_id or dst.stem, "matte", digest[:8]), path=dst, stage=a.stage, sha256=digest,
            vendor="self", model=TOOL, version=tool_version(), license_id=lic, route="code",
            ref_hashes=[prov.sha256_file(src)] + ([prov.sha256_file(a.alpha_from)] if a.alpha_from else []),
            parents=a.parent_id, qa={"passed": passed, "report": prov.rel(qa_dir / "qa.json")},
            notes=f"key {res.info['key']}, seal {res.seal}, content {qa['canvas'].get('contentPx')} px")
        prov.record([row], sidecar=qa_dir / "manifest.json", manifest=a.manifest, generated_by=TOOL)
    except (ValueError, FileNotFoundError, OSError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    print(json.dumps({"out": prov.rel(dst), "passed": passed, "key": res.info["key"], "seal": res.seal,
                      "canvas": qa["canvas"], "halo": halo, "qa": prov.rel(qa_dir / "qa.json")}, indent=2))
    if not passed and not a.no_strict:
        print("error: QA gate failed (see qa.json)", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
