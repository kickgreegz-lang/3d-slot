"""Claude-written animation clip JSON: validation + normalisation (no bpy).

Schema: tools/blender/anim.schema.json (structure) + the semantic rules below. Documented with
an example in tools/blender/README.md. build_actions.py turns a normalised spec into Actions.

Semantic rules enforced here:
  * clip names are snake_case; non-canonical names (ANIMATION_CONTRACT §7.2) warn, research
    aliases (idle_loop, win_small, ...) are errors that name the canonical clip;
  * canonical clips must match the contract's loop flag and length window (warning; error
    with strict=True);
  * keys are integer or fractional frames in [0, length], strictly increasing after holds;
  * loop clips: every track ends on its first value at `length` (added automatically when the
    last key is missing; a different explicit value is an error);
  * `offset` shifts a track in time (overlap / follow-through); on loops it wraps around;
  * `chain` expands into one track per bone with offsetStep * i frames and falloff^i amplitude.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

from . import easing
from .cli import TOOLS_BLENDER, ToolError
from .provenance import validate as schema_validate

SCHEMA_PATH = TOOLS_BLENDER / "anim.schema.json"
CHANNELS = ("rot", "loc", "scale", "squash", "morph")
SPACES = ("world", "local")

# ANIMATION_CONTRACT §7.2 (seconds). None = no window enforced ([planned] extended clips).
CANONICAL = {
    "idle": (True, 4.0, 6.0),
    "idle_bored": (True, 4.0, 8.0),
    "anticipation": (True, 1.0, 2.0),
    "react_small": (False, 1.2, 2.0),
    "win_big": (False, 1.5, 2.5),
    "celebrate": (True, 2.0, 4.0),
    "fs_trigger": (False, 2.0, 3.0),
    "fs_end": (False, 1.5, 2.5),
}
EXTENDED = {"idle_fidget_01", "idle_fidget_02", "idle_fidget_03", "blink_add", "breathe_add", "look_add",
            "react_reel_stop", "react_near_miss", "win_big_outro", "freespins_idle", "intro_drop"}
ALIASES = {"idle_loop": "idle", "anticipation_loop": "anticipation", "win_small": "react_small",
           "win_big_intro": "win_big", "win_big_loop": "celebrate", "bonus_trigger": "fs_trigger"}


class SpecError(ToolError):
    """Invalid animation JSON (clean message, exit code 1)."""


def _vec(v, n, where):
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return [float(v)] * n if n > 1 else float(v)
    if isinstance(v, list) and len(v) == n and all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in v):
        if not all(math.isfinite(x) for x in v):
            raise SpecError(f"{where}: non-finite value")
        return [float(x) for x in v]
    raise SpecError(f"{where}: expected {'a number' if n == 1 else f'{n} numbers'}, got {v!r}")


def _norm_value(channel, v, where):
    if channel in ("rot", "loc"):
        if not isinstance(v, list):
            raise SpecError(f"{where}: {channel} needs [x, y, z]")
        return _vec(v, 3, where)
    if channel == "scale":
        return _vec(v, 3, where)
    val = _vec(v, 1, where)
    if channel == "squash" and val <= 0:
        raise SpecError(f"{where}: squash must be > 0")
    if not math.isfinite(val):
        raise SpecError(f"{where}: non-finite value")
    return val


def _scale_value(channel, v, k):
    """Amplitude falloff for chains: rot/loc scale toward 0, scale/squash toward 1."""
    if channel in ("rot", "loc"):
        return [x * k for x in v]
    if channel == "scale":
        return [1 + (x - 1) * k for x in v]
    if channel == "squash":
        return 1 + (v - 1) * k
    return v * k


def _same(a, b, tol=1e-6):
    if isinstance(a, list):
        return all(abs(x - y) <= tol for x, y in zip(a, b))
    return abs(a - b) <= tol


def load(paths, strict: bool = False) -> tuple[dict, list[str]]:
    """Load one or more clip files -> (merged normalised spec, warnings)."""
    specs = []
    for p in paths:
        p = Path(p)
        try:
            specs.append((p, json.loads(p.read_text())))
        except json.JSONDecodeError as e:
            raise SpecError(f"{p}: invalid JSON: {e}") from e
    merged, warnings = None, []
    for p, raw in specs:
        spec, w = normalise(raw, source=str(p), strict=strict)
        warnings += w
        if merged is None:
            merged = spec
        else:
            if spec["fps"] != merged["fps"]:
                raise SpecError(f"{p}: fps {spec['fps']} differs from {merged['fps']} (one fps per export)")
            names = {c["name"] for c in merged["clips"]}
            dup = [c["name"] for c in spec["clips"] if c["name"] in names]
            if dup:
                raise SpecError(f"{p}: clip(s) defined twice: {', '.join(dup)}")
            merged["clips"] += spec["clips"]
            merged["sources"] += spec["sources"]
    if merged is None:
        raise SpecError("no animation files given")
    return merged, warnings


def normalise(raw: dict, source: str = "<json>", strict: bool = False) -> tuple[dict, list[str]]:
    schema = json.loads(SCHEMA_PATH.read_text())
    errs = schema_validate(raw, schema)
    if errs:
        raise SpecError(f"{source}: does not match anim.schema.json:\n  " + "\n  ".join(errs[:25]))
    warnings: list[str] = []
    fps = int(raw.get("fps", 30))
    if fps != 30:
        warnings.append(f"{source}: fps {fps} (the contract authors everything at 30 fps)")
    defaults = raw.get("defaults", {})
    clips = []
    for ci, c in enumerate(raw["clips"]):
        where = f"{source}: clips[{ci}] '{c.get('name')}'"
        name = c["name"]
        if name in ALIASES:
            raise SpecError(f"{where}: '{name}' is a research alias; use the canonical '{ALIASES[name]}'")
        length = c["length"]
        loop = bool(c.get("loop", False))
        if name in CANONICAL:
            want_loop, lo, hi = CANONICAL[name]
            secs = length / fps
            msg = []
            if loop != want_loop:
                msg.append(f"loop must be {want_loop}")
            if not (lo - 1e-9 <= secs <= hi + 1e-9):
                msg.append(f"length {secs:.2f}s outside {lo}-{hi}s")
            if msg:
                (_raise if strict else warnings.append)(f"{where}: " + "; ".join(msg))
        elif name not in EXTENDED:
            warnings.append(f"{where}: not a canonical clip name (ANIMATION_CONTRACT §7.2); the runtime will not play it")
        base = c.get("base")
        if isinstance(base, str):
            base = None if base == "rest" else {"action": base, "frame": 0}
        tracks = []
        seen = set()
        raw_tracks = []
        for ti, t in enumerate(c["tracks"]):
            if "chain" in t:
                step = float(t.get("offsetStep", 2))
                fall = float(t.get("falloff", 1.0))
                for i, bone in enumerate(t["chain"]):
                    tt = {k: v for k, v in t.items() if k not in ("chain", "offsetStep", "falloff")}
                    tt["bone"] = bone
                    tt["offset"] = float(t.get("offset", 0)) + step * i
                    tt["_amp"] = fall ** i
                    raw_tracks.append((f"tracks[{ti}].chain[{i}]", tt))
            else:
                raw_tracks.append((f"tracks[{ti}]", t))
        for tw, t in raw_tracks:
            tw = f"{where} {tw}"
            channel = t.get("channel", "morph" if "morph" in t else None)
            if channel not in CHANNELS:
                raise SpecError(f"{tw}: channel must be one of {CHANNELS}")
            if channel == "morph":
                target = ("morph", t.get("mesh"), t["morph"])
            else:
                if "bone" not in t:
                    raise SpecError(f"{tw}: bone tracks need 'bone' (or use 'chain')")
                target = ("bone", t["bone"], "scale" if channel == "squash" else channel)
            if target in seen:
                raise SpecError(f"{tw}: duplicate track for {target}")
            seen.add(target)
            space = t.get("space", defaults.get("space", "world"))
            if space not in SPACES:
                raise SpecError(f"{tw}: space must be one of {SPACES}")
            amp = t.get("_amp", 1.0)
            keys = []
            for ki, k in enumerate(t["keys"]):
                kw = f"{tw}.keys[{ki}]"
                f = float(k["f"])
                if f < 0 or f > length:
                    raise SpecError(f"{kw}: frame {f} outside 0..{length}")
                v = _norm_value(channel, k["v"], kw)
                if amp != 1.0:
                    v = _scale_value(channel, v, amp)
                try:
                    ease = easing.parse_ease(k.get("ease", defaults.get("ease", "BEZIER")))
                except easing.EaseError as e:
                    raise SpecError(f"{kw}: {e}") from e
                hold = float(k.get("hold", 0))
                if hold < 0:
                    raise SpecError(f"{kw}: hold must be >= 0")
                keys.append({"f": f, "v": v, "ease": ease, "hold": hold})
            # expand holds, check ordering
            exp = []
            for k in keys:
                exp.append({"f": k["f"], "v": k["v"], "ease": k["ease"]})
                if k["hold"] > 0:
                    exp.append({"f": k["f"] + k["hold"], "v": k["v"], "ease": easing.parse_ease("CONSTANT"),
                                "hold_end": True})
            for a, b in zip(exp, exp[1:]):
                if b["f"] <= a["f"]:
                    raise SpecError(f"{tw}: keys (after holds) must be strictly increasing: {a['f']} then {b['f']}")
            if exp[-1]["f"] > length:
                raise SpecError(f"{tw}: hold runs past the clip end ({exp[-1]['f']} > {length})")
            if exp[0]["f"] > 0:   # hold the first value from frame 0
                exp.insert(0, {"f": 0.0, "v": exp[0]["v"], "ease": easing.parse_ease("CONSTANT")})
            if loop:
                if abs(exp[-1]["f"] - length) < 1e-9:
                    if not _same(exp[-1]["v"], exp[0]["v"]):
                        raise SpecError(f"{tw}: loop clip must end on its first value at frame {length}")
                else:
                    exp.append({"f": float(length), "v": exp[0]["v"],
                                "ease": easing.parse_ease(t.get("loopEase", defaults.get("ease", "BEZIER")))})
            offset = float(t.get("offset", 0))
            if offset and not loop:
                exp = [{**k, "f": k["f"] + offset} for k in exp]
                if exp[-1]["f"] > length + 1e-9:
                    raise SpecError(f"{tw}: offset {offset} pushes keys past the clip end ({exp[-1]['f']} > {length})")
                if exp[0]["f"] > 0:
                    exp.insert(0, {"f": 0.0, "v": exp[0]["v"], "ease": easing.parse_ease("CONSTANT")})
            tracks.append({
                "kind": target[0], "bone": t.get("bone"), "mesh": t.get("mesh"), "morph": t.get("morph"),
                "channel": channel, "space": space, "offset": offset if loop else 0.0,
                "keys": exp,
            })
        clips.append({"name": name, "loop": loop, "length": length, "base": base, "tracks": tracks,
                      "notes": c.get("notes")})
    return {"version": raw.get("version", 1), "fps": fps, "rig": raw.get("rig"), "clips": clips,
            "sources": [source]}, warnings


def _raise(msg):
    raise SpecError(msg)
