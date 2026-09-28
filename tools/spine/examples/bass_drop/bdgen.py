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
  rename: {clamp_L: {clamp_L_shut: clamp}}                 # attachment names per slot (the region path keeps
                                                           # the part name), e.g. ANIMATION_SET's `clamp` in 2 slots
  untouched: [fx_trail, fx_ring]                           # fx slots (and their fx bones) the contract motions must
                                                           # not animate: their generated glow keys are removed
  skins_copy: {base: [trim_base]}                          # like skins, but the attachment also stays in default
  skin_rename: {base: {rim_trim: {trim_base: trim}}}       # rename inside one skin (same name, other image per skin)
  clone: {notch_2: notch_1}                                # copy a slot's default-skin attachments (and setup) to
                                                           # another slot (declare it under `slots`)
  region_scale: {glow_ring: 2}                             # soft art authored at 1/s size: the region draws s x bigger
  radial_weights:                                          # mesh weights by radius (image space) instead of rig.yaml's
    cone: {centre: [380, 440], inner: [cone, 150], outer: [ring, 222]}
  clips:                     pose-to-pose clips (keys on whole frames, curves from named easing presets)
    bass_react:
      frames: 8              # exact length (the last key may sit earlier; the length is padded)
      loop: false
      ease: sine_in_out      # default arrival ease of each key's segment
      bones: {squash: {scale: [[0, 1], [1, [1.03, 0.95], quad_out], [4, [0.99, 1.03]], [8, 1]]}}
      slots: {fx_glow: {alpha: [[0, 0], [1, 0.8], [8, 0]], attachment: [[0, glow]]}}
      events: [{name: drop_release, at: 2}]
    idle: {merge: true, ...}  # add timelines to a generated contract animation (conflicts are errors)
    explode: {merge: true, override: true, ...}   # ... or replace the generated timelines it names

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
BD_KEYS = {"kind", "slots", "skins", "skins_copy", "skin_rename", "clone", "radial_weights", "region_scale", "setup",
           "paths", "clips", "rename", "untouched"}
CLIP_KEYS = {"frames", "loop", "ease", "bones", "slots", "events", "merge", "track", "retime", "override"}


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
        # 0. fx slots that are not glows (speed streak, impact ring, ...): no generated glow keys
        for name in bd.get("untouched") or []:
            slot = next((x for x in doc["slots"] if x["name"] == name), None)
            if slot is None:
                raise RigError(f"untouched.{name}: no such slot")
            for an in doc["animations"].values():
                an.get("slots", {}).pop(name, None)
                if slot["bone"].startswith("fx_") and slot["bone"] not in {s["bone"] for s in doc["slots"] if s["name"] != name}:
                    an.get("bones", {}).pop(slot["bone"], None)
                for group in ("slots", "bones"):
                    if group in an and not an[group]:
                        an.pop(group)
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
        for skin_name, atts in (bd.get("skins_copy") or {}).items():
            skin = next((s for s in doc["skins"] if s["name"] == skin_name), None)
            if skin is None:
                skin = {"name": skin_name, "attachments": {}}
                doc["skins"].append(skin)
            for att in atts:
                hit = [(slot, ent[att]) for slot, ent in default["attachments"].items() if att in ent]
                if not hit:
                    raise RigError(f"skins_copy.{skin_name}: attachment '{att}' not in the default skin")
                skin["attachments"].setdefault(hit[0][0], {})[att] = copy.deepcopy(hit[0][1])
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
        # 4b. attachment names per slot (the region path stays the part's)
        renamed: dict[tuple[str, str], str] = {}
        for slot, mapping in (bd.get("rename") or {}).items():
            if slot not in slot_names:
                raise RigError(f"rename.{slot}: no such slot")
            for old, new in (mapping or {}).items():
                hit = False
                for skin in doc["skins"]:
                    ent = skin["attachments"].get(slot, {})
                    if old in ent:
                        a = ent.pop(old)
                        a.setdefault("path", f"{self.prefix}/{old}")
                        ent[new] = a
                        hit = True
                if not hit:
                    raise RigError(f"rename.{slot}.{old}: attachment not found")
                renamed[(slot, old)] = new
                s = next(x for x in doc["slots"] if x["name"] == slot)
                if s.get("attachment") == old:
                    s["attachment"] = new
        if renamed:
            for an in doc["animations"].values():
                for slot, tls in an.get("slots", {}).items():
                    for k in tls.get("attachment", []):
                        if (slot, k.get("name")) in renamed:
                            k["name"] = renamed[(slot, k["name"])]
        # 4c. per-skin renames (e.g. one `trim` attachment name, a different image in each skin)
        for skin_name, slots_map in (bd.get("skin_rename") or {}).items():
            skin = next((x for x in doc["skins"] if x["name"] == skin_name), None)
            if skin is None:
                raise RigError(f"skin_rename.{skin_name}: no such skin")
            for slot, mapping in (slots_map or {}).items():
                ent = skin["attachments"].get(slot, {})
                for old, new in (mapping or {}).items():
                    if old not in ent:
                        raise RigError(f"skin_rename.{skin_name}.{slot}.{old}: attachment not found")
                    a = ent.pop(old)
                    a.setdefault("path", f"{self.prefix}/{old}")
                    ent[new] = a
        # 4d. clones: a slot gets another slot's default-skin attachments (bone-local, so both bones must share the
        #     same world orientation) and its setup attachment
        for dst, src in (bd.get("clone") or {}).items():
            if dst not in slot_names or src not in slot_names:
                raise RigError(f"clone.{dst}: slots '{dst}' / '{src}' must both exist")
            ent = default["attachments"].get(src)
            if not ent:
                raise RigError(f"clone.{dst}: slot '{src}' has no default-skin attachments")
            new = {}
            for name, a in ent.items():
                b = copy.deepcopy(a)
                b.setdefault("path", f"{self.prefix}/{name}")
                new[name] = b
            default["attachments"][dst] = new
            s_src = next(x for x in doc["slots"] if x["name"] == src)
            s_dst = next(x for x in doc["slots"] if x["name"] == dst)
            if "attachment" in s_src and "attachment" not in s_dst:
                s_dst["attachment"] = s_src["attachment"]
        default["attachments"] = {k: default["attachments"][k] for k in slot_names if k in default["attachments"]}
        # 4e. regions authored at 1/s resolution (soft glows, thin tinted bands): drawn s x bigger around the same centre
        for part, sc in (bd.get("region_scale") or {}).items():
            hit = False
            for skin in doc["skins"]:
                for ent in skin["attachments"].values():
                    for a in ent.values():
                        if a.get("type", "region") == "region" and a.get("path", "").split("/")[-1] == part or \
                                (a.get("type", "region") == "region" and "path" not in a and part in ent and ent[part] is a):
                            a["scaleX"] = a["scaleY"] = float(sc)
                            hit = True
            if not hit:
                raise RigError(f"region_scale.{part}: no region attachment uses it")
        # 4f. radial mesh weights
        for att, spec in (bd.get("radial_weights") or {}).items():
            self._radial_weights(doc, att, spec)
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
                            if kind in cur and not spec.get("override"):
                                raise RigError(f"clips.{name}: {group[:-1]} '{target}' already has a '{kind}' timeline"
                                               " (override: true replaces it)")
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

    def _radial_weights(self, doc: dict, att: str, spec: dict) -> None:
        """Reweight a mesh by radius from `centre` (image space): 100 % `inner` bone inside its radius, 100 % `outer`
        bone outside its radius, smoothstep between (a bulge that keeps its rim in place)."""
        _chk(spec, {"centre", "inner", "outer"}, f"radial_weights.{att}")
        part = self.part_by_name.get(att)
        if part is None:
            raise RigError(f"radial_weights.{att}: no such part")
        m = None
        for skin in doc["skins"]:
            for ent in skin["attachments"].values():
                if att in ent and ent[att].get("type") == "mesh":
                    m = ent[att]
        if m is None:
            raise RigError(f"radial_weights.{att}: not a mesh attachment")
        (b_in, r_in), (b_out, r_out) = spec["inner"], spec["outer"]
        for b in (b_in, b_out):
            if b not in self.bones:
                raise RigError(f"radial_weights.{att}: bone '{b}' missing")
        cx, cy = spec["centre"]
        x0, y0, w, h = part.bbox
        uv = m["uvs"]
        verts = []
        for i in range(0, len(uv), 2):
            px, py = x0 + uv[i] * w, y0 + uv[i + 1] * h
            r = ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5
            t = max(0.0, min(1.0, (r - r_in) / max(1e-6, r_out - r_in)))
            t = t * t * (3 - 2 * t)
            ws = [(b_in, 1 - t), (b_out, t)]
            ws = [(n, round(v, 4)) for n, v in ws if round(v, 4) > 0]
            d = round(1 - sum(v for _, v in ws), 4)
            if d:
                ws[0] = (ws[0][0], round(ws[0][1] + d, 4))
            sx, sy = self.img2sk(px, py)
            verts.append(len(ws))
            for n, v in ws:
                lx, ly = self.bones[n].to_local(sx, sy)
                verts += [self.bone_index(n), round(lx, 2), round(ly, 2), v]
        m["vertices"] = verts

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
