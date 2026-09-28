#!/usr/bin/env python3
"""keyUniform table for every approved (and notApproved) Higgsfield job: measures the key on the downloaded raw with
tools/matte's own gate (mattelib.measure_key) and compares it with the row's requested KEY_HEX from the plan.

    tools/.venv/bin/python tools/artqa/key_table.py [--json build/qa/artqa/key_table.json]
Backgrounds (painted plates, no key) are skipped.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "tools/matte"))
import mattelib as ml  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default=str(REPO / "build/qa/artqa/key_table.json"))
    a = ap.parse_args()
    appr = json.loads((REPO / "art/plan/approvals.json").read_text())
    plan = {r["id"]: r for r in json.loads((REPO / "art/plan/bass-drop.json").read_text())["assets"]}
    rows = json.loads((REPO / "art/manifest.json").read_text())["rows"]
    by_job = {}
    for r in rows:
        if r.get("route") == "higgsfield-mcp" and r.get("jobId"):
            by_job[r["jobId"]] = r
    jobs = [(k, v["job_id"], "approved") for k, v in appr["approvals"].items()]
    for k, v in appr.get("notApproved", {}).items():
        jobs += [(k, j, "notApproved") for j in v["jobs"]]
    out = []
    for row_id, job, status in jobs:
        r = by_job.get(job)
        pr = plan.get(row_id, {})
        if r is None:
            out.append({"row": row_id, "job": job, "status": status, "error": "no manifest raw row"})
            continue
        if "bg" in row_id or pr.get("phase") == "backgrounds":
            continue
        raw = REPO / r["path"]
        if not raw.exists():
            out.append({"row": row_id, "job": job, "status": status, "error": f"raw missing: {r['path']}"})
            continue
        rgb = np.asarray(Image.open(raw).convert("RGB"), np.float32) / 255.0
        req = pr.get("keyHex")
        rep = ml.measure_key(rgb, ml.parse_hex(req) if req else None)
        out.append({"row": row_id, "job": job[:8], "status": status, "requested": req, "measured": rep["key"],
                    "borderP95": rep["borderP95"], "patchSpread": rep["patchSpread"], "uniform": rep["uniform"],
                    "keyable": rep["keyable"], "drift": rep.get("drift"), "passed": rep["passed"],
                    "size": list(Image.open(raw).size)})
    Path(a.json).parent.mkdir(parents=True, exist_ok=True)
    Path(a.json).write_text(json.dumps(out, indent=1) + "\n")
    for o in out:
        if "error" in o:
            print(f"{o['row']:24s} {o['job'][:8]} {o['status']:11s} ERROR {o['error']}")
        else:
            print(f"{o['row']:24s} {o['job']} {o['status']:11s} req {o['requested'] or '-':8s} meas {o['measured']} "
                  f"p95 {o['borderP95']:5.1f} spread {o['patchSpread']:5.1f} drift {o['drift']} {'PASS' if o['passed'] else 'FAIL'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
