#!/usr/bin/env python3
"""Unit tests for the bpy-free parts of tools/blender (numpy + Pillow only; no pytest needed).

    python3 tools/blender/tests/test_units.py        # exit 0 = all passed
"""
from __future__ import annotations

import json
import math
import sys
import tempfile
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np  # noqa: E402

from slotbl import animspec, cli, easing, imgtools, palette, provenance  # noqa: E402

EXAMPLE = cli.TOOLS_BLENDER / "examples" / "celebrate_test.json"


# ------------------------------------------------------------------------------ cli ---
def test_script_argv_modes():
    assert cli.script_argv(["blender", "-b", "-P", "x.py", "--", "--clip", "turn"]) == ["--clip", "turn"]
    assert cli.script_argv(["tools/blender/x.py", "--clip", "turn"]) == ["--clip", "turn"]
    assert cli.script_argv(["tools/blender/x.py", "--", "--clip", "turn"]) == ["--clip", "turn"]
    assert cli.script_argv(["blender", "-b", "--factory-startup", "-P", "x.py"]) == []
    assert cli.script_argv(["blender", "-b", "rig.blend", "-P", "x.py", "--", "a.json"]) == ["a.json"]
    # plain python: a later `--` is argparse's end-of-options marker, never a cut point
    assert cli.script_argv(["tools/blender/x.py", "--glb", "r.glb", "--", "a.json"]) == ["--glb", "r.glb", "--", "a.json"]
    # runpy.run_path swaps argv[0] for the script path; Blender's flags still mark the binary layout
    assert cli.script_argv(["tools/blender/x.py", "-b", "--factory-startup", "-P", "tools/blender/x.py", "--", "--help"]) == ["--help"]


def test_clear_work_dir_only_touches_render_scratch():
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        for n in ("raw_0001.png", "qa_next.png", "meta.json", "keep.txt"):
            (d / n).write_text("x")
        (d / "sub").mkdir()
        assert cli.clear_work_dir(d) == 3
        assert sorted(p.name for p in d.iterdir()) == ["keep.txt", "sub"]
        cli.clear_work_dir(d, remove_dir=True)          # not empty -> folder kept
        assert d.is_dir()


# --------------------------------------------------------------------------- easing ---
def test_ease_parsing():
    assert easing.parse_ease("BACK_OUT") == {"interpolation": "BACK", "easing": "EASE_OUT"}
    assert easing.parse_ease("sine_in_out")["easing"] == "EASE_IN_OUT"
    assert easing.parse_ease("OVERSHOOT")["interpolation"] == "BACK"
    assert easing.parse_ease("HOLD")["interpolation"] == "CONSTANT"
    e = easing.parse_ease({"type": "ELASTIC", "dir": "OUT", "amplitude": 0.5, "period": 3})
    assert e["interpolation"] == "ELASTIC" and e["amplitude"] == 0.5 and e["period"] == 3
    try:
        easing.parse_ease("WOBBLE")
        raise AssertionError("unknown ease accepted")
    except easing.EaseError:
        pass


def test_ease_shapes():
    # BACK_OUT overshoots the target, BOUNCE_OUT ends exactly on it, QUAD_IN starts slow
    assert max(easing.evaluate("BACK_OUT", t / 100) for t in range(101)) > 1.05
    assert abs(easing.evaluate("BOUNCE_OUT", 1.0) - 1.0) < 1e-9
    assert easing.evaluate("QUAD_IN", 0.25) < 0.25 < easing.evaluate("QUAD_OUT", 0.25)
    assert min(easing.evaluate("ANTICIPATE", t / 100) for t in range(101)) < -0.05


# ------------------------------------------------------------------------- animspec ---
def test_example_clip_normalises():
    spec, warnings = animspec.load([EXAMPLE])
    clip = spec["clips"][0]
    assert clip["name"] == "celebrate_test" and clip["loop"] and clip["length"] == 40
    assert any("not a canonical clip" in w for w in warnings)
    for t in clip["tracks"]:
        assert t["keys"][0]["f"] == 0 and t["keys"][-1]["f"] == 40, t
        assert t["keys"][-1]["v"] == t["keys"][0]["v"], "loop closure"
    arms = [t for t in clip["tracks"] if t.get("bone") in ("UpperArm.L", "LowerArm.L")]
    assert [t["offset"] for t in arms] == [0.0, 2.0], "chain offsetStep"
    low = next(t for t in arms if t["bone"] == "LowerArm.L")
    up = next(t for t in arms if t["bone"] == "UpperArm.L")
    assert abs(low["keys"][2]["v"][1] - up["keys"][2]["v"][1] * 0.45) < 1e-9, "chain falloff"
    hips = next(t for t in clip["tracks"] if t.get("bone") == "Hips" and t["channel"] == "loc")
    frames = [k["f"] for k in hips["keys"]]
    assert 16.0 in frames and 13.0 in frames, "hold expands to a second key"


def _spec(**clip):
    base = {"name": "idle", "loop": True, "length": 150,
            "tracks": [{"bone": "b", "channel": "rot", "keys": [{"f": 0, "v": [0, 0, 0]}, {"f": 20, "v": [5, 0, 0]}]}]}
    base.update(clip)
    return {"version": 1, "fps": 30, "clips": [base]}


def _raises(raw, text):
    try:
        animspec.normalise(raw)
    except animspec.SpecError as e:
        assert text in str(e), str(e)
        return
    raise AssertionError(f"expected SpecError containing {text!r}")


def test_spec_errors():
    _raises(_spec(name="idle_loop"), "research alias")
    bad = _spec()
    bad["clips"][0]["tracks"][0]["keys"].append({"f": 150, "v": [1, 0, 0]})
    _raises(bad, "must end on its first value")
    bad = _spec()
    bad["clips"][0]["tracks"][0]["keys"][1]["f"] = 0
    _raises(bad, "strictly increasing")
    bad = _spec()
    bad["clips"][0]["tracks"].append({"bone": "b", "channel": "squash", "keys": [{"f": 0, "v": 1}]})
    bad["clips"][0]["tracks"].append({"bone": "b", "channel": "scale", "keys": [{"f": 0, "v": 1}]})
    _raises(bad, "duplicate track")
    _raises({"clips": [{"name": "Bad Name", "length": 3, "tracks": []}]}, "anim.schema.json")


def test_offset_cannot_move_keys_outside_the_clip():
    for off in (-5, 5):
        raw = {"clips": [{"name": "react_small", "length": 40, "tracks": [{"bone": "b", "channel": "rot", "offset": off,
               "keys": [{"f": 0, "v": [0, 0, 0]}, {"f": 38, "v": [1, 0, 0]}]}]}]}
        try:
            animspec.normalise(raw)
        except animspec.SpecError:
            continue
        raise AssertionError(f"offset {off} accepted")


def test_canonical_windows_warn_or_fail():
    spec, warnings = animspec.normalise(_spec(length=60))       # idle must be 4-6 s
    assert any("outside 4.0-6.0s" in w for w in warnings)
    try:
        animspec.normalise(_spec(length=60), strict=True)
        raise AssertionError("strict should fail")
    except animspec.SpecError:
        pass
    _, w2 = animspec.normalise(_spec(length=150))
    assert not w2


# ----------------------------------------------------------------------- provenance ---
def test_manifest_rows_validate():
    row = provenance.make_row(id="frames.l2_turn.deadbeef", path="build/frames/L2_turn/", stage="3d-render",
                              sha256="a" * 64, model="blender-5.2.2", version="bpy 5.2.2 LTS")
    assert provenance.validate_rows([row]) == []
    bad = dict(row, stage="rendering", sha256="xyz")
    errs = provenance.validate_rows([bad])
    assert any("stage" in e for e in errs) and any("sha256" in e for e in errs)


def test_sidecar_is_idempotent():
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "m.json"
        r1 = provenance.make_row(id="x.y.12345678", path="a", stage="qa", sha256="b" * 64, model="m", version="v",
                                 date="2026-01-01T00:00:00Z")
        provenance.write_sidecar(p, [r1], "test")
        first = p.read_text()
        r2 = dict(r1, date="2027-01-01T00:00:00Z")
        provenance.write_sidecar(p, [r2], "test")
        assert p.read_text() == first, "date kept for an identical id+sha256"


def test_digest_order_invariant():
    with tempfile.TemporaryDirectory() as d:
        a, b = Path(d) / "a.png", Path(d) / "b.png"
        a.write_bytes(b"1")
        b.write_bytes(b"2")
        assert provenance.digest_files([a, b], Path(d)) == provenance.digest_files([b, a], Path(d))


# ------------------------------------------------------------------------- imgtools ---
def _disc(size, r, cx=None, cy=None, hole=0.0):
    yy, xx = np.mgrid[0:size, 0:size]
    cx = size / 2 if cx is None else cx
    cy = size / 2 if cy is None else cy
    d = np.hypot(xx + 0.5 - cx, yy + 0.5 - cy)
    a = np.zeros((size, size, 4), np.uint8)
    m = (d <= r) & (d >= hole)
    a[m] = (200, 50, 50, 255)
    return a


def test_hull_width_measures_ring():
    nohull = _disc(128, 30)
    hull = _disc(128, 34)
    hull[_disc(128, 30)[..., 3] > 0] = (200, 50, 50, 255)
    w = imgtools.hull_width(hull, nohull)
    assert 3.5 <= w["median"] <= 4.5, w


def test_holes_and_bleed():
    ring = _disc(96, 30, hole=10)                  # an 'O'
    holes = imgtools.enclosed_holes(imgtools.mask(ring))
    assert len(holes) == 1
    filled = _disc(96, 30)                         # hull closed the counter
    assert imgtools.hull_bleed(filled, ring)["closed"] == 1
    assert imgtools.hull_bleed(ring, ring)["closed"] == 0


def test_premult_downscale_has_no_dark_fringe():
    from PIL import Image
    a = np.zeros((64, 64, 4), np.uint8)
    a[:, :32] = (255, 255, 0, 255)                 # opaque yellow | transparent black
    small = np.asarray(imgtools.downscale_premult(Image.fromarray(a), 16))
    edge = small[:, 7:9]
    vis = edge[edge[..., 3] > 20]
    assert (vis[:, 0] > 240).all() and (vis[:, 1] > 240).all(), "colour kept on the alpha edge"


def test_mad_and_bounds():
    a = _disc(64, 20)
    assert imgtools.mad(a, a) == 0.0
    assert not imgtools.edge_touch(imgtools.mask(a))
    assert imgtools.edge_touch(imgtools.mask(_disc(64, 40)))


# -------------------------------------------------------------------------- palette ---
def test_palette_helpers():
    assert palette.derive_bands("#FFC629")["deep"] == "#9A4A0C"
    b = palette.derive_bands("#F1C81C")
    assert b["lit"] == "#F1C81C" and b["mid"] != b["deep"]
    assert abs(palette.linear_to_srgb(palette.srgb_to_linear(0.5)) - 0.5) < 1e-9
    assert palette.cell_scale("L2", "royal") == 0.86
    assert palette.cell_scale("S", "scatter") == 1.12
    assert palette.cell_scale("H1", "high") == 0.97
    bible = palette.load_artbible()
    assert palette.symbol_info(bible, "K")["id"] == "L2"
    assert palette.symbol_info(bible, "10")["id"] == "L5"


def test_kmeans_deterministic():
    rng = np.random.RandomState(0)
    X = np.concatenate([rng.normal(0, 0.1, (200, 3)), rng.normal(5, 0.1, (50, 3))])
    c1, l1 = palette.kmeans(X, 2, seed=3)
    c2, l2 = palette.kmeans(X, 2, seed=3)
    assert np.array_equal(l1, l2) and np.allclose(c1, c2)
    assert sorted(np.bincount(l1).tolist()) == [50, 200]


def main():
    tests = [(k, v) for k, v in globals().items() if k.startswith("test_") and callable(v)]
    failed = 0
    for name, fn in tests:
        try:
            fn()
            print(f"ok   {name}")
        except Exception:  # noqa: BLE001
            failed += 1
            print(f"FAIL {name}")
            traceback.print_exc()
    print(f"{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
