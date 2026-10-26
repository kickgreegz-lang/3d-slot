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


# approved anchors (Higgsfield job ids; references are passed as job ids, nothing local is uploaded)
A_H1 = "45cb539f-34b1-42d9-8021-a254b4edea38"   # crown, formula D (mh_probe1)
A_W = "3c1876ad-c6d7-4dcc-9429-8a704eb695f6"    # bandit mask, formula M
A_R = "776d0bd9-59a9-4785-bb5e-1fb9b1dba7c0"    # shooting star, formula M
A_MONTY = "d0036d38-333e-49e9-b53f-d8800aaee423"  # Monty design sheet, formula M
A_BG = "5c4e4d4d-3e22-4b7e-b95a-46c1bc1c9951"   # base plate (has a stray slot machine bottom centre)
ANCHORS = (A_H1, A_W, A_R)


def edit(name, asset, prompt_vars, template, refs, res="4k", ar="21:9", stage="backgrounds"):
    return {"name": name, "template": template, "asset": asset, "stage": stage, "vars": prompt_vars,
            "resolution": res, "aspect_ratio": ar, "medias": [{"value": r, "role": "image_references"} for r in refs]}


BATCHES = {
    "mh_probe1": lambda: batch("mh_probe1", "Magpie Heist style probe: formula M (cartoon) vs formula D on H1; W, R, mascot sheet, base plate", [
        sym("mh_sym_H1.M", "H1"), sym("mh_sym_H1.D", "H1", formula=D, asset="mh_sym_H1_D"),
        sym("mh_sym_W.M", "W"), sym("mh_sym_R.M", "R"),
        mascot_sheet("mh_mascot_monty_sheet.c1"), bg("mh_bg_base_landscape")]),
    # P0 symbols + loot (2k): the rest of the paying set, the Safe scatter, the loot pieces
    "mh_c01": lambda: batch("mh_c01", "Magpie Heist P0: H2-H5, S, loot (coins, diamond, nest), formula M, anchored on H1/W/R", [
        sym("mh_sym_H2.c1", "H2", refs=ANCHORS), sym("mh_sym_H3.c1", "H3", refs=ANCHORS),
        sym("mh_sym_H4.c1", "H4", refs=ANCHORS), sym("mh_sym_H5.c1", "H5", refs=ANCHORS),
        sym("mh_sym_S.c1", "S", refs=ANCHORS),
        prize("mh_prize_coins.c1", "coins", refs=ANCHORS, ar="16:9", fill="60"),
        prize("mh_prize_diamond.c1", "diamond", refs=ANCHORS), prize("mh_prize_nest.c1", "nest", refs=ANCHORS),
    ]),
    # P0 environment (4k): plate fix, portrait reframe, the heist (alarm) variant
    "mh_c02": lambda: batch("mh_c02", "Magpie Heist P0: base plate clean-up, portrait reframe, heist variant", [
        edit("mh_bg_base_landscape_fix", "mh_bg_base_landscape_fix", {
            "SETTING": MH["backgrounds"]["base"]["setting"], "LEFT_MASS": MH["backgrounds"]["base"]["leftMass"],
            "RIGHT_MASS": MH["backgrounds"]["base"]["rightMass"], "TOP_DETAIL": MH["backgrounds"]["base"]["topDetail"],
            "STYLE_FORMULA": ENV,
            "VARIANT_NOTE": "remove the slot machine in the bottom centre and continue the polished checkered marble floor and the velvet rope posts there, so the foreground is empty floor."},
            "background.txt#G", [A_BG]),
        edit("mh_bg_base_portrait", "mh_bg_base_portrait", {
            "SETTING": MH["backgrounds"]["base"]["setting"], "LEFT_MASS": MH["backgrounds"]["base"]["leftMass"],
            "RIGHT_MASS": MH["backgrounds"]["base"]["rightMass"], "TOP_DETAIL": MH["backgrounds"]["base"]["topDetail"],
            "STYLE_FORMULA": ENV, "VARIANT_NOTE": ""}, "background.txt#F", [A_BG], ar="9:16"),
        edit("mh_bg_heist_landscape", "mh_bg_heist_landscape", {
            "SETTING": MH["backgrounds"]["base"]["setting"], "LEFT_MASS": MH["backgrounds"]["base"]["leftMass"],
            "RIGHT_MASS": MH["backgrounds"]["base"]["rightMass"], "TOP_DETAIL": MH["backgrounds"]["base"]["topDetail"],
            "STYLE_FORMULA": ENV, "VARIANT_NOTE": MH["backgrounds"]["free"]["variantNote"] + " Also remove the slot machine in the bottom centre."},
            "background.txt#E", [A_BG]),
    ]),
    # P1 mascot extras for the rig (2k): hand poses
    "mh_c03": lambda: batch("mh_c03", "Magpie Heist P1: Monty hand poses sheet", [
        {"name": "mh_monty_hands.c1", "template": "mascot_parts_sheet.txt#D", "asset": "mh_monty_hands", "stage": "mascot-sheets",
         "vars": {"IDENTITY_LOCK": B["mascots"]["rules"]["identityLock"], "CHARACTER": MH["mascots"]["monty"]["character"],
                  "PART_LIST": "near hand open palm, near hand pointing with the index finger, near hand fist, near hand thumbs up, far hand open palm, far hand waving",
                  "STYLE_FORMULA": M, "KEY_HEX": MH["mascots"]["monty"]["keyHex"], "FACING": MH["mascots"]["monty"]["facing"], "POSE_NOTE": ""},
         "resolution": "2k", "aspect_ratio": "3:2", "medias": [{"value": A_MONTY, "role": "image_references"}]},
    ]),
}

if __name__ == "__main__":
    print(json.dumps(BATCHES[sys.argv[1]](), indent=1))
