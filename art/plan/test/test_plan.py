#!/usr/bin/env python3
"""Self-tests for art/plan (no network, no credits).

  python3 art/plan/test/test_plan.py        # stdlib only; needs node for the twin-parity test
Scratch output: art/_work/test-plan/ (gitignored), recreated on every run.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

PLAN_DIR = Path(__file__).resolve().parents[1]
REPO = PLAN_DIR.parents[1]
sys.path.insert(0, str(PLAN_DIR))
sys.path.insert(0, str(REPO / "tools" / "gen"))
import build_plan as bp  # noqa: E402
import genlib  # noqa: E402

WORK = REPO / "art" / "_work" / "test-plan"
NODE = shutil.which("node") or "node"
PY = sys.executable
NEW_TEMPLATES = ("prop.txt", "emblem.txt", "card_art.txt", "mascot_parts_sheet.txt")

NODE_EVAL = r"""
import { buildValues, render } from './tools/gen/lib/genlib.mjs';
const input = JSON.parse(await new Promise((res) => { let s=''; process.stdin.on('data', (d) => s += d); process.stdin.on('end', () => res(s)); }));
const out = [];
for (const c of input) {
  try {
    const v = buildValues(c.ref, { symbol: c.symbol ?? null, mascot: c.mascot ?? null, rigReady: !!c.rigReady, overrides: c.vars ?? {} });
    const r = render(c.ref, v);
    out.push({ text: r.text, hash: r.hash });
  } catch (e) { out.push({ error: e.message }); }
}
console.log(JSON.stringify(out));
"""

DOC = json.loads(bp.PLAN_PATH.read_text(encoding="utf-8"))
ASSETS = DOC["assets"]
BY_ID = {a["id"]: a for a in ASSETS}
RENDERED = [a for a in ASSETS if a["template"]]
PLANNED = [a for a in ASSETS if not a["jobIds"]]
ANCHORS = [a for a in ASSETS if a["jobIds"]]


def case(a):
    return {"ref": a["template"], "symbol": a["context"].get("symbol"), "mascot": a["context"].get("mascot"),
            "rigReady": bool(a["context"].get("rigReady")), "vars": a["vars"]}


def py_render(c):
    vals = genlib.build_values(c["ref"], symbol=c.get("symbol"), mascot=c.get("mascot"), rig_ready=bool(c.get("rigReady")),
                               overrides=c.get("vars", {}))
    return genlib.render(c["ref"], vals)


class PlanTests(unittest.TestCase):
    def test_plan_and_doc_table_are_current(self):
        r = subprocess.run([PY, str(PLAN_DIR / "build_plan.py"), "--check"], cwd=REPO, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_render_commands_are_script_free(self):
        # every planned row's 'render' field, run as-is in a shell, prints the row's prompt and hash
        self.assertTrue(all(a["render"] for a in PLANNED))
        for a in RENDERED:
            r = subprocess.run(["bash", "-c", a["render"].replace("python3 ", f"{PY} ", 1)], cwd=REPO, capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, f"{a['id']}: {r.stderr}")
            d = json.loads(r.stdout)
            self.assertEqual(d["promptHash"], a["promptHash"], a["id"])
            self.assertEqual(d["prompt"], a["prompt"], a["id"])
            self.assertEqual(py_render(case(a))[1], a["promptHash"], a["id"])

    def test_node_twin_parity_every_row_and_new_section(self):
        cases = [case(a) for a in RENDERED]
        # every section of the new templates (and background E/F) with representative values, beyond the plan rows
        cases += [
            {"ref": "prop.txt#A", "vars": {"PROP": "a squat crate", "VIEW": "orthographic front view", "DETAIL": "Plain wood."}},
            {"ref": "prop.txt#B", "vars": {"PIECES": "a plate; a clamp"}},
            {"ref": "emblem.txt#A", "vars": {"EMBLEM": "a jukebox", "PALETTE": "gold"}},
            {"ref": "emblem.txt#B", "vars": {"EMBLEM": "a badge", "PALETTE": "gold"}},
            {"ref": "emblem.txt#C", "vars": {"ICONS": "a fang; a crown"}},
            {"ref": "card_art.txt", "vars": {"SCENE": "a jukebox.", "BACKDROP": "a violet room"}},
            {"ref": "background.txt#E", "vars": {"VARIANT_NOTE": "after hours."}},
            {"ref": "background.txt#F"},
        ] + [{"ref": f"mascot_parts_sheet.txt#{s}", "mascot": "croak",
              "vars": {"CHARACTER": "lanky adult bullfrog DJ", "FACING": "toward the left side of the image", "POSE_NOTE": ""}
              if s == "A" else {"PART_LIST": "torso, near forearm"}} for s in "ABCDE"]
        r = subprocess.run([NODE, "--input-type=module", "-e", NODE_EVAL], cwd=REPO, text=True, capture_output=True,
                           input=json.dumps(cases), check=True)
        for c, j in zip(cases, json.loads(r.stdout)):
            self.assertNotIn("error", j, f"{c['ref']}: {j.get('error')}")
            text, h = py_render(c)
            self.assertEqual(text, j["text"], c["ref"])
            self.assertEqual(h, j["hash"], c["ref"])

    def test_every_new_section_is_used_by_a_row(self):
        used = {a["template"] for a in ASSETS}
        refs = [n + (f"#{s}" if s else "") for n in NEW_TEMPLATES for s in (genlib.template_sections(n) or [None])]
        for ref in refs + ["background.txt#E", "background.txt#F"]:
            self.assertIn(ref, used, f"{ref} is not used by any plan row")

    def test_prompt_hygiene_and_formula(self):
        terms = genlib.forbidden_terms(genlib.bible())
        for a in PLANNED:
            p = a["prompt"]
            low = p.lower()
            self.assertEqual(genlib.check_forbidden(p, terms), [], a["id"])
            for w in bp.BANNED:
                self.assertNotIn(w, low, f"{a['id']}: banned word {w!r}")
            self.assertNotRegex(p, r"\{[A-Z0-9_]+\}", a["id"])
            name, sec = genlib.split_template_ref(a["template"])
            if "STYLE_FORMULA" in genlib.placeholders(name, sec):
                want = bp.FORMULA_ENV if a["template"] == "background.txt#F" else bp.FORMULA_D
                self.assertIn(want, p, a["id"])
                self.assertNotIn(genlib.bible()["styleFormula"], p, f"{a['id']}: still the SWAMP FUNK formula")
            if a["keyHex"]:
                self.assertIn(a["keyHex"], p, a["id"])
            if any(d for d in a["downstream"] if "outline_matte.py" in d):
                self.assertTrue(all("--key auto" in d for d in a["downstream"] if "outline_matte.py" in d), a["id"])

    def test_formula_d_matches_the_style_decision(self):
        text = (REPO / "docs" / "games" / "bass-drop" / "STYLE_DECISION.md").read_text(encoding="utf-8")
        self.assertIn(bp.FORMULA_D, text.replace("\n> ", " "))
        self.assertIn(bp.FORMULA_ENV, text.replace("\n> ", " "))

    def test_key_colours_follow_the_bible(self):
        b = genlib.bible()
        for a in RENDERED:
            m, s = a["context"].get("mascot"), a["context"].get("symbol")
            if m:
                self.assertEqual(a["keyHex"], b["mascots"][m]["keyHex"], a["id"])
            elif s and a["template"].startswith("symbol"):
                self.assertEqual(a["keyHex"], b["symbols"][s]["keyHex"], a["id"])
        self.assertEqual(BY_ID["bd_emblem_jukebox"]["keyHex"], "#FF00FF")      # teal -> magenta
        self.assertEqual(BY_ID["bd_notch_icons"]["keyHex"], "#0000FF")         # teal + pink clash -> blue
        self.assertEqual(BY_ID["bd_logo_emblem"]["keyHex"], "#0000FF")         # green + pink clash -> blue

    def test_models_prices_and_gate(self):
        for model in bp.MODELS:
            self.assertEqual(genlib.gate(bp.ROUTE, model)["licenseId"], "higgsfield")
            self.assertEqual(genlib.denylist_hits(bp.ROUTE, model), [])
        for bad in ("gpt_image_2", "gpt_image_2_5", "openai_hazel"):
            with self.assertRaises(genlib.GenError):
                genlib.gate(bp.ROUTE, bad)
        for a in ASSETS:
            self.assertIn(a["model"], bp.MODELS, a["id"])
            per = bp.MODELS[a["model"]]["credits"][a["resolution"]]
            self.assertEqual(a["credits"]["perImage"], per, a["id"])
            self.assertEqual(a["credits"]["base"], 0 if a["jobIds"] else per * a["candidates"], a["id"])
            if a["model"] == "nano_banana_pro":
                self.assertEqual(a["manifestModel"], "nano_banana_2", a["id"])
            self.assertIn(a["aspectRatio"], {"1:1", "3:2", "2:3", "4:3", "3:4", "4:5", "5:4", "9:16", "16:9", "21:9"}, a["id"])
        hfl = REPO / "tools" / "gen" / "lib" / "hfledger.mjs"
        if hfl.is_file():  # the ingestion tool's price table must agree with the plan's
            r = subprocess.run([NODE, "--input-type=module", "-e",
                                "import { MCP_MODELS } from './tools/gen/lib/hfledger.mjs'; console.log(JSON.stringify(MCP_MODELS));"],
                               cwd=REPO, capture_output=True, text=True)
            if r.returncode == 0:
                theirs = json.loads(r.stdout)
                for model, spec in bp.MODELS.items():
                    self.assertEqual(theirs[model]["credits"], spec["credits"], model)
                    self.assertEqual(theirs[model]["reports"], spec["reports"], model)

    def test_budget(self):
        bud = DOC["budget"]
        p0, p1 = bud["perPriority"]["P0"], bud["perPriority"]["P1"]
        self.assertLessEqual(p0["total"], bp.P0_CAP)
        self.assertTrue(p0["fitsCap"])
        self.assertLessEqual(p0["total"] + p1["total"], bp.BALANCE)
        for p, x in (("P0", p0), ("P1", p1)):
            rows = [a for a in ASSETS if a["priority"] == p]
            self.assertAlmostEqual(x["base"], sum(a["credits"]["base"] for a in rows))
            self.assertAlmostEqual(x["withRetries"], sum(a["credits"]["base"] for a in rows) * bp.RETRY)
        p2 = bud["perPriority"]["P2"]
        funded = sum(b["credits"] for b in p2["batches"] if b["batch"] in p2["funded"])
        self.assertAlmostEqual(bud["unallocated"], bp.BALANCE - p0["total"] - p1["total"] - funded)
        self.assertGreaterEqual(bud["unallocated"], 0)

    def test_anchors_are_the_adopted_ledger_jobs(self):
        jobs = {j["job_id"]: j for j in bp.ledger_jobs().values()}
        self.assertEqual(sorted(a["id"] for a in ANCHORS),
                         sorted(["sym_H1", "sym_H3", "sym_W", "mascot_gumbo_sheet", "mascot_croak_sheet_v2", "bg_base_landscape"]))
        for a in ANCHORS:
            j = jobs[a["jobIds"][0]]
            self.assertIn(j["batch"], ("ab1", "ab2"), a["id"])
            self.assertEqual(j["promptHash"], a["promptHash"], a["id"])
            self.assertEqual(a["credits"]["spent"], j["credits"], a["id"])
            if a["template"] is None:
                stored = REPO / a["promptPath"]
                if stored.is_file():
                    self.assertEqual(hashlib.sha256(stored.read_bytes()).hexdigest(), a["promptHash"], a["id"])
        # nothing from the rejected formula-A probe batch is referenced
        probe_ids = {j["job_id"] for j in jobs.values() if j["batch"] == "probe1"}
        for a in ASSETS:
            for r in a["refs"]:
                self.assertNotIn(r["jobId"], probe_ids, f"{a['id']} references a probe1 job")
        self.assertTrue(all(s["job"].split("/")[0] in ("probe1", "ab1") for s in DOC["superseded"]))

    def test_refs_order_and_batches(self):
        order = {a["id"]: a["order"] for a in ASSETS}
        batch_ids = [b["id"] for b in DOC["batches"]]
        for a in ASSETS:
            for r in a["refs"]:
                self.assertLess(order[r["ref"]], a["order"], f"{a['id']} -> {r['ref']}")
                if BY_ID[r["ref"]]["jobIds"]:
                    self.assertEqual(r["jobId"], BY_ID[r["ref"]]["jobIds"][0])
                self.assertLessEqual(batch_ids.index(BY_ID[r["ref"]]["batch"]), batch_ids.index(a["batch"]))
            if not a["jobIds"]:
                self.assertTrue(a["refs"], f"{a['id']}: no references (consistency comes from references)")
                self.assertLessEqual(len(a["refs"]), 4, a["id"])
        for b in DOC["batches"]:
            self.assertLessEqual(b["jobs"], 12, f"{b['id']}: > 12 jobs in one generate_image_batch call")
        # the order of operations: inside the P0 pass, phases never go backwards
        p0 = [bp.PHASES.index(a["phase"]) for a in ASSETS if a["priority"] == "P0"]
        self.assertEqual(p0, sorted(p0))

    def test_mascot_parts_cover_the_rig_slots(self):
        md = genlib.bible()["bassDrop"]["mascots"]
        for mid, need in (("gumbo", ["torso", "tank_top", "belly", "tail", "jaw", "head", "mouth/roar", "hand_L/lean", "cooler_lid", "toothpick"]),
                          ("croak", ["torso", "shirt", "pouch", "eye_bulge_L", "lid_R", "mouth/O", "hand_R/press", "hand_L/fader", "mic", "cup_R", "cap"])):
            slots = " ".join(p["slot"] for sheet in md[mid]["sheets"].values() for p in sheet)
            for s in need:
                self.assertIn(s, slots, f"{mid}: {s}")
            near = md[mid]["nearSide"]
            self.assertEqual([p["slot"] for p in md[mid]["sheets"]["body"] if p["piece"] == "near upper arm"], [f"upper_arm_{near}"])
        self.assertNotIn("chain", " ".join(p["slot"] for s in md["gumbo"]["sheets"].values() for p in s))  # D design: no chain

    def test_spec_export_and_ingest_compat(self):
        WORK.mkdir(parents=True, exist_ok=True)
        empty = WORK / "approvals_empty.json"
        empty.write_text('{"approvals": {}}\n')
        r = subprocess.run([PY, str(PLAN_DIR / "build_plan.py"), "spec", "--batch", "c01", "--approvals", str(empty)],
                           cwd=REPO, capture_output=True, text=True)
        self.assertEqual(r.returncode, 3, r.stderr)
        self.assertIn("sym_H2 -> sym_H1", r.stderr)
        appr = {"approvals": {a["id"]: {"job_id": a["jobIds"][0]} for a in ANCHORS}}
        ok = WORK / "approvals_anchors.json"
        ok.write_text(json.dumps(appr))
        r = subprocess.run([PY, str(PLAN_DIR / "build_plan.py"), "spec", "--batch", "c01", "--approvals", str(ok)],
                           cwd=REPO, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        spec = json.loads(r.stdout)
        self.assertEqual(spec["model"], "nano_banana_pro")
        self.assertEqual(len(spec["jobs"]), 6)
        self.assertEqual(len({j["name"] for j in spec["jobs"]}), 6)
        self.assertEqual(spec["jobs"][0]["medias"][0], {"value": BY_ID["sym_H1"]["jobIds"][0], "role": "image_references"})
        self.assertEqual(spec["jobs"][0]["vars"]["STYLE_FORMULA"], bp.FORMULA_D)
        # the ingestion tool (tools/gen/hf-ingest.mjs, another track) renders the same prompts from this spec
        hf = REPO / "tools" / "gen" / "hf-ingest.mjs"
        if not hf.is_file():
            self.skipTest("tools/gen/hf-ingest.mjs not present")
        sp = WORK / "c01.spec.json"
        sp.write_text(json.dumps(spec))
        out = WORK / "c01.plan.json"
        r = subprocess.run([NODE, str(hf), "plan", "--spec", str(sp), "--ledger", str(WORK / "no-ledger.json"), "--out", str(out),
                            "--force"], cwd=REPO, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)                       # a spec the planner refuses would block the batch
        plan = json.loads(out.read_text())
        for j in plan["jobs"]:
            self.assertEqual(j["promptHash"], BY_ID[j["name"].rsplit(".c", 1)[0]]["promptHash"], j["name"])

    def _spec(self, *args, ledger=None, approvals=None):
        """Run build_plan.cmd_spec in-process against a scratch ledger / approvals file: (exit, stdout, stderr)."""
        import contextlib
        import io
        old = bp.LEDGER_PATH
        if ledger is not None:
            bp.LEDGER_PATH = WORK / "spec_ledger.json"
            bp.LEDGER_PATH.write_text(json.dumps(ledger))
        ap = WORK / "spec_approvals.json"
        ap.write_text(json.dumps({"approvals": approvals or {}}))
        out, err = io.StringIO(), io.StringIO()
        try:
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                code = bp.main(["spec", *args, "--approvals", str(ap)])
        finally:
            bp.LEDGER_PATH = old
        return code, out.getvalue(), err.getvalue()

    def test_spec_rejects_bad_approvals_and_supports_retries(self):
        WORK.mkdir(parents=True, exist_ok=True)
        real = json.loads(bp.LEDGER_PATH.read_text(encoding="utf-8"))
        anchors = {a["id"]: {"job_id": a["jobIds"][0]} for a in ANCHORS}
        # a pick that is not a ledger job, or a job of another row (a probe1 image for sym_H1), is never sent
        code, _, err = self._spec("--batch", "c01", ledger=real, approvals={**anchors, "sym_H1": {"job_id": "00000000-0000-4000-8000-000000000000"}})
        self.assertEqual(code, 3, err)
        self.assertIn("sym_H1: approved job 00000000-0000-4000-8000-000000000000 is not in the ledger", err)
        probe_h1 = next(j["job_id"] for j in bp.ledger_jobs().values() if j["batch"] == "probe1" and j["name"] == "sym_H1")
        code, _, err = self._spec("--batch", "c01", ledger=real, approvals={**anchors, "sym_H1": {"job_id": probe_h1}})
        self.assertEqual(code, 3, err)
        self.assertIn("not a candidate of row sym_H1", err)
        code, out, err = self._spec("--batch", "c01", ledger=real, approvals=anchors)
        self.assertEqual(code, 0, err)
        spec = json.loads(out)
        self.assertEqual(spec["batch"], "bd_c01")
        # once bd_c01 is recorded, the same spec is refused; a retry of the rejected row gets its own batch and names
        rec = json.loads(json.dumps(real))
        rec["batches"].append({"id": "bd_c01", "date": "2026-09-27", "model": "nano_banana_pro", "jobs": [
            {"name": j["name"], "job_id": f"00000000-0000-4000-8000-{i:012d}", "status": "completed", "asset": j["asset"]}
            for i, j in enumerate(spec["jobs"])]})
        code, _, err = self._spec("--batch", "c01", ledger=rec, approvals=anchors)
        self.assertEqual(code, 2, err)
        self.assertIn("--attempt 2", err)
        code, out, err = self._spec("--batch", "c01", "--attempt", "2", "--rows", "sym_H2", "--candidates", "1", ledger=rec, approvals=anchors)
        self.assertEqual(code, 0, err)
        retry = json.loads(out)
        self.assertEqual((retry["batch"], [j["name"] for j in retry["jobs"]]), ("bd_c01_r2", ["sym_H2.r2.c1"]))
        self.assertEqual(retry["jobs"][0]["asset"], "sym_H2")
        code, _, err = self._spec("--batch", "c01", "--rows", "sym_W", ledger=real, approvals=anchors)
        self.assertEqual(code, 2, err)
        # an approved candidate of a planned row (its ledger 'asset' is the row id) may be a reference; another row's may not
        c02_anchor = {**anchors, "sym_H2": {"job_id": "00000000-0000-4000-8000-000000000000"}, "sym_H4": {"job_id": "00000000-0000-4000-8000-000000000002"}}
        code, out, err = self._spec("--batch", "c02", ledger=rec, approvals=c02_anchor)
        self.assertEqual(code, 0, err)
        c02_bad = {**c02_anchor, "sym_H4": {"job_id": "00000000-0000-4000-8000-000000000001"}}   # that job is sym_H2.c2
        code, _, err = self._spec("--batch", "c02", ledger=rec, approvals=c02_bad)
        self.assertEqual(code, 3, err)
        self.assertIn("not a candidate of row sym_H4", err)
        # the retry spec goes straight into the ingestion tool's planner
        hf = REPO / "tools" / "gen" / "hf-ingest.mjs"
        sp = WORK / "retry.spec.json"
        sp.write_text(json.dumps(retry))
        r = subprocess.run([NODE, str(hf), "plan", "--spec", str(sp), "--ledger", str(WORK / "no-ledger.json"),
                            "--out", str(WORK / "retry.plan.json"), "--force"], cwd=REPO, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout)["estimatedCredits"], 2)

    def test_docs_cover_every_row_and_template(self):
        art_plan = (REPO / "docs" / "games" / "bass-drop" / "ART_PLAN.md").read_text(encoding="utf-8")
        for a in ASSETS:
            self.assertIn(f"`{a['id']}`", art_plan, a["id"])
        readme = (REPO / "art" / "bible" / "prompts" / "README.md").read_text(encoding="utf-8")
        for name in NEW_TEMPLATES:
            self.assertIn(f"`{name}`", readme, name)

    def test_approvals_file(self):
        d = json.loads(bp.APPROVALS_PATH.read_text(encoding="utf-8"))
        jobs = {j["job_id"] for j in bp.ledger_jobs().values()}
        for rid, x in d["approvals"].items():
            self.assertIn(rid, BY_ID, rid)
            self.assertIn(x["job_id"], jobs, rid)
            if BY_ID[rid]["jobIds"]:
                self.assertEqual(x["job_id"], BY_ID[rid]["jobIds"][0], rid)


if __name__ == "__main__":
    unittest.main(verbosity=2)
