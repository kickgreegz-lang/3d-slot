#!/usr/bin/env python3
"""Bass Drop rig generator: tools/spine/gen.py + the ANIMATION_SET additions that the shared contract
does not carry yet (CR-8, docs/games/bass-drop/ANIMATION_SET.md sections 2, 3, 10, 12).

    python tools/spine/examples/bass_drop/bdgen.py art/source/symbols/W/rig.yaml -o build/spine/bd/sym_W.json

It runs the stock generator (tools/spine/spinegen RigBuilder, unmodified) on rig.yaml + parts.json, then
applies `bassdrop.yaml` from the same folder:

  kind: wild | ui | high     budgets of ANIMATION_SET 10 for the generator's budget gate
                             (wild 34 bones / 12 slots / 300 verts, ui 40 / 30 / 400, high = contract)
  slots:                     empty runtime slots (live text, code-drawn LED arc, flipbook mounts)
    - {name: txt_wild, bone: txt_wild, after: ribbon}      # after: slot name | '^' (first)
  skins:                     skin-only attachments: moved out of the default skin into these skins
    mult: [badge_t1, badge_t2]                             # (an attachment missing from the active skin
    sticky: [badge_t1, clamps, clamps_open]                #  is empty, so default/base shows nothing)
  setup: {badge: badge_t1, clamps: null}                  # slot setup attachment (null = empty)
  paths: {notch_2/notch_w1_off: notch_1/notch_w1_off}      # optional shared regions (slot/att: part)
  clips:                     pose-to-pose clips (keys on whole frames, curves from named easing presets)
    bass_react:
      frames: 8              # exact length (the last key may sit earlier; the length is padded)
      loop: false
      ease: sine_in_out      # default arrival ease of each key's segment
      bones: {squash: {scale: [[0, 1], [1, [1.03, 0.95], quad_out], [4, [0.99, 1.03]], [8, 1]]}}
      slots: {fx_glow: {alpha: [[0, 0], [1, 0.8], [8, 0]], attachment: [[0, glow]]}}
      events: [{name: drop_release, at: 2}]
    idle: {merge: true, ...}  # add timelines to a generated contract animation (conflicts are errors)

Key rows are [frame, value, ease?]: `ease` shapes the segment that LEAVES this key (as in tools/spine
timeline.Key). Scale values may be one number (uniform). Colours are 'rrggbbaa' / 'rrggbb'. Everything else
(bones, meshes, physics, contract motions, accents, events) is rig.yaml for the stock generator.

The output is deterministic and carries a recomputed skeleton.hash. Exit 0 ok, 1 rig error, 2 usage.
"""
from __future__ import annotations

import argparse
import copy
import json
import os
import sys
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
SPINE = HERE.parent.parent
sys.path.insert(0, str(SPINE))

import yaml  # noqa: E402

from spinegen import provenance as prov  # noqa: E402
from spinegen.rig import GEN_VERSION, RigBuilder, RigError, _hash, dump  # noqa: E402
from spinegen.timeline import BONE_CHANNELS, Anim  # noqa: E402

BD_VERSION = "1.0.0"
# ANIMATION_SET 10 (budgets summary). 'high' = the contract's symbol budgets.
KIND_BUDGETS = {
    "wild": {"bones": 34, "slots": 12, "meshVertices": 300, "physics": 4},
    "ui": {"bones": 40, "slots": 30, "meshVertices": 400, "physics": 0},
    "high": {"bones": 30, "slots": 8, "meshVertices": 250, "physics": 4},
}
BD_KEYS = {"kind", "slots", "skins", "setup", "paths", "clips"}
CLIP_KEYS = {"frames", "loop", "ease", "bones", "slots", "events", "merge", "track", "retime"}


def _chk(obj, allowed, where):
    if obj is None:
        return
    if not isinstance(obj, dict):
        raise RigError(f"{where}: expected a mapping")
    bad = sorted(k for k in obj if not (k in allowed or str(k).startswith(("$", "x_"))))
    if bad:
        raise RigError(f"{where}: unknown key(s) {', '.join(bad)} (known: {', '.join(sorted(allowed))})")


def _rgba(v):
    if isinstance(v, str):
        s = v.lstrip("#")
        if len(s) == 6:
            s += "ff"
        if len(s) != 8:
            raise RigError(f"colour '{v}': use rrggbb or rrggbbaa")
        return tuple(int(s[i:i + 2], 16) / 255 for i in (0, 2, 4, 6))
    return tuple(float(x) for x in v)


def _rows(rows, where):
    if not isinstance(rows, list) or not rows:
        raise RigError(f"{where}: expected a list of [frame, value, ease?] rows")
    out = []
    for r in rows:
        if not isinstance(r, list) or len(r) not in (2, 3):
            raise RigError(f"{where}: bad key row {r!r} (want [frame, value, ease?])")
        out.append((r[0], r[1], r[2] if len(r) == 3 else None))
    return out


def build_clip(name: str, spec: dict, anim: Anim | None, fps: int, bones: set, slots: set) -> Anim:
    _chk(spec, CLIP_KEYS, f"clips.{name}")
    if anim is None:
        if "frames" not in spec:
            raise RigError(f"clips.{name}: `frames` is required")
        anim = Anim(name, fps, int(spec["frames"]))
    ease0 = spec.get("ease", "sine_in_out")
    for bone, tls in (spec.get("bones") or {}).items():
        if bone not in bones:
            raise RigError(f"clips.{name}.bones.{bone}: no such bone")
        for kind, rows in (tls or {}).items():
            if kind not in BONE_CHANNELS:
                raise RigError(f"clips.{name}.bones.{bone}.{kind}: timeline must be one of {', '.join(BONE_CHANNELS)}")
            tr = anim.bone(bone, kind)
            two = len(BONE_CHANNELS[kind]) == 2
            for f, v, e in _rows(rows, f"clips.{name}.bones.{bone}.{kind}"):
                if two and not isinstance(v, (list, tuple)):
                    if kind not in ("scale",):
                        raise RigError(f"clips.{name}.bones.{bone}.{kind}: frame {f} needs [x, y]")
                    v = (float(v), float(v))
                elif two:
                    v = (float(v[0]), float(v[1]))
                else:
                    v = float(v)
                tr.key(f, v, e or ease0)
    for slot, tls in (spec.get("slots") or {}).items():
        if slot not in slots:
            raise RigError(f"clips.{name}.slots.{slot}: no such slot")
        for kind, rows in (tls or {}).items():
            if kind not in ("alpha", "rgba", "rgb", "attachment"):
                raise RigError(f"clips.{name}.slots.{slot}.{kind}: use alpha | rgba | rgb | attachment")
            tr = anim.slot(slot, kind)
            for f, v, e in _rows(rows, f"clips.{name}.slots.{slot}.{kind}"):
                if kind == "attachment":
                    tr.key(f, v, None)
                elif kind == "alpha":
                    tr.key(f, float(v), e or ease0)
                else:
                    c = _rgba(v)
                    tr.key(f, c if kind == "rgba" else c[:3], e or ease0)
    for ev in spec.get("events") or []:
        _chk(ev, {"name", "at", "string", "int", "float"}, f"clips.{name}.events")
        payload = {k: ev[k] for k in ("int", "float", "string") if k in ev}
        anim.event(int(ev.get("at", 0)), ev["name"], **payload)
    return anim


def pad_length(anim: Anim) -> None:
    """Make the clip exactly `frames` long: extend a timeline that stops early with a hold key."""
    if anim.frames is None or anim.last_frame() >= anim.frames:
        return
    for group in (anim.bones, anim.slots):
        for props in group.values():
            for kind, tr in props.items():
                if tr.keys and kind != "attachment":
                    tr.key(anim.frames, tr.value_at_end(), "linear")
                    return
    raise RigError(f"clip {anim.name}: no timeline to pad to {anim.frames} frames")


class BassDropBuilder(RigBuilder):
    def __init__(self, rig_path, bd: dict, **kw):
        super().__init__(rig_path, **kw)
        self.bd = bd
        kind = bd.get("kind", "high")
        if kind not in KIND_BUDGETS:
            raise RigError(f"bassdrop.yaml kind '{kind}': use {' | '.join(KIND_BUDGETS)}")
        self.bd_kind = kind
        # the stock generator's budget gate reads self.contract['budgets'] (an in-memory copy)
        self.contract = copy.deepcopy(self.contract)
        self.contract["budgets"] = dict(self.contract["budgets"], **{k: v for k, v in KIND_BUDGETS[kind].items() if k != "physics"})

    def build(self) -> dict:
        doc = super().build()
        bd = self.bd
        bones = {b["name"] for b in doc["bones"]}
        # 1. empty runtime slots
        for s in bd.get("slots") or []:
            _chk(s, {"name", "bone", "after", "blend", "color"}, f"slots[{s.get('name')}]")
            if s["bone"] not in bones:
                raise RigError(f"slots.{s['name']}: bone '{s['bone']}' not declared (add it to rig.yaml bones)")
            if any(x["name"] == s["name"] for x in doc["slots"]):
                raise RigError(f"slots.{s['name']}: slot exists already")
            entry = {"name": s["name"], "bone": s["bone"]}
            if s.get("color"):
                entry["color"] = s["color"]
            if s.get("blend"):
                entry["blend"] = s["blend"]
            after = s.get("after", "^")
            if after == "^":
                doc["slots"].insert(0, entry)
            else:
                idx = [i for i, x in enumerate(doc["slots"]) if x["name"] == after]
                if not idx:
                    raise RigError(f"slots.{s['name']}: after '{after}': no such slot")
                doc["slots"].insert(idx[0] + 1, entry)
        slot_names = [s["name"] for s in doc["slots"]]
        # 2. skin-only attachments
        default = doc["skins"][0]
        moved: dict[str, dict] = {}
        for skin_name, atts in (bd.get("skins") or {}).items():
            skin = next((s for s in doc["skins"] if s["name"] == skin_name), None)
            if skin is None:
                skin = {"name": skin_name, "attachments": {}}
                doc["skins"].append(skin)
            for att in atts:
                src = None
                for slot, entries in default["attachments"].items():
                    if att in entries:
                        src = (slot, entries[att])
                if src is None and att in moved:
                    src = moved[att]
                if src is None:
                    raise RigError(f"skins.{skin_name}: attachment '{att}' not in the default skin")
                moved[att] = src
                skin["attachments"].setdefault(src[0], {})[att] = copy.deepcopy(src[1])
        for att, (slot, _) in moved.items():
            default["attachments"][slot].pop(att, None)
            if not default["attachments"][slot]:
                default["attachments"].pop(slot)
        # keep skin attachment maps in slot order (deterministic, like the default skin)
        for skin in doc["skins"]:
            skin["attachments"] = {k: skin["attachments"][k] for k in slot_names if k in skin["attachments"]}
        # 3. slot setup attachments
        for slot, att in (bd.get("setup") or {}).items():
            s = next((x for x in doc["slots"] if x["name"] == slot), None)
            if s is None:
                raise RigError(f"setup.{slot}: no such slot")
            if att is None:
                s.pop("attachment", None)
            else:
                s["attachment"] = att
        # 4. shared regions
        for key, part in (bd.get("paths") or {}).items():
            slot, att = key.split("/", 1)
            hit = False
            for skin in doc["skins"]:
                a = skin["attachments"].get(slot, {}).get(att)
                if a is not None:
                    a["path"] = f"{self.prefix}/{part}"
                    hit = True
            if not hit:
                raise RigError(f"paths.{key}: attachment not found")
        # 5. clips
        anims = doc["animations"]
        all_bones = set(bones)
        for name, spec in (bd.get("clips") or {}).items():
            spec = spec or {}
            merge = bool(spec.get("merge"))
            if merge and name not in anims:
                raise RigError(f"clips.{name}: merge: true but the generator made no '{name}' (enable it in rig.yaml motion)")
            if not merge and name in anims:
                raise RigError(f"clips.{name}: '{name}' is generated already; use merge: true or disable it in rig.yaml motion")
            a = build_clip(name, spec, None if not merge else Anim(name, self.fps, None), self.fps, all_bones, set(slot_names))
            if merge:
                frag = a.to_json()
                base = anims[name]
                for group in ("slots", "bones"):
                    for target, tls in frag.get(group, {}).items():
                        cur = base.setdefault(group, {}).setdefault(target, {})
                        for kind, keys in tls.items():
                            if kind in cur:
                                raise RigError(f"clips.{name}: {group[:-1]} '{target}' already has a '{kind}' timeline")
                            cur[kind] = keys
                        base[group][target] = dict(sorted(cur.items()))
                    if group in base:
                        base[group] = dict(sorted(base[group].items()))
                for ev_name, fr in (spec.get("retime") or {}).items():   # move a generated event (e.g. explode_done f13)
                    hits = [e for e in base.get("events", []) if e["name"] == ev_name]
                    if len(hits) != 1:
                        raise RigError(f"clips.{name}.retime.{ev_name}: expected one generated event, found {len(hits)}")
                    t = round(int(fr) / self.fps, 5)
                    if t:
                        hits[0]["time"] = t
                    else:
                        hits[0].pop("time", None)
                if frag.get("events") or spec.get("retime"):
                    base["events"] = sorted(base.get("events", []) + frag.get("events", []), key=lambda e: (e.get("time", 0), e["name"]))
                # a merged fragment must not lengthen the animation
                if a.last_frame() and self._anim_len(base) + 1e-6 < a.last_frame() / self.fps:
                    raise RigError(f"clips.{name}: merged keys reach past the generated length")
            else:
                pad_length(a)
                anims[name] = a.to_json()
        for an in anims.values():
            for e in an.get("events", []):
                doc["events"].setdefault(e["name"], {})
        doc["events"] = dict(sorted(doc["events"].items(), key=lambda kv: (kv[0] not in ("land_impact", "win_peak", "explode_burst", "explode_done", "sfx", "vfx", "shake"), kv[0])))
        # budgets (ANIMATION_SET 10) on the final skeleton
        B = KIND_BUDGETS[self.bd_kind]
        nphys = sum(1 for c in doc.get("constraints", []) if c["type"] == "physics")
        for k, v in (("bones", len(doc["bones"])), ("slots", len(doc["slots"])), ("physics", nphys)):
            if v > B[k]:
                raise RigError(f"budget ({self.bd_kind}): {k} {v} > {B[k]} (ANIMATION_SET 10)")
        self.report.stats.update({"slots": len(doc["slots"]), "animations": list(anims), "physics": nphys})
        doc["skeleton"]["hash"] = ""
        doc["skeleton"]["hash"] = _hash(doc)
        return doc

    @staticmethod
    def _anim_len(a: dict) -> float:
        t = 0.0
        for group in ("bones", "slots"):
            for tls in a.get(group, {}).values():
                for keys in tls.values():
                    for k in keys:
                        t = max(t, k.get("time", 0.0))
        for e in a.get("events", []):
            t = max(t, e.get("time", 0.0))
        return t


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="bdgen.py", description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__.split("\n", 2)[2])
    ap.add_argument("rig")
    ap.add_argument("-o", "--out", required=True)
    ap.add_argument("--bd", default=None, help="bassdrop.yaml (default: next to rig.yaml)")
    ap.add_argument("--images-path", default=None)
    ap.add_argument("--provenance", default=None)
    ap.add_argument("--manifest", default=None)
    ap.add_argument("--license-id", default="owned-code")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args(argv)
    bd_path = Path(a.bd) if a.bd else Path(a.rig).resolve().parent / "bassdrop.yaml"
    try:
        bd = yaml.safe_load(bd_path.read_text(encoding="utf-8")) if bd_path.exists() else {}
        _chk(bd, BD_KEYS, str(bd_path))
        rb = BassDropBuilder(a.rig, bd or {}, out_path=a.out, images_path=a.images_path)
        doc = rb.build()
    except (RigError, ValueError, FileNotFoundError, KeyError) as e:
        print(f"bdgen.py: ERROR: {e}", file=sys.stderr)
        return 1
    text = dump(doc)
    out = Path(a.out)
    if a.check:
        ok = out.exists() and out.read_text(encoding="utf-8") == text
        print(f"bdgen.py: {'up to date' if ok else 'DRIFT'}: {out}", file=sys.stdout if ok else sys.stderr)
        return 0 if ok else 1
    out.parent.mkdir(parents=True, exist_ok=True)
    if not out.exists() or out.read_text(encoding="utf-8") != text:
        out.write_text(text, encoding="utf-8")
    st = rb.report.stats
    if not a.quiet:
        print(f"bdgen.py: wrote {out}  ({rb.skel_name}, bassdrop kind {rb.bd_kind}, generator kind {rb.kind})")
        print(f"  bones {st['bones']}  slots {st['slots']}  mesh vertices {st['meshVertices']}  physics {st['physics']}")
        print(f"  animations: {', '.join(st['animations'])}")
        for m, info in (st.get("meshes") or {}).items():
            print(f"  mesh {m}: {info['vertices']} verts, {info['triangles']} tris")
        for w in rb.report.warnings:
            print(f"  warning: {w}")
    if a.provenance or a.manifest:
        inputs = list(dict.fromkeys(rb.report.inputs + ([bd_path] if bd_path.exists() else [])))
        row = prov.make_row(asset_id=f"{rb.skel_name}.skeleton-json", path=out, stage="spine-authoring",
                            model="tools/spine/examples/bass_drop/bdgen.py", version=f"{GEN_VERSION}+bd{BD_VERSION}",
                            inputs=inputs, license_id=a.license_id, shipped=False,
                            notes=f"spine {doc['skeleton']['spine']}; inputs: " + ", ".join(prov.rel(p) for p in inputs[:3])
                            + f" (+{max(0, len(inputs) - 3)} images)")
        for f in (a.provenance, a.manifest):
            if f:
                n = prov.append_rows(f, [row], "tools/spine/examples/bass_drop/bdgen.py")
                if not a.quiet:
                    print(f"  provenance: {'added' if n else 'unchanged'} {row['id']} -> {f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
