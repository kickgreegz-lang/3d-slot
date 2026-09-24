"""Named easing presets for Claude-written animation JSON -> Blender keyframe settings. No bpy.

Semantics (documented in tools/blender/README.md): a key's `ease` describes how the motion
ARRIVES at that key (GSAP-style `to()` semantics). Blender stores interpolation on the
keyframe that STARTS a segment, so build_actions.py writes the preset onto the previous
keyframe point. The first key's ease is ignored.

Preset grammar:  <TYPE>[_IN|_OUT|_IN_OUT]   or an alias, or an object
    {"type": "BACK", "dir": "OUT", "back": 2.2}
    {"type": "ELASTIC", "dir": "OUT", "amplitude": 0.8, "period": 4.0}
TYPE in CONSTANT LINEAR BEZIER SINE QUAD CUBIC QUART QUINT EXPO CIRC BACK BOUNCE ELASTIC.
"""
from __future__ import annotations

import math

TYPES = ("CONSTANT", "LINEAR", "BEZIER", "SINE", "QUAD", "CUBIC", "QUART", "QUINT", "EXPO",
         "CIRC", "BACK", "BOUNCE", "ELASTIC")
DYNAMIC = ("BACK", "BOUNCE", "ELASTIC")
DIRS = {"IN": "EASE_IN", "OUT": "EASE_OUT", "IN_OUT": "EASE_IN_OUT", "AUTO": "AUTO"}

# Acting vocabulary -> preset (so clip JSON reads like an animator's notes).
ALIASES = {
    "STEP": "CONSTANT",
    "HOLD": "CONSTANT",
    "SMOOTH": "SINE_IN_OUT",
    "EASE": "BEZIER",
    "ANTICIPATE": "BACK_IN",      # wind-up: dips the other way before leaving
    "OVERSHOOT": "BACK_OUT",      # pops past the key and settles
    "SETTLE": "ELASTIC_OUT",      # wobble into place
    "SNAP": "EXPO_OUT",           # fast start, soft stop
    "DROP": "QUAD_IN",            # gravity fall
    "THUD": "BOUNCE_OUT",         # lands and bounces
}

PRESETS = sorted(
    {"CONSTANT", "LINEAR", "BEZIER"}
    | {f"{t}_{d}" for t in TYPES[3:] for d in ("IN", "OUT", "IN_OUT")}
    | set(TYPES[3:])
    | set(ALIASES)
)


class EaseError(ValueError):
    pass


def parse_ease(spec) -> dict:
    """-> {'interpolation', 'easing', 'back'?, 'amplitude'?, 'period'?}"""
    if spec is None:
        spec = "BEZIER"
    params = {}
    if isinstance(spec, dict):
        t = str(spec.get("type", "")).upper()
        d = str(spec.get("dir", "AUTO")).upper()
        for k in ("back", "amplitude", "period"):
            if k in spec:
                params[k] = float(spec[k])
        name = t if d == "AUTO" else f"{t}_{d}"
    elif isinstance(spec, str):
        name = spec.strip().upper()
    else:
        raise EaseError(f"ease must be a string or object, got {spec!r}")
    name = ALIASES.get(name, name)
    if name in ("CONSTANT", "LINEAR", "BEZIER"):
        return {"interpolation": name, "easing": "AUTO", **params}
    for d in ("_IN_OUT", "_IN", "_OUT"):
        if name.endswith(d):
            t = name[: -len(d)]
            if t not in TYPES:
                break
            return {"interpolation": t, "easing": DIRS[d[1:]], **params}
    if name in TYPES:
        return {"interpolation": name, "easing": "AUTO", **params}
    raise EaseError(f"unknown ease {spec!r}; use one of {', '.join(PRESETS)}")


# Reference implementations (Robert Penner / Blender BLI_easing.c) used by the unit tests
# and by the JSON validator to report overshoot. t in [0,1] -> progress.
def _back_in(t, s=1.70158):
    return t * t * ((s + 1) * t - s)


def _bounce_out(t):
    if t < 1 / 2.75:
        return 7.5625 * t * t
    if t < 2 / 2.75:
        t -= 1.5 / 2.75
        return 7.5625 * t * t + 0.75
    if t < 2.5 / 2.75:
        t -= 2.25 / 2.75
        return 7.5625 * t * t + 0.9375
    t -= 2.625 / 2.75
    return 7.5625 * t * t + 0.984375


_IN = {
    "LINEAR": lambda t: t,
    "SINE": lambda t: 1 - math.cos(t * math.pi / 2),
    "QUAD": lambda t: t * t,
    "CUBIC": lambda t: t ** 3,
    "QUART": lambda t: t ** 4,
    "QUINT": lambda t: t ** 5,
    "EXPO": lambda t: 0.0 if t == 0 else 2 ** (10 * (t - 1)),
    "CIRC": lambda t: 1 - math.sqrt(max(0.0, 1 - t * t)),
    "BACK": _back_in,
    "BOUNCE": lambda t: 1 - _bounce_out(1 - t),
    "ELASTIC": lambda t: 0.0 if t in (0, 1) else -(2 ** (10 * (t - 1))) * math.sin((t - 1.075) * 2 * math.pi / 0.3),
}


def evaluate(spec, t: float) -> float:
    """Progress 0..1 (may overshoot) of the segment eased with `spec` at t in [0,1]."""
    e = parse_ease(spec)
    ip, easing = e["interpolation"], e["easing"]
    if ip == "CONSTANT":
        return 0.0 if t < 1 else 1.0
    if ip == "BEZIER":
        return t * t * (3 - 2 * t)
    f = _IN[ip] if ip in _IN else _IN["LINEAR"]
    if easing == "AUTO":
        easing = "EASE_OUT" if ip in DYNAMIC else "EASE_IN"
    if easing == "EASE_IN":
        return f(t)
    if easing == "EASE_OUT":
        return 1 - f(1 - t)
    return f(2 * t) / 2 if t < 0.5 else 1 - f(2 - 2 * t) / 2
