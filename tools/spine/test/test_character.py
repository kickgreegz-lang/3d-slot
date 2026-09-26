#!/usr/bin/env python3
"""Unit tests for the 2D character path of tools/spine (spinegen/acting.py + spinegen/character.py).

    python tools/spine/test/test_character.py        (stdlib unittest; needs tools/requirements-spine.txt)

Covers: easing on arrays, the Hermite key fitter against spine-core's 10-piece bezier evaluation,
loop-exact presets, IK bend sign, facing mirroring, FK reach, the demo rigs (budgets, contract
clip lengths and event frames, overlays with zero deltas, face clips, determinism), and schema
typos that must fail loudly instead of generating defaults.
"""
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

import numpy as np

HERE = Path(__file__).resolve().parent
SPINE = HERE.parent
DEMO = SPINE / "examples" / "character_demo"
sys.path.insert(0, str(SPINE))

from spinegen import acting, easing  # noqa: E402
from spinegen.character import CharacterBuilder  # noqa: E402
from spinegen.rig import RigError, dump  # noqa: E402

CONTRACT = json.loads((SPINE / "contract.json").read_text())
_CACHE: dict[str, dict] = {}


def build(char: str, rig: Path | None = None) -> tuple[dict, CharacterBuilder]:
    key = str(rig or char)
    if key not in _CACHE:
        with tempfile.TemporaryDirectory() as t:
            cb = CharacterBuilder(rig or DEMO / char / "rig.yaml", out_path=Path(t) / f"chr_{char}.json")
            _CACHE[key] = (cb.build(), cb)
    return _CACHE[key]


def spine_eval(keys: list[dict], fps: int, ch: str, t: float) -> float:
    """Evaluate a 1-channel Spine timeline the way spine-core does (bezier sampled as 10 linear pieces)."""
    times = [k.get("time", 0.0) for k in keys]
    if t <= times[0]:
        return keys[0][ch]
    for i in range(len(keys) - 1):
        t0, t1 = times[i], times[i + 1]
        if t0 <= t <= t1:
            v0, v1 = keys[i][ch], keys[i + 1][ch]
            c = keys[i].get("curve")
            if c is None:
                return v0 + (v1 - v0) * (t - t0) / (t1 - t0)
            cx1, cy1, cx2, cy2 = c[:4]
            us = np.linspace(0, 1, 11)
            xs = (1 - us) ** 3 * t0 + 3 * (1 - us) ** 2 * us * cx1 + 3 * (1 - us) * us ** 2 * cx2 + us ** 3 * t1
            ys = (1 - us) ** 3 * v0 + 3 * (1 - us) ** 2 * us * cy1 + 3 * (1 - us) * us ** 2 * cy2 + us ** 3 * v1
            return float(np.interp(t, xs, ys))
    return keys[-1][ch]


class Easing(unittest.TestCase):
    def test_ease_vec_matches_scalar(self):
        u = np.linspace(0, 1, 21)
        for name in ("sine_in_out", "expo_out", "back_out", "hold_out", "quad_in"):
            v = acting.ease_vec(name, u)
            for ui, vi in zip(u, v):
                self.assertAlmostEqual(vi, easing.bezier_eval(name, float(ui)), places=4)
        self.assertEqual(list(acting.ease_vec("stepped", np.array([0.0, 0.5, 1.0]))), [0.0, 0.0, 1.0])


class Fitter(unittest.TestCase):
    def test_fit_reproduces_signal_on_the_runtime_curve(self):
        from spinegen.timeline import Anim
        F, fps = 48, 30
        sig = acting.Sig(F, loop=False)
        t = sig.t
        y = 12 * np.sin(2 * np.pi * t / F) * np.exp(-t / 30) + 8 * acting.ease_vec("expo_out", (t - 20) / 4) * (t >= 20)
        a = Anim("t", fps, F)
        acting.emit_track(a.bone("b", "rotate"), [y], [0.2], F, fps, {20})
        keys = a.to_json()["bones"]["b"]["rotate"]
        self.assertLess(len(keys), F // 2, "the fitter must reduce keys")
        worst = max(abs(spine_eval(keys, fps, "value", float(ti) / fps) - float(yi)) for ti, yi in zip(t, y))
        self.assertLess(worst, 0.2 + 1e-3)
        self.assertIn(20, [round(k.get("time", 0) * fps) for k in keys], "a `must` frame is always a key")

    def test_loop_presets_are_periodic_and_start_at_rest(self):
        rig = build("gumbo")[1]._acting_rig()
        for spec in ({"preset": "sway", "chain": ["phys_tail_1", "phys_tail_2"], "amount": 5, "cycles": 2, "lag": 4},
                     {"preset": "weight_shift", "amount": 10, "cycles": 1},
                     {"preset": "nod", "every": 12, "amount": 6},
                     {"preset": "breathe", "cycles": 2},
                     {"preset": "tremble", "bone": "head", "amount": 1}):
            sig = acting.Sig(48, loop=True)
            acting.PRESETS[spec["preset"]](sig, rig, spec, spec["preset"])
            for (bone, ch), arr in sig.ch.items():
                self.assertAlmostEqual(arr[0], arr[-1], places=6, msg=f"{spec['preset']} {bone}.{ch} not periodic")
                self.assertAlmostEqual(arr[0], 1.0 if ch in ("sx", "sy") else 0.0, places=6, msg=f"{spec['preset']} {bone}.{ch} does not start at rest")

    def test_whole_cycles_required_in_loops(self):
        rig = build("gumbo")[1]._acting_rig()
        with self.assertRaises(acting.ActingError):
            acting.p_nod(acting.Sig(50, True), rig, {"preset": "nod", "every": 18}, "nod")
        with self.assertRaises(acting.ActingError):
            acting.p_sway(acting.Sig(50, True), rig, {"preset": "sway", "bone": "head", "cycles": 1.5}, "sway")

    def test_jolt_returns_to_rest(self):
        rig = build("gumbo")[1]._acting_rig()
        sig = acting.Sig(36, False)
        acting.p_jolt(sig, rig, {"preset": "jolt", "at": 10, "x": -24}, "jolt")
        x = sig.ch[("hips", "x")]
        self.assertAlmostEqual(x[0], 0.0)
        self.assertAlmostEqual(x[-1], 0.0, places=6)
        self.assertAlmostEqual(float(x.min()), -24.0, delta=0.5)


class Kinematics(unittest.TestCase):
    def test_ik_bend_sign_rule(self):
        # spine-core: bendPositive reproduces the setup knee iff cross(knee - hip, ankle - knee) > 0 (y up)
        doc, cb = build("gumbo")
        for c in doc["constraints"]:
            if c["type"] != "ik":
                continue
            p, ch = (cb.bones[b] for b in c["bones"])
            r = math.radians(ch.wrot)
            ex, ey = ch.wx + ch.length * math.cos(r), ch.wy + ch.length * math.sin(r)
            cross = (ch.wx - p.wx) * (ey - ch.wy) - (ch.wy - p.wy) * (ex - ch.wx)
            self.assertEqual(c.get("bendPositive", True), cross > 0, c["name"])

    def test_reach_puts_the_wrist_on_the_point(self):
        cb = build("gumbo")[1]
        rig = cb._acting_rig()
        acting.prepare(rig)
        pose = acting.parse_pose(rig, {"reach": {"hand_R": [560, 330]}}, "t", rig.stance)
        W = acting.fk(rig, None, 0, ["hand_R"], override=pose.ch)
        self.assertLess(np.hypot(*(W["hand_R"][1] - np.array(cb.img2sk(560, 330)))), 0.5)

    def test_stance_fk_matches_ik(self):
        cb = build("gumbo")[1]
        rig = cb._acting_rig()
        acting.prepare(rig)
        st = rig.poses[rig.stance]
        W = acting.fk(rig, None, 0, ["forearm_L", "ik_hand_L"], override=st.ch)
        L, T = W["forearm_L"]
        tip = T + L @ np.array([rig.bones["forearm_L"].length, 0.0])
        self.assertLess(np.hypot(*(tip - W["ik_hand_L"][1])), 0.5)

    def test_facing_mirrors_rotations(self):
        g, _ = build("gumbo")
        c, _ = build("croak")
        # both rigs author "bow forward" as a negative facing-normalised rot: on screen it is
        # clockwise for Gumbo (faces right) and counter-clockwise for Croak (faces left)
        gb = g["animations"]["bass_drop"]["bones"]["spine"]["rotate"]
        cb = c["animations"]["bass_drop_charge"]["bones"]["spine"]["rotate"]
        self.assertLess(min(k["value"] for k in gb), -5)
        self.assertGreater(max(k["value"] for k in cb), 5)


class DemoRigs(unittest.TestCase):
    def test_budgets_proportions_and_constraints(self):
        CC = CONTRACT["characters"]
        for char in ("gumbo", "croak"):
            doc, cb = build(char)
            st = cb.report.stats
            self.assertLessEqual(st["bones"], CC["budgets"]["bones"])
            self.assertLessEqual(st["slots"], CC["budgets"]["slots"])
            self.assertLessEqual(st["meshVertices"], CC["budgets"]["meshVertices"])
            self.assertLessEqual(st["physics"], CC["budgets"]["physics"])
            self.assertLessEqual(st["proportions"]["headFraction"], CC["proportions"]["headMax"])
            names = [b["name"] for b in doc["bones"]]
            self.assertEqual(names[0], "root")
            for req in CC["requiredBones"]:
                self.assertIn(req, names)
            types = [c["type"] for c in doc["constraints"]]
            self.assertEqual(types, sorted(types, key=["ik", "transform", "path", "physics", "slider"].index))
            look = next(c for c in doc["constraints"] if c["name"] == "look")
            self.assertEqual((look["source"], look["bones"]), ("ctrl_look", ["head"]))
            for c in doc["constraints"]:
                if c["type"] == "physics":
                    self.assertGreaterEqual(c["limit"], CC["physics"]["minLimit"])

    def test_contract_clips_lengths_and_events(self):
        for char in ("gumbo", "croak"):
            doc, _ = build(char)
            spec = CONTRACT["characters"]["rigs"][f"chr_{char}"]["clips"]
            for name, rule in spec.items():
                a = doc["animations"][name]
                end = 0.0
                for group in ("bones", "slots"):
                    for tls in a.get(group, {}).values():
                        for keys in tls.values():
                            end = max(end, max(k.get("time", 0) for k in keys))
                for keys in a.get("ik", {}).values():
                    end = max(end, max(k.get("time", 0) for k in keys))
                self.assertAlmostEqual(end * 30, rule["frames"], places=2, msg=f"{char} {name}")
                got = {(round(e.get("time", 0) * 30), e["name"], e.get("string")) for e in a.get("events", [])}
                for ev in rule.get("events", []):
                    self.assertIn((ev["frame"], ev["name"], ev.get("string")), got, f"{char} {name}")

    def test_overlays_are_zero_deltas_and_face_clips_key_no_body_bones(self):
        for char in ("gumbo", "croak"):
            doc, _ = build(char)
            spec = CONTRACT["characters"]["rigs"][f"chr_{char}"]["clips"]
            for name, rule in spec.items():
                a = doc["animations"][name]
                if rule["track"] == 1:
                    for bone, tls in a.get("bones", {}).items():
                        for kind, keys in tls.items():
                            for k in (keys[0], keys[-1]):
                                neutral = 1.0 if kind == "scale" else 0.0
                                for ch in ("value", "x", "y"):
                                    if ch in k:
                                        self.assertAlmostEqual(k[ch], neutral, places=3, msg=f"{char} {name} {bone}.{kind}")
                if rule["track"] == 2:
                    self.assertFalse([b for b in a.get("bones", {}) if not b.startswith("face_")], f"{char} {name}")

    def test_deterministic(self):
        with tempfile.TemporaryDirectory() as t:
            a = dump(CharacterBuilder(DEMO / "croak" / "rig.yaml", out_path=Path(t) / "a.json").build())
            b = dump(CharacterBuilder(DEMO / "croak" / "rig.yaml", out_path=Path(t) / "a.json").build())
        self.assertEqual(a, b)

    def test_gen_cli_check(self):
        py = sys.executable
        with tempfile.TemporaryDirectory() as t:
            out = Path(t) / "chr_gumbo.json"
            cmd = [py, str(SPINE / "gen.py"), str(DEMO / "gumbo" / "rig.yaml"), "-o", str(out), "--quiet"]
            r = subprocess.run(cmd, capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(subprocess.run(cmd + ["--check"], capture_output=True).returncode, 0)
            out.write_text(out.read_text().replace('"fps": 30', '"fps": 24'))
            self.assertEqual(subprocess.run(cmd + ["--check"], capture_output=True).returncode, 1)


class Schema(unittest.TestCase):
    def mutate(self, old: str, new: str) -> None:
        with tempfile.TemporaryDirectory() as t:
            td = Path(t)
            shutil.copytree(DEMO / "gumbo", td / "gumbo", ignore=shutil.ignore_patterns("images"))
            (td / "gumbo" / "images").symlink_to(DEMO / "gumbo" / "images")
            rig = td / "gumbo" / "rig.yaml"
            text = rig.read_text()
            self.assertIn(old, text)
            rig.write_text(text.replace(old, new, 1))
            with self.assertRaises((RigError, ValueError)):
                CharacterBuilder(rig, out_path=td / "x.json").build()

    def test_typos_and_contract_mismatches_fail_loudly(self):
        cases = [
            ("tempo: 0.92", "tempo: 0.92\nfacng: right"),                                  # unknown top-level key
            ("hips: {y: -8}", "hips: {yy: -8}"),                                           # unknown pose channel
            ("spine: {rot: -2}", "spyne: {rot: -2}"),                                      # unknown bone in a pose
            ("attach: {hand_L: lean,", "attach: {hand_L: leen,"),                          # unknown attachment
            ("{preset: breathe, cycles: 2, amount: 0.03,", "{preset: breathe, cycles: 2, amont: 0.03,"),  # unknown preset param
            ("{preset: flick, bone: toothpick, at: 96", "{preset: flik, bone: toothpick, at: 96"),        # unknown preset
            ("  blink:                         # track 2: closed f1-f3\n    track: 2",
             "  blink:                         # track 2: closed f1-f3\n    frames: 7\n    track: 2"),   # length != ANIMATION_SET
            ("  fs_end:                        # nod + two-finger salute\n",
             "  fs_endd:                       # nod + two-finger salute\n"),                         # required clip missing
            ("  win_big:                       # slams the cooler lid at f24 with the right fist, lid bounces, roar\n",
             "  win_big:                       # slams the cooler lid at f24 with the right fist, lid bounces, roar\n    events: [{name: sfx, string: cooler_slam, at: 22}]\n"),  # event off its frame
            ("  - {bone: phys_belly, preset: default,", "  - {bone: phys_bellly, preset: default,"),        # physics on a missing bone
        ]
        for old, new in cases:
            with self.subTest(new=new[:60]):
                self.mutate(old, new)


if __name__ == "__main__":
    unittest.main(verbosity=2)
