#!/usr/bin/env python3
"""Self-tests for tools/video on synthetic key-colour clips (ffmpeg lavfi, H.264 4:2:0).

  PIPELINE_PY=tools/.venv/bin/python tools/.venv/bin/python tools/video/test/test_video.py
Scratch: art/_work/test-video/ (gitignored).
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

VIDEO = Path(__file__).resolve().parents[1]
REPO = VIDEO.parents[1]
sys.path.insert(0, str(REPO / "tools" / "matte"))
import mattelib as ml  # noqa: E402

WORK = REPO / "art" / "_work" / "test-video"
ENV = {**os.environ, "PIPELINE_PY": os.environ.get("PIPELINE_PY", sys.executable)}


def sh(*args):
    return subprocess.run([str(a) for a in args], capture_output=True, text=True, cwd=REPO, env=ENV)


def frames(d: Path, name: str):
    return sorted(d.glob(f"{name}_[0-9][0-9][0-9][0-9].png"))


def rgba(p):
    with Image.open(p) as im:
        a = np.asarray(im.convert("RGBA"), np.float32) / 255.0
    return a[..., :3], a[..., 3]


class VideoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        shutil.rmtree(WORK, ignore_errors=True)
        WORK.mkdir(parents=True)
        cls.keyed = {}
        for key in ("00FF00", "FF00FF"):
            clip = WORK / f"clip_{key}.mp4"
            r = sh(VIDEO / "make_test_clip.sh", clip, key, 2, 25)
            assert r.returncode == 0, r.stderr
            out = WORK / f"frames_{key}"
            cls.keyed[key] = sh(VIDEO / "key_video.sh", clip, out, "fx_test", "--size", 256, "--fps", 24, "--fade", 12,
                                "--key", key, "--qa-dir", WORK / f"qa_{key}")

    def test_key_video_frames(self):
        for key, r in self.keyed.items():
            self.assertEqual(r.returncode, 0, f"{key}: {r.stdout}{r.stderr}")
            qa = json.loads((WORK / f"qa_{key}" / "qa.json").read_text())
            self.assertTrue(qa["passed"], qa)
            self.assertEqual(qa["inFrames"], 48)                       # 2 s normalised to 24 fps
            fs = frames(WORK / f"frames_{key}", "fx_test")
            self.assertEqual(len(fs), 36)                              # 48 - 12 crossfade frames
            self.assertEqual(fs[0].name, "fx_test_0001.png")
            for i, f in enumerate(fs, 1):
                rgb, a = rgba(f)
                self.assertEqual(a.shape, (192, 256))
                self.assertEqual(float(a[0, 0] + a[0, -1] + a[-1, 0] + a[-1, -1]), 0.0)
                area = float((a > 0.5).sum())
                # r ~ 31 px disc; frames 25..36 cross-fade two ghosts of it (the loop seam)
                hi = 3500 if i <= 24 else 7000
                self.assertTrue(2700 < area < hi, f"{f.name}: disc area {area}")
                self.assertEqual(float(a.max()), 1.0)

    def test_no_key_fringe(self):
        for key in self.keyed:
            k = ml.parse_hex(key)
            for f in frames(WORK / f"frames_{key}", "fx_test"):
                rgb, a = rgba(f)
                h = ml.halo_report(rgb, a, k)
                self.assertEqual(h["keyTintedEdgePx"], 0, f"{key} {f.name}: {h}")
                vis = a > 0.05
                self.assertEqual(int((vis & (np.linalg.norm(rgb - k, axis=-1) < 0.35)).sum()), 0, f.name)

    def test_loop_seam(self):
        qa = json.loads((WORK / "qa_00FF00" / "qa.json").read_text())
        self.assertGreaterEqual(qa["seamSSIM"] + 0.01, qa["minStepSSIM"])

    def test_no_loop_and_usage(self):
        r = sh(VIDEO / "key_video.sh", WORK / "clip_00FF00.mp4", WORK / "noloop", "fx_nl", "--no-loop", "--size", 128,
               "--qa-dir", WORK / "qa_nl")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(len(frames(WORK / "noloop", "fx_nl")), 48)
        self.assertEqual(sh(VIDEO / "key_video.sh").returncode, 2)
        self.assertEqual(sh(VIDEO / "key_video.sh", WORK / "clip_00FF00.mp4", WORK / "x", "x", "--key", "zz").returncode, 2)
        self.assertEqual(sh(VIDEO / "key_video.sh", WORK / "missing.mp4", WORK / "x", "x").returncode, 2)
        self.assertEqual(sh(VIDEO / "key_video.sh", "--help").returncode, 0)

    def test_stacked_alpha(self):
        src = WORK / "frames_00FF00"
        out = WORK / "fx_test_stacked.mp4"
        r = sh(VIDEO / "stacked_alpha.sh", src, out, "--fps", 24, "--qa-dir", WORK / "qa_stacked", "--preset", "veryfast")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        qa = json.loads((WORK / "qa_stacked" / "qa.json").read_text())
        self.assertTrue(qa["passed"], qa)
        self.assertEqual(qa["videoSize"], [256, 384])
        self.assertEqual(qa["videoFrames"], 36)
        self.assertLessEqual(qa["alphaMAE"], 3.0)
        row = json.loads((WORK / "qa_stacked" / "manifest.json").read_text())["rows"][0]
        self.assertEqual(row["licenseId"], "ffmpeg")
        self.assertEqual(row["route"], "ffmpeg")
        r = sh(VIDEO / "stacked_alpha.sh", src, WORK / "capped.mp4", "--fps", 24, "--max-height", 200,
               "--qa-dir", WORK / "qa_capped", "--preset", "veryfast")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        qa = json.loads((WORK / "qa_capped" / "qa.json").read_text())
        self.assertLessEqual(qa["videoSize"][1], 200)
        self.assertEqual(qa["videoSize"][1] % 2, 0)

    def test_flipbook(self):
        src = WORK / "frames_00FF00"
        py = ENV["PIPELINE_PY"]
        out = WORK / "pack" / "fx_test{tps}"
        r = sh(py, VIDEO / "flipbook.py", src, out, "--name", "fx_test", "--qa-dir", WORK / "qa_fb")
        self.assertEqual(r.returncode, 0, r.stderr)
        meta = json.loads((WORK / "qa_fb" / "flipbook.json").read_text())
        fs = frames(out, "fx_test")
        self.assertEqual(len(fs), 36)
        sizes = set()
        for f in fs:
            with Image.open(f) as im:
                sizes.add(im.size)
        self.assertEqual(len(sizes), 1)
        w, h = sizes.pop()
        self.assertEqual((w % 8, h % 8), (0, 0))
        self.assertLess(w * h, 256 * 192)                               # actually trimmed
        # pivot 'center': the source canvas centre is the output centre in every frame
        bx0, by0 = meta["sourceBox"][:2]
        for f_src, f_out in zip(frames(src, "fx_test")[::7], fs[::7]):
            _, a0 = rgba(f_src)
            _, a1 = rgba(f_out)
            ys, xs = np.nonzero(a0 > 0.5)
            ys1, xs1 = np.nonzero(a1 > 0.5)
            self.assertAlmostEqual(xs.mean() - bx0, xs1.mean(), delta=0.01)
            self.assertAlmostEqual(ys.mean() - by0, ys1.mean(), delta=0.01)
        self.assertAlmostEqual(128 - bx0, w / 2, delta=0.01)
        self.assertAlmostEqual(96 - by0, h / 2, delta=0.01)
        # idempotent: same bytes on a re-run
        before = [f.read_bytes() for f in fs]
        self.assertEqual(sh(py, VIDEO / "flipbook.py", src, out, "--name", "fx_test", "--qa-dir", WORK / "qa_fb").returncode, 0)
        self.assertEqual(before, [f.read_bytes() for f in frames(out, "fx_test")])
        # scaled, on twos, bottom-centre pivot, frame-count gate
        out2 = WORK / "pack" / "fx_small{tps}"
        r = sh(py, VIDEO / "flipbook.py", src, out2, "--name", "fx_small", "--size", 96, "--every", 2,
               "--pivot", "bottom-center", "--expect-frames", 18, "--qa-dir", WORK / "qa_fb2")
        self.assertEqual(r.returncode, 0, r.stderr)
        meta2 = json.loads((WORK / "qa_fb2" / "flipbook.json").read_text())
        self.assertEqual(meta2["anchor"], [0.5, 1.0])
        self.assertLessEqual(max(meta2["size"]), 104)
        r = sh(py, VIDEO / "flipbook.py", src, out2, "--name", "fx_small", "--expect-frames", 5, "--qa-dir", WORK / "qa_fb3")
        self.assertEqual(r.returncode, 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
