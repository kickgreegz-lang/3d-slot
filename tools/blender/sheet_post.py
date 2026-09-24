#!/usr/bin/env python3
"""Pure-Python post step for turntable.py: Lanczos-down raw renders, labelled contact sheet,
metrics JSON. Runs in-process when Pillow is importable, else turntable.py calls

    python tools/blender/sheet_post.py --job <out>/.<tag>.job.json

(Blender's bundled Python has numpy but no Pillow; set SLOT_PYTHON to a Python with the
tools/blender/requirements.txt packages).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from slotbl import cli  # noqa: E402


def process(job: dict) -> int:
    from PIL import Image
    from slotbl import imgtools as it
    imgs = []
    for raw, dst in zip(job["raw"], job["files"]):
        with Image.open(raw) as im:
            small = it.downscale_premult(im, job["size"])
        it.save_png(small, dst)
        imgs.append(small)
        Path(raw).unlink(missing_ok=True)
    sheet = it.contact_sheet(imgs, job["labels"], cols=min(8, len(imgs)), cell=min(job["size"], 320),
                             bg=job.get("bg", "#0C3149"), title=job.get("title"))
    sheet.save(job["sheet"], format="PNG", compress_level=6)
    Path(job["metrics_path"]).write_text(json.dumps(job["metrics"], indent=2) + "\n")
    print(f"[sheet_post] {len(imgs)} images + sheet {cli.rel(job['sheet'])}", flush=True)
    return 0


def main(argv):
    ap = argparse.ArgumentParser(prog="sheet_post.py", description=__doc__.split("\n\n")[0])
    ap.add_argument("--job", required=True, help="job JSON written by turntable.py")
    args = ap.parse_args(argv)
    job_path = Path(args.job)
    rc = process(json.loads(job_path.read_text()))
    job_path.unlink(missing_ok=True)
    return rc


if __name__ == "__main__":
    cli.run(main)
