#!/usr/bin/env python3
"""Self-tests for tools/gen/hf-ingest.mjs (Higgsfield MCP ledger -> art/_raw + manifest rows).

Offline: a local HTTP server stands in for the Higgsfield CDN (the real one may be blocked by the
egress policy). Runs on its own or from test_gen.py:
  python3 tools/gen/test/test_hf_ingest.py
Scratch output: art/_work/test-gen/hf-ingest/ (gitignored), recreated per test.
"""
from __future__ import annotations

import http.server
import json
import os
import shutil
import struct
import subprocess
import sys
import threading
import unittest
import zlib
from pathlib import Path

GEN = Path(__file__).resolve().parents[1]
REPO = GEN.parents[1]
sys.path.insert(0, str(GEN))
import genlib  # noqa: E402
import provenance as prov  # noqa: E402

WORK = REPO / "art" / "_work" / "test-gen" / "hf-ingest"
NODE = shutil.which("node") or "node"
TOOL = GEN / "hf-ingest.mjs"

try:
    import jsonschema
    HAVE_JSONSCHEMA = True
except ImportError:
    HAVE_JSONSCHEMA = False

NODE_VALIDATE = r"""
import fs from 'node:fs';
import { validate } from './tools/licence/schema-lite.mjs';
const [schema, doc] = process.argv.slice(1).map((p) => JSON.parse(fs.readFileSync(p, 'utf8')));
const errs = validate(schema, doc);
console.log(JSON.stringify(errs));
process.exit(errs.length ? 1 : 0);
"""

J = {n: f"00000000-0000-4000-8000-{n:012d}" for n in range(1, 40)}


def png(w: int, h: int, rgb=(0, 255, 0)) -> bytes:
    """Valid RGB PNG of a flat colour (compressed row by row; big sizes stay cheap)."""
    def chunk(t: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + t + data + struct.pack(">I", zlib.crc32(t + data) & 0xFFFFFFFF)
    co = zlib.compressobj(1)
    row = b"\x00" + bytes(rgb) * w
    idat = b"".join(co.compress(row) for _ in range(h)) + co.flush()
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", idat) + chunk(b"IEND", b""))


_PNG_CACHE: dict = {}


def cpng(w, h, rgb=(0, 255, 0)):
    k = (w, h, rgb)
    if k not in _PNG_CACHE:
        _PNG_CACHE[k] = png(w, h, rgb)
    return _PNG_CACHE[k]


def rendered(ref, **kw):
    vals = genlib.build_values(ref, symbol=kw.get("symbol"), mascot=kw.get("mascot"), rig_ready=kw.get("rigReady", False),
                               overrides={k: v for k, v in kw.items() if k.isupper()})
    return genlib.render(ref, vals)


class _CDN(http.server.BaseHTTPRequestHandler):
    """Stand-in CDN. /deny/* answers like the egress proxy, /cf403/* like CloudFront; files support Range."""
    files: dict = {}
    hits: dict = {}
    ranges: list = []
    cut_once: set = set()

    def log_message(self, *a):
        pass

    def _send(self, code, body: bytes, headers=None):
        self.send_response(code)
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        p = self.path
        _CDN.hits[p] = _CDN.hits.get(p, 0) + 1
        rng = self.headers.get("Range")
        if rng:
            _CDN.ranges.append((p, rng))
        if p.startswith("/deny/"):
            host = self.headers.get("Host", "").split(":")[0]
            return self._send(403, f"Host not in allowlist: {host}. Add this host to your network egress settings to allow access.".encode(),
                              {"Content-Type": "text/plain", "x-deny-reason": "host_not_allowed"})
        if p.startswith("/cf403/"):
            return self._send(403, b'<?xml version="1.0" encoding="UTF-8"?><Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>',
                              {"Content-Type": "application/xml", "Server": "CloudFront", "X-Amz-Cf-Id": "test"})
        data = _CDN.files.get(p)
        if data is None:
            return self._send(404, b"not found")
        if p in _CDN.cut_once:
            # announce the whole file, send half, drop the connection
            _CDN.cut_once.discard(p)
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data[: len(data) // 2])
            self.wfile.flush()
            self.close_connection = True
            return
        if rng and rng.startswith("bytes="):
            start = int(rng[6:].split("-")[0])
            if start >= len(data):
                return self._send(416, b"", {"Content-Range": f"bytes */{len(data)}"})
            return self._send(206, data[start:], {"Content-Type": "image/png", "Content-Range": f"bytes {start}-{len(data) - 1}/{len(data)}"})
        self._send(200, data, {"Content-Type": "image/png"})


class HfIngestTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _CDN)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.srv.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def setUp(self):
        self.w = WORK / self._testMethodName
        shutil.rmtree(self.w, ignore_errors=True)
        self.w.mkdir(parents=True)
        self.ledger = self.w / "ledger.json"
        self.prompts = self.w / "prompts"
        self.raw = self.w / "raw"
        self.manifest = self.w / "manifest.json"
        _CDN.files, _CDN.hits, _CDN.ranges, _CDN.cut_once = {}, {}, [], set()

    # ---------------------------------------------------------------- helpers

    def run_tool(self, *args, hosts=True, paths=True):
        cmd = [NODE, str(TOOL), *args]
        if paths:
            cmd += ["--ledger", str(self.ledger), "--prompts-dir", str(self.prompts)]
            if not args or args[0] not in ("plan", "record", "check"):
                cmd += ["--out-root", str(self.raw), "--manifest", str(self.manifest)]
            if hosts and (not args or args[0] not in ("plan", "record", "check", "status")):
                cmd += ["--allow-host", "127.0.0.1"]
        env = {**os.environ, "SOURCE_DATE_EPOCH": "1790000000", "NO_PROXY": "127.0.0.1,localhost", "no_proxy": "127.0.0.1,localhost"}
        return subprocess.run(cmd, cwd=REPO, env=env, capture_output=True, text=True)

    def serve(self, name, data):
        _CDN.files[f"/cdn/{name}"] = data
        return f"{self.base}/cdn/{name}"

    def job(self, name, n, url, template=None, vars=None, resolution="1k", aspect="1:1", credits=2, status="completed", **kw):
        j = {"name": name, "job_id": J[n], "template": template}
        if template:
            j["vars"] = vars or {}
            j["promptHash"] = rendered(template, **(vars or {}))[1]
        j.update({"resolution": resolution, "aspect_ratio": aspect, "credits": credits, "result_url": url, "status": status})
        j.update(kw)
        return j

    def stored_job(self, name, n, url, text, **kw):
        self.prompts.mkdir(parents=True, exist_ok=True)
        h = prov.sha256_text(text)
        (self.prompts / f"{h}.txt").write_text(text)
        j = self.job(name, n, url, **kw)
        j["promptHash"] = h
        return j

    def write_ledger(self, jobs, model="nano_banana_pro", batch="t1"):
        doc = {"$schema": "./higgsfield-jobs.schema.json", "batches": [
            {"id": batch, "date": "2026-09-26", "purpose": "test", "model": model, "planTier": "Higgsfield Plus", "jobs": jobs}]}
        self.ledger.write_text(json.dumps(doc, indent=2) + "\n")

    def validate_manifest(self, path=None):
        path = path or self.manifest
        doc = json.loads(path.read_text())
        schema_path = REPO / "art" / "manifest.schema.json"
        if HAVE_JSONSCHEMA:
            jsonschema.Draft202012Validator(json.loads(schema_path.read_text()), format_checker=jsonschema.FormatChecker()).validate(doc)
        r = subprocess.run([NODE, "--input-type=module", "-e", NODE_VALIDATE, str(schema_path), str(path)], cwd=REPO,
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        for row in doc["rows"]:
            self.assertEqual(prov.sha256_file(REPO / row["path"]), row["sha256"])
        return doc

    def snapshot(self):
        files = {}
        for root in (self.raw, self.w):
            for p in sorted(root.rglob("*")) if root.exists() else []:
                if p.is_file():
                    st = p.stat()
                    files[str(p)] = (st.st_mtime_ns, st.st_size)
        return files

    def three_job_ledger(self):
        u1 = self.serve("h1.png", cpng(2048, 2048))
        u2 = self.serve("gumbo.png", cpng(1584, 672))
        u3 = self.serve("plate.png", cpng(1376, 768))
        jobs = [
            self.job("sym_H1", 1, u1, "symbol.txt", {"symbol": "H1"}, resolution="2k", model="nano_banana_2", type="image"),
            self.job("mascot_gumbo_sheetA", 2, u2, "mascot_turnaround.txt#A", {"mascot": "gumbo"}, aspect="21:9", credits=4),
            self.stored_job("bg_test", 3, u3, "a test plate prompt, neon bayou", aspect="16:9"),
            self.job("sym_H2", 4, None, "symbol.txt", {"symbol": "H2"}, status="queued"),
            self.job("sym_H3", 5, None, "symbol.txt", {"symbol": "H3"}, status="failed", credits=2),
        ]
        self.write_ledger(jobs)

    # ---------------------------------------------------------------- tests

    def test_ingest_layout_rows_idempotent(self):
        self.three_job_ledger()
        r = self.run_tool()
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout)
        self.assertEqual(len(out["downloaded"]), 3)
        self.assertEqual(sorted(s["status"] for s in out["skipped"]), ["failed", "queued"])
        dirs = {"sym_H1": self.raw / "sym_H1" / "v01", "gumbo": self.raw / "mascot_gumbo_turnaround_A" / "v01",
                "bg": self.raw / "bg_test" / "v01"}
        for d in dirs.values():
            for f in ("raw.png", "prompt.txt", "job.json", "manifest.json"):
                self.assertTrue((d / f).is_file(), d / f)
        self.assertEqual((dirs["sym_H1"] / "raw.png").read_bytes(), cpng(2048, 2048))
        self.assertEqual((dirs["sym_H1"] / "prompt.txt").read_text(), rendered("symbol.txt", symbol="H1")[0])
        self.assertEqual((dirs["bg"] / "prompt.txt").read_text(), "a test plate prompt, neon bayou")
        jj = json.loads((dirs["gumbo"] / "job.json").read_text())
        self.assertEqual(jj["jobId"], J[2])
        self.assertEqual(jj["prompt"]["source"], "rendered")
        self.assertEqual((jj["download"]["width"], jj["download"]["height"]), (1584, 672))

        doc = self.validate_manifest()
        rows = {row["id"]: row for row in doc["rows"]}
        self.assertEqual(sorted(rows), ["bg_test.raw.v01", "mascot_gumbo_turnaround_a.raw.v01", "sym_h1.raw.v01"])
        self.assertEqual(rows["sym_h1.raw.v01"]["stage"], "2d-image")
        self.assertEqual(rows["mascot_gumbo_turnaround_a.raw.v01"]["stage"], "mascot-sheets")
        self.assertEqual(rows["bg_test.raw.v01"]["stage"], "backgrounds")
        ledger = json.loads(self.ledger.read_text())["batches"][0]["jobs"]
        for row in rows.values():
            self.assertEqual(row["route"], "higgsfield-mcp")
            self.assertEqual(row["vendor"], "Higgsfield")
            self.assertEqual(row["model"], "nano_banana_2")          # reported id, also for the job without 'model'
            self.assertTrue(row["version"].startswith("higgsfield-mcp/nano_banana_pro@2026-09-26"))
            self.assertIsNone(row["seed"])
            self.assertIs(row["shipped"], False)
            self.assertEqual(row["licenseId"], "higgsfield")
            self.assertEqual(row["planTier"], "Higgsfield Plus")
            self.assertEqual(row["cost"]["currency"], "credits")
            self.assertEqual(row["promptHash"], prov.sha256_file(REPO / row["promptPath"]))
            lj = next(j for j in ledger if j["job_id"] == row["jobId"])
            self.assertEqual(row["promptHash"], lj["promptHash"])
            self.assertEqual(lj["sha256"], row["sha256"])              # ledger learns the paid output's hash
        self.assertEqual(rows["sym_h1.raw.v01"]["template"], "art/bible/prompts/symbol.txt")
        self.assertIsNone(rows["bg_test.raw.v01"]["template"])
        self.assertEqual(rows["mascot_gumbo_turnaround_a.raw.v01"]["cost"]["amount"], 4)
        self.assertEqual((ledger[1]["width"], ledger[1]["height"]), (1584, 672))
        self.assertNotIn("sha256", ledger[3])

        # re-run: no request, no write
        hits = dict(_CDN.hits)
        snap = self.snapshot()
        r2 = self.run_tool()
        self.assertEqual(r2.returncode, 0, r2.stderr)
        self.assertEqual(len(json.loads(r2.stdout)["present"]), 3)
        self.assertEqual(_CDN.hits, hits)
        self.assertEqual(self.snapshot(), snap)

        # lost manifest: rows come back identical from the sidecars, still no download
        before = json.loads(self.manifest.read_text())["rows"]
        self.manifest.unlink()
        r3 = self.run_tool()
        self.assertEqual(r3.returncode, 0, r3.stderr)
        self.assertEqual(sorted(json.loads(self.manifest.read_text())["rows"], key=lambda x: x["id"]), sorted(before, key=lambda x: x["id"]))
        self.assertEqual(_CDN.hits, hits)

        st = self.run_tool("status", "--json")
        self.assertEqual(st.returncode, 0, st.stderr)
        b = json.loads(st.stdout)["batches"][0]
        self.assertEqual(b["counts"], {"jobs": 5, "completed": 3, "failed": 1, "pending": 1, "creditsSpent": 10,
                                       "creditsOnFailed": 2, "creditsUnknown": 0, "downloaded": 3})
        self.assertEqual(next(j for j in b["jobs"] if j["job"] == "sym_H1")["rowId"], "sym_h1.raw.v01")
        txt = self.run_tool("status")
        self.assertIn("credits spent 10", txt.stdout)
        self.assertIn("downloaded 3/3", txt.stdout)

    def test_dry_run_writes_nothing(self):
        self.three_job_ledger()
        before = self.ledger.read_bytes()
        r = self.run_tool("--dry-run")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(len(json.loads(r.stdout)["wouldDownload"]), 3)
        self.assertEqual(_CDN.hits, {})
        self.assertFalse(self.raw.exists())
        self.assertFalse(self.manifest.exists())
        self.assertEqual(self.ledger.read_bytes(), before)

    def test_resume_interrupted_download(self):
        data = cpng(2048, 2048, (10, 200, 30))
        url = self.serve("cut.png", data)
        _CDN.cut_once.add("/cdn/cut.png")
        self.write_ledger([self.job("sym_H1", 6, url, "symbol.txt", {"symbol": "H1"}, resolution="2k")])
        r = self.run_tool("--retries", "1")
        self.assertEqual(r.returncode, 6, r.stderr)
        self.assertIn("re-run to resume", r.stderr)
        part = self.raw / ".incoming" / f"{J[6]}.part"
        have = part.stat().st_size
        self.assertTrue(0 < have < len(data), have)
        self.assertFalse((self.raw / "sym_H1").exists())
        self.assertFalse(self.manifest.exists())
        self.assertEqual(json.loads(self.run_tool("status", "--json").stdout)["batches"][0]["jobs"][0]["partialBytes"], have)
        r = self.run_tool()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn(f"resuming t1/sym_H1 from byte {have}", r.stderr)
        self.assertEqual(_CDN.ranges, [("/cdn/cut.png", f"bytes={have}-")])
        raw = self.raw / "sym_H1" / "v01" / "raw.png"
        self.assertEqual(raw.read_bytes(), data)
        self.assertFalse(part.exists())
        self.assertEqual(json.loads((raw.parent / "job.json").read_text())["download"]["resumedFrom"], have)
        self.validate_manifest()

    def test_bad_png_truncated_and_wrong_size(self):
        good = cpng(2048, 2048)
        self.write_ledger([
            self.job("sym_H1", 7, self.serve("bad.png", b"<html>surprise</html>"), "symbol.txt", {"symbol": "H1"}, resolution="2k"),
            self.job("sym_H2", 8, self.serve("trunc.png", good[:-12]), "symbol.txt", {"symbol": "H2"}, resolution="2k"),
            self.job("sym_H3", 9, self.serve("small.png", cpng(512, 512)), "symbol.txt", {"symbol": "H3"}, resolution="2k"),
            self.job("sym_H4", 10, self.serve("wide.png", cpng(2048, 1024)), "symbol.txt", {"symbol": "H4"}, resolution="2k"),
        ])
        r = self.run_tool("--job", "sym_H1")
        self.assertEqual(r.returncode, 7, r.stderr)
        self.assertIn("not a valid PNG", r.stderr)
        self.assertIn("bad PNG signature", r.stderr)
        self.assertTrue((self.raw / ".incoming" / f"{J[7]}.rejected").is_file())
        r = self.run_tool("--job", "sym_H2")
        self.assertEqual(r.returncode, 7, r.stderr)
        self.assertRegex(r.stderr, r"truncated|no IEND")
        r = self.run_tool("--job", "sym_H3")
        self.assertEqual(r.returncode, 7, r.stderr)
        self.assertIn("does not look like 2k", r.stderr)
        r = self.run_tool("--job", "sym_H4")
        self.assertEqual(r.returncode, 7, r.stderr)
        self.assertIn("the job asked for 1:1", r.stderr)
        for s in ("sym_H1", "sym_H2", "sym_H3", "sym_H4"):
            self.assertFalse((self.raw / s).exists(), s)
        self.assertFalse(self.manifest.exists())
        r = self.run_tool("--job", "sym_H3", "--allow-size-mismatch")
        self.assertEqual(r.returncode, 0, r.stderr)
        row = self.validate_manifest()["rows"][0]
        self.assertIn("SIZE MISMATCH accepted", row["notes"])
        self.assertFalse((self.raw / ".incoming" / f"{J[9]}.rejected").exists())

    def test_egress_403_cdn_403_and_host_policy(self):
        self.write_ledger([
            self.job("sym_H1", 11, f"{self.base}/deny/a.png", "symbol.txt", {"symbol": "H1"}),
            self.job("sym_H2", 12, f"{self.base}/deny/b.png", "symbol.txt", {"symbol": "H2"}),
        ])
        r = self.run_tool()
        self.assertEqual(r.returncode, 6, r.stderr)
        self.assertIn("EGRESS BLOCKED", r.stderr)
        self.assertIn("allow 127.0.0.1", r.stderr)
        self.assertIn("Network access", r.stderr)
        self.assertEqual(r.stderr.count("EGRESS BLOCKED"), 1)
        self.assertEqual(sum(v for k, v in _CDN.hits.items() if k.startswith("/deny/")), 1)   # second job not tried
        out = json.loads(r.stdout)
        self.assertEqual(out["egressBlocked"], ["127.0.0.1"])
        self.assertEqual(len(out["errors"]), 2)
        self.assertEqual([p for p in self.raw.rglob("*") if p.is_file()], [])
        self.assertFalse(self.manifest.exists())

        self.write_ledger([self.job("sym_H1", 13, f"{self.base}/cf403/a.png", "symbol.txt", {"symbol": "H1"})])
        r = self.run_tool()
        self.assertEqual(r.returncode, 6, r.stderr)
        self.assertNotIn("EGRESS", r.stderr)
        self.assertIn("the CDN itself", r.stderr)
        self.assertIn("jobs_wait", r.stderr)

        self.write_ledger([self.job("sym_H1", 14, self.serve("x.png", cpng(1024, 1024)), "symbol.txt", {"symbol": "H1"})])
        r = self.run_tool(hosts=False)
        self.assertEqual(r.returncode, 6, r.stderr)
        self.assertIn("refusing result URL", r.stderr)
        self.assertEqual(_CDN.hits.get("/cdn/x.png"), None)

    def test_never_overwrites_a_different_file(self):
        url = self.serve("h1.png", cpng(1024, 1024))
        self.write_ledger([self.job("sym_H1", 15, url, "symbol.txt", {"symbol": "H1"})])
        self.assertEqual(self.run_tool().returncode, 0)
        raw = self.raw / "sym_H1" / "v01" / "raw.png"
        tampered = cpng(1024, 1024, (1, 2, 3))
        raw.write_bytes(tampered)
        hits = dict(_CDN.hits)
        r = self.run_tool()
        self.assertEqual(r.returncode, 7, r.stderr)
        self.assertIn("differs from the recorded sha256", r.stderr)
        self.assertEqual(raw.read_bytes(), tampered)
        self.assertEqual(_CDN.hits, hits)
        self.assertIn("CONFLICT", self.run_tool("status").stdout)

        # fresh machine (no art/_raw, no manifest), but the CDN now serves other bytes than the ledger recorded
        shutil.rmtree(self.raw)
        self.manifest.unlink()
        _CDN.files["/cdn/h1.png"] = cpng(1024, 1024, (255, 0, 0))
        r = self.run_tool()
        self.assertEqual(r.returncode, 7, r.stderr)
        self.assertIn("differs from the recorded", r.stderr)
        self.assertFalse((self.raw / "sym_H1").exists())
        self.assertTrue((self.raw / ".incoming" / f"{J[15]}.rejected").is_file())

    def test_prompt_drift_stored_fallback_and_licence_refusals(self):
        url = self.serve("h1.png", cpng(1024, 1024))
        j = self.job("sym_H1", 16, url, "symbol.txt", {"symbol": "H1"})
        j["promptHash"] = "f" * 64
        self.write_ledger([j])
        r = self.run_tool()
        self.assertEqual(r.returncode, 2, r.stderr)
        self.assertIn("prompt drift", r.stderr)
        self.assertEqual(_CDN.hits, {})
        self.prompts.mkdir(parents=True, exist_ok=True)
        (self.prompts / ("f" * 64 + ".txt")).write_text("not the paid prompt")
        r = self.run_tool()
        self.assertEqual(r.returncode, 2, r.stderr)
        self.assertIn("does not hash to its name", r.stderr)

        # the template changed since the job ran, but the exact text is stored: ingest with a warning
        j2 = self.stored_job("sym_H1", 17, url, "the prompt as it was when paid for", template="symbol.txt", vars={"symbol": "H1"})
        j2["promptHash"] = prov.sha256_text("the prompt as it was when paid for")
        self.write_ledger([j2])
        r = self.run_tool()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("no longer reproduces the paid prompt", r.stderr)
        v = self.raw / "sym_H1" / "v01"
        self.assertEqual((v / "prompt.txt").read_text(), "the prompt as it was when paid for")
        self.assertEqual(json.loads((v / "job.json").read_text())["prompt"]["source"], "stored")

        for model, reported in (("gpt_image_2", None), ("nano_banana_pro", "openai_hazel")):
            shutil.rmtree(self.raw, ignore_errors=True)
            jj = self.job("sym_H1", 18, url, "symbol.txt", {"symbol": "H1"})
            if reported:
                jj["model"] = reported
            self.write_ledger([jj], model=model)
            hits = dict(_CDN.hits)
            r = self.run_tool()
            self.assertEqual(r.returncode, 3, r.stderr)
            self.assertIn("REFUSED", r.stderr)
            self.assertEqual(_CDN.hits, hits)

    def test_plan_record_status_ingest(self):
        spec = {"batch": "t2", "purpose": "test", "model": "nano_banana_pro", "planTier": "Higgsfield Plus",
                "resolution": "2k", "aspect_ratio": "1:1",
                "jobs": [{"name": "sym_H2_rig", "template": "symbol.txt", "vars": {"symbol": "H2", "rigReady": True}},
                         {"name": "bg_A_test", "template": "background.txt#A", "resolution": "1k", "aspect_ratio": "21:9"}]}
        (self.w / "spec.json").write_text(json.dumps(spec))
        plan = self.w / "plan.json"
        r = self.run_tool("plan", "--spec", str(self.w / "spec.json"), "--out", str(plan), "--max-credits", "10")
        self.assertEqual(r.returncode, 4, r.stderr)                       # 1k NBP cost unknown: fails closed
        spec["jobs"][1]["credits"] = 2
        (self.w / "spec.json").write_text(json.dumps(spec))
        r = self.run_tool("plan", "--spec", str(self.w / "spec.json"), "--out", str(plan), "--max-credits", "10")
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout)
        self.assertEqual(out["estimatedCredits"], 4)
        reqs = out["calls"][0]["requests"]
        self.assertEqual([q["index"] for q in reqs], [0, 1])
        self.assertEqual(reqs[0]["params"], {"model": "nano_banana_pro", "prompt": rendered("symbol.txt", symbol="H2", rigReady=True)[0],
                                             "aspect_ratio": "1:1", "resolution": "2k"})
        self.assertEqual(reqs[1]["params"]["aspect_ratio"], "21:9")
        self.assertFalse(self.ledger.exists())                             # planning spends nothing and records nothing

        submit = self.w / "submit.json"
        submit.write_text(json.dumps({"jobs": [{"index": 0, "job_id": J[20], "status": "queued"},
                                               {"index": 1, "job_id": J[21], "status": "queued"},
                                               {"index": 2, "error": "rejected"}]}))
        r = self.run_tool("record", "--plan", str(plan), "--from", str(submit))
        self.assertEqual(r.returncode, 0, r.stderr)
        rec = json.loads(r.stdout)
        self.assertEqual(rec["added"], ["t2/sym_H2_rig", "t2/bg_A_test"])
        self.assertEqual(rec["notSubmitted"], [{"index": 2, "error": "rejected"}])
        led = json.loads(self.ledger.read_text())
        jobs = led["batches"][0]["jobs"]
        self.assertEqual(jobs[0]["vars"], {"symbol": "H2", "rigReady": True})
        self.assertEqual([j["credits"] for j in jobs], [2, 2])
        for j in jobs:
            self.assertEqual(prov.sha256_file(self.prompts / f"{j['promptHash']}.txt"), j["promptHash"])
        before = self.ledger.read_bytes()
        r = self.run_tool("record", "--plan", str(plan), "--from", str(submit))
        self.assertFalse(json.loads(r.stdout)["changed"])
        self.assertEqual(self.ledger.read_bytes(), before)
        st = json.loads(self.run_tool("status", "--json").stdout)["batches"][0]["counts"]
        self.assertEqual((st["pending"], st["creditsSpent"], st["downloaded"]), (2, 4, 0))
        # the same plan submitted again (new paid job ids) is kept under suffixed names, never dropped
        resub = self.w / "resubmit.json"
        resub.write_text(json.dumps({"jobs": [{"index": 0, "job_id": J[26], "status": "queued"}]}))
        r = self.run_tool("record", "--plan", str(plan), "--from", str(resub))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout)["added"], ["t2/sym_H2_rig.r2"])
        led = json.loads(self.ledger.read_text())
        led["batches"][0]["jobs"] = [j for j in led["batches"][0]["jobs"] if j["job_id"] != J[26]]
        self.ledger.write_text(json.dumps(led, indent=2) + "\n")

        # jobs_wait JSON as the MCP tool result wraps it (content[].text)
        u1 = self.serve("h2.png", cpng(2048, 2048))
        u2 = self.serve("bg.png", cpng(1584, 672))
        wait = {"jobs": [{"index": 0, "job_id": J[20], "status": "completed", "type": "image", "model": "nano_banana_2", "result_url": u1},
                         {"index": 1, "job_id": J[21], "status": "completed", "type": "image", "model": "nano_banana_2", "result_url": u2}],
                "all_terminal": True}
        (self.w / "wait.json").write_text(json.dumps({"content": [{"type": "text", "text": json.dumps(wait)}]}))
        r = self.run_tool("record", "--from", str(self.w / "wait.json"))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout)["updated"], ["t2/sym_H2_rig", "t2/bg_A_test"])
        self.run_tool("record", "--from", str(submit))                    # stale 'queued' must not downgrade
        self.assertEqual({j["status"] for j in json.loads(self.ledger.read_text())["batches"][0]["jobs"]}, {"completed"})

        r = self.run_tool()
        self.assertEqual(r.returncode, 0, r.stderr)
        doc = self.validate_manifest()
        self.assertEqual(sorted(x["id"] for x in doc["rows"]), ["background_a.raw.v01", "sym_h2_rig.raw.v01"])
        self.assertTrue((self.raw / "sym_H2_rig" / "v01" / "raw.png").is_file())
        st = json.loads(self.run_tool("status", "--json").stdout)["batches"][0]["counts"]
        self.assertEqual((st["completed"], st["downloaded"]), (2, 2))

        # ad-hoc MCP batch without a plan: prompts stored verbatim, no template
        req = {"requests": [{"index": 0, "params": {"model": "nano_banana_pro", "prompt": "a glowing jukebox emblem on #FF00FF",
                                                    "aspect_ratio": "1:1", "resolution": "2k"}}]}
        (self.w / "req.json").write_text(json.dumps(req))
        (self.w / "sub3.json").write_text(json.dumps({"jobs": [{"index": 0, "job_id": J[22], "status": "queued"}]}))
        r = self.run_tool("record", "--batch", "t3", "--request", str(self.w / "req.json"), "--from", str(self.w / "sub3.json"),
                          "--name", "0=ui_emblem_juke", "--plan-tier", "Higgsfield Plus")
        self.assertEqual(r.returncode, 0, r.stderr)
        t3 = json.loads(self.ledger.read_text())["batches"][1]
        self.assertEqual((t3["id"], t3["model"], t3["planTier"]), ("t3", "nano_banana_pro", "Higgsfield Plus"))
        self.assertEqual(t3["jobs"][0]["name"], "ui_emblem_juke")
        self.assertIsNone(t3["jobs"][0]["template"])
        self.assertEqual(t3["jobs"][0]["promptHash"], prov.sha256_text(req["requests"][0]["params"]["prompt"]))
        self.assertTrue((self.prompts / f"{t3['jobs'][0]['promptHash']}.txt").is_file())
        self.assertEqual(self.run_tool("check").returncode, 0)

        # refusals: OpenAI model, unknown job without a plan
        req["requests"][0]["params"]["model"] = "gpt_image_2"
        (self.w / "req.json").write_text(json.dumps(req))
        (self.w / "sub4.json").write_text(json.dumps({"jobs": [{"index": 0, "job_id": J[23], "status": "queued"}]}))
        r = self.run_tool("record", "--batch", "t4", "--request", str(self.w / "req.json"), "--from", str(self.w / "sub4.json"))
        self.assertEqual(r.returncode, 3, r.stderr)
        r = self.run_tool("record", "--from", str(self.w / "sub4.json"))
        self.assertEqual(r.returncode, 2, r.stderr)
        self.assertNotIn("t4", self.ledger.read_text())

    def test_record_staged_list_and_media_guard(self):
        # agents staging [{index, name, params, job_id, result_url}] lists: one file is both request and result
        u = self.serve("ab.png", cpng(2048, 2048))
        staged = [{"index": 10, "name": "ab_B_H1", "params": {"model": "nano_banana_pro", "resolution": "2k", "aspect_ratio": "1:1",
                                                               "prompt": "direction B boombox probe"}, "job_id": J[24], "result_url": u},
                  {"index": 11, "name": "ab_B_W", "params": {"model": "nano_banana_pro", "resolution": "2k", "aspect_ratio": "1:1",
                                                              "prompt": "direction B wild probe"}, "job_id": J[25]}]
        f = self.w / ".ab_pending.json"
        f.write_text(json.dumps(staged))
        r = self.run_tool("record", "--batch", "ab1", "--request", str(f), "--from", str(f), "--purpose", "A/B")
        self.assertEqual(r.returncode, 0, r.stderr)
        jobs = json.loads(self.ledger.read_text())["batches"][0]["jobs"]
        self.assertEqual([(j["name"], j["index"], j["status"], j["credits"]) for j in jobs],
                         [("ab_B_H1", 10, "completed", 2), ("ab_B_W", 11, "submitted", 2)])
        st = {j["job"]: j["stage"] for j in json.loads(self.run_tool("status", "--json").stdout)["batches"][0]["jobs"]}
        self.assertEqual(st, {"ab_B_H1": "2d-image", "ab_B_W": "2d-image"})
        # untemplated names: stage from name tokens (mascot ids from the art bible)
        probe = self.w / "stages.mjs"
        probe.write_text(f"import {{ stageFor }} from '{(GEN / 'lib' / 'hfledger.mjs').as_uri()}';\n"
                         "console.log(JSON.stringify(['ab_bg_painted', 'D_gumbo', 'ab_croak_v2', 'mascot_x', 'ab_C_W', 'bgless']"
                         ".map((n) => stageFor({ name: n }, n))));\n")
        r = subprocess.run([NODE, str(probe)], cwd=REPO, capture_output=True, text=True)
        self.assertEqual(json.loads(r.stdout), ["backgrounds", "mascot-sheets", "mascot-sheets", "mascot-sheets", "2d-image", "2d-image"], r.stderr)
        r = self.run_tool()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue((self.raw / "ab_B_H1" / "v01" / "raw.png").is_file())

        # placeholder media ids never reach a paid call
        spec = {"batch": "c01", "model": "nano_banana_pro", "jobs": [
            {"name": "sym_H1_rig.c1", "template": "symbol.txt", "vars": {"symbol": "H1", "rigReady": True}, "asset": "sym_H1_rig",
             "medias": [{"value": "UNAPPROVED:sym_H1", "role": "image_references"}]}]}
        (self.w / "spec.json").write_text(json.dumps(spec))
        r = self.run_tool("plan", "--spec", str(self.w / "spec.json"), "--out", str(self.w / "plan.json"))
        self.assertEqual(r.returncode, 2, r.stderr)
        self.assertIn("UNAPPROVED", r.stderr)
        spec["jobs"][0]["medias"][0]["value"] = J[1]
        (self.w / "spec.json").write_text(json.dumps(spec))
        r = self.run_tool("plan", "--spec", str(self.w / "spec.json"), "--out", str(self.w / "plan.json"))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout)["calls"][0]["requests"][0]["params"]["medias"], [{"value": J[1], "role": "image_references"}])

    def test_plan_refuses_what_record_cannot_store(self):
        """Anything 'record' would refuse AFTER the credits are spent must already fail at 'plan' (exit 2, no plan file)."""
        base = {"name": "sym_H2", "template": "symbol.txt", "vars": {"symbol": "H2"}}
        bad = {
            "name with a space": {"name": "sym H2"},
            "unknown lower-case var (silently unused by the renderer)": {"vars": {"symbol": "H2", "rig_ready": True}},
            "non-string placeholder value": {"vars": {"symbol": "H2", "LIGHT_NOTE": 0}},
            "stage outside the manifest enum": {"stage": "props"},
            "unsafe asset folder": {"asset": "../x"},
            "resolution the model does not take": {"resolution": "8k"},
            "aspect ratio the model does not take": {"aspect_ratio": "7:3"},
            "mask media on Nano Banana Pro": {"medias": [{"value": J[1], "role": "mask"}]},
        }
        plan = self.w / "plan.json"
        for why, patch in bad.items():
            (self.w / "spec.json").write_text(json.dumps({"batch": "p1", "model": "nano_banana_pro", "jobs": [{**base, **patch}]}))
            r = self.run_tool("plan", "--spec", str(self.w / "spec.json"), "--out", str(plan))
            self.assertEqual(r.returncode, 2, f"{why}: {r.stderr}")
            self.assertIn("cannot record", r.stderr, why)
            self.assertFalse(plan.exists(), why)
        # NB2 takes a mask (masked inpaint fills); new templates get their stage from the template
        ok = {"batch": "p1", "model": "nano_banana_pro", "jobs": [
            {"name": "fill_1", "template": "symbol.txt", "vars": {"symbol": "H3"}, "request_model": "nano_banana_2", "resolution": "1k",
             "medias": [{"value": J[1], "role": "image_references"}, {"value": J[2], "role": "mask"}]}]}
        (self.w / "spec.json").write_text(json.dumps(ok))
        r = self.run_tool("plan", "--spec", str(self.w / "spec.json"), "--out", str(plan))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout)["estimatedCredits"], 1.5)
        # a plan file whose calls may already be paid for is never silently replaced by a different one
        ok["jobs"][0]["vars"]["LIGHT_NOTE"] = "lit from above"
        (self.w / "spec.json").write_text(json.dumps(ok))
        before = plan.read_bytes()
        r = self.run_tool("plan", "--spec", str(self.w / "spec.json"), "--out", str(plan))
        self.assertEqual(r.returncode, 2, r.stderr)
        self.assertIn("already holds a different plan", r.stderr)
        self.assertEqual(plan.read_bytes(), before)
        r = self.run_tool("plan", "--spec", str(self.w / "spec.json"), "--out", str(plan), "--force")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotEqual(plan.read_bytes(), before)
        probe = self.w / "stages.mjs"
        probe.write_text(f"import {{ stageFor }} from '{(GEN / 'lib' / 'hfledger.mjs').as_uri()}';\n"
                         "console.log(JSON.stringify(['prop.txt#A', 'emblem.txt#C', 'card_art.txt', 'mascot_parts_sheet.txt#B']"
                         ".map((t) => stageFor({ name: 'x', template: t }, 'x'))));\n")
        r = subprocess.run([NODE, str(probe)], cwd=REPO, capture_output=True, text=True)
        self.assertEqual(json.loads(r.stdout), ["2d-image", "2d-image", "2d-image", "mascot-sheets"], r.stderr)

    def test_real_ledger_is_valid_and_reproducible(self):
        ledger = REPO / "art" / "ledger" / "higgsfield-jobs.json"
        schema = REPO / "art" / "ledger" / "higgsfield-jobs.schema.json"
        if HAVE_JSONSCHEMA:
            jsonschema.Draft202012Validator(json.loads(schema.read_text())).validate(json.loads(ledger.read_text()))
        r = self.run_tool("check", paths=False)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertNotIn("FAIL", r.stdout)
        st = subprocess.run([NODE, str(TOOL), "status", "--json", "--batch", "probe1", "--out-root", str(self.raw), "--manifest", "none"],
                            cwd=REPO, capture_output=True, text=True)
        self.assertEqual(st.returncode, 0, st.stderr)
        b = json.loads(st.stdout)["batches"][0]
        self.assertEqual((b["counts"]["jobs"], b["counts"]["completed"], b["counts"]["creditsSpent"]), (8, 8, 22))
        for j in json.loads(ledger.read_text())["batches"][0]["jobs"]:
            p = REPO / "art" / "ledger" / "prompts" / f"{j['promptHash']}.txt"
            self.assertTrue(p.is_file(), p)
            self.assertEqual(prov.sha256_file(p), j["promptHash"])

    def test_licence_audit_on_ingested_rows(self):
        url = self.serve("h1.png", cpng(1024, 1024))
        self.write_ledger([self.job("sym_H1", 30, url, "symbol.txt", {"symbol": "H1"})])
        self.assertEqual(self.run_tool().returncode, 0)
        empty = self.w / "public"
        empty.mkdir()
        audit = [NODE, str(REPO / "tools" / "licence" / "audit.mjs"), "--public", str(empty)]
        r = subprocess.run([*audit, "--manifest", str(self.manifest)], cwd=REPO, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout)                        # building with a pending clearance is fine
        self.assertIn("no archived ToS", r.stdout)
        doc = json.loads(self.manifest.read_text())
        for row in doc["rows"]:
            row["shipped"] = True
        shipped = self.w / "shipped.json"
        shipped.write_text(json.dumps(doc, indent=2))
        r = subprocess.run([*audit, "--manifest", str(shipped), "--release"], cwd=REPO, capture_output=True, text=True)
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertIn("licence 'higgsfield' has clearance 'pending'", r.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
