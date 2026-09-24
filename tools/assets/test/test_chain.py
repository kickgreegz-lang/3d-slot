#!/usr/bin/env python3
"""Integration: raw art -> matte -> variants -> keyed clip -> flipbook -> AssetPack -> licence audit.

Proves the provenance chain end to end: every shipped output row links back (parents) to the rows of
what was packed into it, the audit passes when every licence in the chain is clear, and FAILS when a
raw generation upstream still has clearance 'pending' (clearances gate shipping, not building).

  PIPELINE_PY=tools/.venv/bin/python tools/.venv/bin/python tools/assets/test/test_chain.py
Scratch: art/_work/test-chain/.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "tools" / "gen"))
import provenance as prov  # noqa: E402

W = REPO / "art" / "_work" / "test-chain"
PY = os.environ.get("PIPELINE_PY", sys.executable)
ENV = {**os.environ, "PIPELINE_PY": PY, "SOURCE_DATE_EPOCH": "1790000000"}


def run(*a):
    r = subprocess.run([str(x) for x in a], cwd=REPO, env=ENV, capture_output=True, text=True)
    assert r.returncode == 0, f"{a[:3]}: {r.stdout}\n{r.stderr}"
    return r


def build(tag: str, raw_licence: str | None):
    root = W / tag
    shutil.rmtree(root, ignore_errors=True)
    root.mkdir(parents=True)
    m = root / "manifest.json"
    run(PY, REPO / "tools/matte/make_synthetic.py", root / "src", "--key", "FF00FF", "--palette", "teal", "--size", "512")
    parent = []
    if raw_licence:  # pretend the art came from a vendor: a raw generation row
        art = root / "src" / "art.png"
        row = prov.make_row(id="sym_w.raw.v01", path=art, stage="2d-image", sha256=prov.sha256_file(art),
                            vendor="Higgsfield", model="nano_banana_2", version="test", license_id=raw_licence,
                            route="higgsfield-cli")
        prov.append_rows(m, [row], "test")
        parent = ["--parent-id", "sym_w.raw.v01"]
    run(PY, REPO / "tools/matte/outline_matte.py", root / "src/art.png", root / "pack/symbols{tps}/sym_W.png",
        "--symbol", "W", "--key", "FF00FF", "--qa-dir", root / "qa/matte", "--manifest", m, *parent)
    matte_id = json.loads(m.read_text())["rows"][-1]["id"]
    run(PY, REPO / "tools/matte/variants.py", root / "pack/symbols{tps}/sym_W.png", "--symbol", "W",
        "--parent-id", matte_id, "--qa-dir", root / "qa/var", "--manifest", m)
    run(REPO / "tools/video/make_test_clip.sh", root / "clip.mp4", "00FF00")
    run(REPO / "tools/video/key_video.sh", root / "clip.mp4", root / "frames/fx_test", "fx_test", "--size", 128,
        "--qa-dir", root / "qa/key", "--manifest", m)
    key_id = json.loads(m.read_text())["rows"][-1]["id"]
    run(PY, REPO / "tools/video/flipbook.py", root / "frames/fx_test", root / "pack/fx_test{tps}", "--name", "fx_test",
        "--parent-id", key_id, "--qa-dir", root / "qa/fb", "--manifest", m)
    run("node", REPO / "tools/assets/pack.mjs", "--entry", root / "pack", "--output", root / "out", "--cache-dir", root / ".cache",
        "--qa-dir", root / "qa/pack", "--parents-from", m, "--manifest", m, "--shipped", "--no-cache")
    audit = subprocess.run(["node", str(REPO / "tools/licence/audit.mjs"), "--manifest", str(m), "--public", str(root / "out"),
                            "--json", str(root / "audit.json")], cwd=REPO, capture_output=True, text=True)
    return m, audit, json.loads((root / "audit.json").read_text())


class ChainTests(unittest.TestCase):
    def test_clear_chain_passes(self):
        m, audit, rep = build("clear", None)
        self.assertEqual(audit.returncode, 0, audit.stdout)
        self.assertEqual(rep["info"]["coverage"]["uncovered"], 0)
        rows = json.loads(m.read_text())["rows"]
        sheet = next(r for r in rows if r["path"].endswith("/out/symbols.png"))
        self.assertEqual(len(sheet["parents"]), 3)                      # matte + blur + glow
        clip = next(r for r in rows if r["path"].endswith("/out/fx_test.png"))
        flip = next(r for r in rows if r["id"] == clip["parents"][0])
        self.assertEqual(flip["stage"], "vfx-bake")                     # flipbook folder row
        self.assertEqual(flip["parents"][0].split(".")[1], "frames")     # -> key_video frames row

    def test_pending_vendor_upstream_blocks_shipping(self):
        m, audit, rep = build("pending", "higgsfield")
        rows = {r["id"]: r for r in json.loads(m.read_text())["rows"]}
        matte = next(r for r in rows.values() if r["stage"] == "matting" and ".matte." in r["id"])
        self.assertEqual(matte["licenseId"], "higgsfield")               # derivative inherits the raw licence
        self.assertEqual(audit.returncode, 1)
        self.assertTrue(any("clearance 'pending'" in e for e in rep["errors"]), rep["errors"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
