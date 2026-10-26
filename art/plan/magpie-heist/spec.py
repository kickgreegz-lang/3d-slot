#!/usr/bin/env python3
"""Magpie Heist hf-ingest specs (docs/games/magpie-heist/ART_PLAN.md). Values come from
art/bible/artbible.json -> magpieHeist; prompts are rendered by tools/gen/genlib.py from the shared templates.

    python3 art/plan/magpie-heist/spec.py <batch> > art/_work/hf-plans/<batch>.spec.json
    pnpm gen:hf-ingest plan --spec art/_work/hf-plans/<batch>.spec.json --max-credits N
"""
from __future__ import annotations
import json, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
B = json.loads((REPO / "art/bible/artbible.json").read_text())
MH = B["magpieHeist"]
M, D, ENV = MH["styleFormula"], MH["styleFormulaD"], MH["environmentFormula"]
RIG = "Rig-ready pose: every part clearly separated from the body, mouth closed and neutral, eyes open, no motion blur."


def sym(name, sid, formula=M, rig=False, refs=(), res="2k", ar="1:1", asset=None):
    s = MH["symbols"][sid]
    return {"name": name, "template": "symbol.txt", "asset": asset or (f"mh_sym_{sid}" + ("_rig" if rig else "")),
            "vars": {"SUBJECT": s["subject"] + ".", "STYLE_FORMULA": formula, "FILL_PCT": "85", "KEY_HEX": s["keyHex"],
                     "LIGHT_NOTE": "", "RIG_READY_LINE": RIG if rig else ""},
            "resolution": res, "aspect_ratio": ar, **({"medias": [{"value": r, "role": "image_references"} for r in refs]} if refs else {})}


def prize(name, pid, refs=(), ar="1:1", fill="85"):
    s = MH["prizes"][pid]
    return {"name": name, "template": "symbol.txt", "asset": f"mh_prize_{pid}",
            "vars": {"SUBJECT": s["subject"] + ".", "STYLE_FORMULA": M, "FILL_PCT": fill, "KEY_HEX": s["keyHex"],
                     "LIGHT_NOTE": "", "RIG_READY_LINE": ""},
            "resolution": "2k", "aspect_ratio": ar, **({"medias": [{"value": r, "role": "image_references"} for r in refs]} if refs else {})}


def mascot_sheet(name, refs=()):
    m = MH["mascots"]["monty"]
    return {"name": name, "template": "mascot_turnaround.txt#A", "asset": "mh_mascot_monty_sheet", "stage": "mascot-sheets",
            "vars": {"CHARACTER": m["character"], "STYLE_FORMULA": M, "KEY_HEX": m["keyHex"]},
            "resolution": "4k", "aspect_ratio": "21:9", **({"medias": [{"value": r, "role": "image_references"} for r in refs]} if refs else {})}


def bg(name, section="A", refs=(), ar="21:9", variant=""):
    g = MH["backgrounds"]["base"]
    return {"name": name, "template": f"background.txt#{section}", "asset": name, "stage": "backgrounds",
            "vars": {"SETTING": g["setting"], "LEFT_MASS": g["leftMass"], "RIGHT_MASS": g["rightMass"],
                     "TOP_DETAIL": g["topDetail"], "STYLE_FORMULA": ENV, "VARIANT_NOTE": variant},
            "resolution": "4k", "aspect_ratio": ar, **({"medias": [{"value": r, "role": "image_references"} for r in refs]} if refs else {})}


def batch(bid, purpose, jobs):
    return {"batch": bid, "model": "nano_banana_pro", "purpose": purpose, "planTier": "Higgsfield Plus",
            "date": "2026-10-26", "jobs": jobs}


BATCHES = {
    "mh_probe1": lambda: batch("mh_probe1", "Magpie Heist style probe: formula M (cartoon) vs formula D on H1; W, R, mascot sheet, base plate", [
        sym("mh_sym_H1.M", "H1"), sym("mh_sym_H1.D", "H1", formula=D, asset="mh_sym_H1_D"),
        sym("mh_sym_W.M", "W"), sym("mh_sym_R.M", "R"),
        mascot_sheet("mh_mascot_monty_sheet.c1"), bg("mh_bg_base_landscape")]),
}

if __name__ == "__main__":
    print(json.dumps(BATCHES[sys.argv[1]](), indent=1))
