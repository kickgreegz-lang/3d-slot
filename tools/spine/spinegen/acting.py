"""Character acting library: named motion presets -> dense signals -> Spine 4.3 keys.

A character clip is authored as data (rig.yaml `clips.<name>`), never as keyframes:

  * `keys`   pose-to-pose beats (anticipation -> action -> follow-through): `{frame: pose}` with an
             easing preset for the move INTO each pose;
  * `layers` named motion presets added on top (breathe, weight_shift, nod, sway, pulse, flick,
             jolt, tremble, blink, puff, release);
  * `swap`   attachment swaps (mouth shapes, eye/lid states, hand poses) at frames;
  * `drag`   overlapping action: every chain link lags its parent by `lag` frames (successive
             breaking of joints), and the upper body lags a hip translation;
  * `events` sfx / vfx / custom events at frames.

Everything is evaluated on a dense grid (RES samples per 30 fps frame) and summed per bone channel;
the result is refitted into Spine keys on whole frames with cubic Hermite segments (bezier control
points at thirds, one-sided tangents at kinks). The fitter measures its error the way spine-core
evaluates a curve (10 linear pieces per bezier), so what plays is what was authored within `TOL`.

Sign conventions (all authoring values are FACING-NORMALISED, the generator mirrors them):
  * `rot` degrees, positive = counter-clockwise for a character facing screen-right (Spine's
    convention); a character facing left gets every rotation negated;
  * `x`/`y` screen units (skeleton units = @2x px): +x = FORWARD (the facing direction), +y = up.
    They are converted into the parent bone's setup frame;
  * `sx`/`sy` bone-local scale factors (sx = along the bone, sy = across), `s` = uniform.
Physics bones are keyed like any bone; spine-core applies the springs on top at runtime.
"""
from __future__ import annotations

import copy
import math
import re
from dataclasses import dataclass, field

import numpy as np

from .easing import handles, rnd
from .timeline import Anim

RES = 8                                # dense samples per frame
TOL = {"rot": 0.2, "trans": 0.2, "scale": 0.001, "mix": 0.005, "alpha": 0.005}
CHANNELS = ("rot", "x", "y", "sx", "sy")
MUL = ("sx", "sy")
POSE_BONE_KEYS = {"rot", "x", "y", "sx", "sy", "s"}
POSE_META = {"base", "attach", "ik", "look", "alpha", "place", "reach", "$comment"}
REACH_CHAINS = {"hand": ("upper_arm", "forearm"), "foot": ("thigh", "shin")}


class ActingError(ValueError):
    pass


# ------------------------------------------------------------------------------------------
# easing on arrays
# ------------------------------------------------------------------------------------------

def ease_vec(name: str | None, u: np.ndarray) -> np.ndarray:
    """Named easing preset evaluated at normalised times u (vectorised bisection on x(t))."""
    u = np.clip(np.asarray(u, dtype=float), 0.0, 1.0)
    if name in (None, "linear"):
        return u
    if name in ("stepped", "step"):
        return (u >= 1.0 - 1e-9).astype(float)
    x1, y1, x2, y2 = handles(name)
    lo = np.zeros_like(u)
    hi = np.ones_like(u)
    for _ in range(40):
        mid = (lo + hi) / 2
        bx = 3 * (1 - mid) ** 2 * mid * x1 + 3 * (1 - mid) * mid * mid * x2 + mid ** 3
        below = bx < u
        lo = np.where(below, mid, lo)
        hi = np.where(below, hi, mid)
    s = (lo + hi) / 2
    return 3 * (1 - s) ** 2 * s * y1 + 3 * (1 - s) * s * s * y2 + s ** 3


def _check_ease(name, where: str) -> str:
    name = "sine_in_out" if name is None else str(name)
    if name in ("linear", "stepped", "step"):
        return name
    try:
        handles(name)
    except ValueError as e:
        raise ActingError(f"{where}: {e}") from None
    return name


# ------------------------------------------------------------------------------------------
# rig description handed over by the character builder
# ------------------------------------------------------------------------------------------

@dataclass
class BoneInfo:
    name: str
    parent: str | None
    x: float                 # setup local
    y: float
    rotation: float
    length: float
    wrot: float              # setup world rotation (deg)
    wx: float = 0.0
    wy: float = 0.0
    inherit: str | None = None


@dataclass
class SlotInfo:
    name: str
    bone: str
    attachments: list[str]
    setup: str | None


@dataclass
class IkInfo:
    name: str
    bones: list[str]
    target: str
    bend: int                # +1 bendPositive, -1 negative
    mix: float               # setup mix


@dataclass
class Pose:
    ch: dict[tuple[str, str], float] = field(default_factory=dict)
    att: dict[str, str | None] = field(default_factory=dict)
    ik: dict[str, float] = field(default_factory=dict)
    alpha: dict[str, float] = field(default_factory=dict)
    reach: dict[str, tuple[float, float]] = field(default_factory=dict)   # hand_X / foot_X -> skeleton point

    def merged(self, other: "Pose") -> "Pose":
        p = copy.deepcopy(self)
        p.ch.update(other.ch)
        p.att.update(other.att)
        p.ik.update(other.ik)
        p.alpha.update(other.alpha)
        p.reach.update(other.reach)
        return p


@dataclass
class ActingRig:
    fps: int
    img2sk: object                           # (x, y) canvas image space -> skeleton space
    facing: int                              # +1 faces screen-right, -1 faces left
    tempo: float
    bones: dict[str, BoneInfo]
    order: list[str]
    slots: dict[str, SlotInfo]
    groups: dict[str, list[str]]
    ik: dict[str, IkInfo]
    phys: set[str]
    face: dict
    poses_raw: dict = field(default_factory=dict)
    poses: dict[str, Pose] = field(default_factory=dict)
    stance: str | None = None
    drag_chains: list[list[str]] = field(default_factory=list)

    def children(self, bone: str) -> list[str]:
        return [b for b in self.order if self.bones[b].parent == bone]

    def ancestors(self, bone: str) -> list[str]:
        out = []
        p = self.bones[bone].parent
        while p:
            out.append(p)
            p = self.bones[p].parent
        return out


# ------------------------------------------------------------------------------------------
# poses
# ------------------------------------------------------------------------------------------

def _slots_of(rig: ActingRig, key: str, where: str) -> list[str]:
    if key in rig.groups:
        return list(rig.groups[key])
    if key in rig.slots:
        return [key]
    raise ActingError(f"{where}: '{key}' is neither a slot nor a slot group ({', '.join(sorted(rig.groups))})")


def _attachment(rig: ActingRig, slot: str, name, where: str) -> str | None:
    if name is None or str(name) in ("none", "null", "hidden"):
        return None
    name = str(name)
    if name == "setup":
        return rig.slots[slot].setup
    if name not in rig.slots[slot].attachments:
        raise ActingError(f"{where}: slot '{slot}' has no attachment '{name}' (has: {', '.join(rig.slots[slot].attachments)})")
    return name


def parse_pose(rig: ActingRig, spec, where: str, default_base: str | None, stack: tuple = ()) -> Pose:
    """rig.yaml pose (mapping) -> Pose. Values are facing-normalised (see module doc)."""
    if spec is None or spec in ("none", "setup"):
        return Pose()
    if isinstance(spec, str):
        return resolve_pose(rig, spec, where, stack)
    if not isinstance(spec, dict):
        raise ActingError(f"{where}: a pose is a name or a mapping, got {type(spec).__name__}")
    base_name = spec.get("base", default_base)
    pose = Pose() if base_name in (None, "none", "setup") else resolve_pose(rig, str(base_name), f"{where}.base", stack)
    own = Pose()
    for k, v in spec.items():
        k = str(k)
        if k in POSE_META or k.startswith(("$", "x_")):
            continue
        if k not in rig.bones:
            raise ActingError(f"{where}: unknown bone '{k}' (poses key bones; attachments go under `attach:`)")
        if not isinstance(v, dict):
            raise ActingError(f"{where}.{k}: expected {{rot, x, y, sx, sy, s}}")
        bad = sorted(set(map(str, v)) - POSE_BONE_KEYS)
        if bad:
            raise ActingError(f"{where}.{k}: unknown channel(s) {', '.join(bad)} (rot, x, y, sx, sy, s)")
        for ch, val in v.items():
            ch = str(ch)
            if ch == "s":
                own.ch[(k, "sx")] = float(val)
                own.ch[(k, "sy")] = float(val)
            else:
                own.ch[(k, ch)] = float(val)
    for key, name in (spec.get("attach") or {}).items():
        for slot in _slots_of(rig, str(key), f"{where}.attach"):
            own.att[slot] = _attachment(rig, slot, name, f"{where}.attach.{key}")
    for c, mix in (spec.get("ik") or {}).items():
        if c not in rig.ik:
            raise ActingError(f"{where}.ik: no IK constraint '{c}' (have: {', '.join(rig.ik) or '-'})")
        own.ik[str(c)] = float(mix)
    if "look" in spec:
        lk = spec["look"]
        if "ctrl_look" not in rig.bones:
            raise ActingError(f"{where}.look: the rig has no ctrl_look bone")
        if not (isinstance(lk, (list, tuple)) and len(lk) == 2):
            raise ActingError(f"{where}.look: expected [x, y] (screen units, x forward)")
        own.ch[("ctrl_look", "x")] = float(lk[0])
        own.ch[("ctrl_look", "y")] = float(lk[1])
    for key, a in (spec.get("alpha") or {}).items():
        for slot in _slots_of(rig, str(key), f"{where}.alpha"):
            own.alpha[slot] = float(a)
    for b, pt in (spec.get("place") or {}).items():
        # absolute canvas point for a bone (IK targets, ctrl_look, props): stored as the screen delta
        b = str(b)
        if b not in rig.bones:
            raise ActingError(f"{where}.place: unknown bone '{b}'")
        if not (isinstance(pt, (list, tuple)) and len(pt) == 2):
            raise ActingError(f"{where}.place.{b}: expected [x, y] (canvas image space)")
        sx, sy = rig.img2sk(float(pt[0]), float(pt[1]))
        bi = rig.bones[b]
        own.ch[(b, "x")] = rig.facing * (sx - bi.wx)
        own.ch[(b, "y")] = sy - bi.wy
    for key, pt in (spec.get("reach") or {}).items():
        key = str(key)
        m = re.match(r"^(hand|foot)_([LR])$", key)
        if not m or f"{REACH_CHAINS[m.group(1)][0]}_{m.group(2)}" not in rig.bones:
            raise ActingError(f"{where}.reach: '{key}' must be hand_L/R or foot_L/R of a biped rig")
        if not (isinstance(pt, (list, tuple)) and len(pt) == 2):
            raise ActingError(f"{where}.reach.{key}: expected [x, y] (canvas image space)")
        own.reach[key] = rig.img2sk(float(pt[0]), float(pt[1]))
    out = pose.merged(own)
    for key, target in sorted(out.reach.items()):
        # FK solve: the limb's two bones put the wrist/ankle on the point (re-solved in every
        # derived pose, so a pose that leans the chest keeps the hand where it was asked to be)
        kind, side = key.split("_")
        a, b = (f"{n}_{side}" for n in REACH_CHAINS[kind])
        if (a, "rot") in own.ch or (b, "rot") in own.ch:
            continue
        info = IkInfo(name=f"reach_{key}", bones=[a, b], target="", bend=_setup_bend(rig, a, b), mix=1.0)
        out.ch.update(solve_ik2(rig, info, out.ch, target=target))
    return out


def _setup_bend(rig: ActingRig, a: str, b: str) -> int:
    pa, pb = rig.bones[a], rig.bones[b]
    r = math.radians(pb.wrot)
    ex, ey = pb.wx + pb.length * math.cos(r), pb.wy + pb.length * math.sin(r)
    cross = (pb.wx - pa.wx) * (ey - pb.wy) - (pb.wy - pa.wy) * (ex - pb.wx)
    return 1 if cross > 0 else -1


def resolve_pose(rig: ActingRig, name: str, where: str, stack: tuple = ()) -> Pose:
    if name in ("none", "setup"):
        return Pose()
    if name == "rest":
        name = rig.stance or "none"
        if name == "none":
            return Pose()
    if name in rig.poses:
        return copy.deepcopy(rig.poses[name])
    if name in stack:
        raise ActingError(f"{where}: pose base cycle {' -> '.join(stack + (name,))}")
    if name not in rig.poses_raw:
        raise ActingError(f"{where}: unknown pose '{name}' (known: {', '.join(sorted(rig.poses_raw)) or '-'})")
    spec = rig.poses_raw[name]
    default_base = rig.stance if (rig.stance and name != rig.stance) else None
    p = parse_pose(rig, spec, f"poses.{name}", default_base, stack + (name,))
    rig.poses[name] = p
    return copy.deepcopy(p)


# ------------------------------------------------------------------------------------------
# dense signals
# ------------------------------------------------------------------------------------------

class Sig:
    """Per-clip dense signals on t = i / RES frames, i = 0 .. F * RES."""

    def __init__(self, frames: int, loop: bool):
        self.F = int(frames)
        self.loop = loop
        self.n = self.F * RES + 1
        self.t = np.arange(self.n) / RES
        self.ch: dict[tuple[str, str], np.ndarray] = {}
        self.ik: dict[str, np.ndarray] = {}
        self.alpha: dict[str, np.ndarray] = {}
        self.att: dict[str, dict[int, str | None]] = {}        # explicit (swap, blink, release): win
        self.att_pose: dict[str, dict[int, str | None]] = {}   # changes along the pose-to-pose track
        self.events: list[tuple[int, str, dict]] = []
        self.must: dict[tuple[str, str], set[int]] = {}

    def get(self, bone: str, ch: str) -> np.ndarray:
        if (bone, ch) not in self.ch:
            self.ch[(bone, ch)] = np.ones(self.n) if ch in MUL else np.zeros(self.n)
        return self.ch[(bone, ch)]

    def add(self, bone: str, ch: str, arr) -> None:
        if ch in MUL:
            self.ch[(bone, ch)] = self.get(bone, ch) * (1.0 + np.asarray(arr, dtype=float))
        else:
            self.ch[(bone, ch)] = self.get(bone, ch) + np.asarray(arr, dtype=float)

    def set_att(self, slot: str, frame: int, name: str | None, where: str) -> None:
        f = int(frame)
        if not 0 <= f <= self.F:
            raise ActingError(f"{where}: frame {f} outside 0..{self.F}")
        keys = self.att.setdefault(slot, {})
        if f in keys and keys[f] != name:
            raise ActingError(f"{where}: slot '{slot}' gets two attachments on frame {f} ({keys[f]} / {name})")
        keys[f] = name

    def shift(self, arr: np.ndarray, frames: float) -> np.ndarray:
        """arr delayed by `frames` (periodic for loops, held at frame 0 for one-shots)."""
        k = int(round(frames * RES))
        if k <= 0:
            return arr.copy()
        if self.loop:
            body = np.roll(arr[:-1], k)
            return np.append(body, body[0])
        out = np.empty_like(arr)
        out[:k] = arr[0]
        out[k:] = arr[:-k]
        return out


def _phase(sig: Sig, cycles: float, phase: float = 0.0) -> np.ndarray:
    return 2 * math.pi * (cycles * sig.t / sig.F + phase)


def _need_int_cycles(sig: Sig, cycles: float, where: str) -> None:
    if sig.loop and abs(cycles - round(cycles)) > 1e-9:
        raise ActingError(f"{where}: a loop needs a whole number of cycles (got {cycles})")


def _window(sig: Sig, at: float, frames: float) -> np.ndarray:
    """0..1 position inside [at, at + frames] (clipped)."""
    return np.clip((sig.t - at) / max(frames, 1e-9), 0.0, 1.0)


# ------------------------------------------------------------------------------------------
# presets
# ------------------------------------------------------------------------------------------

def _defaults(spec: dict, defaults: dict, where: str) -> dict:
    bad = sorted(k for k in spec if k != "preset" and k not in defaults and not str(k).startswith(("$", "x_")))
    if bad:
        raise ActingError(f"{where}: unknown parameter(s) {', '.join(bad)} (known: {', '.join(sorted(defaults))})")
    p = dict(defaults)
    p.update({k: v for k, v in spec.items() if k != "preset"})
    return p


def _bone(rig: ActingRig, name, where: str) -> str:
    if name not in rig.bones:
        raise ActingError(f"{where}: bone '{name}' not in the rig")
    return str(name)


def _frames_list(v) -> list[int]:
    if v is None:
        return []
    if isinstance(v, (int, float)):
        return [int(v)]
    return [int(x) for x in v]


def p_breathe(sig: Sig, rig: ActingRig, spec: dict, where: str) -> None:
    """Breathing: the chest lengthens (rise) and widens, the belly swells; head counter-rotates a hair."""
    p = _defaults(spec, {"bone": "chest", "amount": 0.02, "width": None, "cycles": 1, "phase": 0.0,
                         "belly": None, "belly_amount": None, "hold": None}, where)
    b = _bone(rig, p["bone"], where)
    _need_int_cycles(sig, p["cycles"], where)
    w = 0.5 - 0.5 * np.cos(_phase(sig, p["cycles"], p["phase"]))
    if p["hold"] is not None:          # [from, to]: breath held (anticipation)
        f0, f1 = p["hold"]
        held = np.interp(f0, sig.t, w)
        w = np.where((sig.t >= f0) & (sig.t <= f1), held, w)
    a = float(p["amount"])
    wd = a * 0.5 if p["width"] is None else float(p["width"])
    sig.add(b, "sx", a * w)
    sig.add(b, "sy", wd * w)
    if p["belly"]:
        bb = _bone(rig, p["belly"], where)
        ba = 1.5 * a if p["belly_amount"] is None else float(p["belly_amount"])
        sig.add(bb, "sy", ba * w)
        sig.add(bb, "sx", 0.4 * ba * w)


def p_weight_shift(sig: Sig, rig: ActingRig, spec: dict, where: str) -> None:
    """Weight shift: hips travel forward/back with a dip at each extreme; the spine counter-rotates
    so the chest stays over the planted feet, and the head stays level (IK keeps the feet)."""
    p = _defaults(spec, {"amount": 8.0, "dip": 3.0, "cycles": 1, "phase": 0.0, "tilt": 0.8, "counter": 1.4,
                         "chest": 0.5, "stabilize": 0.8, "hips": "hips", "spine": "spine", "chest_bone": "chest",
                         "head": "head"}, where)
    _need_int_cycles(sig, p["cycles"], where)
    ph = _phase(sig, p["cycles"], p["phase"])
    s = np.sin(ph)
    dip = (1 - np.cos(2 * ph)) / 2
    hips, spine, chest, head = (_bone(rig, p[k], where) for k in ("hips", "spine", "chest_bone", "head"))
    sig.add(hips, "x", p["amount"] * s)
    sig.add(hips, "y", -p["dip"] * dip)
    tilt = -p["tilt"] * s
    sp = p["counter"] * s
    ch = p["counter"] * p["chest"] * s
    sig.add(hips, "rot", tilt)
    sig.add(spine, "rot", sp)
    sig.add(chest, "rot", ch)
    sig.add(head, "rot", -p["stabilize"] * (tilt + sp + ch))


def _beat_shape(sig: Sig, every: float, attack: float, phase: float, count: int | None, at: float) -> np.ndarray:
    """Periodic beat envelope: 0 -> 1 in `attack` frames (fast), back to 0 over the rest (soft)."""
    rel = sig.t - at - phase
    if sig.loop:
        tau = np.mod(rel, every)
    else:
        tau = np.where(rel >= 0, np.mod(rel, every), -1.0)
        if count is not None:
            tau = np.where(rel < count * every, tau, -1.0)
    up = ease_vec("quad_out", tau / max(attack, 1e-9))
    rel_len = max(every * 0.85 - attack, 1.0)
    down = 1.0 - ease_vec("sine_in_out", (tau - attack) / rel_len)
    env = np.where(tau < 0, 0.0, np.where(tau < attack, up, down))
    if not sig.loop and count is None and at + phase > 0:
        env = np.where(rel < 0, 0.0, env)
    return env


def p_nod(sig: Sig, rig: ActingRig, spec: dict, where: str) -> None:
    """Nod on the beat: head (and a share of neck/chest) dips fast and rises slowly; the hips bob
    (knees flex through the foot IK). With on_beat: bottom the lowest point lands ON the beat."""
    p = _defaults(spec, {"every": 18, "amount": 5.0, "attack": 3, "neck": 0.35, "chest": 0.25, "bob": 3.0,
                         "phase": 0.0, "at": 0, "count": None, "on_beat": "start", "head": "head", "neck_bone": "neck",
                         "chest_bone": "chest", "hips": "hips"}, where)
    every = float(p["every"])
    if sig.loop and abs(sig.F / every - round(sig.F / every)) > 1e-9:
        raise ActingError(f"{where}: loop length {sig.F} is not a multiple of every={every}")
    phase = float(p["phase"]) - (float(p["attack"]) if p["on_beat"] == "bottom" else 0.0)
    env = _beat_shape(sig, every, float(p["attack"]), phase, p["count"], float(p["at"]))
    a = float(p["amount"])
    head, neck, chest, hips = (_bone(rig, p[k], where) for k in ("head", "neck_bone", "chest_bone", "hips"))
    sig.add(head, "rot", -a * (1 - p["neck"]) * env)
    sig.add(neck, "rot", -a * p["neck"] * env)
    sig.add(chest, "rot", -a * p["chest"] * env)
    if p["bob"]:
        sig.add(hips, "y", -float(p["bob"]) * env)


def p_sway(sig: Sig, rig: ActingRig, spec: dict, where: str) -> None:
    """Sinusoidal sway of a bone or a chain; each link `lag` frames behind the previous one (a wave
    travelling down a tail or cable: overlapping action without physics)."""
    p = _defaults(spec, {"bone": None, "chain": None, "amount": 5.0, "cycles": 1, "lag": 0.0, "grow": 1.0,
                         "phase": 0.0, "channel": "rot", "at": 0, "frames": None}, where)
    chain = p["chain"] or ([p["bone"]] if p["bone"] else None)
    if not chain:
        raise ActingError(f"{where}: give `bone` or `chain`")
    if p["channel"] not in ("rot", "x", "y"):
        raise ActingError(f"{where}: channel must be rot, x or y")
    _need_int_cycles(sig, p["cycles"], where)
    env = 1.0
    if p["frames"] is not None:        # one-shot window with soft in/out
        u = _window(sig, float(p["at"]), float(p["frames"]))
        env = np.sin(np.pi * u) ** 2
    for i, b in enumerate(chain):
        b = _bone(rig, b, where)
        lagf = float(p["lag"]) * i / rig.tempo
        ph = 2 * math.pi * (p["cycles"] * (sig.t - lagf) / sig.F + p["phase"])
        sig.add(b, p["channel"], float(p["amount"]) * (float(p["grow"]) ** i) * np.sin(ph) * env)


def p_pulse(sig: Sig, rig: ActingRig, spec: dict, where: str) -> None:
    """Scale pulse(s): at frames or every N frames (loop-safe), fast attack, soft release."""
    p = _defaults(spec, {"bone": None, "amount": 0.1, "every": None, "at": None, "attack": 3, "release": 9,
                         "axes": "both", "phase": 0.0}, where)
    b = _bone(rig, p["bone"], where)
    if p["every"] is not None:
        every = float(p["every"])
        if sig.loop and abs(sig.F / every - round(sig.F / every)) > 1e-9:
            raise ActingError(f"{where}: loop length {sig.F} is not a multiple of every={every}")
        first = -1 if sig.loop else 0
        starts = [float(p["phase"]) + k * every for k in range(first, int(sig.F / every) + 2)]
    else:
        starts = [float(f) for f in _frames_list(p["at"])]
    if not starts:
        raise ActingError(f"{where}: give `at` or `every`")
    env = np.zeros(sig.n)
    for f0 in starts:
        tau = sig.t - f0
        if sig.loop:
            tau = np.mod(tau, sig.F)
        up = ease_vec("quad_out", tau / max(p["attack"], 1e-9))
        down = 1 - ease_vec("sine_in_out", (tau - p["attack"]) / max(p["release"], 1e-9))
        e = np.where(tau < 0, 0, np.where(tau < p["attack"], up, np.where(tau < p["attack"] + p["release"], down, 0)))
        env = np.maximum(env, e)
    a = float(p["amount"]) * env
    if p["axes"] in ("both", "along"):
        sig.add(b, "sx", a)
    if p["axes"] in ("both", "across"):
        sig.add(b, "sy", a)


def _damped(u_len: float, tau: np.ndarray, cycles: float) -> np.ndarray:
    """1 at tau = 0, damped cosine decaying to exactly 0 at tau = u_len."""
    k = math.log(40.0) / max(u_len, 1e-9)
    w = 2 * math.pi * cycles / max(u_len, 1e-9)
    v = np.exp(-k * tau) * np.cos(w * tau)
    fade = 1 - ease_vec("sine_in_out", (tau - 0.6 * u_len) / (0.4 * u_len))
    return np.where(tau < 0, 1.0, np.where(tau > u_len, 0.0, v * fade))


def p_flick(sig: Sig, rig: ActingRig, spec: dict, where: str) -> None:
    """Flick with follow-through: a small wind-up the other way, a snap to `amount`, then a damped
    oscillation that settles in `frames` (toothpick flick, tail whip, a head shake)."""
    p = _defaults(spec, {"bone": None, "at": 0, "amount": 20.0, "frames": 12, "cycles": 1.5, "windup": 0.25,
                         "windup_frames": 3, "rise": 2, "channel": "rot"}, where)
    b = _bone(rig, p["bone"], where)
    at, rise = float(p["at"]), max(1.0, float(p["rise"]))
    frames = float(p["frames"]) / rig.tempo
    a = float(p["amount"])
    wu = float(p["windup"]) * a
    wf = float(p["windup_frames"])
    t = sig.t
    v = np.zeros(sig.n)
    if wu and wf > 0:
        m = (t >= at - wf) & (t < at)
        v = np.where(m, -wu * ease_vec("sine_in_out", (t - (at - wf)) / wf), v)
    m = (t >= at) & (t < at + rise)
    v = np.where(m, -wu + (a + wu) * ease_vec("expo_out", (t - at) / rise), v)
    tau = t - at - rise
    v = np.where(tau >= 0, a * _damped(frames, tau, float(p["cycles"])), v)
    if p["channel"] not in ("rot", "x", "y"):
        raise ActingError(f"{where}: channel must be rot, x or y")
    sig.add(b, p["channel"], v)
    sig.must.setdefault((b, p["channel"]), set()).add(int(round(at)))


def p_jolt(sig: Sig, rig: ActingRig, spec: dict, where: str) -> None:
    """Impulse (the keyed kick that also drives physics): fast attack to (x, y, rot), a hold, then a
    springy recovery with one overshoot (bass_drop's hip push, a flinch)."""
    p = _defaults(spec, {"bone": "hips", "at": 0, "x": 0.0, "y": 0.0, "rot": 0.0, "attack": 2, "hold": 1,
                         "recover": 14, "overshoot": 0.15, "ease": "expo_out"}, where)
    b = _bone(rig, p["bone"], where)
    at, att, hold = float(p["at"]), max(1.0, float(p["attack"])), float(p["hold"])
    rec = float(p["recover"]) / rig.tempo
    ease = _check_ease(p["ease"], where)
    t = sig.t
    up = ease_vec(ease, (t - at) / att)
    tau = t - at - att - hold
    u = np.clip(tau / max(rec, 1e-9), 0, 1)
    # recover: 1 -> -overshoot (at 55 %) -> 0, eased
    ov = float(p["overshoot"])
    r1 = 1 - (1 + ov) * ease_vec("sine_in_out", u / 0.55)
    r2 = -ov * (1 - ease_vec("sine_in_out", (u - 0.55) / 0.45))
    rec_v = np.where(u < 0.55, r1, r2)
    env = np.where(t < at, 0.0, np.where(t < at + att, up, np.where(tau < 0, 1.0, np.where(u >= 1, 0.0, rec_v))))
    for ch in ("x", "y", "rot"):
        if float(p[ch]):
            sig.add(b, ch, float(p[ch]) * env)
            sig.must.setdefault((b, ch), set()).update({int(at), int(at + att)})


def p_tremble(sig: Sig, rig: ActingRig, spec: dict, where: str) -> None:
    """Small deterministic shake (tension, held breath): two incommensurate sines, whole cycles in loops."""
    p = _defaults(spec, {"bone": None, "amount": 0.6, "hz": 7.0, "channel": "rot", "at": 0, "frames": None}, where)
    b = _bone(rig, p["bone"], where)
    dur = sig.F / rig.fps
    c1 = float(p["hz"]) * dur
    c2 = float(p["hz"]) * 1.618 * dur
    if sig.loop:
        c1, c2 = max(1, round(c1)), max(1, round(c2))
    v = 0.6 * np.sin(2 * math.pi * c1 * sig.t / sig.F) + 0.4 * np.sin(2 * math.pi * c2 * sig.t / sig.F + 1.3)
    if p["frames"] is not None:
        u = _window(sig, float(p["at"]), float(p["frames"]))
        v = v * np.sin(np.pi * u) ** 2
    sig.add(b, p["channel"], float(p["amount"]) * v)


def p_blink(sig: Sig, rig: ActingRig, spec: dict, where: str) -> None:
    """Eye blink by attachment swaps: closed f+1..f+3 (soft: half / closed / half), then `back`."""
    p = _defaults(spec, {"at": 0, "slots": "eyes", "soft": True, "closed": "closed", "half": "half",
                         "back": "open"}, where)
    slots = _slots_of(rig, str(p["slots"]), where)
    for f in _frames_list(p["at"]):
        seq = ([(f, p["half"]), (f + 1, p["closed"]), (f + 3, p["half"]), (f + 4, p["back"])] if p["soft"]
               else [(f + 1, p["closed"]), (f + 4, p["back"])])
        for s in slots:
            for fr, name in seq:
                if fr <= sig.F:
                    sig.set_att(s, fr, _attachment(rig, s, name, where), where)


def p_puff(sig: Sig, rig: ActingRig, spec: dict, where: str) -> None:
    """fx puff (music notes, sweat drops): the slot fades in, rises and grows, then fades out."""
    p = _defaults(spec, {"slot": None, "bone": None, "at": None, "every": None, "frames": 14, "rise": 40.0,
                         "drift": 10.0, "scale": [0.6, 1.2], "alpha": 1.0, "phase": 0.0}, where)
    slot = p["slot"]
    if slot not in rig.slots:
        raise ActingError(f"{where}: no slot '{slot}'")
    b = _bone(rig, p["bone"] or rig.slots[slot].bone, where)
    if p["every"] is not None:
        every = float(p["every"])
        starts = [float(p["phase"]) + k * every for k in range(int(sig.F / every) + 1) if float(p["phase"]) + k * every < sig.F]
    else:
        starts = [float(f) for f in _frames_list(p["at"])]
    fr = float(p["frames"])
    alpha = np.zeros(sig.n)
    y = np.zeros(sig.n)
    x = np.zeros(sig.n)
    s = np.full(sig.n, float(p["scale"][0]))
    for f0 in starts:
        tau = sig.t - f0
        if sig.loop:
            tau = np.mod(tau, sig.F)
        u = np.clip(tau / fr, 0, 1)
        m = (tau >= 0) & (tau <= fr)
        a = np.where(m, np.sin(np.pi * u) ** 0.7, 0.0) * float(p["alpha"])
        alpha = np.maximum(alpha, a)
        y = np.where(m, float(p["rise"]) * ease_vec("sine_out", u), y)
        x = np.where(m, float(p["drift"]) * np.sin(np.pi * u), x)
        s = np.where(m, p["scale"][0] + (p["scale"][1] - p["scale"][0]) * ease_vec("quad_out", u), s)
    sig.alpha[slot] = np.maximum(sig.alpha.get(slot, np.zeros(sig.n)), alpha)
    sig.add(b, "y", y)
    sig.add(b, "x", x)
    sig.add(b, "sx", s - 1)
    sig.add(b, "sy", s - 1)


PRESETS = {
    "breathe": p_breathe, "weight_shift": p_weight_shift, "nod": p_nod, "sway": p_sway, "pulse": p_pulse,
    "flick": p_flick, "jolt": p_jolt, "tremble": p_tremble, "blink": p_blink, "puff": p_puff,
}
POST = {"release"}


# ------------------------------------------------------------------------------------------
# forward kinematics (setup + keyed offsets; no physics, no constraints)
# ------------------------------------------------------------------------------------------

def _local_offsets(rig: ActingRig, sig: Sig, bone: str, idx) -> tuple:
    """Screen-space local offsets of `bone` at sample index/indices: (drot, dx_local, dy_local, sx, sy)."""
    f = rig.facing
    bi = rig.bones[bone]
    rot = f * sig.ch.get((bone, "rot"), np.zeros(sig.n))[idx]
    X = f * sig.ch.get((bone, "x"), np.zeros(sig.n))[idx]
    Y = sig.ch.get((bone, "y"), np.zeros(sig.n))[idx]
    th = math.radians(rig.bones[bi.parent].wrot) if bi.parent else 0.0
    lx = math.cos(th) * X + math.sin(th) * Y
    ly = -math.sin(th) * X + math.cos(th) * Y
    sx = sig.ch.get((bone, "sx"), np.ones(sig.n))[idx]
    sy = sig.ch.get((bone, "sy"), np.ones(sig.n))[idx]
    return rot, lx, ly, sx, sy


def fk(rig: ActingRig, sig: Sig | None, idx: int, bones: list[str] | None = None,
       override: dict | None = None) -> dict[str, tuple[np.ndarray, np.ndarray]]:
    """World (2x2 linear, translation) per bone at dense sample `idx`. `override` = {(bone, ch): value}
    replaces the (screen-space) offsets for pose evaluation without a Sig."""
    need = set()
    for b in (bones or rig.order):
        need.add(b)
        need.update(rig.ancestors(b))
    out: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    for b in rig.order:
        if b not in need:
            continue
        bi = rig.bones[b]
        if sig is not None:
            drot, dx, dy, sx, sy = _local_offsets(rig, sig, b, idx)
        else:
            ov = override or {}
            f = rig.facing
            drot = f * ov.get((b, "rot"), 0.0)
            X, Y = f * ov.get((b, "x"), 0.0), ov.get((b, "y"), 0.0)
            th = math.radians(rig.bones[bi.parent].wrot) if bi.parent else 0.0
            dx, dy = math.cos(th) * X + math.sin(th) * Y, -math.sin(th) * X + math.cos(th) * Y
            sx, sy = ov.get((b, "sx"), 1.0), ov.get((b, "sy"), 1.0)
        r = math.radians(bi.rotation + float(drot))
        L = np.array([[math.cos(r) * sx, -math.sin(r) * sy], [math.sin(r) * sx, math.cos(r) * sy]], dtype=float)
        pos = np.array([bi.x + float(dx), bi.y + float(dy)])
        if bi.parent is None:
            out[b] = (L, pos)
            continue
        PL, PT = out[bi.parent]
        if bi.inherit in ("noScale", "noScaleOrReflection"):
            pr = math.atan2(PL[1, 0], PL[0, 0])
            PR = np.array([[math.cos(pr), -math.sin(pr)], [math.sin(pr), math.cos(pr)]])
            out[b] = (PR @ L, PL @ pos + PT)
        else:
            out[b] = (PL @ L, PL @ pos + PT)
    return out


def world_rot(M: np.ndarray) -> float:
    return math.degrees(math.atan2(M[1, 0], M[0, 0]))


def solve_ik2(rig: ActingRig, ik: IkInfo, pose_offsets: dict, target: tuple[float, float] | None = None
              ) -> dict[tuple[str, str], float]:
    """Facing-normalised rot offsets for a 2-bone IK chain that put the child tip on the target
    bone (or on `target`, a skeleton-space point); same law-of-cosines solution and bend
    convention as spine-core's IkConstraint.apply2."""
    if len(ik.bones) != 2:
        return {}
    pb, cb = ik.bones
    W = fk(rig, None, 0, [pb, cb] + ([ik.target] if target is None else []), override=pose_offsets)
    PL, P = W[pb]
    T = W[ik.target][1] if target is None else np.array(target, dtype=float)
    cbi = rig.bones[cb]
    l1 = math.hypot(cbi.x, cbi.y)
    l2 = cbi.length
    d = float(np.hypot(*(T - P)))
    d = min(max(d, abs(l1 - l2) + 1e-6), l1 + l2 - 1e-6)
    phi = math.atan2(T[1] - P[1], T[0] - P[0])
    A = math.acos(max(-1.0, min(1.0, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))))
    B = math.acos(max(-1.0, min(1.0, (l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2))))
    s = ik.bend
    parent_world = math.degrees(phi - s * A)
    child_rel = math.degrees(s * (math.pi - B))
    pbi = rig.bones[pb]
    gp = rig.bones[pb].parent
    gp_rot = world_rot(W[gp][0]) if gp else 0.0
    p_local = parent_world - gp_rot
    f = rig.facing

    def wrap(a: float) -> float:
        return (a + 180.0) % 360.0 - 180.0

    return {(pb, "rot"): f * wrap(p_local - pbi.rotation), (cb, "rot"): f * wrap(child_rel - cbi.rotation)}


# ------------------------------------------------------------------------------------------
# post-processes
# ------------------------------------------------------------------------------------------

def _drag(sig: Sig, rig: ActingRig, spec, where: str) -> None:
    """Overlapping action: link k of a chain lags the accumulated rotation of links < k by `lag`
    frames (gain 1 = full lag); the spine also lags a fast hip translation (body)."""
    if spec is False:
        return
    p = _defaults(spec or {}, {"lag": 2.0, "gain": 0.5, "body": 0.5, "chains": None}, where)
    lag = float(p["lag"]) / rig.tempo
    chains = p["chains"] or rig.drag_chains
    for chain in chains:
        for b in chain:
            _bone(rig, b, where)
        base = [a for a in reversed(rig.ancestors(chain[0]))]
        for k in range(1, len(chain)):
            acc = np.zeros(sig.n)
            for b in base + chain[:k]:
                acc = acc + sig.ch.get((b, "rot"), 0.0)
            lagged = sig.shift(acc, lag)
            gain = float(p["gain"])
            sig.add(chain[k], "rot", gain * (lagged - acc))
    if p["body"] and "hips" in rig.bones and "spine" in rig.bones:
        X = sig.ch.get(("hips", "x"))
        if X is not None and np.ptp(X) > 1e-6:
            L = max(rig.bones["spine"].length, 1.0) * 1.6
            d = sig.shift(X, lag) - X
            sig.add("spine", "rot", -float(p["body"]) * np.degrees(d / L))


def _release(sig: Sig, rig: ActingRig, spec: dict, where: str, ik_mix: dict[str, np.ndarray]) -> None:
    """A held prop leaves its parent at `at` and falls on a ballistic path in world space (the mic
    drop). The parent chain must be FK there (IK mix 0) and free of physics bones."""
    p = _defaults(spec, {"bone": None, "at": 0, "frames": 12, "fall": 400.0, "forward": 3.0, "spin": 90.0,
                         "slot": None}, where)
    b = _bone(rig, p["bone"], where)
    at = int(p["at"])
    chain = [b] + rig.ancestors(b)
    bad = [x for x in chain if x in rig.phys]
    if bad:
        raise ActingError(f"{where}: the parent chain of '{b}' has physics bones ({', '.join(bad)}); FK cannot predict them")
    for c, ik in rig.ik.items():
        if set(ik.bones) & set(chain):
            m = ik_mix.get(c)
            mix = m[at * RES:] if m is not None else np.full(1, ik.mix)
            if np.max(mix) > 0.01:
                raise ActingError(f"{where}: IK '{c}' drives the parent chain of '{b}' after frame {at}; key its mix to 0")
    bi = rig.bones[b]
    par = bi.parent
    i0 = at * RES
    W0 = fk(rig, sig, i0, [b])
    P0 = W0[b][1].copy()
    R0 = world_rot(W0[b][0])
    frames = float(p["frames"])
    g = 2 * float(p["fall"]) / (frames * frames)
    f = rig.facing
    th_setup = math.radians(rig.bones[par].wrot)
    for i in range(i0, sig.n):
        tau = (i - i0) / RES
        Wi = fk(rig, sig, i, [par])
        PL, PT = Wi[par]
        target = P0 + np.array([f * float(p["forward"]) * tau, -0.5 * g * tau * tau])
        loc = np.linalg.solve(PL, target - PT)
        lrot = R0 + f * float(p["spin"]) * min(tau / frames, 1.0) - world_rot(PL)
        dxl, dyl = loc[0] - bi.x, loc[1] - bi.y
        X = math.cos(th_setup) * dxl - math.sin(th_setup) * dyl
        Y = math.sin(th_setup) * dxl + math.cos(th_setup) * dyl
        sig.get(b, "x")[i] = f * X
        sig.get(b, "y")[i] = Y
        sig.get(b, "rot")[i] = f * (((lrot - bi.rotation) + 180) % 360 - 180)
    sig.must.setdefault((b, "x"), set()).add(at)
    sig.must.setdefault((b, "y"), set()).add(at)
    sig.must.setdefault((b, "rot"), set()).add(at)
    if p["slot"]:
        end = min(sig.F, at + int(math.ceil(frames)))
        sig.set_att(str(p["slot"]), end, None, where)


# ------------------------------------------------------------------------------------------
# fitting: dense signal -> whole-frame keys with Hermite beziers
# ------------------------------------------------------------------------------------------

_U10 = np.linspace(0.0, 1.0, 11)


def _slope_out(y: np.ndarray, i: int) -> float:
    n = len(y)
    h = 1.0 / RES
    if i + 2 < n:
        return (-3 * y[i] + 4 * y[i + 1] - y[i + 2]) / (2 * h)
    if i + 1 < n:
        return (y[i + 1] - y[i]) / h
    return _slope_in(y, i)


def _slope_in(y: np.ndarray, i: int) -> float:
    h = 1.0 / RES
    if i - 2 >= 0:
        return (3 * y[i] - 4 * y[i - 1] + y[i - 2]) / (2 * h)
    if i - 1 >= 0:
        return (y[i] - y[i - 1]) / h
    return _slope_out(y, i)


def _hermite(va, ma, vb, mb, span, u):
    u2, u3 = u * u, u * u * u
    return ((2 * u3 - 3 * u2 + 1) * va + (u3 - 2 * u2 + u) * span * ma + (-2 * u3 + 3 * u2) * vb
            + (u3 - u2) * span * mb)


def _seg_error(ys, tols, a: int, b: int) -> tuple[float, int]:
    i0, i1 = a * RES, b * RES
    span = b - a
    u = (np.arange(i0, i1 + 1) - i0) / (i1 - i0)
    worst, at = 0.0, a
    for y, tol in zip(ys, tols):
        va, vb = y[i0], y[i1]
        ma, mb = _slope_out(y, i0), _slope_in(y, i1)
        pts = _hermite(va, ma, vb, mb, span, _U10)
        approx = np.interp(u, _U10, pts)          # spine-core: 10 linear pieces per bezier
        err = np.abs(approx - y[i0:i1 + 1]) / tol
        k = int(np.argmax(err))
        if err[k] > worst:
            worst, at = float(err[k]), a + int(round(k / RES))
    return worst, min(max(at, a + 1), b - 1)


def fit_keys(ys: list[np.ndarray], tols: list[float], F: int, must: set[int]) -> list[int]:
    keys = sorted({0, F} | {int(f) for f in must if 0 < f < F})
    for _ in range(4 * F + 8):
        new = set()
        for a, b in zip(keys, keys[1:]):
            if b - a < 2:
                continue
            err, at = _seg_error(ys, tols, a, b)
            if err > 1.0:
                new.add(at)
        if not new:
            break
        keys = sorted(set(keys) | new)
    return keys


def emit_track(track, ys: list[np.ndarray], tols: list[float], F: int, fps: int, must: set[int],
               extra: dict | None = None) -> int:
    keys = fit_keys(ys, tols, F, must)
    for j, fr in enumerate(keys):
        i = fr * RES
        vals = tuple(rnd(float(y[i])) for y in ys)
        value = vals if len(ys) > 1 else vals[0]
        curve = None
        if j + 1 < len(keys):
            nb = keys[j + 1]
            span = nb - fr
            ta, tb = fr / fps, nb / fps
            dt = tb - ta
            c: list[float] = []
            linear = True
            for y, tol in zip(ys, tols):
                va, vb = float(y[i]), float(y[nb * RES])
                ma, mb = _slope_out(y, i), _slope_in(y, nb * RES)
                cy1 = va + ma * span / 3
                cy2 = vb - mb * span / 3
                if abs(cy1 - (va + (vb - va) / 3)) > tol * 0.05 or abs(cy2 - (vb - (vb - va) / 3)) > tol * 0.05:
                    linear = False
                c += [rnd(ta + dt / 3, 5), rnd(cy1), rnd(tb - dt / 3, 5), rnd(cy2)]
            curve = None if linear else c
        track.key(fr, value, "linear", curve=curve, extra=extra)
    return len(keys)


# ------------------------------------------------------------------------------------------
# clip assembly
# ------------------------------------------------------------------------------------------

CLIP_KEYS = {"frames", "loop", "track", "keys", "layers", "swap", "events", "drag", "end", "base", "tempo"}
EVENT_KEYS = {"name", "at", "int", "float", "string"}


def _neutral(ch: str) -> float:
    return 1.0 if ch in MUL else 0.0


def _pose_track(sig: Sig, rig: ActingRig, keys: list[tuple[int, Pose, str]], where: str) -> dict[str, np.ndarray]:
    """Pose-to-pose signals; returns the IK mix signals."""
    frames = [k[0] for k in keys]
    chans = set()
    for _, pose, _ in keys:
        chans.update(pose.ch)
    t = sig.t
    for c in sorted(chans):
        vals = [pose.ch.get(c, _neutral(c[1])) for _, pose, _ in keys]
        arr = np.full(sig.n, vals[0], dtype=float)
        for i in range(1, len(keys)):
            f0, f1 = frames[i - 1], frames[i]
            m = t >= f0
            u = (t - f0) / max(f1 - f0, 1e-9)
            seg = vals[i - 1] + (vals[i] - vals[i - 1]) * ease_vec(keys[i][2], u)
            arr = np.where(m, np.where(t <= f1, seg, vals[i]), arr)
        if c[1] in MUL:
            sig.ch[c] = sig.get(*c) * arr
        else:
            sig.ch[c] = sig.get(*c) + arr
        changes = {frames[i] for i in range(len(keys))
                   if (i > 0 and vals[i] != vals[i - 1]) or (i + 1 < len(keys) and vals[i] != vals[i + 1])}
        sig.must.setdefault(c, set()).update(changes)
    iks: dict[str, np.ndarray] = {}
    names = set()
    for _, pose, _ in keys:
        names.update(pose.ik)
    for c in sorted(names):
        vals = [pose.ik.get(c, rig.ik[c].mix) for _, pose, _ in keys]
        arr = np.full(sig.n, vals[0], dtype=float)
        for i in range(1, len(keys)):
            f0, f1 = frames[i - 1], frames[i]
            u = (t - f0) / max(f1 - f0, 1e-9)
            seg = vals[i - 1] + (vals[i] - vals[i - 1]) * ease_vec(keys[i][2], u)
            arr = np.where(t >= f0, np.where(t <= f1, seg, vals[i]), arr)
        iks[c] = arr
    alphas = set()
    for _, pose, _ in keys:
        alphas.update(pose.alpha)
    for s in sorted(alphas):
        vals = [pose.alpha.get(s, 1.0) for _, pose, _ in keys]
        arr = np.full(sig.n, vals[0], dtype=float)
        for i in range(1, len(keys)):
            f0, f1 = frames[i - 1], frames[i]
            u = (t - f0) / max(f1 - f0, 1e-9)
            seg = vals[i - 1] + (vals[i] - vals[i - 1]) * ease_vec(keys[i][2], u)
            arr = np.where(t >= f0, np.where(t <= f1, seg, vals[i]), arr)
        sig.alpha[s] = arr
    # attachments: key a slot where the pose track CHANGES it (poses inherit the stance's
    # attachments, so re-asserting them on every key would undo explicit swaps in between)
    slots_all = set()
    for _, pose, _ in keys:
        slots_all.update(pose.att)
    for slot in sorted(slots_all):
        prev = object()
        for f, pose, _ in keys:
            if slot not in pose.att:
                continue
            name = pose.att[slot]
            if name != prev:
                sig.att_pose.setdefault(slot, {})[f] = name
            prev = name
    return iks


def _parse_keys(rig: ActingRig, spec, F: int, loop: bool, base: str, where: str, end_rest: bool):
    raw = spec or {}
    if not isinstance(raw, dict):
        raise ActingError(f"{where}: keys is a mapping {{frame: pose}}")
    keys: list[tuple[int, Pose, str]] = []
    for fr in sorted(raw, key=lambda k: int(k)):
        v = raw[fr]
        f = int(fr)
        if not 0 <= f <= F:
            raise ActingError(f"{where}: key frame {f} outside 0..{F}")
        if isinstance(v, dict) and "pose" in v:
            bad = sorted(set(map(str, v)) - {"pose", "ease"})
            if bad:
                raise ActingError(f"{where}.{f}: unknown key field(s) {', '.join(bad)} (pose, ease)")
            pose_spec, ease = v["pose"], v.get("ease")
        else:
            pose_spec, ease = v, None
        pose = parse_pose(rig, pose_spec, f"{where}.{f}", base if base != "none" else None) \
            if isinstance(pose_spec, dict) else resolve_pose(rig, str(pose_spec) if pose_spec is not None else "none", f"{where}.{f}")
        keys.append((f, pose, _check_ease(ease, f"{where}.{f}")))
    rest = resolve_pose(rig, base, where)
    if not keys or keys[0][0] != 0:
        keys.insert(0, (0, rest, "linear"))
    if loop:
        if keys[-1][0] != F:
            keys.append((F, copy.deepcopy(keys[0][1]), "sine_in_out"))
        else:
            first, last = keys[0][1], keys[-1][1]
            if first.ch != last.ch or first.ik != last.ik:
                raise ActingError(f"{where}: a loop must end on the pose it starts with (frame {F})")
    elif keys[-1][0] != F:
        keys.append((F, rest if end_rest else copy.deepcopy(keys[-1][1]), "sine_in_out"))
    return keys


def build_clip(name: str, spec: dict, rig: ActingRig, expect: dict | None = None) -> tuple[Anim, dict]:
    where = f"clips.{name}"
    if not isinstance(spec, dict):
        raise ActingError(f"{where}: expected a mapping")
    bad = sorted(k for k in spec if k not in CLIP_KEYS and not str(k).startswith(("$", "x_")))
    if bad:
        raise ActingError(f"{where}: unknown key(s) {', '.join(bad)} (known: {', '.join(sorted(CLIP_KEYS))})")
    expect = expect or {}
    F = int(spec.get("frames", expect.get("frames", 0)))
    if F <= 0:
        raise ActingError(f"{where}: `frames` is required")
    loop = bool(spec.get("loop", expect.get("loop", False)))
    track = int(spec.get("track", expect.get("track", 0)))
    base = str(spec.get("base", "rest" if track == 0 else "none"))
    end_rest = spec.get("end", "rest") == "rest"
    saved_tempo = rig.tempo
    if spec.get("tempo") is not None:
        rig.tempo = float(spec["tempo"])
    try:
        sig = Sig(F, loop)
        keys = _parse_keys(rig, spec.get("keys"), F, loop, base, f"{where}.keys", end_rest)
        iks = _pose_track(sig, rig, keys, where)
        posts = []
        for i, layer in enumerate(spec.get("layers") or []):
            lw = f"{where}.layers[{i}]"
            if not isinstance(layer, dict) or "preset" not in layer:
                raise ActingError(f"{lw}: expected {{preset: <name>, ...}} (presets: {', '.join(sorted(PRESETS) + sorted(POST))})")
            pn = str(layer["preset"])
            if pn in POST:
                posts.append((pn, layer, lw))
                continue
            if pn not in PRESETS:
                raise ActingError(f"{lw}: unknown preset '{pn}' (known: {', '.join(sorted(PRESETS) + sorted(POST))})")
            PRESETS[pn](sig, rig, layer, f"{lw} ({pn})")
        for key, frames in (spec.get("swap") or {}).items():
            for slot in _slots_of(rig, str(key), f"{where}.swap"):
                for fr, att in (frames or {}).items():
                    sig.set_att(slot, int(fr), _attachment(rig, slot, att, f"{where}.swap.{key}"), f"{where}.swap")
        if track == 0:
            _drag(sig, rig, spec.get("drag"), f"{where}.drag")
        elif spec.get("drag"):
            _drag(sig, rig, spec.get("drag"), f"{where}.drag")
        for pn, layer, lw in posts:
            _release(sig, rig, layer, f"{lw} ({pn})", iks)
        for i, ev in enumerate(spec.get("events") or []):
            ew = f"{where}.events[{i}]"
            if not isinstance(ev, dict) or "name" not in ev:
                raise ActingError(f"{ew}: expected {{name, at, string?}}")
            badk = sorted(set(map(str, ev)) - EVENT_KEYS)
            if badk:
                raise ActingError(f"{ew}: unknown key(s) {', '.join(badk)}")
            fr = int(ev.get("at", 0))
            if not 0 <= fr <= F:
                raise ActingError(f"{ew}: frame {fr} outside 0..{F}")
            sig.events.append((fr, str(ev["name"]), {k: ev[k] for k in ("int", "float", "string") if k in ev}))
        anim = _emit(name, sig, rig, iks, track)
    finally:
        rig.tempo = saved_tempo
    report = {"frames": F, "loop": loop, "track": track,
              "keys": sum(len(tr.keys) for p in anim.bones.values() for tr in p.values()),
              "timelines": sum(len(p) for p in anim.bones.values()) + len(anim.slots) + len(anim.ik),
              "events": [(f, n, pl.get("string")) for f, n, pl in sorted(sig.events)]}
    return anim, report


def _face_rules(sig: Sig, rig: ActingRig) -> None:
    """Pupils follow the eye state: hidden while an eye shows a state in face.hide_pupils."""
    hide = set(rig.face.get("hide_pupils", ["half", "closed"]))
    for eye in rig.groups.get("eyes", []):
        m = re.match(r"^(.*?)(_[LR])$", eye)
        if not m:
            continue
        pupil = f"pupil{m.group(2)}"
        if pupil not in rig.slots or eye not in sig.att:
            continue
        show = rig.slots[pupil].setup
        for fr, name in sorted(sig.att[eye].items()):
            want = None if name in hide or name is None else show
            cur = sig.att.setdefault(pupil, {})
            if fr in cur and cur[fr] != want:
                continue  # an explicit pupil swap on the same frame wins
            cur[fr] = want


def _emit(name: str, sig: Sig, rig: ActingRig, iks: dict[str, np.ndarray], track: int) -> Anim:
    F, fps, f = sig.F, rig.fps, rig.facing
    a = Anim(name, fps, F)
    if sig.loop:
        for arr in list(sig.ch.values()) + list(iks.values()) + list(sig.alpha.values()):
            arr[-1] = arr[0]
    for bone in rig.order:
        rot = sig.ch.get((bone, "rot"))
        if rot is not None and np.max(np.abs(rot)) > 1e-4:
            must = sig.must.get((bone, "rot"), set())
            emit_track(a.bone(bone, "rotate"), [f * rot], [TOL["rot"]], F, fps, must)
        X = sig.ch.get((bone, "x"))
        Y = sig.ch.get((bone, "y"))
        if (X is not None and np.max(np.abs(X)) > 1e-4) or (Y is not None and np.max(np.abs(Y)) > 1e-4):
            X = f * (X if X is not None else np.zeros(sig.n))
            Y = Y if Y is not None else np.zeros(sig.n)
            par = rig.bones[bone].parent
            th = math.radians(rig.bones[par].wrot) if par else 0.0
            lx = math.cos(th) * X + math.sin(th) * Y
            ly = -math.sin(th) * X + math.cos(th) * Y
            must = sig.must.get((bone, "x"), set()) | sig.must.get((bone, "y"), set())
            emit_track(a.bone(bone, "translate"), [lx, ly], [TOL["trans"]] * 2, F, fps, must)
        SX = sig.ch.get((bone, "sx"))
        SY = sig.ch.get((bone, "sy"))
        if (SX is not None and np.max(np.abs(SX - 1)) > 1e-6) or (SY is not None and np.max(np.abs(SY - 1)) > 1e-6):
            SX = SX if SX is not None else np.ones(sig.n)
            SY = SY if SY is not None else np.ones(sig.n)
            must = sig.must.get((bone, "sx"), set()) | sig.must.get((bone, "sy"), set())
            emit_track(a.bone(bone, "scale"), [SX, SY], [TOL["scale"]] * 2, F, fps, must)
    for c, arr in sorted(iks.items()):
        extra = None if rig.ik[c].bend > 0 else {"bendPositive": False}
        emit_track(a.ik_timeline(c), [arr, np.zeros(sig.n)], [TOL["mix"], 1.0], F, fps, set(), extra=extra)
    for s, arr in sorted(sig.alpha.items()):
        emit_track(a.slot(s, "alpha"), [arr], [TOL["alpha"]], F, fps, set())
    # attachments: track-0 clips reset every swappable slot on frame 0 (a clip never inherits a
    # previous clip's mouth or hand); loops must end with the attachments they start with
    merged: dict[str, dict[int, str | None]] = {}
    for s in set(sig.att_pose) | set(sig.att):
        m = dict(sig.att_pose.get(s, {}))
        m.update(sig.att.get(s, {}))
        merged[s] = m
    sig.att = merged
    if track == 0:
        for s, info in rig.slots.items():
            if len(info.attachments) > 1 or s in sig.att:
                sig.att.setdefault(s, {}).setdefault(0, info.setup)
    _face_rules(sig, rig)
    for s in sorted(sig.att):
        keys = sorted(sig.att[s].items())
        if track == 0 and keys[0][0] != 0:
            keys.insert(0, (0, rig.slots[s].setup))
        clean: list[tuple[int, str | None]] = []
        for fr, nm in keys:
            if clean and clean[-1][1] == nm:
                continue
            clean.append((fr, nm))
        if sig.loop:
            end_state = clean[-1][1]
            start_state = clean[0][1] if clean[0][0] == 0 else rig.slots[s].setup
            if end_state != start_state:
                raise ActingError(f"clips.{name}: loop ends with slot '{s}' = {end_state}, starts with {start_state}")
        if len(clean) == 1 and clean[0][1] == rig.slots[s].setup and track != 0:
            continue
        tr = a.slot(s, "attachment")
        for fr, nm in clean:
            tr.key(fr, nm, None)
    for fr, nm, payload in sorted(sig.events, key=lambda e: (e[0], e[1])):
        a.event(fr, nm, **payload)
    anchor = "hips" if "hips" in rig.bones else rig.order[0]
    a.ensure_length(anchor)
    return a


def prepare(rig: ActingRig, match_ik: bool = True) -> list[str]:
    """Resolve every pose; with match_ik, write the FK rotations that reproduce each IK chain's
    solution into the stance (so an IK -> FK mix starts from where the limb really is)."""
    notes: list[str] = []
    for n in list(rig.poses_raw):
        resolve_pose(rig, n, f"poses.{n}")
    if match_ik and rig.stance and rig.stance in rig.poses:
        st = rig.poses[rig.stance]
        for c, ik in rig.ik.items():
            if st.ik.get(c, ik.mix) >= 0.999 and len(ik.bones) == 2:
                sol = solve_ik2(rig, ik, st.ch)
                for k, v in sol.items():
                    st.ch[k] = round(v, 3)
                notes.append(f"stance: FK of {'/'.join(ik.bones)} matched to IK '{c}'")
        # poses based on the stance inherit the matched FK values unless they set them
        for n, spec in rig.poses_raw.items():
            if n == rig.stance:
                continue
            rig.poses.pop(n, None)
        for n in list(rig.poses_raw):
            resolve_pose(rig, n, f"poses.{n}")
    return notes
