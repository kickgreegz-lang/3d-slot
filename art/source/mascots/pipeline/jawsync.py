#!/usr/bin/env python3
"""Drive a mouth slot from the jaw rotation (post-process of a gen.py character skeleton).

Gumbo's mouth slot is the mouth INTERIOR drawn behind the jaw at four jaw angles (mastercut `wedge`
clips): closed_pick 3 deg, grin 9, open 18, roar 28. The right attachment is a function of how far the
jaw is open, so it is derived from the generated jaw rotation instead of being keyed by hand: for every
frame interval the largest opening decides, so the interior always covers the gap (never a see-through
mouth) and never hangs below a closing jaw by more than one step.

  jawsync.py <skeleton.json> --bone jaw --slot mouth --open-sign -1 \
             --map closed_pick:3.5,grin:9.5,open:18.5,roar:99 [-o out.json]

Only animations on track 0 / 1 that key the jaw or reset the mouth are rewritten; the face track (blink)
is left alone. Deterministic; rewrites the file in place unless -o is given.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

FPS = 30


def bezier_value(t, k0, k1, curve):
    """Spine 4.x rotate timeline segment value at time t (k0 <= t <= k1)."""
    t0, v0 = k0.get("time", 0.0), k0.get("value", 0.0)
    t1, v1 = k1.get("time", 0.0), k1.get("value", 0.0)
    if t1 <= t0:
        return v1
    if curve == "stepped":
        return v0 if t < t1 else v1
    if not curve:
        return v0 + (v1 - v0) * (t - t0) / (t1 - t0)
    cx1, cy1, cx2, cy2 = curve[:4]
    # solve x(s) = t for s in [0,1] by bisection, then y(s)
    lo, hi = 0.0, 1.0
    for _ in range(40):
        s = (lo + hi) / 2
        x = (1 - s) ** 3 * t0 + 3 * (1 - s) ** 2 * s * cx1 + 3 * (1 - s) * s * s * cx2 + s ** 3 * t1
        if x < t:
            lo = s
        else:
            hi = s
    s = (lo + hi) / 2
    return (1 - s) ** 3 * v0 + 3 * (1 - s) ** 2 * s * cy1 + 3 * (1 - s) * s * s * cy2 + s ** 3 * v1


def sample(keys, t):
    if not keys:
        return 0.0
    if t <= keys[0].get("time", 0.0):
        return keys[0].get("value", 0.0)
    for a, b in zip(keys, keys[1:]):
        if a.get("time", 0.0) <= t <= b.get("time", 0.0):
            return bezier_value(t, a, b, a.get("curve"))
    return keys[-1].get("value", 0.0)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("skeleton")
    ap.add_argument("--bone", default="jaw")
    ap.add_argument("--slot", default="mouth")
    ap.add_argument("--open-sign", type=float, default=-1.0, help="sign of an OPENING jaw rotation in the JSON")
    ap.add_argument("--map", default="closed_pick:3.5,grin:9.5,open:18.5,roar:999")
    ap.add_argument("-o", "--out")
    a = ap.parse_args()
    p = Path(a.skeleton)
    d = json.loads(p.read_text())
    steps = [(n, float(v)) for n, v in (x.split(":") for x in a.map.split(","))]
    rep = {}
    for name, anim in d.get("animations", {}).items():
        bones = anim.get("bones", {})
        slots = anim.get("slots", {})
        rot = (bones.get(a.bone) or {}).get("rotate")
        had = a.slot in slots
        if rot is None and not had:
            continue
        # duration: the latest key time in the animation
        tmax = 0.0
        for group in ("bones", "slots", "ik", "transform", "physics", "attachments", "drawOrder", "events"):
            g = anim.get(group)
            if isinstance(g, dict):
                for tl in g.values():
                    if isinstance(tl, dict):
                        for keys in tl.values():
                            if isinstance(keys, list):
                                for k in keys:
                                    tmax = max(tmax, k.get("time", 0.0))
            elif isinstance(g, list):
                for k in g:
                    tmax = max(tmax, k.get("time", 0.0))
        frames = int(round(tmax * FPS))
        keys = []
        prev = None
        mx = 0.0
        for f in range(frames + 1):
            # the largest opening over [f, f+1)
            op = 0.0
            for i in range(9):
                t = (f + i / 8) / FPS
                op = max(op, a.open_sign * sample(rot or [], t))
            mx = max(mx, op)
            att = next(n for n, lim in steps if op < lim)
            if att != prev:
                k = {"name": att}
                if f:
                    k["time"] = round(f / FPS, 4)
                keys.append(k)
                prev = att
        old = (slots.get(a.slot) or {}).get("attachment")
        slots.setdefault(a.slot, {})["attachment"] = keys
        anim["slots"] = slots
        rep[name] = {"maxOpenDeg": round(mx, 2), "keys": [(round(k.get("time", 0) * FPS), k["name"]) for k in keys],
                     "replaced": bool(old)}
    out = Path(a.out) if a.out else p
    out.write_text(json.dumps(d, separators=(",", ":")) if "\n" not in p.read_text()[:200] else json.dumps(d, indent=1))
    for n, r in rep.items():
        print(f"jawsync {n:16s} max open {r['maxOpenDeg']:5.1f} deg  mouth {r['keys']}")


if __name__ == "__main__":
    main()
