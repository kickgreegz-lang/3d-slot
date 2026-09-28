#!/usr/bin/env python3
"""ANIMATION_SET 4 table checks for the env rigs (validate.mjs --kind env checks only budgets and static rules; the
per-rig clip tables live here, the way check_bd.mjs does it for the symbols and the meter).

    tools/.venv/bin/python tools/bdart/check_env.py build/spine/bd/env_speaker_stack.json [--report file]
Exit 0 = pass, 1 = fail.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

FPS = 30
TABLES = {
    # ANIMATION_SET 4.1
    "env_speaker_stack": {
        "budget": {"slots": 12, "bones": 20},
        "slots": ["cabinet", "woofer_rim", "woofer", "port_L", "port_R", "cable_1", "cable_2", "floor_light", "fx_glow"],
        "meshes": ["woofer", "cable_1", "cable_2"],
        "physics": ["phys_cable_1", "phys_cable_2"],
        "clips": {
            "idle": {"frames": 72, "loop": True},
            "pump": {"frames": 6, "overlay": True, "peak": ("woofer", "scale", [2], 1.06)},
            "boom_follow": {"frames": 18, "peak": ("woofer", "scale", [2], None), "hop": ("cabinet", 6.0)},
            "feature_follow": {"frames": 54, "peak": ("woofer", "scale", [2, 20, 38], None)},
        },
    },
}


def keys_of(anim: dict, bone: str, prop: str) -> list[dict]:
    return anim.get("bones", {}).get(bone, {}).get(prop, [])


def value(k: dict, prop: str) -> float:
    if prop == "scale":
        return max(k.get("x", 1.0), k.get("y", 1.0))
    if prop == "translate":
        return k.get("y", 0.0)
    return k.get("value", 0.0)


def last_time(anim: dict) -> float:
    t = 0.0
    for group in ("bones", "slots"):
        for props in anim.get(group, {}).values():
            for tl in props.values():
                for k in tl:
                    t = max(t, k.get("time", 0.0))
    return t


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("skeleton")
    ap.add_argument("--report")
    a = ap.parse_args()
    doc = json.loads(Path(a.skeleton).read_text())
    name = Path(a.skeleton).stem
    tab = TABLES[name]
    errs, notes = [], []
    slots = {s["name"]: s for s in doc["slots"]}
    bones = {b["name"] for b in doc["bones"]}
    if len(doc["slots"]) > tab["budget"]["slots"]:
        errs.append(f"slots {len(doc['slots'])} > {tab['budget']['slots']}")
    if len(bones) > tab["budget"]["bones"]:
        errs.append(f"bones {len(bones)} > {tab['budget']['bones']}")
    for s in tab["slots"]:
        if s not in slots:
            errs.append(f"slot {s} missing")
    atts = {att: v for sk in doc["skins"] for slot, m in sk["attachments"].items() for att, v in m.items()}
    for m in tab["meshes"]:
        if atts.get(m, {}).get("type") != "mesh":
            errs.append(f"{m} is not a mesh")
    phys = {c.get("bone") for c in doc.get("constraints", []) if c.get("type") == "physics"}
    for p in tab["physics"]:
        if p not in phys:
            errs.append(f"physics constraint on {p} missing")
    for s in ("floor_light", "fx_glow"):
        if s in slots and slots[s].get("blend") != "additive":
            errs.append(f"{s} must be additive")
    anims = doc["animations"]
    for clip, rule in tab["clips"].items():
        an = anims.get(clip)
        if an is None:
            errs.append(f"clip {clip} missing")
            continue
        frames = round(last_time(an) * FPS)
        if frames != rule["frames"]:
            errs.append(f"{clip}: {frames} f, table says {rule['frames']}")
        if rule.get("overlay") or rule.get("loop"):
            # overlays start and end on the setup pose; loops end where they start
            for bone, props in an.get("bones", {}).items():
                for prop, tl in props.items():
                    if not tl:
                        continue
                    v0, v1 = value(tl[0], prop), value(tl[-1], prop)
                    rest = 1.0 if prop == "scale" else 0.0
                    if abs(v0 - v1) > 1e-6:
                        errs.append(f"{clip}: {bone}.{prop} does not end where it starts ({v0} -> {v1})")
                    if rule.get("overlay") and (abs(v0 - rest) > 1e-6 or tl[0].get("time", 0) > 0):
                        errs.append(f"{clip}: overlay {bone}.{prop} does not start on the setup pose")
        if "peak" in rule:
            bone, prop, frames_at, amount = rule["peak"]
            tl = keys_of(an, bone, prop)
            by_f = {round(k.get("time", 0) * FPS): value(k, prop) for k in tl}
            for f in frames_at:
                v = by_f.get(f)
                nb = [by_f.get(g) for g in (f - 1, f + 1) if g in by_f]
                if v is None or any(x is not None and x >= v for x in nb) or v <= 1.0:
                    errs.append(f"{clip}: {bone} does not punch at f{f} (keys {sorted(by_f.items())[:8]}...)")
                elif amount is not None and abs(v - amount) > 1e-3:
                    errs.append(f"{clip}: {bone} peak {v} at f{f}, table says {amount}")
            notes.append(f"{clip}: {bone} peaks at " + ", ".join(f"f{f}={by_f.get(f)}" for f in frames_at))
        if "hop" in rule:
            bone, units = rule["hop"]
            hop = max((value(k, "translate") for k in keys_of(an, bone, "translate")), default=0.0)
            if abs(hop - units) > 0.01:
                errs.append(f"{clip}: {bone} hop {hop}, table says {units}")
            notes.append(f"{clip}: {bone} hop {hop} units")
    rep = {"skeleton": a.skeleton, "pass": not errs, "errors": errs, "notes": notes,
           "counts": {"bones": len(bones), "slots": len(doc["slots"])}}
    if a.report:
        Path(a.report).parent.mkdir(parents=True, exist_ok=True)
        Path(a.report).write_text(json.dumps(rep, indent=1) + "\n")
    for e in errs:
        print(f"  FAIL {e}")
    for n in notes:
        print(f"  info {n}")
    print(f"check_env {name}: {'PASS' if not errs else 'FAIL'}")
    return 0 if not errs else 1


if __name__ == "__main__":
    sys.exit(main())
