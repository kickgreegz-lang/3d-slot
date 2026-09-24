"""Spine 4.3 physics constraint parameters from frequency / damping ratio.

spine-core 4.3 PhysicsConstraint integrates, per fixed step t = 1/fps:
    v += (-offset * strength) * (t / mass);  offset += v * t;  v *= damping ** (60 * t)
so the natural frequency is w = sqrt(strength / mass) and the per-second velocity decay is
damping ** 60. Matching a damped oscillator x'' + 2*zeta*w*x' + w^2 x = 0 gives
    strength = w^2 * mass            damping = exp(-2 * zeta * w / 60)
(ANIMATION_CONTRACT section 2.5: 3.5 Hz, zeta 0.25 -> 484 / 0.833).
"""
from __future__ import annotations

import math


def strength_damping(f_hz: float, zeta: float, mass: float = 1.0) -> tuple[float, float]:
    if f_hz <= 0:
        raise ValueError("physics frequency must be > 0")
    if not (0 <= zeta < 2):
        raise ValueError("physics zeta must be in [0, 2)")
    w = 2 * math.pi * f_hz
    return w * w * mass, math.exp(-2 * zeta * w / 60)


def constraint(spec: dict, defaults: dict, presets: dict) -> dict:
    """rig.yaml physics entry -> Spine 4.3 constraint map (type 'physics')."""
    s = dict(defaults)
    preset = spec.get("preset")
    if preset:
        if preset not in presets:
            raise ValueError(f"physics preset '{preset}' unknown (known: {', '.join(sorted(presets))})")
        s.update(presets[preset])
    s.update({k: v for k, v in spec.items() if k != "preset"})
    bone = s["bone"]
    if not bone.startswith("phys_"):
        raise ValueError(f"physics bone '{bone}' must be named phys_* (ANIMATION_CONTRACT 2.3)")
    mass = float(s.get("mass", 1))
    if "strength" in spec or "damping" in spec:
        strength = float(s.get("strength"))
        damping = float(s.get("damping"))
    else:
        strength, damping = strength_damping(float(s["f"]), float(s["zeta"]), mass)
    c: dict = {"type": "physics", "name": s.get("name", bone), "bone": bone}
    for k in ("x", "y", "rotate", "scaleX", "shearX"):
        v = float(spec.get(k, s.get(k, 0) if k == "rotate" else 0))
        if v:
            c[k] = round(v, 4)
    if "scaleY" in spec:
        c["scaleY"] = spec["scaleY"]  # ScaleYMode enum string
    c["limit"] = round(float(s.get("limit", 12000)), 2)
    c["fps"] = int(s.get("fps", 60))
    c["inertia"] = round(float(s.get("inertia", 0.6)), 4)
    c["strength"] = round(strength, 2)
    c["damping"] = round(damping, 4)
    if mass != 1:
        c["mass"] = round(mass, 4)
    for k in ("wind", "gravity"):
        if s.get(k):
            c[k] = round(float(s[k]), 4)
    if "mix" in s and float(s["mix"]) != 1:
        c["mix"] = round(float(s["mix"]), 4)
    if c["name"] != bone:
        raise ValueError(f"physics constraint '{c['name']}' must have the same name as its bone '{bone}'")
    if not any(k in c for k in ("x", "y", "rotate", "scaleX", "shearX")):
        raise ValueError(f"physics '{bone}': enable at least one of x, y, rotate, scaleX, shearX")
    return c
