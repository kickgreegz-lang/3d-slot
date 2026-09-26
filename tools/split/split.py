#!/usr/bin/env python3
"""Cut Higgsfield part sheets into Spine parts and register them onto the rig master (PIPELINE 3.1).

CPU only (no SAM / GPU): key matte (tools/matte, measured key + keyUniform gate) -> connected components
-> the operator names them in a small mapping file -> masked NCC + ECC registration onto the approved
master (front to back, so hidden pieces only match what is still visible) -> canvas placement (trim +
pad) -> joints from the round overlap caps, biped landmarks -> parts.json for tools/spine/gen.py
(symbol kind and character kind) + a reassembly check (SSIM / alpha IoU vs the master, joint holes at
+-35 degrees).

  # 1. cut a sheet: components + a numbered preview to look at + a mapping stub
  python tools/split/split.py cut art/_raw/chr_gumbo_parts_face/v01/raw.png --out build/split/gumbo/face \\
      --expect-key FF00FF [--plan-row chr_gumbo_parts_face]
  # 2. write the mapping (tools/split/README.md "Mapping file"), then build parts.json + images
  python tools/split/split.py build art/source/mascots/gumbo/spine2d/split.json --preview [--strict]
  # 3. re-check an edited parts.json against the master
  python tools/split/split.py preview art/source/mascots/gumbo/spine2d/split.json

Exit codes: 0 ok · 1 a gate failed with --strict (or keyUniform) · 2 usage / mapping / registration error.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import splitlib as sl  # noqa: E402
from splitlib import SplitError, ml  # noqa: E402

TOOL = "tools/split/split.py"
SIDES = ("L", "R")
# biped slot -> (overlap partner slot(s), landmark written from the joint); first partner that exists wins
BIPED = {}
for _s in SIDES:
    BIPED.update({f"upper_arm_{_s}": (["torso"], f"shoulder_{_s}"), f"forearm_{_s}": ([f"upper_arm_{_s}"], f"elbow_{_s}"),
                  f"hand_{_s}": ([f"forearm_{_s}"], f"wrist_{_s}"), f"thigh_{_s}": (["torso"], f"hip_{_s}"),
                  f"shin_{_s}": ([f"thigh_{_s}"], f"knee_{_s}"), f"foot_{_s}": ([f"shin_{_s}"], f"ankle_{_s}")})
BIPED.update({"neck": (["torso"], "neck"), "head": (["neck", "torso"], "head"), "jaw": (["head"], "jaw")})
# adult-proportions gate (tools/spine validate-character: head <= 27% of the setup height)
HEAD_SLOTS = re.compile(r"^(head|jaw|eye_.*|brow_.*|mouth|jowl|lid_.*|pupil_.*|eye_bulge_.*|nostrils|teeth_.*|gold_tooth|cap)$")
NOT_FIGURE = re.compile(r"^(fx_.*|band|cup_.*|cable|mic|toothpick)$")
PART_FIELDS = ("bone", "parent", "blend", "color", "hidden", "setup")


# ----------------------------------------------------------------------------- mapping


def rpath(p: str | None) -> Path | None:
    if p is None:
        return None
    q = Path(p)
    return q if q.is_absolute() else Path.cwd() / q


def parse_pid(entry, kind: str) -> tuple[str, str, str | None]:
    """'eye_R/open' | {'slot': 'eye_R', 'attachment': 'open'} | {'name': 'body'} -> (pid, slot, att)."""
    if isinstance(entry, str):
        entry = {"slot": entry}
    raw = entry.get("slot") or entry.get("name")
    if not raw:
        raise SplitError(f"piece entry without 'slot'/'name': {entry}")
    att = entry.get("attachment")
    if "/" in raw:
        raw, att2 = raw.split("/", 1)
        att = att or att2
    if kind == "symbol" and att:
        raise SplitError(f"symbol part '{raw}': attachments are a character feature")
    if not re.match(r"^[a-z][a-z0-9_]*(_[LR])?$", raw):
        raise SplitError(f"slot/name '{raw}' must be snake_case (L/R suffix allowed)")
    if att is not None and not re.match(r"^[A-Za-z0-9_]+$", att):
        raise SplitError(f"attachment '{att}' must be [A-Za-z0-9_]")
    pid = raw if att in (None, raw) else f"{raw}/{att}"
    return pid, raw, (None if att in (None, raw) else att)


def load_defaults(path: Path | None, kind: str) -> dict:
    """Per-slot z / bone / parent / blend / colour / hidden and relative joint + tip from an existing
    parts.json (e.g. the placeholder demo rigs, which carry the canonical slot names and draw order)."""
    if path is None:
        return {}
    doc = json.loads(path.read_text(encoding="utf-8"))
    root = path.parent / str(doc.get("images", "images"))
    prefix = doc.get("skeleton") or f"sym_{doc.get('symbol')}"
    out: dict = {}
    for pm in doc.get("parts", []):
        slot = pm.get("slot") or pm.get("name")
        att = pm.get("attachment")
        pid = slot if not att or att == slot else f"{slot}/{att}"
        d = out.setdefault(slot, {"variants": [], "order": len(out)})
        d["variants"].append(pid)
        for k in ("z",) + PART_FIELDS:
            if k in pm and k not in d:
                d[k] = pm[k]
        for k in ("joint", "tip"):
            if k in pm and k not in d:
                rel = pm.get("image") or (f"{prefix}/{slot}.png" if pid == slot else f"{prefix}/{slot}/{att}.png")
                img = root / rel
                bb = pm["bbox"]
                if img.exists():
                    a = np.asarray(Image.open(img).convert("RGBA"))[..., 3] > 127
                    ys, xs = np.nonzero(a)
                    box = (bb[0] + xs.min(), bb[1] + ys.min(), xs.max() + 1 - xs.min(), ys.max() + 1 - ys.min())
                else:
                    box = tuple(bb)
                d[k + "Rel"] = [(pm[k][0] - box[0]) / box[2], (pm[k][1] - box[1]) / box[3]]
    return out


class Build:
    def __init__(self, mapping_path: Path, out_dir: Path | None = None, log=print):
        self.mp = Path(mapping_path)
        self.m = json.loads(self.mp.read_text(encoding="utf-8"))
        self.log = log
        m = self.m
        self.kind = m.get("kind", "character" if m.get("skeleton") else "symbol")
        if self.kind not in ("character", "symbol"):
            raise SplitError("kind: character | symbol")
        if self.kind == "character":
            self.name = m.get("skeleton") or ""
            if not re.match(r"^chr_[a-z0-9_]+$", self.name):
                raise SplitError("character mappings need skeleton: chr_<id>")
            self.canvas = [int(v) for v in m.get("canvas") or []]
            if len(self.canvas) != 2:
                raise SplitError("character mappings need canvas: [W, H] (2x the landscape design rect)")
            self.anchor = [float(v) for v in m.get("anchor", [0.5, 1.0])]
            self.facing = m.get("facing", "right")
            if self.facing not in ("right", "left"):
                raise SplitError("facing: right | left")
            self.prefix = self.name
        else:
            sym = m.get("symbol")
            if not sym or not re.match(r"^[A-Za-z0-9_]+$", str(sym)):
                raise SplitError("symbol mappings need symbol: <ID>")
            self.name = f"sym_{sym}"
            self.canvas = [int(v) for v in m.get("canvas", [sl.ml.CANVAS, sl.ml.CANVAS])]
            self.prefix = self.name
            self.facing = m.get("facing", "right")
        self.W, self.H = self.canvas
        outs = m.get("out") or {}
        base = out_dir or rpath(outs.get("dir")) or (Path.cwd() / "build" / "split" / self.name)
        self.out_parts = rpath(outs["parts"]) if outs.get("parts") else base / "parts.json"
        self.out_images = rpath(outs["images"]) if outs.get("images") else base / "images"
        self.work = rpath(outs.get("work")) if outs.get("work") else base / "work"
        self.pad = int(m.get("pad", 3))
        if not 2 <= self.pad <= 4:
            raise SplitError("pad: 2-4 px (character parts contract)")
        self.defaults = load_defaults(rpath(m.get("defaultsFrom")), self.kind)
        self.pieces: list[sl.Piece] = []
        self.by_pid: dict[str, sl.Piece] = {}
        self.report: dict = {"tool": TOOL, "mapping": str(self.mp), "kind": self.kind, "name": self.name,
                             "cv2": sl.HAVE_CV2, "sheets": {}, "pieces": {}, "errors": [], "warnings": []}
        self.errors = self.report["errors"]
        self.warnings = self.report["warnings"]

    # ------------------------------------------------------------------ inputs
    def load(self) -> None:
        m = self.m
        ms = m.get("master")
        if isinstance(ms, str):
            ms = {"image": ms}
        if not ms or not ms.get("image"):
            raise SplitError("mapping needs master: {image, key?, expectKey?}")
        mt = sl.matte_image(rpath(ms["image"]), key=ms.get("key", "auto"), expect_key=ms.get("expectKey"),
                            cache_dir=self.work / "cache")
        self.master = sl.Master(mt["rgb"], mt["alpha"])
        if mt["key"].get("matte", {}).get("leakWarning"):
            self.warnings.append(f"master: {mt['key']['matte']['leakPx']} non-key px keyed out (open outline?): check the matte")
        self.report["master"] = {"image": ms["image"], "size": [self.master.W, self.master.H], "key": mt["key"]}
        sheets = m.get("sheets") or []
        if not sheets:
            raise SplitError("mapping needs sheets: [...]")
        for sh in sheets:
            sid = sh.get("id") or Path(sh["image"]).stem
            mt = sl.matte_image(rpath(sh["image"]), key=sh.get("key", "auto"), expect_key=sh.get("expectKey"),
                                cache_dir=self.work / "cache")
            comps, lab = sl.find_components(mt["alpha"], min_area=sh.get("minArea"))
            if mt["key"].get("matte", {}).get("leakWarning"):
                self.warnings.append(f"sheet {sid}: {mt['key']['matte']['leakPx']} non-key px keyed out (open outline?): "
                                     f"check components.png")
            ids = {c["id"]: c for c in comps}
            used: set[str] = set()
            rep = {"image": sh["image"], "key": mt["key"], "components": len([c for c in comps if not c["noise"]]),
                   "noise": len([c for c in comps if c["noise"]])}
            for key, entry in (sh.get("pieces") or {}).items():
                cids = [k.strip() for k in str(key).split("+")]
                for c in cids:
                    if c not in ids:
                        raise SplitError(f"sheet {sid}: component '{c}' does not exist (see the cut preview)")
                    if c in used:
                        raise SplitError(f"sheet {sid}: component '{c}' mapped twice")
                    used.add(c)
                if entry is None:
                    continue                                   # explicitly ignored (stray mark, duplicate)
                spec = {"slot": entry} if isinstance(entry, str) else dict(entry)
                pid, slot, att = parse_pid(spec, self.kind)
                if pid in self.by_pid:
                    raise SplitError(f"piece '{pid}' mapped twice (sheet {sid} and {self.by_pid[pid].sheet})")
                rgb, a, origin = sl.extract(mt["rgb"], mt["alpha"], lab, [ids[c]["label"] for c in cids])
                p = sl.Piece(pid=pid, slot=slot, att=att, sheet=sid, comps=cids, spec=spec, rgb=rgb, alpha=a,
                             origin=origin)
                gaps = [ids[c].get("gapPx") for c in cids if ids[c].get("gapPx") is not None]
                if gaps and min(gaps) < 6:
                    self.warnings.append(f"{pid}: only {min(gaps)} px from the next piece on sheet {sid} (cross-talk risk)")
                self.pieces.append(p)
                self.by_pid[pid] = p
            unmapped = [c["id"] for c in comps if not c["noise"] and c["id"] not in used]
            if unmapped:
                msg = f"sheet {sid}: unmapped component(s) {', '.join(unmapped)} (map them to a piece or to null)"
                self.errors.append(msg)
            rep["unmapped"] = unmapped
            rep["scaleSpec"] = sh.get("scale", "auto")
            self.report["sheets"][sid] = rep
        self._resolve_meta()

    def _resolve_meta(self) -> None:
        """z, setup, hidden and rig fields per piece: mapping entry > defaultsFrom > rules."""
        slots: dict[str, list[sl.Piece]] = {}
        for p in self.pieces:
            slots.setdefault(p.slot, []).append(p)
        self.slots = slots
        missing_z = []
        for slot, ps in slots.items():
            d = self.defaults.get(slot, {})
            z = next((p.spec["z"] for p in ps if "z" in p.spec), d.get("z"))
            if z is None:
                missing_z.append(slot)
            setup = [p for p in ps if p.spec.get("setup")]
            if len(setup) > 1:
                raise SplitError(f"slot {slot}: two setup attachments")
            if not setup:
                if d.get("setup") and any(p.att == d["setup"] for p in ps):
                    setup = [p for p in ps if p.att == d["setup"]]
                elif d.get("variants"):
                    first = next((v for v in d["variants"] if v in self.by_pid), None)
                    setup = [self.by_pid[first]] if first else [ps[0]]
                else:
                    setup = [ps[0]]
            for p in ps:
                p.z = z
                p.setup = p is setup[0]
                p.hidden = bool(p.spec.get("hidden", d.get("hidden", False)))
        if missing_z:
            raise SplitError(f"no z (draw order) for slot(s) {', '.join(missing_z)}: give 'z' or defaultsFrom")

    # ------------------------------------------------------------------ registration
    def register(self) -> None:
        by_sheet: dict[str, list[sl.Piece]] = {}
        for p in self.pieces:
            by_sheet.setdefault(p.sheet, []).append(p)
        use_feats = sl.HAVE_CV2 and self.m.get("features", True)
        feats = sl.Features(self.master) if use_feats else None
        self.sheet_scale = {}
        for sid, ps in by_sheet.items():
            spec = self.report["sheets"][sid]["scaleSpec"]
            if isinstance(spec, (int, float)):
                self.sheet_scale[sid] = float(spec)
                self.report["sheets"][sid]["scale"] = {"scale": float(spec), "method": "mapping"}
                continue
            lo, hi = (spec if isinstance(spec, list) else [0.2, 5.0])
            est = sl.sheet_scale_from_features(feats, ps) if feats else None
            if est is not None and not (float(lo) <= est["scale"] <= float(hi)):
                est = None
            if est is None:
                est = sl.estimate_sheet_scale(self.master, ps, lo=float(lo), hi=float(hi))
                self.warnings.append(f"sheet {sid}: scale from the explained-area search ({est['scale']:.3f}); features "
                                     f"{'unavailable' if not feats else 'found no piece'}: check it or give the sheet a scale")
            self.sheet_scale[sid] = est["scale"]
            self.report["sheets"][sid]["scale"] = est
            self.log(f"sheet {sid}: scale {est['scale']:.4f} ({est['method']}, from {', '.join(est['pieces'])})")
        auto = [p for p in self.pieces if p.setup and not p.hidden and self._place(p).get("mode") == "auto"]
        motion = self.m.get("motion", "affine")
        self._provisional_fit()
        pending = list(auto)
        last: dict[str, tuple[dict, np.ndarray | None]] = {}
        # rounds: parents before children, front before back. Round 0 accepts only strong, unambiguous fits
        # (they fix the claims for the rest); later rounds search a piece inside its registered parent
        # (a piece whose parent is still pending waits) with progressively lower thresholds.
        for rnd in range(10):
            progress = False
            order = (lambda q: -(q.z or 0)) if rnd == 0 else (lambda q: (self._depth(q), -(q.z or 0)))
            for p in sorted(pending, key=order):
                pl = self._place(p)
                s = self.sheet_scale[p.sheet]
                hinted = pl.get("near") is not None or pl.get("nearMaster") is not None
                near, region = self._hint(p, pl)
                if near is None and rnd > 0:
                    near, region = self._region(p, s)
                self.master.use_z(p.z)
                init, fm = None, None
                if feats is not None:
                    fm = feats.match(p, use_visibility=True, scale=s)
                    if fm and fm["ok"] and near is not None:
                        c = sl.apply(fm["A"], [[p.alpha.shape[1] / 2, p.alpha.shape[0] / 2]])[0]
                        if math.hypot(c[0] - near[0], c[1] - near[1]) > near[2]:
                            fm["ok"] = False                         # a feature pose outside the region
                    if fm and fm["ok"]:
                        init = fm["A"]
                mc = 0.05 if near is not None else 0.25
                mo = p.spec.get("motion", motion)
                rep = sl.register(self.master, p, s, near=near, init=init, min_cover=mc, motion=mo)
                if init is not None and not rep.get("ok"):
                    A1 = p.A
                    rep2 = sl.register(self.master, p, s, near=near, min_cover=mc, motion=mo)
                    if not (rep2.get("ok") or rep2.get("ncc", -1) > rep.get("ncc", -1)):
                        p.A = A1
                    else:
                        rep = rep2
                if fm:
                    rep["features"] = {k: fm[k] for k in ("inliers", "matches", "scale", "rotation", "ok")}
                rep["round"] = rnd
                if region:
                    rep["searchRegion"] = region
                amb = rep.get("ambiguity", 0.0) if rep.get("init") == "ncc" else 0.0
                need = max(sl.GATE_NCC, 0.85 - 0.1 * rnd)
                weak = rep.get("visibleFrac", 1) < 0.35 and not hinted
                accept = (rep.get("ok") and rep["ncc"] >= need and rep.get("conflict", 0) <= 0.15 and
                          amb < (0.9 if rnd == 0 else 0.98 if near is not None else 0.9) and
                          (not weak or (rep["ncc"] >= 0.9 and amb < 0.8)))
                p.reg = rep
                last[p.pid] = (rep, p.A)
                if not accept:
                    p.A = None
                    continue
                pending.remove(p)
                progress = True
                rep["verified"] = True
                self.master.explain(p)
                self.log(f"  {p.pid:22s} ncc {rep['ncc']:.3f} vis {rep['visibleFrac']:.0%} {rep['init']}+{rep['method']} "
                         f"round {rnd} scale {rep['transform']['scale']:.3f} rot {rep['transform']['rotation']:+.1f}")
            self._refine_scales()
            if not pending or (rnd > 0 and not progress):
                break
        # what never passed: keep the best attempt as an UNVERIFIED placement (the registration gate fails,
        # the previews still render) so the operator can confirm or correct it with a hint
        for p in pending:
            rep, A = last.get(p.pid, ({}, None))
            if A is None or rep.get("ncc", -1) <= -0.99:
                self.errors.append(f"{p.pid}: no placement found ({rep.get('why') or 'not visible'}): give it place: "
                                   f"{{near: [x, y]}} (canvas) / {{nearMaster: [x, y]}} or {{like: <piece>}} or {{at: [x, y]}}")
                continue
            p.A = A
            p.reg = {**rep, "verified": False}
            c = self._m2c_point(sl.apply(A, [[p.alpha.shape[1] / 2, p.alpha.shape[0] / 2]])[0])
            self.warnings.append(f"{p.pid}: UNVERIFIED placement (ncc {rep.get('ncc', -1):.2f}, ambiguity {rep.get('ambiguity')}, "
                                 f"visible {rep.get('visibleFrac', 0):.0%}), centre near canvas ({c[0]:.0f}, {c[1]:.0f}): check "
                                 f"landmarks.png / preview.png and confirm with place: {{near: [x, y]}} (or like / at)")
            self.log(f"  {p.pid:22s} UNVERIFIED ncc {rep.get('ncc', -1):.3f} vis {rep.get('visibleFrac', 0):.0%}")

    def _refine_scales(self) -> None:
        """Sheet scale from the accepted ECC fits of that sheet (the search grid is only ~2% fine)."""
        for sid in self.sheet_scale:
            if isinstance(self.report["sheets"][sid]["scaleSpec"], (int, float)):
                continue
            fits = [q.reg["transform"]["scale"] for q in self.pieces
                    if q.sheet == sid and q.A is not None and q.reg.get("verified") and
                    str(q.reg.get("method", "")).startswith("ecc")]
            if len(fits) >= 2:
                new = float(np.median(fits))
                if abs(new / self.sheet_scale[sid] - 1) > 0.005:
                    self.log(f"sheet {sid}: scale {self.sheet_scale[sid]:.4f} -> {new:.4f} (median of {len(fits)} ECC fits)")
                    self.report["sheets"][sid]["scale"]["refined"] = round(new, 5)
                    self.sheet_scale[sid] = new

    def _depth(self, p: sl.Piece) -> int:
        """Parent-chain depth (parents register before their children inside a round)."""
        d, cur, seen = 0, p.slot, set()
        while cur and cur not in seen and d < 12:
            seen.add(cur)
            q = self.setup_piece(cur)
            par = self._exact_parents(q) if q is not None else []
            cur = par[0] if par else None
            d += 1 if cur else 0
        return d

    def _hint(self, p: sl.Piece, pl: dict):
        if pl.get("nearMaster") is not None:
            return (float(pl["nearMaster"][0]), float(pl["nearMaster"][1]), float(pl.get("radius", 160))), "hint"
        if pl.get("near") is not None:
            c = sl.apply(np.linalg.inv(self.M2C_hint), [pl["near"]])[0]
            return (c[0], c[1], float(pl.get("radius", 80)) / self.M2C_hint_scale), "hint"
        return None, None

    def _provisional_fit(self) -> None:
        """Master -> canvas before registration (feet x from the lowest rows), for canvas-space hints."""
        if hasattr(self, "M2C"):
            self.M2C_hint, self.M2C_hint_scale = self.M2C, self.M2C_scale
            return
        saved = {p.pid: p.A for p in self.pieces}
        for p in self.pieces:
            p.A = None
        self.fit()
        self.M2C_hint, self.M2C_hint_scale = self.M2C, self.M2C_scale
        for p in self.pieces:
            p.A = saved[p.pid]
        del self.M2C

    def _m2c_point(self, pt) -> np.ndarray:
        M = getattr(self, "M2C", None)
        if M is None:
            M = self.M2C_hint
        return sl.apply(M, [pt])[0]

    def _bone(self, slot: str) -> str:
        ps = self.slots.get(slot, [])
        spec = next((q.spec for q in ps if q.spec.get("bone")), {})
        return spec.get("bone") or self.defaults.get(slot, {}).get("bone") or slot

    def _exact_parents(self, p: sl.Piece) -> list[str]:
        """Slots a piece sits inside/joins: `within`, its parent bone's slot, the slot named like its own
        bone (teeth_lower -> jaw), or the biped partner."""
        d = self.defaults.get(p.slot, {})
        spec = {k: v for q in self.slots[p.slot] for k, v in q.spec.items()}
        out = [spec["within"]] if spec.get("within") else []
        par = spec.get("parent") or d.get("parent")
        bone = self._bone(p.slot)
        for s2 in self.slots:
            if s2 == p.slot:
                continue
            b2 = self._bone(s2)
            if (par and (s2 == par or b2 == par == f"face_{s2}")) or (bone != p.slot and s2 == bone):
                out.append(s2)
        if p.slot in BIPED:
            out += [x for x in BIPED[p.slot][0] if x in self.slots]
        return out

    def _region(self, p: sl.Piece, s: float):
        """Search region for a piece that did not register on its own: its parent's registered box (parents
        are tried first in every round), else the box of its registered children. Returns
        ((cx, cy, radius) in master px, description) or (None, None)."""
        exact = self._exact_parents(p)
        for c in exact:
            q = self.setup_piece(c)
            if q is not None and q.A is not None:
                x0, y0, x1, y1 = self.master.master_box(q)
                h, w = p.alpha.shape
                r = 0.5 * math.hypot(x1 - x0, y1 - y0) * 1.2 + 0.25 * s * max(h, w)
                return ((x0 + x1) / 2, (y0 + y1) / 2, r), f"parent {c}"
        bone = self._bone(p.slot)
        kids = []
        for s2, ps in self.slots.items():
            q = self.setup_piece(s2)
            if q is None or q.A is None or s2 == p.slot:
                continue
            if p.slot in self._exact_parents(q) or bone in (self.defaults.get(s2, {}).get("parent"),):
                kids.append(self.master.master_box(q))
        if kids:
            k = np.array(kids)
            x0, y0, x1, y1 = k[:, 0].min(), k[:, 1].min(), k[:, 2].max(), k[:, 3].max()
            return ((x0 + x1) / 2, (y0 + y1) / 2, 0.5 * math.hypot(x1 - x0, y1 - y0)), "children"
        return None, None

    def m2c_scale_guess(self) -> float:
        return getattr(self, "M2C_scale", 1.0)

    def _c2m(self, pt) -> np.ndarray:
        if not hasattr(self, "M2C"):
            raise SplitError("canvas coordinates in a 'near' hint need the canvas fit first: give fit.mode matrix, "
                             "or use nearMaster: [x, y] (master px)")
        return sl.apply(np.linalg.inv(self.M2C), [pt])[0]

    def _place(self, p: sl.Piece) -> dict:
        pl = p.spec.get("place", "auto")
        if pl == "auto" or pl is None:
            if not p.setup:
                ref = next(q for q in self.slots[p.slot] if q.setup)
                return {"mode": "like", "like": ref.pid, "align": "joint" if p.slot.startswith("hand_") else "centre"}
            return {"mode": "auto"}
        pl = dict(pl)
        if "like" in pl:
            pl["mode"] = "like"
        elif "at" in pl:
            pl["mode"] = "at"
        elif "near" in pl or "nearMaster" in pl:
            pl["mode"] = "auto"
        else:
            raise SplitError(f"{p.pid}: place needs like / at / near")
        return pl

    # ------------------------------------------------------------------ canvas fit
    def fit(self) -> None:
        fit = dict(self.m.get("fit") or {"mode": "feet" if self.kind == "character" else "symbol"})
        mode = fit.get("mode")
        ma = self.master.alpha
        if mode == "matrix":
            s = float(fit["scale"])
            ox, oy = fit.get("offset", [0, 0])
            M2C = sl.trans_m(ox, oy) @ sl.scale_m(s)
        elif mode == "identity":
            M2C = np.eye(3)
        elif mode == "symbol":
            content = int(fit.get("contentPx") or ml.content_px_for(symbol=self.name[4:]))
            x0, y0, x1, y1 = ml.bbox(ma)
            s = content / max(x1 - x0, y1 - y0) if fit.get("fit", "max") == "max" else content / (y1 - y0)
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            M2C = sl.trans_m(self.W / 2, self.H / 2) @ sl.scale_m(s) @ sl.trans_m(-cx, -cy)
            fit["contentPx"] = content
        elif mode == "feet":
            ys, xs = np.nonzero(ma > 0.5)
            ytop, ybot = float(ys.min()), float(ys.max() + 1)
            height = float(fit.get("height") or round(0.88 * self.H))
            s = height / (ybot - ytop)
            if fit.get("feetX") is not None:
                fx = float(fit["feetX"])
                src = "mapping"
            else:
                feet = [self.by_pid.get(f"foot_{sd}") or next((q for q in self.slots.get(f"foot_{sd}", []) if q.setup), None)
                        for sd in SIDES]
                feet = [f for f in feet if f is not None and f.A is not None]
                if len(feet) == 2:
                    pts = []
                    for f in feet:
                        x0, y0, x1, y1 = f.content_box()
                        pts.append(sl.apply(f.A, [[(x0 + x1) / 2, y1]])[0])
                    fx = float(np.mean([q[0] for q in pts]))
                    src = "midpoint of foot_L / foot_R"
                else:
                    band = ys >= ybot - 0.04 * (ybot - ytop)
                    fx = float(xs[band].mean() + 0.5)
                    src = "centre of the lowest 4% of the figure"
            M2C = sl.trans_m(self.anchor[0] * self.W, self.anchor[1] * self.H) @ sl.scale_m(s) @ sl.trans_m(-fx, -ybot)
            fit.update({"height": height, "feetX": round(fx, 2), "feetXFrom": src, "masterFigure": [ytop, ybot]})
        else:
            raise SplitError("fit.mode: feet | symbol | matrix | identity")
        self.M2C = M2C
        self.M2C_scale = math.sqrt(abs(np.linalg.det(M2C[:2, :2])))
        fit["scale"] = round(self.M2C_scale, 6)
        self.report["fit"] = fit

    # ------------------------------------------------------------------ hints, variants
    def _align_point(self, p: sl.Piece, how: str) -> np.ndarray:
        x0, y0, x1, y1 = p.content_box()
        fx = {"left": 0.0, "right": 1.0}
        fy = {"top": 0.0, "bottom": 1.0}
        parts = how.replace("centre", "center").split("-")
        ax = next((fx[q] for q in parts if q in fx), 0.5)
        ay = next((fy[q] for q in parts if q in fy), 0.5)
        return np.array([x0 + ax * (x1 - x0), y0 + ay * (y1 - y0)])

    def place_hinted(self, joint_pass: bool = False) -> None:
        """Pieces placed by a hint instead of registration: `at` (canvas point), `like` (another piece's
        transform + an alignment), and the variants (default like the setup attachment). `like` chains
        resolve in dependency order. The joint pass re-aligns `align: joint` pieces once joints exist."""
        if joint_pass:
            for p in self.pieces:
                pl = self._place(p)
                if pl["mode"] == "like" and pl.get("align") == "joint" and p.A is not None:
                    self._align_joint(p, self.by_pid[pl["like"]], pl)
            return
        pending = [p for p in self.pieces if p.A is None]
        while pending:
            progress = False
            for p in list(pending):
                if self._place_one(p):
                    pending.remove(p)
                    progress = True
            if not progress:
                break
        for p in pending:
            pl = self._place(p)
            if pl["mode"] == "like":
                self.errors.append(f"{p.pid}: place.like '{pl['like']}' never got a position")
            else:
                self.errors.append(f"{p.pid}: not visible in the master ({'hidden' if p.hidden else 'variant'}"
                                   f"{'' if p.hidden or not p.setup else ' or failed registration'}): "
                                   f"give place: {{at: [x, y]}} (canvas) or {{like: <piece>}}")

    def _place_one(self, p: sl.Piece) -> bool:
        pl = self._place(p)
        if pl["mode"] == "at":
            s = self.sheet_scale[p.sheet]
            a = self._align_point(p, pl.get("anchor", "centre"))
            target = self._c2m(pl["at"])
            p.A = sl.trans_m(*target) @ sl.rot_m(float(pl.get("rotate", 0))) @ sl.scale_m(s) @ sl.trans_m(-a[0], -a[1])
            p.reg = {"method": "at", "ok": True, "transform": sl.decompose(p.A)}
            return True
        if pl["mode"] != "like":
            return False
        ref = self.by_pid.get(pl["like"])
        if ref is None:
            raise SplitError(f"{p.pid}: place.like '{pl['like']}' is not a mapped piece")
        if ref.A is None:
            return False
        align = pl.get("align", "centre")
        if align == "joint":
            align = "centre"                 # provisional; refined in the joint pass
        L = ref.A.copy()
        L[:2, 2] = 0
        a_ref = sl.apply(ref.A, [self._align_point(ref, align)])[0]
        a_p = self._align_point(p, align)
        off = np.asarray(pl.get("offset", [0, 0]), float) / self.M2C_scale
        p.A = sl.trans_m(*(a_ref + off)) @ L @ sl.trans_m(-a_p[0], -a_p[1])
        p.reg = {"method": f"like {ref.pid} ({pl.get('align', 'centre')})", "ok": True, "transform": sl.decompose(p.A)}
        return True

    def _align_joint(self, p: sl.Piece, ref: sl.Piece, pl: dict) -> None:
        """Hand poses: every variant pivots at the setup hand's wrist. Slide the (centre-aligned) variant so
        its wrist region matches the setup hand's wrist region (masked NCC in canvas space)."""
        J = ref.joint
        if J is None:
            self.warnings.append(f"{p.pid}: align joint needs {ref.pid}'s joint; kept centre alignment")
            return
        sl.place_on_canvas(p, self.M2C, self.pad)
        r = float(ref.info.get("capRadius") or 0.3 * min(ref.box[2], ref.box[3]))
        r = max(8.0, min(r * 1.4, 0.5 * max(ref.box[2], ref.box[3])))
        search = int(0.35 * max(p.box[2], p.box[3])) + 4
        R = int(math.ceil(r))
        W, H = self.W, self.H
        refL = sl.canvas_layer(ref, W, H)
        jx, jy = int(round(J[0])), int(round(J[1]))
        pad = R + search + 2
        big = np.zeros((H + 2 * pad, W + 2 * pad, 4), np.float32)
        big[pad:pad + H, pad:pad + W] = sl.canvas_layer(p, W, H)
        rbig = np.zeros_like(big)
        rbig[pad:pad + H, pad:pad + W] = refL
        cy, cx = jy + pad, jx + pad
        T = rbig[cy - R:cy + R + 1, cx - R:cx + R + 1]
        yy, xx = np.mgrid[-R:R + 1, -R:R + 1]
        Mk = ((xx ** 2 + yy ** 2) <= r * r) & (T[..., 3] > 0.5)
        img = big[cy - R - search:cy + R + search + 1, cx - R - search:cx + R + search + 1]
        ncc, _ = sl.masked_ncc(img, np.ones(img.shape[:2], np.float32), T, Mk.astype(np.float32), min_cover=0.5)
        sc, qx, qy = sl._peak(ncc)
        # template top-left at (qx, qy) in img = variant content that matches the ref wrist region;
        # it sits at canvas offset (qx - search, qy - search) from the ref's -> move the variant back by that
        # the variant's wrist content sits (qx - search, qy - search) away from the setup wrist: move it back
        dx, dy = -(qx - search), -(qy - search)
        off = np.asarray(pl.get("offset", [0, 0]), float)
        p.A = np.linalg.inv(self.M2C) @ sl.trans_m(dx + off[0], dy + off[1]) @ self.M2C @ p.A
        p.reg = {"method": f"like {ref.pid} (joint)", "ok": bool(sc > 0.5), "alignNcc": round(sc, 4),
                 "shift": [round(dx, 2), round(dy, 2)], "transform": sl.decompose(p.A)}
        if sc <= 0.5:
            self.warnings.append(f"{p.pid}: wrist-region match only {sc:.2f}: check its pivot in variants.png")

    # ------------------------------------------------------------------ joints + landmarks
    def canvas_alpha(self, p: sl.Piece) -> np.ndarray:
        return sl.canvas_layer(p, self.W, self.H)[..., 3]

    def setup_piece(self, slot: str) -> sl.Piece | None:
        return next((q for q in self.slots.get(slot, []) if q.setup), None)

    def joints(self) -> None:
        self.landmarks: dict[str, list] = {}
        self.lm_src: dict[str, str] = {}
        self.pairs: list[tuple[sl.Piece, sl.Piece, list]] = []
        cache: dict[str, np.ndarray] = {}

        def A(p):
            if p.pid not in cache:
                cache[p.pid] = self.canvas_alpha(p)
            return cache[p.pid]

        if self.kind == "character":
            for slot, (partners, lm) in BIPED.items():
                c = self.setup_piece(slot)
                par = next((self.setup_piece(s) for s in partners if self.setup_piece(s)), None)
                if c is None or par is None:
                    continue
                cj = sl.cap_joint(A(c), A(par))
                if cj.get("joint") is None:
                    self.errors.append(f"{slot}: no joint with {par.slot} ({cj.get('why')})")
                    continue
                c.joint = cj["joint"]
                c.info.update({"jointWith": par.slot, **{k: v for k, v in cj.items() if k != "joint"}})
                if cj.get("method") == "overlap-centroid":
                    self.warnings.append(f"{slot}: no round overlap cap found at the joint with {par.slot} "
                                         f"(overlap centroid used; ART_PLAN parts gate wants caps)")
                self.landmarks[lm] = c.joint
                self.lm_src[lm] = f"cap joint {slot} / {par.slot} ({cj.get('method')})"
                self.pairs.append((c, par, c.joint))
            self._derived_landmarks(A)
        # part bones (face features, props, symbol parts): mapping joint > defaultsFrom relative > centre
        for slot, ps in self.slots.items():
            p = next(q for q in ps if q.setup)
            if self.kind == "character" and slot in BIPED:
                continue
            spec = {k: v for q in ps for k, v in q.spec.items()}
            d = self.defaults.get(slot, {})
            jspec = spec.get("joint", "relative" if "jointRel" in d else None)
            if jspec is None and self.kind == "symbol" and (spec.get("bone") or d.get("bone", "body")) not in ("body",):
                jspec = "centre"
            if jspec is None:
                continue
            p.joint = self._joint_from(p, jspec, d.get("jointRel"), spec, A)
            tspec = spec.get("tip", "relative" if "tipRel" in d else None)
            if tspec is not None:
                p.tip = self._joint_from(p, tspec, d.get("tipRel"), spec, A, is_tip=True)

    def _joint_from(self, p, js, rel, spec, A, is_tip=False):
        box = p.box
        a = self.canvas_alpha(p)
        ys, xs = np.nonzero(a > 0.5)
        x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
        if isinstance(js, (list, tuple)):
            return [float(js[0]), float(js[1])]
        if js == "relative" and rel is not None:
            return [round(float(x0 + rel[0] * (x1 - x0)), 1), round(float(y0 + rel[1] * (y1 - y0)), 1)]
        if js in ("centre", "center", "relative"):
            return [round(float((x0 + x1) / 2), 1), round(float((y0 + y1) / 2), 1)]
        if js in ("top", "bottom", "left", "right"):
            return {"top": [(x0 + x1) / 2, y0], "bottom": [(x0 + x1) / 2, y1], "left": [x0, (y0 + y1) / 2],
                    "right": [x1, (y0 + y1) / 2]}[js]
        if js == "far" and is_tip and p.joint is not None:
            d = (xs + 0.5 - p.joint[0]) ** 2 + (ys + 0.5 - p.joint[1]) ** 2
            i = int(np.argmax(d))
            return [round(float(xs[i] + 0.5), 1), round(float(ys[i] + 0.5), 1)]
        if js == "cap":
            partner = spec.get("attach")
            par = self.by_pid.get(partner) if partner else None
            if par is None:
                pb = spec.get("parent") or self.defaults.get(p.slot, {}).get("parent")
                par = next((self.setup_piece(s) for s in self.slots
                            if (self.setup_piece(s) and (self.setup_piece(s).spec.get("bone") or
                                                         self.defaults.get(s, {}).get("bone") or s) == pb)), None)
            if par is None:
                raise SplitError(f"{p.pid}: joint 'cap' needs attach: <piece> (the piece it joins)")
            cj = sl.cap_joint(A(p), A(par))
            if cj.get("joint") is None:
                raise SplitError(f"{p.pid}: joint 'cap': {cj.get('why')}")
            p.info.update({"jointWith": par.pid, **{k: v for k, v in cj.items() if k != "joint"}})
            self.pairs.append((p, par, cj["joint"]))
            return cj["joint"]
        raise SplitError(f"{p.pid}: joint/tip must be [x, y], cap, centre, relative, top/bottom/left/right or far (tip)")

    def _derived_landmarks(self, A) -> None:
        lm, src = self.landmarks, self.lm_src
        fwd = 1 if self.facing == "right" else -1
        if "hip_L" in lm and "hip_R" in lm and "hips" not in lm:
            lm["hips"] = [round((lm["hip_L"][0] + lm["hip_R"][0]) / 2, 1), round((lm["hip_L"][1] + lm["hip_R"][1]) / 2, 1)]
            src["hips"] = "midpoint of hip_L / hip_R"
        head = self.setup_piece("head")
        if head is not None:
            ys, xs = np.nonzero(A(head) > 0.5)
            top = ys.min()
            lm["head_top"] = [round(float(xs[ys <= top + 1].mean() + 0.5), 1), float(top)]
            src["head_top"] = "top of the head piece"
            if self.setup_piece("neck") is None and "head" in lm:
                # no neck piece (Croak): the head joins the torso there; the nod pivot sits just above it
                n = lm["head"]
                lm["neck"] = n
                lm["head"] = [round(n[0] + 0.1 * (lm["head_top"][0] - n[0]), 1), round(n[1] + 0.1 * (lm["head_top"][1] - n[1]), 1)]
                src["neck"] = "head / torso joint (no neck piece)"
                src["head"] = "10% from the neck toward head_top (no neck piece)"
        if "neck" in lm and "hips" in lm and "chest" not in lm:
            n, h = lm["neck"], lm["hips"]
            lm["chest"] = [round(n[0] + 0.3 * (h[0] - n[0]), 1), round(n[1] + 0.3 * (h[1] - n[1]), 1)]
            src["chest"] = "30% from neck to hips (rib-cage centre)"
        jaw = self.setup_piece("jaw")
        if jaw is not None and "jaw" in lm:
            ys, xs = np.nonzero(A(jaw) > 0.5)
            j = lm["jaw"]
            d = (xs + 0.5 - j[0]) * fwd
            i = int(np.argmax(d))
            lm["chin"] = [round(float(xs[i] + 0.5), 1), round(float(ys[i] + 0.5), 1)]
            src["chin"] = "jaw tip (farthest forward from the hinge)"
        for s in SIDES:
            hand = self.setup_piece(f"hand_{s}")
            if hand is not None and f"wrist_{s}" in lm:
                ys, xs = np.nonzero(A(hand) > 0.5)
                w = lm[f"wrist_{s}"]
                d = (xs + 0.5 - w[0]) ** 2 + (ys + 0.5 - w[1]) ** 2
                i = int(np.argmax(d))
                far = (xs[i] + 0.5, ys[i] + 0.5)
                lm[f"hand_{s}"] = [round(w[0] + 0.62 * (far[0] - w[0]), 1), round(w[1] + 0.62 * (far[1] - w[1]), 1)]
                src[f"hand_{s}"] = "knuckles: 62% from the wrist to the farthest fingertip"
            foot = self.setup_piece(f"foot_{s}")
            if foot is not None:
                ys, xs = np.nonzero(A(foot) > 0.5)
                low = ys >= ys.min() + 0.7 * (ys.max() - ys.min())
                i = int(np.argmax(xs[low] * fwd))
                lm[f"toe_{s}"] = [round(float(xs[low][i] + 0.5), 1), round(float(ys[low][i] + 0.5), 1)]
                src[f"toe_{s}"] = "front of the sole (facing side)"
        for k, v in (self.m.get("landmarks") or {}).items():
            lm[k] = [float(v[0]), float(v[1])]
            src[k] = "mapping"
        need = ["hips", "chest", "neck", "head", "head_top"] + [f"{n}_{s}" for s in SIDES for n in
                                                                 ("shoulder", "elbow", "wrist", "hand", "hip", "knee", "ankle", "toe")]
        miss = [k for k in need if k not in lm]
        if miss:
            self.errors.append(f"missing landmark(s) {', '.join(miss)}: map the pieces they come from or give "
                               f"landmarks: {{name: [x, y]}} in the mapping")

    # ------------------------------------------------------------------ lock + gates
    def lock_visible(self) -> None:
        """PIPELINE 3.1: original visible pixels stay locked. Where a piece is the top-most one in the rest
        pose (and fully opaque, 2 px inside its own edge) its colour is replaced by the master's."""
        W, H = self.W, self.H
        mc = sl.master_to_canvas_image(self.master, self.M2C, W, H)
        mrgb, ma = sl.unpremultiply(mc)
        rest = [p for p in self.pieces if p.setup and not p.hidden]
        owner = np.full((H, W), -1, np.int32)
        for i, p in sorted(enumerate(rest), key=lambda t: t[1].z or 0):
            owner[self.canvas_alpha(p) > 0.5] = i
        for i, p in enumerate(rest):
            if p.spec.get("lock") is False:
                continue
            x, y, w, h = p.box
            a = p.img[..., 3]
            inner = ndi.binary_erosion(a >= 0.999, iterations=2)
            sx0, sy0, sx1, sy1 = max(0, x), max(0, y), min(W, x + w), min(H, y + h)
            win = np.zeros_like(inner)
            win[sy0 - y:sy1 - y, sx0 - x:sx1 - x] = (owner[sy0:sy1, sx0:sx1] == i) & (ma[sy0:sy1, sx0:sx1] >= 0.999)
            sel = inner & win
            if not sel.any():
                p.info["lockedFrac"] = 0.0
                continue
            src = np.zeros((h, w, 3), np.float32)
            src[sy0 - y:sy1 - y, sx0 - x:sx1 - x] = mrgb[sy0:sy1, sx0:sx1]
            p.img[..., :3][sel] = src[sel] * a[sel][:, None]
            p.info["lockedFrac"] = round(float(sel.sum() / max(1, (a > 0.5).sum())), 3)

    def gates(self) -> dict:
        W, H = self.W, self.H
        rest = [p for p in self.pieces if p.setup and not p.hidden]
        self.rest = sl.composite(rest, W, H)
        self.mcanvas = sl.master_to_canvas_image(self.master, self.M2C, W, H)
        g = {"reassembly": sl.reassembly_metrics(self.rest, self.mcanvas)}
        holes = {}
        for c, par, j in self.pairs:
            t = sl.joint_hole_test(self.canvas_alpha(c), self.canvas_alpha(par), j)
            c.info["jointHoles"] = t
            if t.get("holesPx") is not None:
                area = math.pi * (0.9 * t["radius"]) ** 2
                holes[c.pid] = {**t, "ok": t["holesPx"] <= max(4, 0.02 * area)}
        g["jointHoles"] = {"deg": sl.JOINT_TEST_DEG, "pieces": holes, "passed": all(v["ok"] for v in holes.values())}
        ups = {p.pid: p.info["canvasScale"] for p in self.pieces if p.info.get("canvasScale", 0) > 1.02}
        g["noUpscale"] = {"upscaled": ups, "passed": not ups}
        reg = {p.pid: p.reg.get("ncc") for p in self.pieces if p.reg.get("ncc") is not None}
        unverified = [p.pid for p in self.pieces if p.reg.get("verified") is False]
        g["registration"] = {"minNcc": min(reg.values()) if reg else None, "gate": sl.GATE_NCC,
                             "unverified": unverified,
                             "passed": all(v >= sl.GATE_NCC for v in reg.values()) and not unverified}
        if self.kind == "character":
            fig = [p for p in rest if not NOT_FIGURE.match(p.slot)]
            ys = [(p.box[1], p.box[1] + p.box[3]) for p in fig]
            hs = [(p.box[1], p.box[1] + p.box[3]) for p in fig if HEAD_SLOTS.match(p.slot)]
            if ys and hs:
                tot = max(b for _, b in ys) - min(a for a, _ in ys)
                head = max(b for _, b in hs) - min(a for a, _ in hs)
                g["adultProportions"] = {"headRatio": round(head / tot, 4), "max": 0.27, "passed": head / tot <= 0.27}
        g["passed"] = all(v.get("passed", True) for v in g.values() if isinstance(v, dict))
        self.report["gates"] = g
        return g

    # ------------------------------------------------------------------ output
    def write(self) -> Path:
        img_root = self.out_images / self.prefix
        img_root.mkdir(parents=True, exist_ok=True)
        rel_images = os.path.relpath(self.out_images, self.out_parts.parent)
        parts = []
        z_order = sorted(self.slots, key=lambda s: (self.slots[s][0].z, s))
        for slot in z_order:
            ps = sorted(self.slots[slot], key=lambda q: (not q.setup, q.pid))
            d = self.defaults.get(slot, {})
            spec = {k: v for q in ps for k, v in q.spec.items()}
            for i, p in enumerate(ps):
                if self.kind == "character":
                    rel = f"{slot}.png" if p.att is None else f"{slot}/{p.att}.png"
                    e = {"slot": slot}
                    if p.att is not None:
                        e["attachment"] = p.att
                else:
                    rel = f"{slot}.png"
                    e = {"name": slot}
                path = img_root / rel
                path.parent.mkdir(parents=True, exist_ok=True)
                rgb, a = sl.unpremultiply(p.img)
                rgb = ml.bleed(rgb, a > 0)
                ml.save_rgba(path, rgb, a)
                e["bbox"] = [int(v) for v in p.box]
                if i == 0:
                    e["z"] = p.z
                    for k in PART_FIELDS:
                        v = spec.get(k, d.get(k))
                        if v is not None and not (k == "setup") and not (k == "hidden" and v is False):
                            e[k] = v
                    if p.joint is not None:
                        e["joint"] = [round(float(v), 1) for v in p.joint]
                    if p.tip is not None:
                        e["tip"] = [round(float(v), 1) for v in p.tip]
                    if self.kind == "character" and slot in BIPED:
                        e.pop("joint", None)            # biped limbs take their joints from the landmarks
                if p.setup and len(ps) > 1 and i != 0:
                    e["setup"] = True
                parts.append(e)
                self.report["pieces"][p.pid] = {"sheet": p.sheet, "components": p.comps, "bbox": e["bbox"],
                                                "image": str(path), "z": p.z, "setup": p.setup, "hidden": p.hidden,
                                                "registration": p.reg, **({"joint": p.joint} if p.joint else {}),
                                                **p.info}
        doc: dict = {"$comment": f"Written by {TOOL} from {self.mp.name} (split of the Higgsfield part sheets onto "
                                 f"the rig master; report: {self.work / 'report.json'}). Canvas image space, y down."}
        if self.kind == "character":
            doc.update({"skeleton": self.name, "kind": "character", "canvas": [self.W, self.H], "anchor": self.anchor,
                        "images": rel_images,
                        "landmarks": {k: [round(float(v[0]), 1), round(float(v[1]), 1)] for k, v in self.landmarks.items()},
                        "parts": parts})
        else:
            doc.update({"symbol": self.name[4:], "canvas": [self.W, self.H], "images": rel_images, "parts": parts})
        self.out_parts.parent.mkdir(parents=True, exist_ok=True)
        self.out_parts.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
        if self.kind == "character":
            self.report["landmarks"] = {k: {"at": v, "from": self.lm_src.get(k)} for k, v in self.landmarks.items()}
        return self.out_parts

    # ------------------------------------------------------------------ previews
    def previews(self) -> dict:
        W, H = self.W, self.H
        self.work.mkdir(parents=True, exist_ok=True)
        bg = sl.checker(H, W)
        a = sl.over_bg(self.rest, bg)
        b = sl.over_bg(self.mcanvas, bg)
        la = sl.luminance(self.rest[..., :3] + 0.5 * (1 - self.rest[..., 3:4]))
        lb = sl.luminance(self.mcanvas[..., :3] + 0.5 * (1 - self.mcanvas[..., 3:4]))
        diff = np.clip(np.abs(la - lb) * 4, 0, 1)
        amiss = (np.abs(self.rest[..., 3] - self.mcanvas[..., 3]) > 0.5).astype(np.float32)
        heat = np.dstack([diff, diff * 0.6, amiss]) + np.dstack([0 * amiss, amiss, 0 * amiss]) * 0.8   # cyan = alpha mismatch
        gap = np.ones((H, 12, 3), np.float32) * 0.1
        row = np.concatenate([a, gap, b, gap, np.clip(heat, 0, 1)], axis=1)
        head = 56
        canvas = np.zeros((H + head, row.shape[1], 3), np.float32)
        canvas[head:] = row
        im = Image.fromarray(sl.to_u8(canvas))
        d = ImageDraw.Draw(im)
        font = sl._font(22)
        r = self.report["gates"]["reassembly"]
        d.text((10, 6), f"{self.name}  rest pose | master | |diff| x4   SSIM {r['ssim']:.4f} (> {sl.GATE_SSIM})   "
                        f"alpha IoU {r['alphaIoU']:.4f} (> {sl.GATE_IOU})   {'PASS' if r['passed'] else 'FAIL'}",
               fill=(255, 255, 255), font=font)
        d.text((10, 30), f"joint holes at +-{sl.JOINT_TEST_DEG:.0f} deg: "
                         f"{'none' if self.report['gates']['jointHoles']['passed'] else 'FOUND'}   pieces {len(self.pieces)}",
               fill=(200, 200, 200), font=font)
        out = {"preview": self.work / "preview.png"}
        im.save(out["preview"])
        # landmarks + joints over the rest pose
        im2 = Image.fromarray(sl.to_u8(a))
        d2 = ImageDraw.Draw(im2)
        f2 = sl._font(14)
        pts = dict(getattr(self, "landmarks", {}))
        for p in self.pieces:
            if p.setup and p.joint is not None and p.slot not in BIPED:
                pts[f"{p.slot}"] = p.joint
        for k, (x, y) in pts.items():
            d2.line([x - 6, y, x + 6, y], fill=(255, 40, 160), width=2)
            d2.line([x, y - 6, x, y + 6], fill=(255, 40, 160), width=2)
            d2.text((x + 5, y + 3), k, fill=(255, 255, 255), font=f2)
        out["landmarks"] = self.work / "landmarks.png"
        im2.save(out["landmarks"])
        # variants: each attachment swapped into the rest pose, cropped around the slot
        rows = []
        for slot, ps in sorted(self.slots.items()):
            if len(ps) < 2:
                continue
            boxes = np.array([p.box for p in ps], float)
            x0, y0 = boxes[:, 0].min(), boxes[:, 1].min()
            x1, y1 = (boxes[:, 0] + boxes[:, 2]).max(), (boxes[:, 1] + boxes[:, 3]).max()
            m = 0.35 * max(x1 - x0, y1 - y0)
            X0, Y0, X1, Y1 = [int(v) for v in (max(0, x0 - m), max(0, y0 - m), min(W, x1 + m), min(H, y1 + m))]
            tiles = []
            for p in sorted(ps, key=lambda q: (not q.setup, q.pid)):
                others = [q for q in self.pieces if q.setup and not q.hidden and q.slot != slot] + [p]
                comp = sl.composite(others, W, H)
                t = sl.over_bg(comp, bg)[Y0:Y1, X0:X1]
                if p.joint is None and ps[0].joint is not None:
                    pass
                tiles.append(t)
            th = max(t.shape[0] for t in tiles)
            tiles = [np.pad(t, ((0, th - t.shape[0]), (0, 8), (0, 0))) for t in tiles]
            rows.append((slot, [p.att or p.slot for p in sorted(ps, key=lambda q: (not q.setup, q.pid))], np.concatenate(tiles, 1)))
        if rows:
            wmax = max(r[2].shape[1] for r in rows)
            stack = []
            for slot, names, r in rows:
                lab = np.zeros((22, wmax, 3), np.float32)
                stack += [lab, np.pad(r, ((0, 0), (0, wmax - r.shape[1]), (0, 0)))]
            im3 = Image.fromarray(sl.to_u8(np.concatenate(stack, 0)))
            d3 = ImageDraw.Draw(im3)
            yy = 0
            for slot, names, r in rows:
                d3.text((6, yy + 3), f"{slot}: " + "  |  ".join(names), fill=(255, 230, 0), font=f2)
                yy += 22 + r.shape[0]
            out["variants"] = self.work / "variants.png"
            im3.save(out["variants"])
        return {k: str(v) for k, v in out.items()}

    # ------------------------------------------------------------------ run
    def run(self, preview: bool = True, lock: bool | None = None) -> dict:
        self.load()
        fit_first = (self.m.get("fit") or {}).get("mode") in ("matrix", "identity")
        if fit_first:
            self.fit()
        self.register()
        if not fit_first:
            self.fit()
        self.place_hinted()
        if self.errors:
            raise SplitError("; ".join(self.errors))
        for p in self.pieces:
            sl.place_on_canvas(p, self.M2C, self.pad)
        self.joints()
        self.place_hinted(joint_pass=True)
        for p in self.pieces:
            if p.reg.get("method", "").endswith("(joint)"):
                sl.place_on_canvas(p, self.M2C, self.pad)
        if self.errors:
            raise SplitError("; ".join(self.errors))
        if lock if lock is not None else self.m.get("lockVisible", False):
            self.lock_visible()
        self.gates()
        self.write()
        if preview:
            self.report["previews"] = self.previews()
        self.work.mkdir(parents=True, exist_ok=True)
        (self.work / "report.json").write_text(json.dumps(self.report, indent=1, default=float) + "\n", encoding="utf-8")
        return self.report


# ----------------------------------------------------------------------------- cut


def plan_expectations(row_id: str) -> list[str]:
    """Expected pieces of a plan row (art/plan/bass-drop.json): mascot sheets from
    artbible.bassDrop.mascots.<id>.sheets.<sheet>, symbol sheets from artbible.symbols.<ID>.rigParts."""
    plan = json.loads((sl.REPO / "art" / "plan" / "bass-drop.json").read_text())
    bible = json.loads((sl.REPO / "art" / "bible" / "artbible.json").read_text())
    row = next((r for r in plan["assets"] if r["id"] == row_id), None)
    if row is None:
        raise SplitError(f"plan row '{row_id}' not in art/plan/bass-drop.json")
    src = (row.get("varsFrom") or {}).get("PART_LIST")
    out: list[str] = []
    if src:
        node = bible
        for k in src.split("."):
            node = node[k]
        for it in node:
            slot = re.sub(r"\s*\(.*?\)", "", it["slot"] if isinstance(it, dict) else str(it)).strip()
            out += [s.strip() for s in slot.split("+")]
    elif (row.get("context") or {}).get("symbol"):
        sym = bible["symbols"][row["context"]["symbol"]]
        out = [re.sub(r"\s*\(.*?\)", "", p).strip() for p in sym.get("rigParts", [])]
    return out


def cmd_cut(a) -> int:
    out = Path(a.out)
    mt = sl.matte_image(Path(a.sheet), key=a.key, expect_key=a.expect_key, cache_dir=out / "cache")
    comps, lab = sl.find_components(mt["alpha"], min_area=a.min_area)
    sl.components_preview(mt["rgb"], mt["alpha"], comps, out / "components.png")
    ml.save_rgba(out / "sheet_rgba.png", mt["rgb"], mt["alpha"])
    real = [c for c in comps if not c["noise"]]
    expected = plan_expectations(a.plan_row) if a.plan_row else []
    stub = {"id": a.id or Path(a.sheet).parent.parent.name or Path(a.sheet).stem, "image": a.sheet, "key": a.key,
            **({"expectKey": "#" + a.expect_key.lstrip("#").upper()} if a.expect_key else {}),
            "scale": "auto", "pieces": {}}
    for i, c in enumerate(real):
        guess = expected[i] if i < len(expected) and len(expected) == len(real) else None
        stub["pieces"][c["id"]] = guess
    doc = {"$comment": "Sheet entry for a tools/split mapping: look at components.png, name every component "
                       "(slot, slot/attachment or {slot, ...}) or null to ignore it; guesses follow the plan's "
                       "piece order only when the counts match - check every one.",
           "components": comps, "expected": expected, "sheetEntry": stub, "key": mt["key"]}
    (out / "components.json").write_text(json.dumps(doc, indent=1, default=float) + "\n", encoding="utf-8")
    print(json.dumps({"components": len(real), "noise": len(comps) - len(real), "expected": len(expected) or None,
                      "countMatches": (len(expected) == len(real)) if expected else None,
                      "minGapPx": min((c.get("gapPx") for c in real if c.get("gapPx") is not None), default=None),
                      "key": {k: mt["key"].get(k) for k in ("mode", "key", "uniform", "drift", "passed")},
                      "matteLeakPx": mt["key"].get("matte", {}).get("leakPx"),
                      "preview": str(out / "components.png"), "stub": str(out / "components.json")}, indent=2))
    if mt["key"].get("matte", {}).get("leakWarning"):
        print(f"warning: the matte keyed out {mt['key']['matte']['leakPx']} non-key px: an open outline let a fill leak "
              f"into the background (look for hollow pieces in components.png)", file=sys.stderr)
    if expected and len(expected) != len(real):
        print(f"warning: {len(real)} components but the plan lists {len(expected)} pieces: merged or missing "
              f"pieces (a sheet where two pieces touch needs a regenerate, or a manual cut)", file=sys.stderr)
    return 0


def cmd_build(a) -> int:
    b = Build(Path(a.mapping), out_dir=Path(a.out) if a.out else None)
    rep = b.run(preview=not a.no_preview, lock=True if a.lock_visible else None)
    g = rep["gates"]
    summary = {"parts": str(b.out_parts), "images": str(b.out_images / b.prefix), "report": str(b.work / "report.json"),
               "pieces": len(b.pieces), "reassembly": g["reassembly"], "jointHoles": g["jointHoles"]["passed"],
               "noUpscale": g["noUpscale"]["passed"], "registrationMinNcc": g["registration"]["minNcc"],
               **({"adultProportions": g["adultProportions"]} if "adultProportions" in g else {}),
               "passed": g["passed"], "previews": rep.get("previews"), "warnings": rep["warnings"]}
    print(json.dumps(summary, indent=2, default=float))
    r = g["reassembly"]
    print(f"reassembly: SSIM {r['ssim']:.4f} (gate > {sl.GATE_SSIM}), alpha IoU {r['alphaIoU']:.4f} (gate > {sl.GATE_IOU})"
          f" -> {'PASS' if r['passed'] else 'FAIL'}", file=sys.stderr)
    if a.strict and not g["passed"]:
        print("error: a split gate failed (see the report)", file=sys.stderr)
        return 1
    return 0


def cmd_preview(a) -> int:
    """Composite an existing parts.json (e.g. after hand edits) next to the master and print SSIM / IoU."""
    b = Build(Path(a.mapping), out_dir=Path(a.out) if a.out else None)
    ms = b.m["master"] if isinstance(b.m["master"], dict) else {"image": b.m["master"]}
    mt = sl.matte_image(rpath(ms["image"]), key=ms.get("key", "auto"), expect_key=ms.get("expectKey"),
                        cache_dir=b.work / "cache")
    b.master = sl.Master(mt["rgb"], mt["alpha"])
    doc = json.loads(Path(a.parts or b.out_parts).read_text())
    if (b.m.get("fit") or {}).get("mode") in ("matrix", "identity", "symbol"):
        b.slots, b.by_pid = {}, {}
        b.fit()
    else:
        rep_path = b.work / "report.json"
        if not rep_path.exists():
            raise SplitError("feet fit: run build first (the report keeps the master -> canvas fit)")
        f = json.loads(rep_path.read_text())["fit"]
        b.M2C = sl.trans_m(b.anchor[0] * b.W, b.anchor[1] * b.H) @ sl.scale_m(f["scale"]) @ sl.trans_m(-f["feetX"], -f["masterFigure"][1])
    root = Path(a.parts or b.out_parts).parent / doc.get("images", "images")
    prefix = doc.get("skeleton") or f"sym_{doc.get('symbol')}"
    seen, zs, pieces = set(), {}, []
    for pm in doc["parts"]:
        slot = pm.get("slot") or pm.get("name")
        if "z" in pm:
            zs[slot] = pm["z"]
        if slot in seen or pm.get("hidden"):
            seen.add(slot)
            continue
        seen.add(slot)
        att = pm.get("attachment")
        rel = pm.get("image") or (f"{prefix}/{slot}.png" if not att else f"{prefix}/{slot}/{att}.png")
        arr = np.asarray(Image.open(root / rel).convert("RGBA"), np.float32) / 255
        p = sl.Piece(pid=slot, slot=slot, att=att, sheet="-", comps=[], spec={}, rgb=arr[..., :3], alpha=arr[..., 3],
                     origin=(0, 0), z=zs.get(slot, 0))
        p.img = sl.premultiply(p.rgb, p.alpha)
        p.box = tuple(int(v) for v in pm["bbox"])
        pieces.append(p)
    rest = sl.composite(pieces, b.W, b.H)
    mc = sl.master_to_canvas_image(b.master, b.M2C, b.W, b.H)
    r = sl.reassembly_metrics(rest, mc)
    print(json.dumps(r, indent=2))
    b.rest, b.mcanvas, b.pieces, b.slots = rest, mc, pieces, {p.slot: [p] for p in pieces}
    b.report["gates"] = {"reassembly": r, "jointHoles": {"passed": True}}
    b.landmarks = doc.get("landmarks", {})
    print(json.dumps(b.previews(), indent=2))
    return 0 if (r["passed"] or not a.strict) else 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("cut", help="matte a sheet, number its components, write a preview + mapping stub")
    c.add_argument("sheet")
    c.add_argument("--out", required=True)
    c.add_argument("--key", default="auto", help="auto (measured, keyUniform gate) | RRGGBB | alpha")
    c.add_argument("--expect-key", help="the prompt's KEY_HEX (drift is reported)")
    c.add_argument("--min-area", type=int, help="components smaller than this are noise (default 2e-5 x area, >= 48)")
    c.add_argument("--plan-row", help="art/plan/bass-drop.json row id: expected piece list for the stub")
    c.add_argument("--id", help="sheet id in the stub (default: the raw folder's asset name)")
    b = sub.add_parser("build", help="mapping -> registered parts + parts.json + QA")
    b.add_argument("mapping")
    b.add_argument("--out", help="output dir (default: the mapping's out.*, else build/split/<name>)")
    b.add_argument("--preview", action="store_true", help="(default on) write preview.png / landmarks.png / variants.png")
    b.add_argument("--no-preview", action="store_true")
    b.add_argument("--lock-visible", action="store_true", help="lock the visible pixels to the master (PIPELINE 3.1)")
    b.add_argument("--strict", action="store_true", help="exit 1 when a gate fails")
    p = sub.add_parser("preview", help="re-check an existing parts.json against the master")
    p.add_argument("mapping")
    p.add_argument("--parts", help="parts.json to check (default: the mapping's output)")
    p.add_argument("--out")
    p.add_argument("--strict", action="store_true")
    a = ap.parse_args(argv)
    try:
        return {"cut": cmd_cut, "build": cmd_build, "preview": cmd_preview}[a.cmd](a)
    except ml.KeyNotUniform as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    except (SplitError, FileNotFoundError, KeyError, json.JSONDecodeError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
