"""Parametric motion library: the ANIMATION_CONTRACT section 3 animation set, from parameters.

Every animation is built from a few numbers (depths, frames, eases) that rig.yaml can
override per symbol under `motion.<anim>`. Defaults below ARE the contract values; do not
tune them here for one symbol, override them in its rig.yaml.

Bone roles used: `squash` (feet pivot: squash/stretch), `body` (centre pivot: pops,
sways), fx_* slots (additive glow), face_eye* bones (blinks), part bones (explode scatter).
Loops end on exactly their first key; `win` ends on exactly `win_loop`'s first pose;
`land`, `appear`, `anticipation_out` end on the setup pose; `explode` ends at alpha 0.
"""
from __future__ import annotations

import copy
import math
from dataclasses import dataclass, field

from .timeline import Anim

# ------------------------------------------------------------------------------------------
# contract defaults (frames at 30 fps)
# ------------------------------------------------------------------------------------------
DEFAULTS: dict[str, dict] = {
    "idle": {
        "enabled": True, "frames": 90,
        "breath": 0.015,          # sy amplitude of the breath (= SYMBOL_TIMING.idle.breathScale 1.015)
        "breaths": 1,             # whole breaths per loop (keeps the seam exact)
        "sway": 1.5,              # body rotate amplitude (deg); drives physics parts
        "blink_frame": 62,        # null = no blink in idle
    },
    "land": {
        "enabled": True, "frames": 12,
        "impact_frame": 0,        # land_impact: frame 0 = the contact frame (runtime calls land at contact)
        "pre_stretch": 0.05,      # sy at contact (matches the falling stretch)
        "squash": 0.85,           # contract 0.83-0.87 (sy at the squash peak)
        "rebound": 0.06,          # one rebound, sy = 1 + rebound (<= 8% SH)
        "settle": 0.015,          # small second dip before rest
        "keys": [0, 2, 5, 8],     # contact, squash peak, rebound peak, settle dip (scaled to frames)
        "volume": 1.0,            # 1 = sx = 1/sqrt(sy); > 1 exaggerates width
        "sfx": None,              # optional SfxId payload -> extra `sfx` event on impact
        "vfx": None,              # optional FX id -> extra `vfx` event on impact
    },
    "win": {
        "enabled": True, "frames": 24,   # must be <= 27 (TIMING.win.winAnimDuration 900 ms)
        "dip_frame": 4, "dip": 0.90,     # anticipation squash (sy)
        "peak_frame": 8, "pop": 1.25,    # win_peak at the pop apex
        "under_frame": 13, "under": 1.05,
        "over_frame": 18, "over": 1.13,
        "settle": 1.10,                  # = win_loop base scale (shared, see win_loop.scale)
        "wiggle": 4.0,                   # body rotate (deg) around the pop
        "glow_peak": 1.0,
        "glow_scale": 1.12,              # fx_* bone scale relative to the body pop (halo stays visible)
        "vfx": None, "sfx": None,
    },
    "win_loop": {
        "enabled": True, "frames": 40,
        "pulse": 0.04, "beats": 2,       # scale pulses per loop on top of win.settle
        "sway": 2.0, "sways": 1,         # rotate amplitude (deg), whole cycles per loop
        "bounce": 0.03,                  # squash on each beat
        "glow": [0.6, 0.95],             # glow alpha min/max; min is also where win ends
    },
    "anticipation": {
        "enabled": True, "frames": 16,   # one beat ~ TIMING.anticipation.pulsePeriod 520 ms
        "lub": 1.06, "dub": 1.045,
        "shake": 1.5,
        "glow": [0.35, 0.9],
        "sfx": None,
    },
    "anticipation_intro": {"enabled": True, "frames": 9, "pop": 1.08},
    "anticipation_out": {"enabled": True, "frames": 8, "dip": 0.97},
    "explode": {
        "enabled": True, "frames": 12,
        "burst_frame": 2,                # explode_burst ~ TIMING.explode.anticipateDuration 80 ms
        "squeeze": 0.9,                  # TIMING.explode.anticipateScale
        "burst_scale": 1.3, "burst_peak_frame": 4,   # ~ TIMING.explode.burstScale 1.35
        "end_scale": 1.38,
        "scatter": 150.0,                # px (skeleton units) parts fly apart
        "spin": 70.0,                    # deg
        "body_fade": [3, 9],             # body slots fade (frames), faster than the flying parts
        "fade_from": 5,                  # other parts fade from here to the last frame
        "vfx": None, "sfx": None, "shake": None,
    },
    "appear": {"enabled": True, "frames": 9, "from": 0.55, "over": 1.08, "fade_frames": 3},
    "blur": {"enabled": True, "frames": 2},
    "blink": {"enabled": True, "frames": 5, "closed": 0.1},
    "dim": {"enabled": False, "tint": "7f7f7f"},
}

ORDER = ["idle", "land", "win", "win_loop", "anticipation", "anticipation_intro", "anticipation_out",
         "explode", "appear", "blur", "blink", "dim"]


def merge_params(overrides: dict | None) -> dict[str, dict]:
    p = copy.deepcopy(DEFAULTS)
    for name, ov in (overrides or {}).items():
        if name not in p:
            raise ValueError(f"motion.{name}: unknown animation (known: {', '.join(ORDER)})")
        if ov is False:
            p[name]["enabled"] = False
            continue
        for k, v in (ov or {}).items():
            if k not in p[name]:
                raise ValueError(f"motion.{name}.{k}: unknown parameter (known: {', '.join(sorted(p[name]))})")
            p[name][k] = v
    return p


def vol(sy: float, volume: float = 1.0) -> float:
    """sx for a given sy: volume preserving (1/sqrt(sy)), optionally exaggerated."""
    return 1.0 + (1.0 / math.sqrt(sy) - 1.0) * volume


@dataclass
class MotionCtx:
    fps: int
    glow_slots: list[str]
    glow_bones: list[str]                      # fx_* bones carrying glow slots (scaled with pops)
    body_slots: list[str]                      # slots on squash/body (fade first in explode)
    part_slots: list[str]                      # non-fx slots (faded by explode/appear)
    slot_alpha: dict[str, float]               # setup alpha per slot
    eyes: list[str]                            # face_eye* bones (blink)
    scatter: list[tuple[str, float, float, float]]  # (bone, dx, dy in parent-local, spin sign)
    blur: dict[str, str]                       # slot -> blur attachment name
    main_attachment: dict[str, str | None]     # slot -> setup attachment
    params: dict[str, dict]
    squash: str = "squash"
    body: str = "body"
    markers: dict[str, dict[str, int]] = field(default_factory=dict)


def _scaled_keys(keys: list[int], frames: int, nominal: int) -> list[int]:
    if frames == nominal:
        return list(keys)
    out = [int(round(k * frames / nominal)) for k in keys]
    for i in range(1, len(out)):
        out[i] = max(out[i], out[i - 1] + 1)
    return out


def _glow(anim: Anim, ctx: MotionCtx, keys: list[tuple[int, float, str]]) -> None:
    for s in ctx.glow_slots:
        tr = anim.slot(s, "alpha")
        for f, a, e in keys:
            tr.key(f, a, e)


def _glow_scale(anim: Anim, ctx: MotionCtx, keys: list[tuple[int, float, str]]) -> None:
    """fx_* bones are children of root (contract), so pops that scale `body` must scale the
    glow bones too or the halo disappears behind the grown body."""
    for b in ctx.glow_bones:
        tr = anim.bone(b, "scale")
        for f, v, e in keys:
            tr.key(f, (v, v), e)


# ------------------------------------------------------------------------------------------
# animations
# ------------------------------------------------------------------------------------------

def idle(ctx: MotionCtx) -> Anim:
    p = ctx.params["idle"]
    F = int(p["frames"])
    a = Anim("idle", ctx.fps, F)
    n = max(1, int(p["breaths"]))
    sq = a.bone(ctx.squash, "scale")
    for i in range(n):
        f0 = round(i * F / n)
        fm = round((i + 0.5) * F / n)
        sq.key(f0, (1.0, 1.0), "sine_in_out")
        sy = 1 + p["breath"]
        sq.key(fm, (vol(sy), sy), "sine_in_out")
    sq.key(F, (1.0, 1.0))
    if p["sway"]:
        r = a.bone(ctx.body, "rotate")
        q = F / 4
        r.key(0, 0.0, "sine_out").key(round(q), p["sway"], "sine_in_out").key(round(3 * q), -p["sway"], "sine_in_out").key(F, 0.0)
    bf = p.get("blink_frame")
    if bf is not None and ctx.eyes and ctx.params["blink"]["enabled"]:
        bf = int(bf)
        if bf + 5 > F:
            raise ValueError(f"idle.blink_frame {bf} too close to the end ({F})")
        closed = ctx.params["blink"]["closed"]
        for e in ctx.eyes:
            t = a.bone(e, "scale")
            t.key(0, (1.0, 1.0)).key(bf, (1.0, 1.0), "quad_in").key(bf + 2, (1.04, closed), "quad_out").key(bf + 5, (1.0, 1.0)).key(F, (1.0, 1.0))
    a.markers = {"start": 0, "end": F}
    return a


def land(ctx: MotionCtx) -> Anim:
    p = ctx.params["land"]
    F = int(p["frames"])
    a = Anim("land", ctx.fps, F)
    k0, k1, k2, k3 = _scaled_keys(p["keys"], F, 12)
    v = p["volume"]
    s0 = 1 + p["pre_stretch"]
    s1 = p["squash"]
    s2 = 1 + p["rebound"]
    s3 = 1 - p["settle"]
    sq = a.bone(ctx.squash, "scale")
    sq.key(k0, (vol(s0, v), s0), "quad_out")        # contact: still stretched from the fall
    sq.key(k1, (vol(s1, v), s1), "sine_in_out")     # squash peak (at the feet)
    sq.key(k2, (vol(s2, v), s2), "sine_in_out")     # the one rebound
    sq.key(k3, (vol(s3, v), s3), "sine_in_out")     # settle dip
    sq.key(F, (1.0, 1.0))                           # setup pose
    impact = int(p["impact_frame"])
    a.event(impact, "land_impact")
    if p.get("sfx"):
        a.event(impact, "sfx", string=str(p["sfx"]))
    if p.get("vfx"):
        a.event(impact, "vfx", string=str(p["vfx"]))
    a.markers = {"start": 0, "impact": impact, "squash": k1, "rebound": k2, "end": F}
    return a


def win(ctx: MotionCtx) -> Anim:
    p = ctx.params["win"]
    lp = ctx.params["win_loop"]
    F = int(p["frames"])
    a = Anim("win", ctx.fps, F)
    df, pf, uf, of = int(p["dip_frame"]), int(p["peak_frame"]), int(p["under_frame"]), int(p["over_frame"])
    if not (0 < df < pf < uf < of < F):
        raise ValueError("win: need 0 < dip_frame < peak_frame < under_frame < over_frame < frames")
    sq = a.bone(ctx.squash, "scale")
    sy = p["dip"]
    sq.key(0, (1.0, 1.0), "sine_out").key(df, (vol(sy), sy), "quad_out")
    st = 1.06
    sq.key(min(df + 3, pf - 1), (vol(st), st), "sine_in_out").key(pf + 2, (1.0, 1.0))
    b = a.bone(ctx.body, "scale")
    b.key(0, (1.0, 1.0), "sine_out").key(df, (0.97, 0.97), "snap")
    b.key(pf, (p["pop"], p["pop"]), "sine_in_out")
    b.key(uf, (p["under"], p["under"]), "sine_in_out")
    b.key(of, (p["over"], p["over"]), "sine_in_out")
    b.key(F, (p["settle"], p["settle"]))
    w = p["wiggle"]
    if w:
        r = a.bone(ctx.body, "rotate")
        r.key(0, 0.0).key(df, 0.0, "quad_out").key(pf, -w, "sine_in_out").key(uf, 0.7 * w, "sine_in_out")
        r.key(of, -0.3 * w, "sine_in_out").key(F, 0.0)
    g0 = lp["glow"][0]
    _glow(a, ctx, [(0, 0.0, "quad_out"), (pf, p["glow_peak"], "sine_in_out"), (F, g0, "linear")])
    gs = p["glow_scale"]
    _glow_scale(a, ctx, [(0, 1.0, "sine_out"), (df, 0.97, "snap"), (pf, p["pop"] * gs, "sine_in_out"),
                         (F, p["settle"] * gs, "linear")])
    a.event(pf, "win_peak")
    if p.get("vfx"):
        a.event(pf, "vfx", string=str(p["vfx"]))
    if p.get("sfx"):
        a.event(pf, "sfx", string=str(p["sfx"]))
    a.markers = {"start": 0, "dip": df, "peak": pf, "end": F}
    return a


def win_loop(ctx: MotionCtx) -> Anim:
    p = ctx.params["win_loop"]
    base = ctx.params["win"]["settle"]
    F = int(p["frames"])
    a = Anim("win_loop", ctx.fps, F)
    beats = max(1, int(p["beats"]))
    b = a.bone(ctx.body, "scale")
    sq = a.bone(ctx.squash, "scale") if p["bounce"] else None
    g0, g1 = p["glow"]
    gkeys: list[tuple[int, float, str]] = []
    beat_frames = []
    for i in range(beats):
        f0 = round(i * F / beats)
        f1 = f0 + max(2, round(F / beats * 0.12))
        beat_frames.append(f0)
        b.key(f0, (base, base), "quad_out").key(f1, (base + p["pulse"], base + p["pulse"]), "sine_in_out")
        gkeys += [(f0, g0, "quad_out"), (f1, g1, "sine_in_out")]
        if sq is not None:
            sy = 1 - p["bounce"]
            sq.key(f0, (1.0, 1.0), "quad_out").key(f0 + 2, (vol(sy), sy), "sine_in_out")
            sy2 = 1 + p["bounce"] * 0.5
            sq.key(f0 + 5, (vol(sy2), sy2), "sine_in_out").key(f0 + 9, (1.0, 1.0))
    b.key(F, (base, base))
    if sq is not None:
        sq.key(F, (1.0, 1.0))
    gkeys.append((F, g0, "linear"))
    _glow(a, ctx, gkeys)
    gs = ctx.params["win"]["glow_scale"]
    _glow_scale(a, ctx, [(k.frame, k.value[0] * gs, k.ease) for k in b.keys])
    if p["sway"]:
        n = max(1, int(p["sways"]))
        r = a.bone(ctx.body, "rotate")
        for i in range(n):
            f0 = round(i * F / n)
            r.key(f0, 0.0, "sine_in_out").key(round(f0 + F / n / 4), p["sway"], "sine_in_out")
            r.key(round(f0 + 3 * F / n / 4), -p["sway"], "sine_in_out")
        r.key(F, 0.0)
    a.markers = {"start": 0, "end": F, **{f"beat{i}": f for i, f in enumerate(beat_frames)}}
    return a


def anticipation(ctx: MotionCtx) -> Anim:
    p = ctx.params["anticipation"]
    F = int(p["frames"])
    a = Anim("anticipation", ctx.fps, F)
    lub, dub = p["lub"], p["dub"]
    k = _scaled_keys([2, 4, 6, 11], F, 16)
    b = a.bone(ctx.body, "scale")
    b.key(0, (1.0, 1.0), "quad_out").key(k[0], (lub, lub), "sine_in_out").key(k[1], (1.02, 1.02), "quad_out")
    b.key(k[2], (dub, dub), "sine_in_out").key(k[3], (1.0, 1.0)).key(F, (1.0, 1.0))
    s = p["shake"]
    if s:
        r = a.bone(ctx.body, "rotate")
        r.key(0, 0.0, "sine_in_out").key(k[0], s, "sine_in_out").key(k[1], -s, "sine_in_out")
        r.key(k[2], 0.6 * s, "sine_in_out").key(k[3], 0.0).key(F, 0.0)
    g0, g1 = p["glow"]
    _glow(a, ctx, [(0, g0, "quad_out"), (k[0], g1, "sine_in_out"), (k[1], 0.6 * g1 + 0.4 * g0, "quad_out"),
                   (k[2], 0.85 * g1, "sine_in_out"), (F, g0, "linear")])
    _glow_scale(a, ctx, [(kk.frame, kk.value[0], kk.ease) for kk in b.keys])
    if p.get("sfx"):
        a.event(0, "sfx", string=str(p["sfx"]))
    a.markers = {"start": 0, "lub": k[0], "dub": k[2], "end": F}
    return a


def anticipation_intro(ctx: MotionCtx) -> Anim:
    p = ctx.params["anticipation_intro"]
    F = int(p["frames"])
    a = Anim("anticipation_intro", ctx.fps, F)
    m = max(2, F // 2)
    a.bone(ctx.body, "scale").key(0, (1.0, 1.0), "back_out").key(m, (p["pop"], p["pop"]), "sine_in_out").key(F, (1.0, 1.0))
    _glow(a, ctx, [(0, 0.0, "quad_out"), (F, ctx.params["anticipation"]["glow"][0], "linear")])
    a.markers = {"start": 0, "end": F}
    return a


def anticipation_out(ctx: MotionCtx) -> Anim:
    p = ctx.params["anticipation_out"]
    F = int(p["frames"])
    a = Anim("anticipation_out", ctx.fps, F)
    m = max(2, F // 3)
    a.bone(ctx.body, "scale").key(0, (1.0, 1.0), "sine_out").key(m, (p["dip"], p["dip"]), "sine_in_out").key(F, (1.0, 1.0))
    _glow(a, ctx, [(0, ctx.params["anticipation"]["glow"][0], "sine_in_out"), (F, 0.0, "linear")])
    a.markers = {"start": 0, "end": F}
    return a


def explode(ctx: MotionCtx) -> Anim:
    p = ctx.params["explode"]
    F = int(p["frames"])
    a = Anim("explode", ctx.fps, F)
    bf, pk, ff = int(p["burst_frame"]), int(p["burst_peak_frame"]), int(p["fade_from"])
    if not (0 < bf < pk < F and 0 < ff < F):
        raise ValueError("explode: need 0 < burst_frame < burst_peak_frame < frames and 0 < fade_from < frames")
    b = a.bone(ctx.body, "scale")
    s = p["squeeze"]
    b.key(0, (1.0, 1.0), "hold_out").key(bf, (s, s), "expo_out").key(pk, (p["burst_scale"], p["burst_scale"]), "sine_out")
    b.key(F, (p["end_scale"], p["end_scale"]))
    sq = a.bone(ctx.squash, "scale")
    sq.key(0, (1.0, 1.0), "quad_in").key(bf, (vol(0.92), 0.92), "expo_out").key(pk, (vol(1.08), 1.08), "sine_in_out").key(F, (1.0, 1.0))
    for bone, dx, dy, sign in ctx.scatter:
        tr = a.bone(bone, "translate")
        tr.key(0, (0.0, 0.0)).key(bf, (0.0, 0.0), "expo_out").key(F, (dx * p["scatter"], dy * p["scatter"]))
        if p["spin"]:
            rr = a.bone(bone, "rotate")
            rr.key(0, 0.0).key(bf, 0.0, "cubic_out").key(F, sign * p["spin"])
    b0, b1 = (int(v) for v in p["body_fade"])
    if not (0 < b0 < b1 <= F):
        raise ValueError("explode.body_fade: need 0 < start < end <= frames")
    for slot in ctx.part_slots:
        a0 = ctx.slot_alpha.get(slot, 1.0)
        t = a.slot(slot, "alpha").key(0, a0)
        if slot in ctx.body_slots:
            t.key(b0, a0, "quad_in").key(b1, 0.0)
            if b1 < F:
                t.key(F, 0.0)
        else:
            t.key(ff, a0, "quad_in").key(F, 0.0)
    _glow(a, ctx, [(0, 0.0, "quad_in"), (bf, 1.0, "quad_out"), (F, 0.0, "linear")])
    _glow_scale(a, ctx, [(0, 1.0, "hold_out"), (bf, p["squeeze"], "expo_out"), (F, p["end_scale"] * 1.1, "linear")])
    a.event(bf, "explode_burst")
    a.event(F, "explode_done")
    for k in ("vfx", "sfx"):
        if p.get(k):
            a.event(bf, k, string=str(p[k]))
    if p.get("shake"):
        a.event(bf, "shake", float=float(p["shake"]))
    a.markers = {"start": 0, "burst": bf, "end": F}
    return a


def appear(ctx: MotionCtx) -> Anim:
    p = ctx.params["appear"]
    F = int(p["frames"])
    a = Anim("appear", ctx.fps, F)
    m = max(2, round(F * 0.55))
    b = a.bone(ctx.body, "scale")
    b.key(0, (p["from"], p["from"]), "cubic_out").key(m, (p["over"], p["over"]), "sine_in_out").key(F, (1.0, 1.0))
    fade = max(1, int(p["fade_frames"]))
    for slot in ctx.part_slots:
        a0 = ctx.slot_alpha.get(slot, 1.0)
        a.slot(slot, "alpha").key(0, 0.0, "quad_out").key(fade, a0)
    a.markers = {"start": 0, "end": F}
    a.ensure_length(ctx.body)
    return a


def blur(ctx: MotionCtx) -> Anim | None:
    p = ctx.params["blur"]
    if not ctx.blur:
        return None
    F = max(1, int(p["frames"]))
    a = Anim("blur", ctx.fps, F)
    for slot, att in sorted(ctx.blur.items()):
        a.slot(slot, "attachment").key(0, att).key(F, att)
    a.markers = {"start": 0, "end": F}
    return a


def blink(ctx: MotionCtx) -> Anim | None:
    p = ctx.params["blink"]
    if not ctx.eyes:
        return None
    F = int(p["frames"])
    a = Anim("blink", ctx.fps, F)
    for e in ctx.eyes:
        a.bone(e, "scale").key(0, (1.0, 1.0), "quad_in").key(2, (1.04, p["closed"]), "quad_out").key(F, (1.0, 1.0))
    a.markers = {"start": 0, "end": F}
    return a


def dim(ctx: MotionCtx) -> Anim:
    p = ctx.params["dim"]
    a = Anim("dim", ctx.fps, 0)
    c = p["tint"]
    rgb = tuple(int(c[i:i + 2], 16) / 255 for i in (0, 2, 4))
    for slot in ctx.part_slots:
        a.slot(slot, "rgb").key(0, rgb)
    a.markers = {"start": 0, "end": 0}
    return a


BUILDERS = {
    "idle": idle, "land": land, "win": win, "win_loop": win_loop, "anticipation": anticipation,
    "anticipation_intro": anticipation_intro, "anticipation_out": anticipation_out, "explode": explode,
    "appear": appear, "blur": blur, "blink": blink, "dim": dim,
}


# ------------------------------------------------------------------------------------------
# accents: per-bone overlap on top of the base motion (rig.yaml `accents.<anim>: [...]`)
# ------------------------------------------------------------------------------------------

def _resolve_at(at, markers: dict[str, int]) -> int:
    if isinstance(at, (int, float)):
        return int(at)
    s = str(at).replace(" ", "")
    for op in ("+", "-"):
        if op in s[1:]:
            name, off = s.split(op, 1) if s[0] != op else (s, "0")
            base = markers.get(name)
            if base is None:
                raise ValueError(f"accent at '{at}': unknown marker '{name}' (known: {', '.join(markers)})")
            return base + (int(off) if op == "+" else -int(off))
    if s not in markers:
        raise ValueError(f"accent at '{at}': unknown marker (known: {', '.join(markers)})")
    return markers[s]


def apply_accent(anim: Anim, spec: dict, loop: bool) -> None:
    bone = spec["bone"]
    kind = spec.get("type", "pump")
    amt = float(spec.get("amount", 0.15))
    F = anim.frames if anim.frames is not None else anim.last_frame()
    at = _resolve_at(spec.get("at", 0), anim.markers)
    ln = int(spec.get("frames", {"pump": 7, "squash": 9, "wiggle": 12, "hop": 7}.get(kind, 8)))

    def fit(frames_needed: int) -> None:
        if at < 0 or at + frames_needed > F:
            raise ValueError(f"{anim.name}: accent {kind} on {bone} at {at} (+{frames_needed}) leaves the {F}-frame window")

    if kind == "pump":
        fit(ln)
        t = anim.bone(bone, "scale")
        if at > 0:
            t.key(0, (1.0, 1.0))
        t.key(at, (1.0, 1.0), "quad_out").key(at + max(1, ln // 5), (1 + amt, 1 + amt), "sine_in_out")
        t.key(at + max(2, ln // 2), (1 - amt * 0.3, 1 - amt * 0.3), "sine_in_out").key(at + ln, (1.0, 1.0))
        if loop and at + ln < F:
            t.key(F, (1.0, 1.0))
    elif kind == "squash":
        fit(ln)
        t = anim.bone(bone, "scale")
        if at > 0:
            t.key(0, (1.0, 1.0))
        t.key(at, (1.0, 1.0), "quad_out").key(at + 2, (1 + amt * 0.5, 1 - amt), "sine_in_out")
        t.key(at + max(3, ln // 2 + 1), (1 - amt * 0.25, 1 + amt * 0.35), "sine_in_out").key(at + ln, (1.0, 1.0))
        if loop and at + ln < F:
            t.key(F, (1.0, 1.0))
    elif kind == "wiggle":
        fit(ln)
        n = int(spec.get("count", 3))
        t = anim.bone(bone, "rotate")
        if at > 0:
            t.key(0, 0.0)
        t.key(at, 0.0, "sine_out")
        step = ln / (n + 1)
        for i in range(n):
            t.key(at + max(i + 1, round(step * (i + 1))), amt * (-1) ** i * (1 - i / (n + 1)), "sine_in_out")
        t.key(at + ln, 0.0)
        if loop and at + ln < F:
            t.key(F, 0.0)
    elif kind == "hop":
        fit(ln)
        t = anim.bone(bone, "translate")
        if at > 0:
            t.key(0, (0.0, 0.0))
        t.key(at, (0.0, 0.0), "quad_out").key(at + ln // 2, (0.0, amt), "quad_in").key(at + ln, (0.0, 0.0))
        if loop and at + ln < F:
            t.key(F, (0.0, 0.0))
    elif kind == "pulse":   # loop-safe: `beats` whole pulses across the animation
        beats = max(1, int(spec.get("beats", 1)))
        off = int(spec.get("offset", 0))
        t = anim.bone(bone, "scale")
        pts = []
        for i in range(beats):
            f0 = round(i * F / beats) + off
            pts += [(f0, 1.0, "quad_out"), (f0 + max(1, round(F / beats * 0.15)), 1 + amt, "sine_in_out")]
        pts = [(f, v, e) for f, v, e in pts if 0 <= f < F]
        if not pts or pts[0][0] != 0:
            pts.insert(0, (0, 1.0, "sine_in_out"))
        for f, v, e in pts:
            t.key(f, (v, v), e)
        t.key(F, (1.0, 1.0))
    elif kind == "sway":
        cyc = max(1, int(spec.get("cycles", 1)))
        t = anim.bone(bone, "rotate")
        for i in range(cyc):
            f0 = round(i * F / cyc)
            t.key(f0, 0.0, "sine_in_out").key(round(f0 + F / cyc / 4), amt, "sine_in_out").key(round(f0 + 3 * F / cyc / 4), -amt, "sine_in_out")
        t.key(F, 0.0)
    else:
        raise ValueError(f"accent type '{kind}' unknown (pump, squash, wiggle, hop, pulse, sway)")
