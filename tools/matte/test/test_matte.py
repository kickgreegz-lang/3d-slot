#!/usr/bin/env python3
"""Self-tests for tools/matte on synthetic cel-shaded art with exact ground truth.

  tools/.venv/bin/python tools/matte/test/test_matte.py
Gates asserted (art bible §10): zero key-tinted edge pixels (on black, on white, and in the
straight-alpha texels), alpha IoU vs ground truth > 0.98 at master and canvas resolution,
360x360 canvas with the content at cellScale x 300 px, centred; straight alpha; idempotent.
keyUniform (ART_PLAN): --key auto measures the key (an olive background the prompt asked to be
#00FF00 mattes on the olive), fails loudly (exit 1) on a non-uniform background and on
--max-key-drift; on the real D_H1 raw when it has been downloaded (pnpm gen:hf-ingest).
Scratch: art/_work/test-matte/ (gitignored).
"""
from __future__ import annotations

import json
import math
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

MATTE = Path(__file__).resolve().parents[1]
REPO = MATTE.parents[1]
sys.path.insert(0, str(MATTE))
sys.path.insert(0, str(REPO / "tools" / "gen"))
import mattelib as ml  # noqa: E402
import provenance as prov  # noqa: E402
import variants  # noqa: E402

WORK = REPO / "art" / "_work" / "test-matte"
PY = sys.executable
CASES = {
    # name: (key, palette, extra synthetic flags)
    "green_warm": ("00FF00", "warm", []),
    "magenta_teal_slop": ("FF00FF", "teal", ["--slop"]),
    "green_gap": ("00FF00", "warm", ["--gap", "3"]),
    "blue_gold_slop": ("0000FF", "gold", ["--slop"]),
}


def rgba(path):
    a = np.asarray(Image.open(path).convert("RGBA"), np.float32) / 255.0
    return a[..., :3], a[..., 3]


def run(*args):
    return subprocess.run([PY, *map(str, args)], capture_output=True, text=True, cwd=REPO)


class MatteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        shutil.rmtree(WORK, ignore_errors=True)
        WORK.mkdir(parents=True)
        cls.results = {}
        for name, (key, pal, extra) in CASES.items():
            d = WORK / name
            r = run(MATTE / "make_synthetic.py", d, "--key", key, "--palette", pal, "--size", "640", *extra)
            assert r.returncode == 0, r.stderr
            r = run(MATTE / "outline_matte.py", d / "art.png", d / "out.png", "--key", key, "--content-px", "300",
                    "--emit-master", d / "master.png", "--qa-dir", d / "qa", "--asset-id", f"test_{name}")
            cls.results[name] = r

    def test_exit_and_report(self):
        for name, r in self.results.items():
            self.assertEqual(r.returncode, 0, f"{name}: {r.stdout}\n{r.stderr}")
            qa = json.loads((WORK / name / "qa" / "qa.json").read_text())
            self.assertTrue(qa["passed"], name)

    def test_zero_key_tinted_edge_pixels(self):
        for name, (key, _, _) in CASES.items():
            rgb, a = rgba(WORK / name / "out.png")
            h = ml.halo_report(rgb, a, ml.parse_hex(key))
            self.assertEqual(h["keyTintedEdgePx"], 0, f"{name}: {h}")
            self.assertGreater(h["edgePx"], 500)
            # independent check: no visible pixel anywhere is close to the key colour
            vis = a > 0.05
            dist = np.linalg.norm(rgb - ml.parse_hex(key), axis=-1)
            self.assertEqual(int(np.count_nonzero(vis & (dist < 0.35))), 0, name)

    def test_iou_vs_ground_truth(self):
        for name in CASES:
            d = WORK / name
            gt = np.asarray(Image.open(d / "gt_alpha.png"), np.float32) / 255.0
            _, m = rgba(d / "master.png")
            _, o = rgba(d / "out.png")
            tf = json.loads((d / "qa" / "qa.json").read_text())["transform"]
            self.assertGreater(ml.iou(m, gt), 0.98, f"{name} master IoU")
            self.assertGreater(ml.iou(o, ml.transform_alpha(gt, tf)), 0.98, f"{name} canvas IoU")

    def test_canvas_and_pivot(self):
        for name in CASES:
            rgb, a = rgba(WORK / name / "out.png")
            self.assertEqual(a.shape, (360, 360))
            rep = ml.canvas_report(a, 300, 360, "max")
            self.assertLessEqual(abs(rep["contentPx"] - 300), 2, rep)
            self.assertLessEqual(max(map(abs, rep["centreOffset"])), 1.0, rep)
            self.assertEqual(float(a[0].max() + a[-1].max() + a[:, 0].max() + a[:, -1].max()), 0.0)

    def test_straight_alpha_and_colours_kept(self):
        for name, (_, pal, _) in CASES.items():
            d = WORK / name
            gt = json.loads((d / "gt.json").read_text())
            rgb, a = rgba(d / "out.png")
            tf = json.loads((d / "qa" / "qa.json").read_text())["transform"]
            px, py = gt["baseProbe"]
            cx = int(round((px - tf["srcOrigin"][0]) * tf["scale"]))
            cy = int(round((py - tf["srcOrigin"][1]) * tf["scale"]))
            self.assertEqual(a[cy, cx], 1.0)
            want = ml.parse_hex(gt["colours"]["base"])
            self.assertLess(float(np.abs(rgb[cy - 2:cy + 3, cx - 2:cx + 3] - want).max()), 3 / 255, name)
            # semi-transparent edge texels carry the unmixed ink colour, not a premultiplied darkening of a hue
            semi = (a > 0.1) & (a < 0.9)
            self.assertLess(float(rgb[semi].max(axis=-1).mean()), 0.25, name)

    def test_hole_is_transparent_and_gap_sealed(self):
        d = WORK / "green_warm"
        _, m = rgba(d / "master.png")
        gt = np.asarray(Image.open(d / "gt_alpha.png"), np.float32) / 255.0
        hole = gt == 0
        inside = np.zeros_like(hole)
        s = gt.shape[0] / 1000
        inside[int(530 * s):int(590 * s), int(650 * s):int(700 * s)] = True   # centre of the ring opening
        self.assertTrue((hole & inside).any())
        self.assertEqual(float(m[hole & inside].max()), 0.0)
        qa = json.loads((WORK / "green_gap" / "qa" / "qa.json").read_text())
        self.assertGreaterEqual(qa["matte"]["seal"], 1)
        self.assertEqual(json.loads((WORK / "green_warm" / "qa" / "qa.json").read_text())["matte"]["seal"], 0)

    def test_idempotent(self):
        d = WORK / "green_warm"
        before = (prov.sha256_file(d / "out.png"), (d / "qa" / "manifest.json").read_text())
        r = run(MATTE / "outline_matte.py", d / "art.png", d / "out.png", "--key", "00FF00", "--content-px", "300",
                "--emit-master", d / "master.png", "--qa-dir", d / "qa", "--asset-id", "test_green_warm")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(before, (prov.sha256_file(d / "out.png"), (d / "qa" / "manifest.json").read_text()))

    def test_manifest_row(self):
        doc = json.loads((WORK / "green_warm" / "qa" / "manifest.json").read_text())
        row = doc["rows"][0]
        self.assertEqual(row["stage"], "matting")
        self.assertEqual(row["licenseId"], "python-geometry")
        self.assertEqual(row["sha256"], prov.sha256_file(WORK / "green_warm" / "out.png"))
        self.assertTrue(row["qa"]["passed"])
        try:
            import jsonschema
        except ImportError:
            return
        schema = json.loads((REPO / "art" / "manifest.schema.json").read_text())
        jsonschema.Draft202012Validator(schema, format_checker=jsonschema.FormatChecker()).validate(doc)

    def test_symbol_sizes_from_game_ts(self):
        t = ml.symbol_targets()
        self.assertEqual(set(t), {"H1", "H2", "H3", "H4", "L1", "L2", "L3", "L4", "L5", "W", "S"})
        self.assertEqual(ml.content_px_for(symbol="H1"), 291)
        self.assertEqual(ml.content_px_for(symbol="S"), 336)
        self.assertEqual(ml.content_px_for(symbol="L3"), 258)
        self.assertEqual(t["H3"]["restAngle"], -14.0)
        d = WORK / "magenta_teal_slop"
        r = run(MATTE / "outline_matte.py", d / "art.png", d / "out_S.png", "--key", "FF00FF", "--symbol", "S",
                "--qa-dir", d / "qa_S")
        self.assertEqual(r.returncode, 0, r.stderr)
        _, a = rgba(d / "out_S.png")
        self.assertLessEqual(abs(ml.canvas_report(a, 336, 360, "max")["contentPx"] - 336), 2)

    def test_refusals(self):
        d = WORK / "green_warm"
        small = WORK / "small.png"
        Image.open(d / "art.png").resize((200, 200), Image.Resampling.LANCZOS).save(small)
        r = run(MATTE / "outline_matte.py", small, WORK / "small_out.png", "--key", "00FF00", "--content-px", "300",
                "--qa-dir", WORK / "qa_small")
        self.assertEqual(r.returncode, 2)
        self.assertIn("never upscale", r.stderr)
        flat = WORK / "flat.png"
        Image.new("RGB", (64, 64), (0, 255, 0)).save(flat)
        r = run(MATTE / "outline_matte.py", flat, WORK / "flat_out.png", "--key", "00FF00", "--content-px", "30",
                "--qa-dir", WORK / "qa_flat")
        self.assertEqual(r.returncode, 2)

    def test_rembg_wrapper_licence_guard(self):
        # rembg's default model (bria-rmbg, CC BY-NC) and non-allowlisted models are refused before rembg
        # runs; allowed models always get an explicit -m plus -dc (checked with a fake rembg on PATH)
        import os
        fake_bin = WORK / "fakebin"
        fake_bin.mkdir(parents=True, exist_ok=True)
        log = WORK / "rembg_argv.txt"
        (fake_bin / "rembg").write_text(f'#!/bin/sh\necho "$@" > "{log}"\ncp "$5" "$6"\n')
        (fake_bin / "rembg").chmod(0o755)
        env = {**os.environ, "PATH": f"{fake_bin}{os.pathsep}{os.environ.get('PATH', '')}"}
        sh = str(MATTE / "rembg_matte.sh")
        src = WORK / "green_warm" / "art.png"
        for model in ("bria-rmbg", "u2net", "isnet-anime", "", "birefnet-general;id"):
            r = subprocess.run([sh, model, str(src), str(WORK / "rembg_out.png")], capture_output=True, text=True, env=env)
            self.assertEqual(r.returncode, 3, (model, r.stderr))
        self.assertFalse(log.exists())
        r = subprocess.run([sh, "birefnet-general", str(src), str(WORK / "rembg_out.png")], capture_output=True, text=True, env=env)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(log.read_text().split()[:4], ["i", "-m", "birefnet-general", "-dc"])

    def test_alpha_from_external_matte(self):
        d = WORK / "magenta_teal_slop"
        ext = WORK / "external_rgba.png"
        rgb = np.asarray(Image.open(d / "art.png").convert("RGB"))
        gt = np.asarray(Image.open(d / "gt_alpha.png"))
        Image.fromarray(np.dstack([rgb, gt]), "RGBA").save(ext)
        r = run(MATTE / "outline_matte.py", d / "art.png", d / "out_ext.png", "--key", "FF00FF", "--content-px", "300",
                "--alpha-from", ext, "--qa-dir", d / "qa_ext")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


class MeasuredKeyTests(unittest.TestCase):
    """--key auto = measured key + keyUniform gate (the model does not always obey the requested hex)."""

    OLIVE = "95C445"    # what ab2/D_H1 came back on instead of #00FF00

    @classmethod
    def setUpClass(cls):
        cls.d = WORK / "measured"
        shutil.rmtree(cls.d, ignore_errors=True)
        r = run(MATTE / "make_synthetic.py", cls.d / "olive", "--key", cls.OLIVE, "--palette", "gold", "--size", "640")
        assert r.returncode == 0, r.stderr

    def test_olive_key_measured(self):
        d = self.d / "olive"
        r = run(MATTE / "outline_matte.py", d / "art.png", d / "out.png", "--content-px", "300", "--expect-key", "00FF00",
                "--emit-master", d / "master.png", "--qa-dir", d / "qa")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("warning: the background measures #95C445", r.stderr)
        qa = json.loads((d / "qa" / "qa.json").read_text())
        k = qa["keyUniform"]
        self.assertEqual((k["mode"], k["key"], k["uniform"], k["passed"], k["chroma"]), ("measured", "#95C445", True, True, False))
        self.assertEqual(k["requested"], "#00FF00")
        self.assertGreater(k["drift"], 150)
        self.assertLess(qa["matte"]["keyLikeFgFraction"], 0.01)       # gold stays clear of the olive
        gt = np.asarray(Image.open(d / "gt_alpha.png"), np.float32) / 255.0
        rgb, m = rgba(d / "master.png")
        self.assertGreater(ml.iou(m, gt), 0.98)
        rgb, a = rgba(d / "out.png")
        key = ml.parse_hex(self.OLIVE)
        self.assertEqual(ml.halo_report(rgb, a, key)["keyTintedEdgePx"], 0)
        vis = a > 0.05
        self.assertEqual(int(np.count_nonzero(vis & (np.linalg.norm(rgb - key, axis=-1) < 0.2))), 0)
        # the gold fill keeps its colour: the general (hue-axis) despill does not touch it
        gtj = json.loads((d / "gt.json").read_text())
        tf = qa["transform"]
        px, py = gtj["baseProbe"]
        cx, cy = int(round((px - tf["srcOrigin"][0]) * tf["scale"])), int(round((py - tf["srcOrigin"][1]) * tf["scale"]))
        self.assertLess(float(np.abs(rgb[cy - 2:cy + 3, cx - 2:cx + 3] - ml.parse_hex("FFC629")).max()), 3 / 255)

    def test_spill_axis_for_non_chroma_keys(self):
        olive = ml.parse_hex(self.OLIVE)
        self.assertFalse(ml.is_chroma_key(olive))
        self.assertTrue(all(ml.is_chroma_key(ml.parse_hex(h)) for h in ("00FF00", "FF00FF", "0000FF", "F530F6", "06FB25")))
        cols = np.array([olive, ml.parse_hex("FFC629"), ml.parse_hex("E2861A"), [0, 0, 0], [1, 1, 1]], np.float32)
        s = ml.spill(cols, olive)
        self.assertGreater(s[0], 0.3)                                   # the key itself
        self.assertTrue(np.all(s[1:] < 24 / 255 + 0.12), s)             # gold, deep gold, ink, white
        self.assertTrue(np.all(np.abs(s[3:]) < 1e-6))
        with self.assertRaises(ValueError):
            ml.key_axis(ml.parse_hex("808080"))

    def test_non_uniform_background_fails_loudly(self):
        d = self.d / "gradient"
        d.mkdir(parents=True, exist_ok=True)
        rgb = np.asarray(Image.open(self.d / "olive" / "art.png").convert("RGB")).astype(np.float32)
        h, w = rgb.shape[:2]
        ramp = np.linspace(-60, 60, w, dtype=np.float32)[None, :, None]    # a lit/vignetted "key"
        bg = np.linalg.norm(rgb - ml.parse_hex(self.OLIVE) * 255, axis=-1) < 12
        rgb = np.where(bg[..., None], np.clip(rgb + ramp, 0, 255), rgb)
        Image.fromarray(rgb.astype(np.uint8)).save(d / "art.png")
        r = run(MATTE / "outline_matte.py", d / "art.png", d / "out.png", "--content-px", "300", "--qa-dir", d / "qa")
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("keyUniform FAILED", r.stderr)
        self.assertFalse((d / "out.png").exists())
        qa = json.loads((d / "qa" / "qa.json").read_text())
        self.assertFalse(qa["passed"])
        self.assertFalse(qa["keyUniform"]["uniform"])
        # a forced key skips the gate (operator's call) and says so in the report
        r = run(MATTE / "outline_matte.py", d / "art.png", d / "out.png", "--content-px", "300", "--key", self.OLIVE,
                "--qa-dir", d / "qa_forced", "--no-strict")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(json.loads((d / "qa_forced" / "qa.json").read_text())["keyUniform"]["skipped"])

    def test_max_key_drift(self):
        d = self.d / "olive"
        r = run(MATTE / "outline_matte.py", d / "art.png", d / "drift.png", "--content-px", "300", "--expect-key", "00FF00",
                "--max-key-drift", "60", "--qa-dir", d / "qa_drift")
        self.assertEqual(r.returncode, 1)
        self.assertIn("from the requested #00FF00", r.stderr)
        r = run(MATTE / "outline_matte.py", d / "art.png", d / "drift.png", "--content-px", "300", "--expect-key", "95C445",
                "--max-key-drift", "10", "--qa-dir", d / "qa_drift")
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_white_background_is_not_a_key(self):
        # sym_W_rig of batch c03 came back on flat white: uniform, but not keyable -> fail loudly
        d = self.d / "white"
        r = run(MATTE / "make_synthetic.py", d, "--key", "FFFFFF", "--palette", "teal", "--size", "320")
        self.assertEqual(r.returncode, 0, r.stderr)
        r = run(MATTE / "outline_matte.py", d / "art.png", d / "out.png", "--content-px", "150", "--qa-dir", d / "qa")
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("not a colour key", r.stderr)
        k = json.loads((d / "qa" / "qa.json").read_text())["keyUniform"]
        self.assertEqual((k["uniform"], k["keyable"], k["passed"]), (True, False, False))

    def test_forced_wrong_key_warns(self):
        d = self.d / "olive"
        r = run(MATTE / "outline_matte.py", d / "art.png", d / "forced.png", "--content-px", "300", "--key", "00FF00",
                "--qa-dir", d / "qa_forced", "--no-strict")
        self.assertIn("but the background measures #95C445", r.stderr)

    def test_real_d_h1_raw(self):
        raw = REPO / "art" / "_raw" / "D_H1" / "v01" / "raw.png"
        if not raw.exists():
            self.skipTest("art/_raw/D_H1/v01/raw.png not downloaded (pnpm gen:hf-ingest --job D_H1)")
        d = self.d / "D_H1"
        r = run(MATTE / "outline_matte.py", raw, d / "sym_H1.png", "--symbol", "H1", "--expect-key", "00FF00",
                "--emit-master", d / "master.png", "--qa-dir", d / "qa")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        qa = json.loads((d / "qa" / "qa.json").read_text())
        k = qa["keyUniform"]
        self.assertTrue(k["uniform"])
        self.assertLess(np.linalg.norm(ml.parse_hex(k["key"]) - ml.parse_hex(self.OLIVE)) * 255, 8)
        self.assertEqual(qa["halo"]["keyTintedEdgePx"], 0)
        _, m = rgba(d / "master.png")
        self.assertEqual(float(m[450, 1085]), 0.0)                     # the handle opening is keyed out
        self.assertEqual(float(m[1100, 1024]), 1.0)                    # the cassette door is opaque
        self.assertEqual(float(m[:8].max() + m[-8:].max()), 0.0)


class VariantTests(unittest.TestCase):
    def test_variants(self):
        src = WORK / "green_warm" / "out.png"
        if not src.exists():
            self.skipTest("run with MatteTests")
        out = WORK / "variants"
        r = run(MATTE / "variants.py", src, "--out-dir", out, "--name", "sym_T", "--symbol", "H3",
                "--qa-dir", out / "qa")
        self.assertEqual(r.returncode, 0, r.stderr)
        brgb, ba = rgba(out / "sym_T_blur.png")
        grgb, ga = rgba(out / "sym_T_glow.png")
        self.assertEqual(ba.shape, (360, 360))
        self.assertEqual(ga.shape, (360, 360))
        self.assertTrue(np.all(grgb[ga > 0] == 1.0))                     # white silhouette
        self.assertEqual(float(max(ga[0].max(), ga[-1].max(), ga[:, 0].max(), ga[:, -1].max())), 0.0)
        self.assertGreater(float(ga.max()), 0.9)
        _, a = rgba(src)
        self.assertGreater(float(ba.sum()), 0.8 * float(a.sum()))

    def test_blur_is_vertical_in_screen_space(self):
        size = 180
        alpha = np.zeros((size, size), np.float32)
        alpha[85:95, 85:95] = 1
        rgb = np.zeros((size, size, 3), np.float32)
        for angle in (0.0, -14.0, -18.0):
            _, b = variants.blur_variant(rgb, alpha, angle, mode="box")
            screen = variants._affine(b, angle)                          # what the runtime displays
            ys, xs = np.nonzero(screen > 0.01)
            w = screen[ys, xs]
            my, mx = np.average(ys, weights=w), np.average(xs, weights=w)
            cov = np.cov(np.vstack([ys - my, xs - mx]), aweights=w)
            theta = 0.5 * math.degrees(math.atan2(2 * cov[0, 1], cov[0, 0] - cov[1, 1]))
            self.assertLess(abs(theta), 1.5, f"smear axis {theta:.2f} deg off vertical at restAngle {angle}")
            self.assertGreater(cov[0, 0], 4 * cov[1, 1])


if __name__ == "__main__":
    unittest.main(verbosity=2)
