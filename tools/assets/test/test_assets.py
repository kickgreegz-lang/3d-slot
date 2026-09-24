#!/usr/bin/env python3
"""AssetPack config + tools/assets/pack.mjs on a tiny raw-assets fixture (art/_work/assetpack-fixture/).

  PIPELINE_PY=tools/.venv/bin/python tools/.venv/bin/python tools/assets/test/test_assets.py
The fixture mimics what the pipeline scripts write into build/pack/: three symbol statics
(360x360, one {tps} folder), two flipbook clips (one {tps} folder each, <clip>_NNNN.png), a
background in a {m} bundle, and mastered audio that must pass through untouched.
"""
from __future__ import annotations

import json
import os
import shutil
import struct
import subprocess
import sys
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

ASSETS = Path(__file__).resolve().parents[1]
REPO = ASSETS.parents[1]
FIX = REPO / "art" / "_work" / "assetpack-fixture"
RAW = FIX / "raw"
OUT = FIX / "out"
PY = os.environ.get("PIPELINE_PY", sys.executable)


def disc(size, r, fill, outline=12, cx=None, cy=None):
    im = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx = size[0] / 2 if cx is None else cx
    cy = size[1] / 2 if cy is None else cy
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(0, 0, 0, 255))
    d.ellipse([cx - r + outline, cy - r + outline, cx + r - outline, cy + r - outline], fill=fill)
    return im


def make_fixture():
    shutil.rmtree(FIX, ignore_errors=True)
    sym = RAW / "symbols{tps}"
    sym.mkdir(parents=True)
    for i, (name, col) in enumerate([("sym_H1", (255, 198, 41, 255)), ("sym_H2", (255, 63, 168, 255)), ("sym_W", (53, 242, 224, 255))]):
        disc((360, 360), 140 - 10 * i, col).save(sym / f"{name}.png")
    for clip, n, size in (("fx_poof", 8, (96, 80)), ("W_turn", 12, (120, 160))):
        d = RAW / f"{clip}{{tps}}"
        d.mkdir(parents=True)
        for k in range(1, n + 1):
            disc(size, min(size) / 2 - 4, (255, 120 + 10 * k, 40, 255), 6, cx=size[0] / 2, cy=size[1] / 2).save(d / f"{clip}_{k:04d}.png")
    env = RAW / "env{m}"
    env.mkdir(parents=True)
    Image.new("RGB", (512, 256), (42, 15, 94)).save(env / "bg_landscape.png")
    aud = RAW / "audio"
    aud.mkdir(parents=True)
    ff = subprocess.run([PY, "-c", "import imageio_ffmpeg as m; print(m.get_ffmpeg_exe())"], capture_output=True, text=True, check=True).stdout.strip()
    for ext, codec in (("webm", ["-c:a", "libopus", "-b:a", "64k"]), ("m4a", ["-c:a", "aac", "-b:a", "96k"])):
        subprocess.run([ff, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=f=660:d=0.3", *codec,
                        "-fflags", "+bitexact", str(aud / f"ui_click_01.{ext}")], check=True)


def pack(*extra):
    return subprocess.run(["node", str(ASSETS / "pack.mjs"), "--entry", str(RAW), "--output", str(OUT),
                           "--cache-dir", str(FIX / ".cache"), "--qa-dir", str(FIX / "qa"), *extra],
                          capture_output=True, text=True, cwd=REPO)


class AssetPackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        make_fixture()
        cls.r = pack("--no-cache")
        cls.qa = json.loads((FIX / "qa" / "qa.json").read_text()) if (FIX / "qa" / "qa.json").exists() else {}

    def test_pack_passes(self):
        self.assertEqual(self.r.returncode, 0, self.r.stdout + self.r.stderr)
        self.assertTrue(self.qa["passed"], self.qa.get("errors"))

    def test_manifest_relative(self):
        man = json.loads((OUT / "manifest.json").read_text())
        srcs = [s if isinstance(s, str) else s["src"] for b in man["bundles"] for a in b["assets"] for s in a["src"]]
        self.assertTrue(srcs)
        for s in srcs:
            self.assertFalse(s.startswith("/") or ".." in s or "://" in s, s)
            self.assertTrue((OUT / s).exists(), s)
        self.assertIn("env", [b["name"] for b in man["bundles"]])

    def test_webp_png_and_low_res(self):
        names = {p.name for p in OUT.rglob("*") if p.is_file()}
        for base in ("symbols", "fx_poof", "W_turn"):
            for n in (f"{base}.png.json", f"{base}.webp.json", f"{base}@0.5x.png.json", f"{base}@0.5x.webp.json",
                      f"{base}.png", f"{base}.webp", f"{base}@0.5x.png", f"{base}@0.5x.webp"):
                self.assertIn(n, names)
        self.assertTrue({"bg_landscape.png", "bg_landscape.webp", "bg_landscape@0.5x.png", "bg_landscape@0.5x.webp"} <= names)

    def test_pages_and_clip_lengths(self):
        for p in self.qa["pages"]:
            w, h = p["size"]
            self.assertLessEqual(max(w, h), 2048)
            self.assertEqual((w % 4, h % 4), (0, 0), p)
        self.assertEqual(self.qa["clips"]["fx_poof"]["frames"], 8)
        self.assertEqual(self.qa["clips"]["W_turn"]["frames"], 12)
        anims = self.qa["animations"]
        self.assertEqual(sorted(g["frames"] for g in anims["W_turn"]), [12, 12, 12, 12])
        self.assertNotIn("sym_H", anims)                     # symbol statics are not an animation
        sheet = json.loads((OUT / "symbols.png.json").read_text())
        self.assertEqual(sorted(sheet["frames"]), ["sym_H1", "sym_H2", "sym_W"])
        self.assertEqual(sheet["frames"]["sym_H1"]["sourceSize"], {"w": 360, "h": 360})
        low = json.loads((OUT / "symbols@0.5x.png.json").read_text())
        self.assertEqual(low["frames"]["sym_H1"]["sourceSize"], {"w": 180, "h": 180})
        self.assertEqual(low["meta"]["scale"], 0.5)

    def test_audio_untouched(self):
        for ext in ("webm", "m4a"):
            self.assertEqual((OUT / "audio" / f"ui_click_01.{ext}").read_bytes(), (RAW / "audio" / f"ui_click_01.{ext}").read_bytes())
        self.assertFalse(list(OUT.rglob("*.mp3")))

    def test_rows(self):
        doc = json.loads((FIX / "qa" / "manifest.json").read_text())
        files = [p for p in OUT.rglob("*") if p.is_file()]
        self.assertEqual(len(doc["rows"]), len(files))
        for r in doc["rows"]:
            self.assertEqual(r["stage"], "packaging")
            self.assertEqual(r["licenseId"], "pixi")
        sym = [r for r in doc["rows"] if r["path"].endswith("/symbols.png")][0]
        self.assertEqual(len(sym["refHashes"]), 3)
        try:
            import jsonschema
        except ImportError:
            return
        schema = json.loads((REPO / "art" / "manifest.schema.json").read_text())
        jsonschema.Draft202012Validator(schema, format_checker=jsonschema.FormatChecker()).validate(doc)

    def test_zz_rerun_with_cache_is_identical(self):
        before = {str(p.relative_to(OUT)): p.read_bytes() for p in OUT.rglob("*") if p.is_file()}
        r = pack()
        self.assertEqual(r.returncode, 0, r.stderr)
        after = {str(p.relative_to(OUT)): p.read_bytes() for p in OUT.rglob("*") if p.is_file()}
        self.assertEqual(before.keys(), after.keys())
        self.assertEqual(before, after)

    def test_zz_refuses_public_assets_root(self):
        # AssetPack rm -rf's --output (cold cache) and --cache-dir (--no-cache): every folder that holds
        # other work must be refused before AssetPack is even constructed
        for flag, target in (("--output", REPO / "public" / "assets"), ("--output", REPO / "public"), ("--output", REPO),
                             ("--output", REPO / "build"), ("--output", REPO / "src" / "pack"), ("--output", RAW / "out"),
                             ("--output", Path.home()), ("--cache-dir", REPO), ("--cache-dir", REPO / "art")):
            args = ["--output", str(OUT), "--cache-dir", str(FIX / ".cache")]
            args[args.index(flag) + 1] = str(target)
            r = subprocess.run(["node", str(ASSETS / "pack.mjs"), "--entry", str(RAW), *args, "--no-cache"],
                               capture_output=True, text=True, cwd=REPO)
            self.assertEqual(r.returncode, 2, (flag, target, r.stderr))
            self.assertIn("refusing", r.stderr)
        self.assertTrue((REPO / "public" / "assets").is_dir() and (REPO / "src").is_dir())


if __name__ == "__main__":
    unittest.main(verbosity=2)
