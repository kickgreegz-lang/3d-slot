#!/usr/bin/env python3
"""Self-tests for tools/split on synthetic part sheets with exact ground truth.

  tools/.venv/bin/python tools/split/test/test_split.py            # ~6-9 min (the character loop)
  SPLIT_TEST_QUICK=1 tools/.venv/bin/python tools/split/test/test_split.py   # symbol + units, ~1.5 min

Synthetic data (make_synthetic_sheet.py): the demo placeholder rigs in tools/spine/examples (outlined cel
parts with round overlap caps) composited into a rig master on a noisy flat key, and every piece (all
variants) laid out on part sheets at another scale with a random +-2 deg rotation, like the Higgsfield
sheets. The "operator" (component -> slot names, hints) is played from the ground truth.

Asserted:
  * cut: one component per piece, reading-order numbering, the plan row's expected piece list, measured
    key (keyUniform), a non-uniform sheet fails loudly;
  * symbol (fully automatic, OpenCV and the no-OpenCV fallback): every part within 1.5 px of the truth,
    sheet rotation recovered, reassembly SSIM > 0.98 and alpha IoU > 0.99 (ART_BIBLE 10), then
    make_blur -> gen.py -> validate.mjs pass on the demo rig.yaml; the 'symbol' canvas fit;
  * character, no hints: NO silent error - every piece the tool calls verified is within 4 canvas px,
    the rest are reported UNVERIFIED and fail the registration gate (exit 1 with --strict);
  * character, the operator loop (hints for exactly the flagged pieces, rebuild, <= 3 passes): converges
    with nothing flagged and no verified piece misplaced in any pass; every piece within 6 px, the
    cap-derived landmarks within 5 px of the rig's, limb joints free of holes at +-35 deg, alpha IoU > 0.99,
    head <= 27% of the height, and gen.py + validate.mjs --kind character pass on the demo rig.yaml;
  * units: masked NCC under occlusion, cap-joint circle fit, the joint-hole test (capsule vs straight cut).
Scratch: art/_work/test-split/ (gitignored).
"""
from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

SPLIT = Path(__file__).resolve().parents[1]
REPO = SPLIT.parents[1]
sys.path.insert(0, str(SPLIT))
import make_synthetic_sheet as synth  # noqa: E402
import splitlib as sl  # noqa: E402

WORK = REPO / "art" / "_work" / "test-split"
PY = sys.executable
NODE = shutil.which("node") or "node"
QUICK = bool(os.environ.get("SPLIT_TEST_QUICK"))
SYM_PARTS = REPO / "tools/spine/examples/demo_symbol/parts.json"
GUMBO_PARTS = REPO / "tools/spine/examples/character_demo/gumbo/parts.json"


def run(*args, env=None):
    return subprocess.run([str(a) for a in args], capture_output=True, text=True, cwd=REPO,
                          env={**os.environ, **(env or {})})


def content_box(img_path: Path, bbox) -> list[float]:
    a = np.asarray(Image.open(img_path))[..., 3] > 127
    ys, xs = np.nonzero(a)
    return [bbox[0] + xs.min(), bbox[1] + ys.min(), bbox[0] + xs.max() + 1, bbox[1] + ys.max() + 1]


def centre_err(out_dir: Path, truth: dict, prefix: str) -> dict:
    """Per setup piece: canvas content-centre error vs the ground truth."""
    pj = json.loads((out_dir / "parts.json").read_text())
    seen, errs = set(), {}
    for p in pj["parts"]:
        slot = p.get("slot") or p.get("name")
        pid = slot if not p.get("attachment") else f"{slot}/{p['attachment']}"
        rel = f"{slot}.png" if not p.get("attachment") else f"{slot}/{p['attachment']}.png"
        cb = content_box(out_dir / "images" / prefix / rel, p["bbox"])
        tc = truth["pieces"][pid]["canvasContent"]
        errs[pid] = math.hypot((cb[0] + cb[2] - tc[0] - tc[2]) / 2, (cb[1] + cb[3] - tc[1] - tc[3]) / 2)
        seen.add(slot)
    return errs


def cut_all(out: Path, key: str) -> dict:
    t = json.loads((out / "truth.json").read_text())
    cuts = {}
    for g in t["sheets"]:
        r = run(PY, SPLIT / "split.py", "cut", out / f"sheet_{g}.png", "--out", out / f"cut_{g}", "--expect-key", key)
        assert r.returncode == 0, r.stderr
        cuts[g] = out / f"cut_{g}" / "components.json"
    return cuts


def build(mapping: dict, path: Path, *flags, env=None):
    path.write_text(json.dumps(mapping, indent=1))
    r = run(PY, SPLIT / "split.py", "build", path, *flags, env=env)
    summary = json.loads(r.stdout) if r.stdout.strip().startswith("{") else None
    return r, summary


class Units(unittest.TestCase):
    def test_masked_ncc_finds_the_visible_part(self):
        rng = np.random.default_rng(0)
        img = rng.random((80, 90, 3)).astype(np.float32)
        T = img[20:40, 30:55].copy()
        M = np.ones(T.shape[:2], np.float32)
        V = np.ones(img.shape[:2], np.float32)
        V[20:40, 30:42] = 0                                   # half the true spot is explained by a front piece
        ncc, cover = sl.masked_ncc(img, V, T, M)
        iy, ix = np.unravel_index(int(np.argmax(ncc)), ncc.shape)
        self.assertEqual((ix, iy), (30, 20))
        self.assertGreater(float(ncc.max()), 0.99)
        self.assertAlmostEqual(float(cover[20, 30]), 13 / 25, places=3)

    def test_cap_joint_and_hole_test(self):
        H = W = 300
        yy, xx = np.mgrid[0:H, 0:W] + 0.5
        torso = ((xx - 150) ** 2 / 90 ** 2 + (yy - 110) ** 2 / 70 ** 2 <= 1).astype(np.float32)
        px, py = xx - 150, yy - 150
        t = np.clip(py / 120, 0, 1)
        arm = ((px ** 2 + (py - t * 120) ** 2) <= 28 ** 2).astype(np.float32)   # capsule, cap centred at (150,150)
        fore = ((px ** 2 + (py - 120) ** 2) <= 26 ** 2).astype(np.float32)
        cj = sl.cap_joint(arm, torso, away=(150, 270))
        self.assertEqual(cj["method"], "child-cap", cj)
        self.assertLess(math.hypot(cj["joint"][0] - 150, cj["joint"][1] - 150), 2.0, cj)
        self.assertLess(abs(cj["capRadius"] - 28), 2.0)
        self.assertEqual(sl.joint_hole_test(arm, torso, cj["joint"])["holesPx"] <= 8, True)
        # a limb cut off straight at a narrow parent swings its corners out: holes
        narrow = ((np.abs(xx - 150) <= 15) & (yy <= 160)).astype(np.float32)
        straight = ((np.abs(xx - 150) <= 28) & (yy >= 130) & (yy <= 270)).astype(np.float32)
        self.assertGreater(sl.joint_hole_test(straight, narrow, (150.0, 150.0))["holesPx"], 100)
        self.assertLessEqual(sl.joint_hole_test(arm, narrow, (150.0, 150.0))["holesPx"], 8)
        # a joint on the child's very edge = no overlap cap at all
        self.assertIsNone(sl.joint_hole_test(straight, narrow, (150.0, 130.5))["holesPx"])
        del fore

    def test_reading_order(self):
        a = np.zeros((200, 400), np.float32)
        a[20:80, 20:60] = 1        # 1: tall, top-aligned
        a[20:40, 100:140] = 1      # 2: short, same row
        a[20:60, 200:260] = 1      # 3
        a[120:180, 30:90] = 1      # 4: next row
        a[5:7, 380:382] = 1        # noise
        comps, _ = sl.find_components(a, min_area=20)
        real = [c for c in comps if not c["noise"]]
        self.assertEqual([c["bbox"][0] for c in real], [20, 100, 200, 30])
        self.assertEqual([c["id"] for c in real], ["1", "2", "3", "4"])
        self.assertEqual([c["id"] for c in comps if c["noise"]], ["n1"])


class SymbolSplit(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.out = WORK / "sym"
        shutil.rmtree(cls.out, ignore_errors=True)
        r = run(PY, SPLIT / "make_synthetic_sheet.py", "--parts", SYM_PARTS, "--out", cls.out, "--key", "00FF00",
                "--master-scale", "4", "--rotate", "2", "--seed", "7", "--no-close")   # the demo outlines are closed
        assert r.returncode == 0, r.stderr
        cls.truth = json.loads((cls.out / "truth.json").read_text())
        cls.cuts = cut_all(cls.out, "00FF00")
        cls.m = synth.truth_mapping(cls.out, cls.cuts, "demo", "symbol", str(SYM_PARTS), out_dir=str(cls.out / "out"))
        cls.r, cls.summary = build(cls.m, cls.out / "map.json")

    def test_cut(self):
        doc = json.loads(self.cuts["parts"].read_text())
        real = [c for c in doc["components"] if not c["noise"]]
        self.assertEqual(len(real), len(self.truth["pieces"]))
        self.assertEqual(doc["key"]["mode"], "measured")
        self.assertTrue(doc["key"]["uniform"])
        self.assertTrue((self.out / "cut_parts" / "components.png").exists())
        self.assertEqual(set(doc["sheetEntry"]["pieces"]), {c["id"] for c in real})

    def test_build_gates_and_accuracy(self):
        self.assertEqual(self.r.returncode, 0, self.r.stderr)
        g = self.summary
        self.assertTrue(g["reassembly"]["passed"], g["reassembly"])
        self.assertGreater(g["reassembly"]["ssim"], 0.98)
        self.assertGreater(g["reassembly"]["alphaIoU"], 0.99)
        self.assertTrue(g["passed"], g)
        errs = centre_err(self.out / "out", self.truth, "sym_demo")
        self.assertLess(max(errs.values()), 1.5, errs)
        rep = json.loads((self.out / "out" / "work" / "report.json").read_text())
        for pid, tp in self.truth["pieces"].items():
            rot = rep["pieces"][pid]["registration"]["transform"]["rotation"]
            self.assertLess(abs(rot + tp["angle"]), 0.5, (pid, rot, tp["angle"]))   # the sheet rotation, undone
        pj = json.loads((self.out / "out" / "parts.json").read_text())
        self.assertEqual(pj["canvas"], [360, 360])
        for p in pj["parts"]:
            w, h = Image.open(self.out / "out" / "images" / "sym_demo" / f"{p['name']}.png").size
            self.assertEqual([w, h], p["bbox"][2:])
            self.assertLessEqual(set(p), {"name", "bbox", "z", "bone", "parent", "joint", "tip", "blend", "color"})
        # part bones keep the demo's relative pivots (speaker / eye centres, antenna root)
        src = {p["name"]: p for p in json.loads(SYM_PARTS.read_text())["parts"]}
        for p in pj["parts"]:
            if "joint" in p and "joint" in src[p["name"]]:
                self.assertLess(math.dist(p["joint"], src[p["name"]]["joint"]), 3.0, p["name"])

    def test_gen_and_validate(self):
        out = self.out / "out"
        shutil.copy(REPO / "tools/spine/examples/demo_symbol/rig.yaml", out / "rig.yaml")
        r = run(PY, REPO / "tools/spine/make_blur.py", out / "parts.json")
        self.assertEqual(r.returncode, 0, r.stderr)
        r = run(PY, REPO / "tools/spine/gen.py", out / "rig.yaml", "-o", out / "sym_demo.json")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        r = run(NODE, REPO / "tools/spine/validate.mjs", out / "sym_demo.json", "--quiet")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_no_opencv_fallback(self):
        m = dict(self.m, out={"dir": str(self.out / "out_nocv2")})
        r, g = build(m, self.out / "map_nocv2.json", env={"SPLIT_NO_CV2": "1"})
        self.assertEqual(r.returncode, 0, r.stderr)
        # the fallback has no ECC (translation + 1.5 deg rotation steps): at the gate, not always over it
        self.assertGreater(g["reassembly"]["ssim"], 0.97, g["reassembly"])
        self.assertGreater(g["reassembly"]["alphaIoU"], 0.99, g["reassembly"])
        errs = centre_err(self.out / "out_nocv2", self.truth, "sym_demo")
        self.assertLess(max(errs.values()), 2.0, errs)

    def test_symbol_fit_mode(self):
        m = dict(self.m, fit={"mode": "symbol", "contentPx": 300}, out={"dir": str(self.out / "out_fit")})
        r, g = build(m, self.out / "map_fit.json", "--no-preview")
        self.assertEqual(r.returncode, 0, r.stderr)
        pj = json.loads((self.out / "out_fit" / "parts.json").read_text())
        boxes = np.array([content_box(self.out / "out_fit" / "images" / "sym_demo" / f"{p['name']}.png", p["bbox"])
                          for p in pj["parts"]])
        x0, y0, x1, y1 = boxes[:, 0].min(), boxes[:, 1].min(), boxes[:, 2].max(), boxes[:, 3].max()
        self.assertLessEqual(abs(max(x1 - x0, y1 - y0) - 300), 3)
        self.assertLessEqual(abs((x0 + x1) / 2 - 180), 2)
        self.assertLessEqual(abs((y0 + y1) / 2 - 180), 2)

    def test_mapping_errors(self):
        m = json.loads(json.dumps(self.m))
        ids = list(m["sheets"][0]["pieces"])
        del m["sheets"][0]["pieces"][ids[-1]]
        r, _ = build(m, self.out / "map_bad.json", "--no-preview")
        self.assertEqual(r.returncode, 2)
        self.assertIn("unmapped component", r.stderr)
        m = json.loads(json.dumps(self.m))
        m["sheets"][0]["pieces"]["99"] = {"name": "ghost"}
        r, _ = build(m, self.out / "map_bad.json", "--no-preview")
        self.assertEqual(r.returncode, 2)
        self.assertIn("does not exist", r.stderr)

    def test_nonuniform_sheet_fails_loudly(self):
        rgb = np.asarray(Image.open(self.out / "sheet_parts.png").convert("RGB")).astype(np.float32)
        ramp = np.linspace(-70, 70, rgb.shape[1], dtype=np.float32)[None, :, None]
        bg = np.linalg.norm(rgb - np.array([0, 255, 0], np.float32), axis=-1) < 20
        Image.fromarray(np.where(bg[..., None], np.clip(rgb + ramp, 0, 255), rgb).astype(np.uint8)).save(self.out / "bad.png")
        r = run(PY, SPLIT / "split.py", "cut", self.out / "bad.png", "--out", self.out / "cut_bad")
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("keyUniform FAILED", r.stderr)


@unittest.skipIf(QUICK, "SPLIT_TEST_QUICK=1")
class CharacterSplit(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.out = WORK / "gumbo"
        shutil.rmtree(cls.out, ignore_errors=True)
        r = run(PY, SPLIT / "make_synthetic_sheet.py", "--parts", GUMBO_PARTS, "--out", cls.out, "--key", "FF00FF",
                "--master-scale", "1.6", "--rotate", "2", "--seed", "3")
        assert r.returncode == 0, r.stderr
        cls.truth = json.loads((cls.out / "truth.json").read_text())
        cls.cuts = cut_all(cls.out, "FF00FF")
        # 1. no hints
        m = synth.truth_mapping(cls.out, cls.cuts, "chr_gumbo", "character", str(GUMBO_PARTS),
                                out_dir=str(cls.out / "out_nohint"))
        cls.r1, cls.s1 = build(m, cls.out / "map_nohint.json", "--strict", "--no-preview")
        rep = json.loads((cls.out / "out_nohint" / "work" / "report.json").read_text())
        cls.unverified = [pid for pid, v in rep["pieces"].items() if v["registration"].get("verified") is False]
        cls.rep1 = rep
        # 2. the operator loop: hints for exactly the flagged pieces - an eyeballed point (+-2 units) for most,
        #    the torso placed like the tank top it sits under - rebuild, repeat while anything is flagged
        rng = np.random.default_rng(4)
        hints, flagged, cls.passes, cls.silent = {}, list(cls.unverified), [], {}
        for it in range(3):
            for pid in flagged:
                if pid == "torso":
                    hints[pid] = {"like": "tank_top", "align": "top"}
                else:
                    c = synth.true_centre(cls.out, pid)
                    hints[pid] = {"at": [round(c[0] + rng.uniform(-2, 2), 1), round(c[1] + rng.uniform(-2, 2), 1)]}
            m2 = synth.truth_mapping(cls.out, cls.cuts, "chr_gumbo", "character", str(GUMBO_PARTS), hints=hints,
                                     out_dir=str(cls.out / "out"))
            cls.r2, cls.s2 = build(m2, cls.out / "map.json", "--lock-visible")
            rep2 = json.loads((cls.out / "out" / "work" / "report.json").read_text())
            flagged = rep2["gates"]["registration"]["unverified"]
            errs = centre_err(cls.out / "out", cls.truth, "chr_gumbo")
            cls.silent.update({f"pass{it + 1}:{pid}": round(e, 1) for pid, e in errs.items()
                               if e > 4.0 and pid in rep2["pieces"] and cls.truth["pieces"][pid]["setup"]
                               and rep2["pieces"][pid]["registration"].get("verified") is not False
                               and pid not in hints})
            cls.passes.append({"hints": len(hints), "flagged": list(flagged)})
            if not flagged:
                break

    def test_cut_matches_the_plan_row(self):
        r = run(PY, SPLIT / "split.py", "cut", self.out / "sheet_face.png", "--out", self.out / "cut_face_plan",
                "--expect-key", "FF00FF", "--plan-row", "chr_gumbo_parts_face")
        self.assertEqual(r.returncode, 0, r.stderr)
        s = json.loads(r.stdout)
        self.assertEqual((s["components"], s["expected"], s["countMatches"]), (23, 23, True))

    def test_no_silent_errors_without_hints(self):
        self.assertEqual(self.r1.returncode, 1, self.r1.stderr[-2000:])         # --strict: registration gate
        errs = centre_err(self.out / "out_nohint", self.truth, "chr_gumbo")
        bad = {pid: round(e, 1) for pid, e in errs.items()
               if e > 4.0 and self.rep1["pieces"][pid]["registration"].get("verified") is not False
               and pid in self.truth["pieces"] and self.truth["pieces"][pid]["setup"]}
        self.assertEqual(bad, {}, "a piece reported as verified is misplaced")
        self.assertFalse(self.s1["registrationMinNcc"] is None)
        self.assertLess(len(self.unverified), 20)
        for pid in self.unverified:
            self.assertTrue(any(w.startswith(f"{pid}: UNVERIFIED") for w in self.s1["warnings"]), pid)

    def test_with_hints(self):
        self.assertEqual(self.r2.returncode, 0, self.r2.stderr[-3000:])
        self.assertEqual(self.passes[-1]["flagged"], [], self.passes)          # the loop converges
        self.assertEqual(self.silent, {}, "a piece reported as verified is misplaced in a hinted pass")
        g = self.s2
        self.assertGreater(g["reassembly"]["alphaIoU"], 0.99)
        self.assertGreater(g["reassembly"]["ssim"], 0.95)     # the flat synthetic art's ceiling is ~0.988
        self.assertTrue(g["adultProportions"]["passed"])
        errs = centre_err(self.out / "out", self.truth, "chr_gumbo")
        setup = {pid: e for pid, e in errs.items() if self.truth["pieces"][pid]["setup"]}
        self.assertLess(max(setup.values()), 6.0, {k: round(v, 1) for k, v in setup.items() if v > 3})
        self.assertLess(float(np.median(list(setup.values()))), 1.5)
        # variants: eyes centre-aligned and hands pivoting at the wrist land on the rig's own registration
        for pid in ("eye_R/half", "eye_R/closed", "eye_L/wide", "hand_R/fist", "hand_R/point", "hand_L/lean"):
            self.assertLess(errs[pid], 5.0, (pid, errs[pid]))
        rep = json.loads((self.out / "out" / "work" / "report.json").read_text())
        self.assertEqual(rep["gates"]["registration"]["unverified"], [])
        # joints from the round overlap caps = the rig's own landmarks
        lm = json.loads((self.out / "out" / "parts.json").read_text())["landmarks"]
        for k in [f"{n}_{s}" for s in "LR" for n in ("shoulder", "elbow", "wrist", "hip", "knee", "ankle")] + ["neck"]:
            # the placeholder neck has no true round cap (and is placed from an eyeballed hint): 8 px there
            tol = 8.0 if k == "neck" else 5.0
            self.assertLess(math.dist(lm[k], self.truth["landmarks"][k]), tol, (k, lm[k], self.truth["landmarks"][k]))
        holes = rep["gates"]["jointHoles"]["pieces"]
        for k in ("upper_arm_L", "upper_arm_R", "forearm_L", "forearm_R", "thigh_L", "thigh_R", "shin_L", "shin_R"):
            self.assertTrue(holes[k]["ok"], (k, holes[k]))

    def test_gen_and_validate_character(self):
        out = self.out / "out"
        shutil.copy(REPO / "tools/spine/examples/character_demo/gumbo/rig.yaml", out / "rig.yaml")
        r = run(PY, REPO / "tools/spine/gen.py", out / "rig.yaml", "-o", out / "chr_gumbo.json")
        self.assertEqual(r.returncode, 0, r.stdout[-2000:] + r.stderr[-2000:])
        r = run(NODE, REPO / "tools/spine/validate.mjs", out / "chr_gumbo.json", "--quiet")
        self.assertEqual(r.returncode, 0, r.stdout[-2000:] + r.stderr[-2000:])
        pj = json.loads((out / "parts.json").read_text())
        self.assertEqual((pj["skeleton"], pj["kind"], pj["canvas"], pj["anchor"]), ("chr_gumbo", "character", [868, 992], [0.5, 1.0]))
        for p in pj["parts"]:
            rel = f"{p['slot']}.png" if "attachment" not in p else f"{p['slot']}/{p['attachment']}.png"
            self.assertEqual(list(Image.open(out / "images" / "chr_gumbo" / rel).size), p["bbox"][2:])


if __name__ == "__main__":
    WORK.mkdir(parents=True, exist_ok=True)
    unittest.main(verbosity=2)
