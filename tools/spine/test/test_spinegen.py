#!/usr/bin/env python3
"""Unit tests for tools/spine (stdlib unittest; run: python tools/spine/test/test_spinegen.py)."""
from __future__ import annotations

import json
import math
import shutil
import subprocess
import sys

sys.dont_write_bytecode = True  # never leave __pycache__ in tools/
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPINE = HERE.parent
REPO = SPINE.parent.parent
DEMO = SPINE / "examples" / "demo_symbol"
sys.path.insert(0, str(SPINE))

from spinegen import easing, motion, physics  # noqa: E402
from spinegen.rig import RigBuilder, dump  # noqa: E402
from spinegen.timeline import Anim  # noqa: E402


class Physics(unittest.TestCase):
    def test_contract_table(self):
        # ANIMATION_CONTRACT 2.5 table
        for f, z, s, d in ((3.0, 0.20, 355, 0.882), (3.5, 0.25, 484, 0.833), (4.0, 0.30, 632, 0.778)):
            st, dm = physics.strength_damping(f, z)
            self.assertAlmostEqual(st, s, delta=1.0)
            self.assertAlmostEqual(dm, d, delta=0.001)

    def test_constraint_fields(self):
        c = physics.constraint({"bone": "phys_x", "preset": "stiff"}, {"f": 3.5, "zeta": 0.25, "rotate": 1, "limit": 12000,
                                                                       "inertia": 0.6, "fps": 60, "mass": 1},
                               {"stiff": {"f": 4.0, "zeta": 0.3}})
        self.assertEqual(c["type"], "physics")
        self.assertEqual(c["name"], "phys_x")
        self.assertEqual(c["limit"], 12000)
        self.assertAlmostEqual(c["strength"], 631.65, delta=0.1)
        with self.assertRaises(ValueError):
            physics.constraint({"bone": "antenna"}, {"f": 3.5, "zeta": 0.25}, {})


class Curves(unittest.TestCase):
    def test_absolute_two_channels(self):
        c = easing.absolute_curve("sine_in_out", 0.1, 0.3, [(1.0, 2.0), (0.0, -1.0)])
        self.assertEqual(len(c), 8)
        x1, y1, x2, y2 = easing.PRESETS["sine_in_out"]
        self.assertAlmostEqual(c[0], 0.1 + x1 * 0.2, places=4)
        self.assertAlmostEqual(c[1], 1.0 + y1 * 1.0, places=4)
        self.assertAlmostEqual(c[5], 0.0 + y1 * -1.0, places=4)
        self.assertIsNone(easing.absolute_curve("linear", 0, 1, [(0, 1)]))
        self.assertEqual(easing.absolute_curve("stepped", 0, 1, [(0, 1)]), "stepped")

    def test_back_out_overshoots(self):
        self.assertGreater(max(easing.bezier_eval("back_out", u / 20) for u in range(21)), 1.0)

    def test_spring_extrema_alternate(self):
        ex = easing.spring_extrema(7.5, 0.32, -0.15, 0, 3)
        self.assertLess(ex[0][1] * ex[1][1], 0)
        self.assertAlmostEqual(ex[1][0] - ex[0][0], math.pi / (2 * math.pi * 7.5 * math.sqrt(1 - 0.32 ** 2)), places=6)

    def test_track_emits_channel_count(self):
        a = Anim("t", 30, 10)
        a.bone("squash", "scale").key(0, (1, 1), "quad_out").key(10, (1.1, 0.9))
        a.slot("s", "rgba").key(0, (1, 1, 1, 1), "sine_in_out").key(10, (1, 1, 1, 0))
        j = a.to_json()
        self.assertEqual(len(j["bones"]["squash"]["scale"][0]["curve"]), 8)
        self.assertEqual(len(j["slots"]["s"]["rgba"][0]["curve"]), 16)
        with self.assertRaises(ValueError):
            a.bone("squash", "scale")  # duplicate timeline


class Generator(unittest.TestCase):
    def build(self, rig: Path, out: Path):
        return RigBuilder(rig, out_path=out).build()

    def test_demo_contract_shape(self):
        with tempfile.TemporaryDirectory() as t:
            doc = self.build(DEMO / "rig.yaml", Path(t) / "sym_demo.json")
        self.assertTrue(doc["skeleton"]["spine"].startswith("4.3"))
        self.assertEqual(doc["skeleton"]["fps"], 30)
        for k in ("ik", "transform", "path", "physics"):
            self.assertNotIn(k, doc)
        names = [b["name"] for b in doc["bones"]]
        self.assertEqual(names[:3], ["root", "squash", "body"])
        types = [c["type"] for c in doc["constraints"]]
        self.assertEqual(types, sorted(types, key=["ik", "transform", "path", "physics", "slider"].index))
        for a in ("idle", "land", "win", "win_loop", "anticipation", "explode", "appear", "blur"):
            self.assertIn(a, doc["animations"])
        land = doc["animations"]["land"]
        self.assertIn("land_impact", [e["name"] for e in land["events"]])
        sy = [k["y"] for k in land["bones"]["squash"]["scale"]]
        self.assertAlmostEqual(min(sy), 0.85, places=3)
        self.assertEqual(land["bones"]["squash"]["scale"][-1]["y"], 1.0)

    def test_override_and_determinism(self):
        with tempfile.TemporaryDirectory() as t:
            td = Path(t)
            shutil.copytree(DEMO, td / "demo", ignore=shutil.ignore_patterns("provenance.json"))
            rig = td / "demo" / "rig.yaml"
            text = rig.read_text().replace("land: {squash: 0.85, rebound: 0.06, frames: 12}",
                                           "land: {squash: 0.83, rebound: 0.05, frames: 14}")
            rig.write_text(text)
            a = dump(self.build(rig, td / "a.json"))
            b = dump(self.build(rig, td / "a.json"))
            self.assertEqual(a, b)
            doc = json.loads(a)
            land = doc["animations"]["land"]
            sy = [k["y"] for k in land["bones"]["squash"]["scale"]]
            self.assertAlmostEqual(min(sy), 0.83, places=3)
            self.assertAlmostEqual(max(sy), 1.05, places=3)
            self.assertAlmostEqual(land["bones"]["squash"]["scale"][-1]["time"], 14 / 30, places=4)

    def test_unknown_motion_param_fails(self):
        with self.assertRaises(ValueError):
            motion.merge_params({"land": {"squish": 1}})

    def test_rig_typos_fail_loudly(self):
        # a typo must never silently fall back to the contract defaults
        cases = [
            ("accents:", "accent:"),                                   # unknown top-level key
            ("amount: 0.25, at: impact+1}", "ammount: 0.25, at: impact+1}"),  # unknown accent key
            ("{name: vfx, at: peak, string: fx_sparkle}", "{name: vfx, at: peak, strng: fx_sparkle}"),
            ("  win:\n    - {name: vfx", "  lnad:\n    - {name: vfx"),              # events for an animation not generated
            ("kind: special", "kind: special\nbones: [oops"),                  # YAML syntax error -> RigError, not a traceback
            ("    spacing: 40", "    spacng: 40"),                   # unknown mesh key
        ]
        for old, new in cases:
            with self.subTest(new=new), tempfile.TemporaryDirectory() as t:
                td = Path(t)
                shutil.copytree(DEMO, td / "demo", ignore=shutil.ignore_patterns("provenance.json"))
                rig = td / "demo" / "rig.yaml"
                text = rig.read_text()
                self.assertIn(old, text)
                rig.write_text(text.replace(old, new, 1))
                with self.assertRaises(ValueError):
                    self.build(rig, td / "a.json")

    def test_gen_cli_check(self):
        py = sys.executable
        with tempfile.TemporaryDirectory() as t:
            out = Path(t) / "sym_demo.json"
            r = subprocess.run([py, str(SPINE / "gen.py"), str(DEMO / "rig.yaml"), "-o", str(out), "--quiet"], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            before = out.stat().st_mtime_ns
            r = subprocess.run([py, str(SPINE / "gen.py"), str(DEMO / "rig.yaml"), "-o", str(out), "--check", "--quiet"], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            r = subprocess.run([py, str(SPINE / "gen.py"), str(DEMO / "rig.yaml"), "-o", str(out), "--quiet"], capture_output=True, text=True)
            self.assertEqual(out.stat().st_mtime_ns, before, "idempotent run must not rewrite the file")
            out.write_text(out.read_text().replace('"fps": 30', '"fps": 24'))
            r = subprocess.run([py, str(SPINE / "gen.py"), str(DEMO / "rig.yaml"), "-o", str(out), "--check", "--quiet"], capture_output=True, text=True)
            self.assertEqual(r.returncode, 1)
            r = subprocess.run([py, str(SPINE / "gen.py"), str(Path(t) / "missing.yaml"), "-o", str(out)], capture_output=True, text=True)
            self.assertEqual(r.returncode, 1)


class Pack(unittest.TestCase):
    def test_pack_deterministic_and_no_mesh_strip(self):
        py = sys.executable
        with tempfile.TemporaryDirectory() as t:
            td = Path(t)
            skel = td / "sym_demo.json"
            skel.write_text(dump(RigBuilder(DEMO / "rig.yaml", out_path=skel).build()))
            cmd = [py, str(SPINE / "pack.py"), "--images", str(DEMO / "images"), "--skeleton", str(skel), "--out", str(td / "o"),
                   "--name", "sym_demo", "--quiet"]
            self.assertEqual(subprocess.run(cmd).returncode, 0)
            first = {p.name: p.read_bytes() for p in (td / "o").iterdir()}
            self.assertEqual(subprocess.run(cmd + ["--check"]).returncode, 0)
            shutil.rmtree(td / "o")
            self.assertEqual(subprocess.run(cmd).returncode, 0)
            second = {p.name: p.read_bytes() for p in (td / "o").iterdir()}
            self.assertEqual(first, second)
            atlas = (td / "o" / "sym_demo.atlas").read_text()
            self.assertIn("pma: true", atlas)
            # mesh regions keep their full image (no offsets line after them)
            lines = atlas.splitlines()
            i = lines.index("sym_demo/body")
            self.assertTrue(lines[i + 1].startswith("bounds:"))
            self.assertFalse(lines[i + 2].startswith("offsets:"))
            for ln in lines:
                if ln.startswith("size:"):
                    w, h = (int(v) for v in ln[5:].split(","))
                    self.assertEqual((w % 4, h % 4), (0, 0))
            # --check writes nothing and fails cleanly (exit 1, no traceback) when --out does not exist
            cmd_new = [c if c != str(td / "o") else str(td / "new") for c in cmd]
            r = subprocess.run(cmd_new + ["--check"], capture_output=True, text=True)
            self.assertEqual(r.returncode, 1)
            self.assertNotIn("Traceback", r.stderr)
            self.assertFalse((td / "new").exists())

    def test_make_blur_provenance_idempotent(self):
        py = sys.executable
        with tempfile.TemporaryDirectory() as t:
            td = Path(t)
            shutil.copytree(DEMO, td / "demo", ignore=shutil.ignore_patterns("provenance.json", "*_blur.png"))
            cmd = [py, str(SPINE / "make_blur.py"), str(td / "demo" / "parts.json"), "--provenance", str(td / "rows.json")]
            self.assertEqual(subprocess.run(cmd, capture_output=True).returncode, 0)
            rows = json.loads((td / "rows.json").read_text())["rows"]
            self.assertEqual(len(rows), 6)  # every non-fx part
            self.assertTrue(all(r["stage"] == "spine-authoring" and len(r["refHashes"]) == 1 for r in rows))
            for r in rows:  # byte-identical to the committed demo blur variants
                name = Path(r["path"]).name
                self.assertEqual((td / "demo" / "images" / "sym_demo" / name).read_bytes(),
                                 (DEMO / "images" / "sym_demo" / name).read_bytes())
            self.assertEqual(subprocess.run(cmd, capture_output=True).returncode, 0)
            self.assertEqual(len(json.loads((td / "rows.json").read_text())["rows"]), 6)
            self.assertEqual(subprocess.run([py, str(SPINE / "make_blur.py"), str(td / "nope.json")],
                                            capture_output=True).returncode, 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
