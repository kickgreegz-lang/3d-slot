"""Timeline builders that emit Spine 4.3 JSON animation maps.

Keys are placed on integer FRAMES (30 fps); every curve is computed from a named easing
preset into Spine's absolute bezier form, with the channel count taken from the timeline
type. Nothing here is hand-typed JSON.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .easing import absolute_curve, rnd

# timeline type -> value channels (as JSON field names). None = attachment/non-curve.
BONE_CHANNELS: dict[str, tuple[str, ...]] = {
    "rotate": ("value",),
    "translate": ("x", "y"),
    "translatex": ("value",),
    "translatey": ("value",),
    "scale": ("x", "y"),
    "scalex": ("value",),
    "scaley": ("value",),
    "shear": ("x", "y"),
    "shearx": ("value",),
    "sheary": ("value",),
}
SLOT_CHANNELS: dict[str, tuple[str, ...] | None] = {
    "alpha": ("value",),
    "rgba": ("r", "g", "b", "a"),
    "rgb": ("r", "g", "b"),
    "attachment": None,
}
PHYSICS_CHANNELS = ("inertia", "strength", "damping", "mass", "wind", "gravity", "mix")
IK_CHANNELS = ("mix", "softness")  # 4.3 IK keys: 2 curve channels (8 numbers), plus bendPositive/compress/stretch flags

# neutral values used to check that one-shots return to rest
REST = {"rotate": 0.0, "translate": (0.0, 0.0), "scale": (1.0, 1.0), "shear": (0.0, 0.0),
        "translatex": 0.0, "translatey": 0.0, "scalex": 1.0, "scaley": 1.0, "shearx": 0.0, "sheary": 0.0}


def color_hex(c: tuple[float, ...]) -> str:
    return "".join(f"{max(0, min(255, round(v * 255))):02x}" for v in c)


@dataclass
class Key:
    frame: int
    value: object
    ease: str | None = "linear"
    overshoot: float | None = None
    curve: list[float] | None = None     # explicit absolute curve (4 numbers per channel); overrides `ease`
    extra: dict | None = None            # extra key fields (e.g. IK bendPositive: false)


@dataclass
class Track:
    kind: str
    channels: tuple[str, ...] | None
    keys: list[Key] = field(default_factory=list)
    label: str = ""

    def key(self, frame: int | float, value, ease: str | None = "linear", overshoot: float | None = None,
            curve: list[float] | None = None, extra: dict | None = None) -> "Track":
        f = int(round(frame))
        if abs(f - frame) > 1e-6:
            raise ValueError(f"{self.label}: keys must sit on whole frames, got {frame}")
        if f < 0:
            raise ValueError(f"{self.label}: negative frame {f}")
        for k in self.keys:
            if k.frame == f:
                raise ValueError(f"{self.label}: two keys on frame {f}")
        if self.channels and len(self.channels) > 1:
            if not isinstance(value, (tuple, list)) or len(value) != len(self.channels):
                raise ValueError(f"{self.label}: expected {len(self.channels)} values, got {value!r}")
        if curve is not None and (not self.channels or len(curve) != 4 * len(self.channels)):
            raise ValueError(f"{self.label}: explicit curve needs 4 numbers per channel")
        self.keys.append(Key(f, value, ease, overshoot, curve, extra))
        self.keys.sort(key=lambda k: k.frame)
        return self

    @property
    def last_frame(self) -> int:
        return self.keys[-1].frame if self.keys else 0

    def value_at_end(self):
        return self.keys[-1].value if self.keys else None

    def value_at_start(self):
        return self.keys[0].value if self.keys else None

    def emit(self, fps: int) -> list[dict]:
        out: list[dict] = []
        for i, k in enumerate(self.keys):
            t = rnd(k.frame / fps, 5)
            m: dict = {}
            if t:
                m["time"] = t
            if self.channels is None:  # attachment
                m["name"] = k.value
                out.append(m)
                continue
            vals = k.value if len(self.channels) > 1 else (k.value,)
            if self.kind in ("rgba", "rgb"):
                vals = tuple(round(v * 255) / 255 for v in vals)
                m["color"] = color_hex(tuple(vals))
            else:
                for ch, v in zip(self.channels, vals):
                    m[ch] = rnd(v)
            if k.extra:
                m.update(k.extra)
            if k.curve is not None:
                if i + 1 < len(self.keys):
                    m["curve"] = list(k.curve)
                out.append(m)
                continue
            if i + 1 < len(self.keys):
                nxt = self.keys[i + 1]
                nvals = nxt.value if len(self.channels) > 1 else (nxt.value,)
                if self.kind in ("rgba", "rgb"):
                    nvals = tuple(round(v * 255) / 255 for v in nvals)
                if nxt.value != k.value or k.ease == "stepped":
                    curve = absolute_curve(k.ease, t, rnd(nxt.frame / fps, 5),
                                           [(float(a), float(b)) for a, b in zip(vals, nvals)], k.overshoot)
                    if curve is not None:
                        m["curve"] = curve
            out.append(m)
        return out


class Anim:
    """One animation: bone/slot/physics timelines + events, emitted as Spine 4.3 JSON."""

    def __init__(self, name: str, fps: int = 30, frames: int | None = None):
        self.name = name
        self.fps = fps
        self.frames = frames  # nominal length; enforced with an end marker if nothing reaches it
        self.bones: dict[str, dict[str, Track]] = {}
        self.slots: dict[str, dict[str, Track]] = {}
        self.physics: dict[str, dict[str, Track]] = {}
        self.ik: dict[str, Track] = {}
        self.events: list[dict] = []
        self.markers: dict[str, int] = {}

    def bone(self, bone: str, kind: str) -> Track:
        if kind not in BONE_CHANNELS:
            raise ValueError(f"unknown bone timeline '{kind}'")
        props = self.bones.setdefault(bone, {})
        if kind in props:
            raise ValueError(f"{self.name}: bone '{bone}' already has a '{kind}' timeline (accent conflict?)")
        props[kind] = Track(kind, BONE_CHANNELS[kind], label=f"{self.name}/{bone}/{kind}")
        return props[kind]

    def has_bone(self, bone: str, kind: str) -> bool:
        return kind in self.bones.get(bone, {})

    def slot(self, slot: str, kind: str) -> Track:
        if kind not in SLOT_CHANNELS:
            raise ValueError(f"unknown slot timeline '{kind}'")
        props = self.slots.setdefault(slot, {})
        if kind in props:
            raise ValueError(f"{self.name}: slot '{slot}' already has a '{kind}' timeline")
        props[kind] = Track(kind, SLOT_CHANNELS[kind], label=f"{self.name}/{slot}/{kind}")
        return props[kind]

    def phys(self, constraint: str, kind: str) -> Track:
        if kind not in PHYSICS_CHANNELS:
            raise ValueError(f"unknown physics timeline '{kind}'")
        props = self.physics.setdefault(constraint, {})
        props[kind] = Track(kind, ("value",), label=f"{self.name}/{constraint}/{kind}")
        return props[kind]

    def ik_timeline(self, constraint: str) -> Track:
        """IK constraint timeline (mix + softness per key; flags go in Key.extra)."""
        if constraint in self.ik:
            raise ValueError(f"{self.name}: IK constraint '{constraint}' already has a timeline")
        self.ik[constraint] = Track("ik", IK_CHANNELS, label=f"{self.name}/ik/{constraint}")
        return self.ik[constraint]

    def event(self, frame: int, name: str, **payload) -> None:
        e = {"frame": int(frame), "name": name}
        e.update(payload)
        self.events.append(e)

    def last_frame(self) -> int:
        f = 0
        for group in (self.bones, self.slots, self.physics):
            for props in group.values():
                for tr in props.values():
                    f = max(f, tr.last_frame)
        for tr in self.ik.values():
            f = max(f, tr.last_frame)
        for e in self.events:
            f = max(f, e["frame"])
        return f

    def to_json(self) -> dict:
        fps = self.fps
        out: dict = {}
        end = self.last_frame()
        if self.frames is not None and end > self.frames:
            raise ValueError(f"{self.name}: keys reach frame {end} > nominal length {self.frames}")
        if self.slots:
            out["slots"] = {s: {k: tr.emit(fps) for k, tr in sorted(p.items())} for s, p in sorted(self.slots.items())}
        if self.bones:
            out["bones"] = {b: {k: tr.emit(fps) for k, tr in sorted(p.items())} for b, p in sorted(self.bones.items())}
        if self.ik:
            out["ik"] = {c: tr.emit(fps) for c, tr in sorted(self.ik.items())}
        if self.physics:
            out["physics"] = {c: {k: tr.emit(fps) for k, tr in sorted(p.items())} for c, p in sorted(self.physics.items())}
        if self.events:
            evs = []
            for e in sorted(self.events, key=lambda e: (e["frame"], e["name"])):
                m = {}
                t = rnd(e["frame"] / fps, 5)
                if t:
                    m["time"] = t
                m["name"] = e["name"]
                for k in ("int", "float", "string"):
                    if k in e:
                        m[k] = e[k]
                evs.append(m)
            out["events"] = evs
        return out

    def ensure_length(self, anchor_bone: str) -> None:
        """Make the animation exactly `frames` long: if no timeline reaches the end, hold the
        last value of a timeline on the anchor bone (or add a zero rotate hold)."""
        if self.frames is None or self.last_frame() >= self.frames:
            return
        props = self.bones.get(anchor_bone, {})
        for kind, tr in props.items():
            if tr.keys:
                tr.key(self.frames, tr.value_at_end(), "linear")
                return
        tr = self.bone(anchor_bone, "rotate")
        tr.key(0, 0.0).key(self.frames, 0.0)
