"""Named easing presets -> Spine 4.3 ABSOLUTE bezier curves.

Spine stores a curve per key as 4 numbers per channel: [cx1, cy1, cx2, cy2] in absolute
time (seconds) and absolute value units (not normalised). Scale/translate/shear keys have
2 channels (8 numbers), rgba 4 channels (16 numbers), alpha/rotate 1 channel (4 numbers).
A 4-number curve on a 2-channel timeline reads undefined -> NaN, so the channel count is
always derived from the timeline type, never typed by hand.

Presets are CSS-style normalised handles (x1, y1, x2, y2); y outside [0, 1] overshoots,
which Spine evaluates fine (the graph editor shows the handle outside the key range).
"""
from __future__ import annotations

import math

# (x1, y1, x2, y2). Sources: easings.net / CSS cubic-bezier equivalents.
PRESETS: dict[str, tuple[float, float, float, float]] = {
    "linear": (0.0, 0.0, 1.0, 1.0),
    "sine_in": (0.12, 0.0, 0.39, 0.0),
    "sine_out": (0.61, 1.0, 0.88, 1.0),
    "sine_in_out": (0.37, 0.0, 0.63, 1.0),
    "quad_in": (0.11, 0.0, 0.5, 0.0),
    "quad_out": (0.5, 1.0, 0.89, 1.0),
    "quad_in_out": (0.45, 0.0, 0.55, 1.0),
    "cubic_in": (0.32, 0.0, 0.67, 0.0),
    "cubic_out": (0.33, 1.0, 0.68, 1.0),
    "cubic_in_out": (0.65, 0.0, 0.35, 1.0),
    "expo_in": (0.7, 0.0, 0.84, 0.0),
    "expo_out": (0.16, 1.0, 0.3, 1.0),
    "circ_out": (0.0, 0.55, 0.45, 1.0),
    "back_in": (0.36, 0.0, 0.66, -0.56),
    "back_out": (0.34, 1.56, 0.64, 1.0),
    "back_in_out": (0.68, -0.6, 0.32, 1.6),
    # animator presets
    "snap": (0.2, 0.9, 0.3, 1.0),          # fast attack, soft landing (impacts, pops)
    "ease": (0.25, 0.1, 0.25, 1.0),        # CSS 'ease'
    "hold_out": (0.8, 0.0, 0.9, 0.3),      # slow start, used for anticipation squeezes
    "smooth": (0.45, 0.0, 0.55, 1.0),      # loop-friendly (zero slope at both keys)
}

# Names that emit special tokens instead of numbers.
SPECIAL = {"linear", "stepped"}


def handles(name: str, overshoot: float | None = None) -> tuple[float, float, float, float]:
    """Normalised handles of a preset. `back_out` / `back_in` accept an overshoot factor s
    (1.70158 == the preset above); anything else ignores it."""
    if name == "back_out" and overshoot is not None:
        # cubic approximation: y1 grows with s (s=1.70158 -> 1.56)
        return (0.34, 1.0 + 0.329 * overshoot, 0.64, 1.0)
    if name == "back_in" and overshoot is not None:
        return (0.36, 0.0, 0.66, -0.329 * overshoot)
    try:
        return PRESETS[name]
    except KeyError as exc:  # pragma: no cover - message path
        known = ", ".join(sorted(list(PRESETS) + ["stepped"]))
        raise ValueError(f"unknown easing preset '{name}' (known: {known})") from exc


def rnd(v: float, nd: int = 4) -> float:
    """Deterministic rounding that never emits -0.0."""
    r = round(float(v), nd)
    return 0.0 if r == 0 else r


def absolute_curve(ease: str, t1: float, t2: float, pairs: list[tuple[float, float]], overshoot: float | None = None):
    """Absolute Spine curve for one key: `pairs` = [(v1, v2)] per channel.

    Returns None for linear (Spine's default), "stepped", or a flat list of 4*len(pairs) numbers.
    """
    if ease is None or ease == "linear":
        return None
    if ease == "stepped":
        return "stepped"
    x1, y1, x2, y2 = handles(ease, overshoot)
    dt = t2 - t1
    out: list[float] = []
    for v1, v2 in pairs:
        dv = v2 - v1
        out += [rnd(t1 + x1 * dt, 5), rnd(v1 + y1 * dv), rnd(t1 + x2 * dt, 5), rnd(v1 + y2 * dv)]
    return out


def bezier_eval(ease: str, u: float) -> float:
    """Evaluate a preset at normalised time u (for tests / previews). Newton on x(t)."""
    if ease in (None, "linear"):
        return u
    if ease == "stepped":
        return 0.0 if u < 1 else 1.0
    x1, y1, x2, y2 = handles(ease)

    def bx(t: float) -> float:
        return 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t * t * x2 + t ** 3

    def by(t: float) -> float:
        return 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t * t * y2 + t ** 3

    lo, hi = 0.0, 1.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if bx(mid) < u:
            lo = mid
        else:
            hi = mid
    return by((lo + hi) / 2)


# ------------------------------------------------------------------------------------------
# Damped spring -> keys at the extrema (physically timed squash/rebound without hand keys)
# ------------------------------------------------------------------------------------------

def spring_extrema(freq_hz: float, zeta: float, x0: float, v0: float = 0.0, count: int = 4) -> list[tuple[float, float]]:
    """Times (s) and displacements of the first `count` extrema of an underdamped spring
    x'' + 2*zeta*w*x' + w^2 x = 0 released from (x0, v0). Used to place squash/rebound keys
    exactly where the runtime's spring would put them (contract: 7.5 Hz, zeta 0.32)."""
    w = 2 * math.pi * freq_hz
    if not (0 < zeta < 1):
        raise ValueError("spring_extrema needs 0 < zeta < 1")
    wd = w * math.sqrt(1 - zeta * zeta)
    a = x0
    b = (v0 + zeta * w * x0) / wd

    def x(t: float) -> float:
        return math.exp(-zeta * w * t) * (a * math.cos(wd * t) + b * math.sin(wd * t))

    # x'(t)=0 -> tan(wd t) = (b*wd - zeta*w*a) / (a*wd + zeta*w*b)
    num = b * wd - zeta * w * a
    den = a * wd + zeta * w * b
    t0 = math.atan2(num, den) / wd
    while t0 <= 1e-9:
        t0 += math.pi / wd
    out = []
    t = t0
    for _ in range(count):
        out.append((t, x(t)))
        t += math.pi / wd
    return out
