#!/usr/bin/env python3
"""Self-tests for tools/gen (no API keys, no network).

  python3 tools/gen/test/test_gen.py            # stdlib only; schema checks need jsonschema
Scratch output: art/_work/test-gen/ (gitignored), recreated on every run.
"""
from __future__ import annotations

import base64
import http.server
import json
import os
import shutil
import subprocess
import sys
import threading
import unittest
from pathlib import Path

GEN = Path(__file__).resolve().parents[1]
REPO = GEN.parents[1]
sys.path.insert(0, str(GEN))
import genlib  # noqa: E402
import provenance as prov  # noqa: E402

WORK = REPO / "art" / "_work" / "test-gen"
NODE = shutil.which("node") or "node"
PY = sys.executable

try:
    import jsonschema  # noqa: F401
    HAVE_JSONSCHEMA = True
except ImportError:
    HAVE_JSONSCHEMA = False

# one representative render per template/section
CASES = [
    {"ref": "symbol.txt", "symbol": "H1"},
    {"ref": "symbol.txt", "symbol": "H3", "rig": True},
    {"ref": "symbol.txt", "symbol": "W"},
    {"ref": "symbol.txt", "symbol": "S", "rig": True},
    {"ref": "royal_material_pass.txt", "symbol": "L1"},
    {"ref": "royal_material_pass.txt", "symbol": "L3"},
    {"ref": "royal_material_pass.txt", "symbol": "L4"},
    {"ref": "royal_material_pass.txt", "symbol": "L5"},
    {"ref": "symbol_parts_sheet.txt#A", "symbol": "H1"},
    {"ref": "symbol_parts_sheet.txt#B", "symbol": "H3", "vars": {"PART": "claw_L"}},
    {"ref": "symbol_parts_sheet.txt#C", "symbol": "H3", "vars": {"PART": "claw_L"}},
    {"ref": "symbol_parts_sheet.txt#D", "symbol": "H3", "vars": {"STATE_CHANGE": "eyes closed (blink)"}},
    {"ref": "mascot_turnaround.txt#A", "mascot": "gumbo"},
    {"ref": "mascot_turnaround.txt#B", "mascot": "croak", "vars": {"VIEW": "left"}},
    {"ref": "mascot_expressions.txt#A", "mascot": "gumbo"},
    {"ref": "mascot_expressions.txt#D", "mascot": "croak", "vars": {"POSE": "scratching a record, one hand raised", "ASPECT": "1:1"}},
    {"ref": "background.txt#A"},
    {"ref": "background.txt#B", "vars": {"LAYER": "mid"}},
    {"ref": "background.txt#C"},
    {"ref": "background.txt#D"},
    {"ref": "frame_piece.txt", "vars": {"PIECE": "corner cap"}},
    {"ref": "vfx_keyframe.txt", "vars": {"EFFECT": "coin burst", "PHASE": "peak", "COLOURS": "molten gold #FFC629 with white-hot core"}},
    {"ref": "video_loop.txt", "vars": {"ACTION": "slow breathing, one blink"}},
    {"ref": "sfx.txt", "vars": {"CUE_ID": "land_heavy", "SOURCE": "a heavy golden boombox", "ACTION": "thuds onto a glass table",
                                "CHARACTER": "deep sub thump", "DURATION_S": "0.6"}},
    {"ref": "music.txt", "vars": {"STEM": "base", "KEY": "E minor", "BPM": "104", "ENERGY": "laid-back groove",
                                  "SECTION_PLAN": "intro 4 bars / loop A 16 bars", "DURATION_S": "60"}},
]

GATE_CASES = [
    ("higgsfield-cli", "nano_banana_2", True), ("higgsfield-cli", "nano_banana_flash", True),
    ("higgsfield-cli", "seedance_2_0", True), ("higgsfield-cli", "kling3_0", True),
    ("higgsfield-cli", "gpt_image_2", False), ("higgsfield-cli", "gpt_image_2_5", False),
    ("higgsfield-cli", "openai_hazel", False), ("higgsfield-cli", "sora_2", False),
    ("higgsfield-cli", "mirelo_text_to_audio", False), ("higgsfield-cli", "sonilo_music", False),
    ("higgsfield-cli", "hunyuan_image_3", False), ("higgsfield-cli", "flux_1_dev", False),
    ("vertex", "gemini-3-pro-image", True), ("vertex", "gemini-3.1-flash-image", True),
    ("vertex", "gemini-3-pro-image-preview", False), ("vertex", "imagen-4", False),
    ("scenario", "model_abc123", True), ("scenario", "gpt-image-2.5-sunburst", False),
    ("elevenlabs", "eleven_text_to_sound_v2", True), ("elevenlabs", "music_v2", True),
    ("elevenlabs", "musicgen-large", False), ("stability", "stable-audio-2.5", True),
    ("stability", "stable-audio-3-medium", False),
]

NODE_EVAL = r"""
import { buildValues, render, gate, GenError } from './tools/gen/lib/genlib.mjs';
const input = JSON.parse(await new Promise((res) => { let s=''; process.stdin.on('data', (d) => s += d); process.stdin.on('end', () => res(s)); }));
const out = { renders: [], gates: [] };
for (const c of input.cases) {
  try {
    const v = buildValues(c.ref, { symbol: c.symbol ?? null, mascot: c.mascot ?? null, rigReady: !!c.rig, overrides: c.vars ?? {} });
    const r = render(c.ref, v);
    out.renders.push({ text: r.text, hash: r.hash });
  } catch (e) { out.renders.push({ error: e.message }); }
}
for (const [route, model] of input.gates) {
  try { out.gates.push({ ok: true, licenseId: gate(route, model).licenseId }); }
  catch (e) { out.gates.push({ ok: false, code: e.code }); }
}
console.log(JSON.stringify(out));
"""


def py_render(c):
    vals = genlib.build_values(c["ref"], symbol=c.get("symbol"), mascot=c.get("mascot"), rig_ready=c.get("rig", False),
                               overrides=c.get("vars", {}))
    return genlib.render(c["ref"], vals)


def validate_rows(tc: unittest.TestCase, manifest: Path):
    doc = json.loads(manifest.read_text())
    if HAVE_JSONSCHEMA:
        import jsonschema
        schema = json.loads((REPO / "art" / "manifest.schema.json").read_text())
        jsonschema.Draft202012Validator(schema, format_checker=jsonschema.FormatChecker()).validate(doc)
    for r in doc["rows"]:
        for k in prov.REQUIRED:
            tc.assertIn(k, r)
        tc.assertRegex(r["id"], r"^[a-z0-9][a-z0-9_.-]*$")
        tc.assertEqual(prov.sha256_file(REPO / r["path"]), r["sha256"])
    return doc


class TemplateTests(unittest.TestCase):
    def test_render_all_and_node_parity(self):
        py = [py_render(c) for c in CASES]
        r = subprocess.run([NODE, "--input-type=module", "-e", NODE_EVAL], cwd=REPO, text=True, capture_output=True,
                           input=json.dumps({"cases": CASES, "gates": [g[:2] for g in GATE_CASES]}), check=True)
        js = json.loads(r.stdout)
        for c, (text, h), j in zip(CASES, py, js["renders"]):
            self.assertNotIn("error", j, f"{c}: {j.get('error')}")
            self.assertEqual(text, j["text"], c["ref"])
            self.assertEqual(h, j["hash"], c["ref"])
            self.assertEqual(h, prov.sha256_text(text))
            self.assertNotRegex(text, r"\{[A-Z0-9_]+\}")
            self.assertFalse(text.endswith("\n"))
        for (route, model, ok), j in zip(GATE_CASES, js["gates"]):
            self.assertEqual(j["ok"], ok, f"node gate {route}:{model}")

    def test_style_formula_byte_identical(self):
        formula = genlib.bible()["styleFormula"]
        for c in CASES:
            if "STYLE_FORMULA" in genlib.placeholders(*genlib.split_template_ref(c["ref"])):
                self.assertIn(formula, py_render(c)[0])

    def test_symbol_context(self):
        h1 = py_render({"ref": "symbol.txt", "symbol": "H1"})[0]
        self.assertIn("slightly more from above", h1)             # restAngle -6 -> light note
        self.assertIn("#00FF00", h1)
        self.assertNotIn("Rig-ready", h1)
        w = py_render({"ref": "symbol.txt", "symbol": "W", "rig": True})[0]
        self.assertIn("#FF00FF", w)                                # W is keyed on magenta
        self.assertNotIn("PROPOSAL", w)
        self.assertNotIn("WILD", w)                                # 'live text' sentence stripped
        self.assertIn("Rig-ready pose", w)
        self.assertNotIn("slightly more from above", w)            # restAngle 0
        self.assertIn("filling 85%", w)
        q = py_render({"ref": "royal_material_pass.txt", "symbol": "L3"})[0]
        self.assertIn("'Q'", q)
        self.assertIn("#FF00FF", q)
        self.assertIn("green (#75D92A)", q)
        frame = py_render({"ref": "frame_piece.txt", "vars": {"PIECE": "beam"}})[0]
        self.assertIn("#FF00FF", frame)                            # template default beats the global key
        self.assertIn("6:1", frame)

    def test_template_defaults_are_verbatim(self):
        tv = json.loads((GEN / "template-vars.json").read_text())
        for name, spec in tv.items():
            if name.startswith("$"):
                continue
            text = (genlib.PROMPTS_DIR / name).read_text()
            strings = [v for v in spec.get("defaults", {}).values() if v]
            strings += [v for k, v in spec.items() if isinstance(v, str)]
            for ch in spec.get("choices", {}).values():
                strings += list(ch["map"].values())
            for s in strings:
                self.assertIn(s, text, f"{name}: default {s!r} no longer in the template")

    def test_failures(self):
        with self.assertRaises(genlib.GenError):
            genlib.render("background.txt", {})                    # sectioned, no section
        with self.assertRaises(genlib.GenError):
            genlib.render("background.txt#Z", {})
        with self.assertRaises(genlib.GenError):
            py_render({"ref": "video_loop.txt"})                   # ACTION unfilled
        with self.assertRaises(genlib.GenError) as cm:
            py_render({"ref": "video_loop.txt", "vars": {"ACTION": "a cute little wave"}})
        self.assertIn("cute", str(cm.exception))
        with self.assertRaises(genlib.GenError):
            py_render({"ref": "video_loop.txt", "vars": {"ACTION": "dance like in Cuphead"}})
        with self.assertRaises(genlib.GenError):
            py_render({"ref": "frame_piece.txt", "vars": {"PIECE": "window"}})
        with self.assertRaises(genlib.GenError):
            genlib.parse_vars(["lower=1"])

    def test_cli_render(self):
        r = subprocess.run([PY, str(GEN / "genlib.py"), "render", "--template", "symbol.txt", "--symbol", "H4", "--json"],
                           capture_output=True, text=True, check=True)
        d = json.loads(r.stdout)
        self.assertEqual(d["promptHash"], prov.sha256_text(d["prompt"]))
        r = subprocess.run([PY, str(GEN / "genlib.py"), "render", "--template", "background.txt"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 2)


class GateTests(unittest.TestCase):
    def test_gate_table(self):
        for route, model, ok in GATE_CASES:
            if ok:
                g = genlib.gate(route, model)
                self.assertTrue(g["licenseId"])
            else:
                with self.assertRaises(genlib.GenError, msg=f"{route}:{model} must be refused") as cm:
                    genlib.gate(route, model)
                self.assertEqual(cm.exception.code, 3)

    def test_vertex_license_by_model(self):
        self.assertEqual(genlib.gate("vertex", "gemini-3-pro-image")["licenseId"], "vertex-nano-banana-pro")
        self.assertEqual(genlib.gate("vertex", "gemini-3.1-flash-image")["licenseId"], "vertex-nano-banana-2")


class HiggsfieldTests(unittest.TestCase):
    def setUp(self):
        self.w = WORK / "hf"
        shutil.rmtree(self.w, ignore_errors=True)
        self.w.mkdir(parents=True)
        self.env = {**os.environ, "FAKE_HF_OUT": str(self.w / "vendor"), "FAKE_HF_LOG": str(self.w / "calls.log"),
                    "SOURCE_DATE_EPOCH": "1790000000", "HIGGSFIELD_ALLOW_FILE_URLS": "1"}

    def hf(self, *args):
        return subprocess.run([NODE, str(GEN / "higgsfield.mjs"), "--bin", str(GEN / "test" / "fake-higgsfield.mjs"),
                               "--out-root", str(self.w / "raw"), "--manifest", str(self.w / "manifest.json"), *args],
                              cwd=REPO, env=self.env, capture_output=True, text=True)

    def test_dry_run_writes_nothing(self):
        r = self.hf("--template", "symbol.txt", "--symbol", "H1", "--dry-run")
        self.assertEqual(r.returncode, 0, r.stderr)
        d = json.loads(r.stdout)
        self.assertIn("generate create nano_banana_2", d["createCommand"])
        for flag in ("--aspect_ratio 1:1", "--resolution 2k", "--wait", "--json"):
            self.assertIn(flag, d["createCommand"])
        self.assertIn("generate cost nano_banana_2", d["costCommand"])
        self.assertFalse((self.w / "raw").exists())
        self.assertFalse((self.w / "calls.log").exists())

    def test_video_flags_always_explicit_and_audio_off(self):
        r = self.hf("--template", "video_loop.txt", "--var", "ACTION=slow breathing", "--model", "seedance_2_0", "--dry-run")
        cmd = json.loads(r.stdout)["createCommand"]
        for flag in ("--aspect_ratio 1:1", "--duration 5", "--resolution 1080p", "--generate_audio false", "--mode std"):
            self.assertIn(flag, cmd)
        r = self.hf("--template", "video_loop.txt", "--var", "ACTION=slow breathing", "--model", "kling3_0", "--dry-run")
        cmd = json.loads(r.stdout)["createCommand"]
        self.assertIn("--sound off", cmd)
        self.assertIn("--duration 5", cmd)

    def test_refusals(self):
        r = self.hf("--template", "symbol.txt", "--symbol", "H1", "--model", "gpt_image_2", "--dry-run")
        self.assertEqual(r.returncode, 3)
        r = self.hf("--template", "symbol.txt", "--symbol", "H1", "--model", "mirelo_text_to_audio", "--dry-run")
        self.assertEqual(r.returncode, 3)
        r = self.hf("--template", "symbol.txt", "--symbol", "H1", "--resolution", "8k", "--dry-run")
        self.assertEqual(r.returncode, 2)

    def test_generate_record_idempotent(self):
        r = self.hf("--template", "symbol.txt", "--symbol", "H1", "--plan-tier", "Higgsfield Ultra")
        self.assertEqual(r.returncode, 0, r.stderr)
        v = self.w / "raw" / "sym_H1" / "v01"
        for f in ("prompt.txt", "args.json", "job.json", "raw.png", "manifest.json", "cost.json"):
            self.assertTrue((v / f).is_file(), f)
        doc = validate_rows(self, self.w / "manifest.json")
        row = doc["rows"][0]
        self.assertEqual(row["id"], "sym_h1.raw.v01")
        self.assertEqual(row["route"], "higgsfield-cli")
        self.assertEqual(row["licenseId"], "higgsfield")
        self.assertEqual(row["jobId"], "job-0001")
        self.assertEqual(row["cost"]["amount"], 12)
        self.assertEqual(row["promptHash"], prov.sha256_text((v / "prompt.txt").read_text()))
        # identical request again: skipped, no new call to the vendor
        calls = (self.w / "calls.log").read_text().count("create")
        r2 = self.hf("--template", "symbol.txt", "--symbol", "H1")
        self.assertEqual(r2.returncode, 0)
        self.assertIn("already generated", r2.stdout)
        self.assertEqual((self.w / "calls.log").read_text().count("create"), calls)
        # --force-new -> v02
        r3 = self.hf("--template", "symbol.txt", "--symbol", "H1", "--force-new")
        self.assertEqual(r3.returncode, 0, r3.stderr)
        self.assertTrue((self.w / "raw" / "sym_H1" / "v02" / "raw.png").is_file())
        self.assertEqual(len(json.loads((self.w / "manifest.json").read_text())["rows"]), 2)

    def test_failed_job_resumes_same_folder(self):
        env = dict(self.env)
        self.env = {**env, "FAKE_HF_FAIL": "1"}
        r = self.hf("--template", "symbol.txt", "--symbol", "H2")
        self.assertEqual(r.returncode, 5)
        self.env = env
        r = self.hf("--template", "symbol.txt", "--symbol", "H2")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(sorted(p.name for p in (self.w / "raw" / "sym_H2").iterdir()), ["v01"])

    def test_local_result_urls_refused_outside_tests(self):
        self.env = {k: v for k, v in self.env.items() if k != "HIGGSFIELD_ALLOW_FILE_URLS"}
        r = self.hf("--template", "symbol.txt", "--symbol", "W")
        self.assertEqual(r.returncode, 6, r.stderr)
        self.assertIn("refusing non-HTTP result URL", r.stderr)

    def test_cost_cap_fails_closed(self):
        # an unrecognised cost-preview shape must not slip past --max-credits
        self.env = {**self.env, "FAKE_HF_COST_UNKNOWN": "1"}
        r = self.hf("--template", "symbol.txt", "--symbol", "H4", "--max-credits", "100")
        self.assertEqual(r.returncode, 4, r.stderr)
        self.assertNotIn("create", (self.w / "calls.log").read_text())
        r = self.hf("--template", "symbol.txt", "--symbol", "H4", "--max-credits", "100", "--no-cost-preview")
        self.assertEqual(r.returncode, 2, r.stderr)

    def test_failed_download_resumes_without_regenerating(self):
        # job finished (paid) but result 2 failed to download: no raw* file may be left behind (else the
        # next run says 'already generated' with rows never written), and the resume re-downloads the
        # same job's results instead of paying for a new generation
        self.env = {**self.env, "FAKE_HF_TWO": "1"}
        r = self.hf("--template", "symbol.txt", "--symbol", "S")
        self.assertEqual(r.returncode, 6, r.stderr)
        v = self.w / "raw" / "sym_S" / "v01"
        self.assertEqual([p.name for p in v.iterdir() if p.name.startswith("raw")], [])
        (self.w / "vendor" / "second.png").write_bytes((self.w / "vendor" / "result_nano_banana_2.png").read_bytes())
        r = self.hf("--template", "symbol.txt", "--symbol", "S")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual((self.w / "calls.log").read_text().count('"create"'), 1)
        self.assertTrue((v / "raw.png").is_file() and (v / "raw_2.png").is_file())
        doc = validate_rows(self, self.w / "manifest.json")
        self.assertEqual([x["id"] for x in doc["rows"]], ["sym_s.raw.v01", "sym_s.raw.v01.2"])
        self.assertEqual(doc["rows"][0]["jobId"], "job-0002")


class NbpTests(unittest.TestCase):
    def setUp(self):
        self.w = WORK / "nbp"
        shutil.rmtree(self.w, ignore_errors=True)
        self.w.mkdir(parents=True)
        self.ref = self.w / "ref.png"
        # 1x1 PNG
        self.ref.write_bytes(base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"))

    def nbp(self, *args):
        return subprocess.run([PY, str(GEN / "nbp.py"), *args], cwd=REPO, capture_output=True, text=True,
                              env={**os.environ, "SOURCE_DATE_EPOCH": "1790000000"})

    def test_dry_run(self):
        r = self.nbp("--template", "symbol.txt", "--symbol", "H3", "--ref", str(self.ref), "--image-size", "2K",
                     "--out-root", str(self.w / "raw"), "--dry-run")
        self.assertEqual(r.returncode, 0, r.stderr)
        d = json.loads(r.stdout)
        self.assertEqual(d["request"]["model"], "gemini-3-pro-image")
        self.assertEqual(d["request"]["config"]["imageConfig"], {"aspectRatio": "1:1", "imageSize": "2K"})
        self.assertEqual(d["estimatedCostUSD"], 0.134)
        self.assertEqual(d["request"]["contents"][0]["parts"][1]["inlineData"]["sha256"], prov.sha256_file(self.ref))
        self.assertFalse((self.w / "raw").exists())

    def test_refuse_preview_and_too_many_refs(self):
        self.assertEqual(self.nbp("--template", "symbol.txt", "--symbol", "H3", "--model", "gemini-3-pro-image-preview",
                                  "--dry-run").returncode, 3)
        args = ["--template", "symbol.txt", "--symbol", "H3", "--dry-run"]
        for _ in range(15):
            args += ["--ref", str(self.ref)]
        self.assertEqual(self.nbp(*args).returncode, 2)

    def test_batch_stage_and_collect(self):
        common = ["--template", "symbol.txt", "--symbol", "H4", "--ref", str(self.ref), "--out-root", str(self.w / "raw"),
                  "--manifest", str(self.w / "manifest.json"), "--batch-jsonl", str(self.w / "batch.jsonl")]
        self.assertEqual(self.nbp(*common).returncode, 0)
        self.assertEqual(self.nbp(*common).returncode, 0)          # re-stage: no duplicate line
        lines = (self.w / "batch.jsonl").read_text().splitlines()
        self.assertEqual(len(lines), 1)
        line = json.loads(lines[0])
        self.assertEqual(line["request"]["generationConfig"]["imageConfig"]["imageSize"], "2K")
        pred = {"request": line["request"], "response": {"candidates": [{"content": {"parts": [
            {"inlineData": {"mimeType": "image/png", "data": base64.b64encode(self.ref.read_bytes()).decode()}}]}}]}}
        (self.w / "pred.jsonl").write_text(json.dumps(pred) + "\n")
        r = self.nbp("batch-collect", "--jsonl", str(self.w / "batch.jsonl"), "--results", str(self.w / "pred.jsonl"),
                     "--template", "symbol.txt", "--out-root", str(self.w / "raw"), "--manifest", str(self.w / "manifest.json"))
        self.assertEqual(r.returncode, 0, r.stderr)
        doc = validate_rows(self, self.w / "manifest.json")
        self.assertEqual(doc["rows"][0]["cost"]["amount"], 0.067)   # batch = 50 %
        self.assertEqual(doc["rows"][0]["licenseId"], "vertex-nano-banana-pro")
        self.assertIn("already generated", self.nbp(*common).stdout)


class _Scenario(http.server.BaseHTTPRequestHandler):
    polls = 0
    cost_unknown = False
    seen: list = []

    def log_message(self, *a):
        pass

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _auth_ok(self):
        return self.headers.get("Authorization") == "Basic " + base64.b64encode(b"k:s").decode()

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(n) or b"{}")
        _Scenario.seen.append((self.path, body))
        if not self._auth_ok():
            return self._json(401, {"error": "auth"})
        if self.path.startswith("/v1/assets"):
            return self._json(200, {"asset": {"id": "asset_ref1"}})
        if self.path.startswith("/v1/generate/custom/model_test"):
            if "dryRun=true" in self.path:
                return self._json(200, {"estimate": "5 CU"} if _Scenario.cost_unknown else {"creativeUnitsCost": 5})
            return self._json(200, {"job": {"jobId": "job_1", "status": "queued"}, "creativeUnitsCost": 5})
        self._json(404, {})

    def do_GET(self):
        if self.path.startswith("/files/"):
            data = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC")
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if not self._auth_ok():
            return self._json(401, {})
        if self.path.startswith("/v1/jobs/job_1"):
            _Scenario.polls += 1
            st = "success" if _Scenario.polls > 1 else "in-progress"
            return self._json(200, {"job": {"jobId": "job_1", "status": st, "metadata": {"assetIds": ["asset_out1"]}}})
        if self.path.startswith("/v1/assets/asset_out1"):
            port = self.server.server_address[1]
            return self._json(200, {"asset": {"id": "asset_out1", "url": f"http://127.0.0.1:{port}/files/out.png",
                                              "mimeType": "image/png"}})
        self._json(404, {})


class ScenarioTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Scenario)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.srv.server_address[1]}/v1"

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def setUp(self):
        self.w = WORK / "scenario"
        shutil.rmtree(self.w, ignore_errors=True)
        self.w.mkdir(parents=True)
        self.ref = self.w / "ref.png"
        self.ref.write_bytes(base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"))

    def sc(self, *args, env=None):
        e = {**os.environ, "SCENARIO_API_KEY": "k", "SCENARIO_API_SECRET": "s", "SOURCE_DATE_EPOCH": "1790000000",
             "NO_PROXY": "127.0.0.1,localhost", "no_proxy": "127.0.0.1,localhost", **(env or {})}
        return subprocess.run([PY, str(GEN / "scenario.py"), "--template", "symbol.txt", "--symbol", "H1",
                               "--model-id", "model_test", "--base", "qwen-image", "--api-base", self.base,
                               "--out-root", str(self.w / "raw"), "--manifest", str(self.w / "manifest.json"),
                               "--poll-interval", "0.01", *args], cwd=REPO, capture_output=True, text=True, env=e)

    def test_dry_run(self):
        r = self.sc("--dry-run", "--ref", str(self.ref), "--param", "guidance=3.5", env={"SCENARIO_API_KEY": ""})
        self.assertEqual(r.returncode, 0, r.stderr)
        d = json.loads(r.stdout)
        gen = [q for q in d["requests"] if "/generate/custom/model_test" in q["url"]][0]
        self.assertEqual(gen["method"], "POST")
        self.assertEqual(gen["body"]["width"], 2048)
        self.assertEqual(gen["body"]["guidance"], 3.5)
        self.assertEqual(gen["body"]["seed"], d["seed"])
        self.assertEqual(gen["headers"]["Authorization"], "Basic <redacted>")
        self.assertFalse((self.w / "raw").exists())

    def test_generate_via_mock(self):
        _Scenario.polls = 0
        r = self.sc("--ref", str(self.ref), "--lora-version", "lora=model_test dataset=sha256:abc")
        self.assertEqual(r.returncode, 0, r.stderr)
        doc = validate_rows(self, self.w / "manifest.json")
        row = doc["rows"][0]
        self.assertEqual(row["route"], "scenario")
        self.assertEqual(row["jobId"], "job_1")
        self.assertIsInstance(row["seed"], int)
        self.assertEqual(row["cost"], {"amount": 5.0, "currency": "credits", "unit": "Scenario CU", "estimated": False})
        gen_bodies = [b for p, b in _Scenario.seen if p.startswith("/v1/generate/custom/model_test") and "dryRun" not in p]
        self.assertEqual(gen_bodies[-1]["referenceImages"], ["asset_ref1"])
        again = self.sc("--ref", str(self.ref), "--lora-version", "lora=model_test dataset=sha256:abc")
        self.assertIn("already generated", again.stdout)

    def test_cost_cap(self):
        r = self.sc("--max-cu", "1")
        self.assertEqual(r.returncode, 4)

    def test_cost_cap_fails_closed(self):
        _Scenario.cost_unknown = True
        try:
            r = self.sc("--max-cu", "100")
        finally:
            _Scenario.cost_unknown = False
        self.assertEqual(r.returncode, 4, r.stderr)
        self.assertFalse(any(p.startswith("/v1/generate/custom/model_test") and "dryRun" not in p for p, _ in _Scenario.seen[-3:]))


class ProvenanceTests(unittest.TestCase):
    def test_append_only_and_collision(self):
        w = WORK / "prov"
        shutil.rmtree(w, ignore_errors=True)
        w.mkdir(parents=True)
        f = w / "a.txt"
        f.write_text("x")
        row = prov.make_row(id="t.a.1", path=f, stage="qa", sha256=prov.sha256_file(f), vendor="self", model="m",
                            version="1", license_id="ffmpeg")
        m = w / "manifest.json"
        self.assertEqual(prov.append_rows(m, [row], "test"), 1)
        self.assertEqual(prov.append_rows(m, [row], "test"), 0)
        bad = {**row, "sha256": "0" * 64}
        with self.assertRaises(ValueError):
            prov.append_rows(m, [bad], "test")
        with self.assertRaises(ValueError):
            prov.make_row(id="Bad.ID", path=f, stage="qa", sha256="0" * 64, vendor="v", model="m", version="1",
                          license_id="x")


# Higgsfield MCP ingestion (tools/gen/hf-ingest.mjs): local CDN fixture, idempotency, resume, bad PNG, 403s
from test_hf_ingest import HfIngestTests  # noqa: E402,F401

if __name__ == "__main__":
    unittest.main(verbosity=2)
