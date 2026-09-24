#!/usr/bin/env python3
"""Self-tests for tools/audio (synthetic tones, mock ElevenLabs server; no keys, no network).

  PIPELINE_PY=tools/.venv/bin/python tools/.venv/bin/python tools/audio/test/test_audio.py
Scratch: art/_work/test-audio/ (gitignored).
"""
from __future__ import annotations

import http.server
import io
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import threading
import unittest
import zipfile
from pathlib import Path

AUDIO = Path(__file__).resolve().parents[1]
REPO = AUDIO.parents[1]
sys.path.insert(0, str(REPO / "tools" / "gen"))
import provenance as prov  # noqa: E402

WORK = REPO / "art" / "_work" / "test-audio"
PY = os.environ.get("PIPELINE_PY", sys.executable)
ENV = {**os.environ, "PIPELINE_PY": PY, "SOURCE_DATE_EPOCH": "1790000000", "NO_PROXY": "127.0.0.1,localhost",
       "no_proxy": "127.0.0.1,localhost"}


def ffmpeg() -> str:
    if os.environ.get("FFMPEG"):
        return os.environ["FFMPEG"]
    return subprocess.run([PY, "-c", "import imageio_ffmpeg as m; print(m.get_ffmpeg_exe())"], capture_output=True,
                          text=True, check=True).stdout.strip()


FF = ffmpeg()
ENV["FFMPEG"] = FF


def run(*args, **kw):
    return subprocess.run([str(a) for a in args], capture_output=True, text=True, cwd=REPO, env=ENV, **kw)


def synth(path: Path, expr: str, seconds: float, rate: int = 48000, ch: int = 1):
    r = run(FF, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"aevalsrc='{expr}':s={rate}:d={seconds}",
            "-ac", ch, "-c:a", "pcm_s16le", path)
    assert r.returncode == 0, r.stderr


def measure(path: Path) -> dict:
    r = run(PY, AUDIO / "audio_qa.py", "measure", path)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


class MasterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        shutil.rmtree(WORK, ignore_errors=True)
        (WORK / "in").mkdir(parents=True)
        i = WORK / "in"
        synth(i / "music.wav", "0.03*(sin(2*PI*220*t)+0.7*sin(2*PI*277.2*t)+0.5*sin(2*PI*329.6*t))*(0.8+0.2*sin(2*PI*0.5*t))", 8, 44100, 2)
        synth(i / "loop.wav", "0.1*sin(2*PI*(200+50*t)*t)", 4, 48000, 2)
        synth(i / "sfx.wav", "if(between(t,0.3,0.7),0.1*sin(2*PI*880*t)*exp(-6*(t-0.3)),0)", 1)
        synth(i / "spiky.wav", "0.01*sin(2*PI*330*t)+if(between(t,2,2.002),0.99,0)", 6)
        # a UI click: a decaying noise burst with an abrupt attack; AAC/Opus overshoot its peak by 2-3 dB
        synth(i / "click.wav", "0.5*(2*random(0)-1)*exp(-40*t)", 0.15)
        cls.res = {}
        for name, mode, extra in (("music", "music", []), ("loop", "loop", ["--crossfade-ms", "250"]),
                                  ("sfx", "sfx", ["--peak", "-6"]), ("spiky", "music", []), ("click", "sfx", ["--peak", "-6"])):
            cls.res[name] = run(AUDIO / "master.sh", i / f"{name}.wav", WORK / "out" / name, "--mode", mode,
                                "--formats", "webm,m4a,ogg", "--wav", WORK / "out" / f"{name}_master.wav",
                                "--qa-dir", WORK / f"qa_{name}", *extra)

    def qa(self, name):
        return json.loads((WORK / f"qa_{name}" / "qa.json").read_text())

    def test_all_pass(self):
        for name, r in self.res.items():
            self.assertEqual(r.returncode, 0, f"{name}: {r.stdout}{r.stderr}")
            self.assertTrue(self.qa(name)["passed"], name)

    def test_music_linear_and_loudness(self):
        q = self.qa("music")
        self.assertEqual(q["normalization"], "loudnorm-2pass-linear")
        self.assertEqual(q["loudnormPass2"]["normalization_type"], "linear")
        for ext in ("webm", "m4a", "ogg"):
            m = measure(WORK / "out" / f"music.{ext}")            # independent ebur128 measurement
            self.assertLessEqual(abs(m["I"] + 16), 1.0, (ext, m["I"]))
            self.assertLessEqual(m["TP"], -1 + 1.0)
        m = measure(WORK / "out" / "music_master.wav")
        self.assertLessEqual(abs(m["I"] + 16), 1.0)
        self.assertEqual(m["duration"], 8.0)

    def test_loop_seam_and_aac_alignment(self):
        q = self.qa("loop")
        self.assertEqual(q["outputSamples"] % 1024, 0)
        for o in q["outputs"]:
            self.assertEqual(o["samples48k"], q["outputSamples"], o["file"])   # m4a has no padding tail
            self.assertLessEqual(o["seamJumpRatio"], 8, o["file"])
            self.assertLessEqual(abs(o["I"] + 16), 1.0)

    def test_sfx_trim_and_peak(self):
        for o in self.qa("sfx")["outputs"]:
            self.assertLessEqual(o["leadSilence"], 0.02)
            self.assertLess(o["duration"], 0.45)                                 # 0.3 s of silence removed
        m = measure(WORK / "out" / "sfx_master.wav")
        self.assertAlmostEqual(m["samplePeak"], -6.0, delta=0.1)

    def test_sfx_ceiling_gated_on_master_not_codec_overshoot(self):
        q = self.qa("click")
        self.assertTrue(q["passed"])
        self.assertTrue(q["master"]["gates"]["peakCeiling"])
        self.assertAlmostEqual(q["master"]["samplePeak"], -6.0, delta=0.1)
        lossy = [o for o in q["outputs"] if not o["file"].endswith(".wav")]
        self.assertTrue(lossy and all(o["gates"]["noClip"] for o in lossy))
        self.assertTrue(any(o["peakOvershootDb"] > 1.0 for o in lossy), lossy)   # the case the old gate rejected
        # a ceiling the lossy encodes would clip at still fails
        r = run(AUDIO / "master.sh", WORK / "in" / "click.wav", WORK / "out" / "click_hot", "--mode", "sfx", "--peak", "-0.2",
                "--qa-dir", WORK / "qa_click_hot")
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)

    def test_fallback_hits_target(self):
        q = self.qa("spiky")
        self.assertTrue(q["normalization"].startswith("static-gain+alimiter"))
        for ext in ("webm", "m4a", "ogg"):
            m = measure(WORK / "out" / f"spiky.{ext}")
            self.assertLessEqual(abs(m["I"] + 16), 1.0, (ext, m["I"]))
            self.assertLessEqual(m["TP"], 0.0)

    def test_idempotent_bytes(self):
        before = {p.name: prov.sha256_file(p) for p in (WORK / "out").glob("music*")}
        r = run(AUDIO / "master.sh", WORK / "in" / "music.wav", WORK / "out" / "music", "--mode", "music",
                "--formats", "webm,m4a,ogg", "--wav", WORK / "out" / "music_master.wav", "--qa-dir", WORK / "qa_music")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(before, {p.name: prov.sha256_file(p) for p in (WORK / "out").glob("music*")})

    def test_rows(self):
        doc = json.loads((WORK / "qa_music" / "manifest.json").read_text())
        self.assertEqual(sorted(r["path"].rsplit(".", 1)[1] for r in doc["rows"]), ["m4a", "ogg", "wav", "webm"])
        for r in doc["rows"]:
            self.assertEqual(r["stage"], "audio-post")
            self.assertEqual(r["licenseId"], "ffmpeg")
            self.assertTrue(r["qa"]["passed"])

    def test_usage(self):
        self.assertEqual(run(AUDIO / "master.sh").returncode, 2)
        self.assertEqual(run(AUDIO / "master.sh", WORK / "in" / "sfx.wav", WORK / "x", "--mode", "nope").returncode, 2)
        self.assertEqual(run(AUDIO / "master.sh", "--help").returncode, 0)


class SpriteTests(unittest.TestCase):
    def test_sprite(self):
        d = WORK / "sprite_in"
        d.mkdir(parents=True, exist_ok=True)
        for f in (440, 660, 990):
            synth(d / f"ui_click_{f}.wav", f"0.5*sin(2*PI*{f}*t)*exp(-12*t)*min(1,(0.35-t)*50)", 0.35)
        r = run("node", AUDIO / "sprite.mjs", "--out", WORK / "sprite" / "sfx", "--formats", "webm,m4a,ogg",
                "--qa-dir", WORK / "qa_sprite", "--loop", "ui_click_990", *sorted(d.glob("*.wav")))
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        m = json.loads((WORK / "sprite" / "sfx.json").read_text())
        self.assertEqual(m["src"], ["sfx.webm", "sfx.m4a", "sfx.ogg"])
        self.assertEqual(list(m["sprite"]), ["ui_click_440", "ui_click_660", "ui_click_990"])
        self.assertEqual(m["sprite"]["ui_click_990"][2], True)
        for start, n in m["samples"].values():
            self.assertEqual(start % 1024, 0)
            self.assertEqual(n, 16800)
        self.assertTrue(json.loads((WORK / "qa_sprite" / "qa.json").read_text())["passed"])


class _Eleven(http.server.BaseHTTPRequestHandler):
    calls: list = []
    sfx_budget = None          # int: sound-generation calls allowed before the mock answers HTTP 400

    def log_message(self, *a):
        pass

    def _send(self, code, body: bytes, ctype="application/octet-stream", headers=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    @staticmethod
    def pcm(seconds, ch=1, f=440.0):
        n = int(48000 * seconds)
        return b"".join(struct.pack("<" + "h" * ch, *([int(8000 * math.sin(2 * math.pi * f * i / 48000))] * ch)) for i in range(n))

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(n)
        if self.headers.get("xi-api-key") != "test-key":
            return self._send(401, b"{}", "application/json")
        ctype = self.headers.get("Content-Type", "")
        body = json.loads(raw) if ctype.startswith("application/json") else {"multipart": len(raw)}
        _Eleven.calls.append((self.path, body))
        if self.path.startswith("/v1/sound-generation"):
            if _Eleven.sfx_budget is not None:
                if _Eleven.sfx_budget <= 0:
                    return self._send(400, b'{"detail": "mock failure"}', "application/json")
                _Eleven.sfx_budget -= 1
            return self._send(200, self.pcm(body["duration_seconds"], 1), headers={"request-id": "req-sfx"})
        if self.path.startswith("/v1/music/plan"):
            plan = {"chunks": [{"text": "groove", "duration_ms": body["music_length_ms"], "positive_styles": ["funk"], "negative_styles": []}]}
            return self._send(200, json.dumps(plan).encode(), "application/json")
        if self.path.startswith("/v1/music/stem-separation"):
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w") as z:
                z.writestr("drums.wav", b"RIFF0000WAVE")
            return self._send(200, buf.getvalue(), "application/zip")
        if self.path.startswith("/v1/music"):
            if "composition_plan" in body:
                secs = sum(c["duration_ms"] for c in body["composition_plan"]["chunks"]) / 1000
            else:
                secs = body["music_length_ms"] / 1000
            return self._send(200, self.pcm(secs, 2, 220.0), headers={"song-id": f"song-{len(_Eleven.calls)}"})
        self._send(404, b"{}", "application/json")


class GenAudioTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Eleven)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.srv.server_address[1]}"
        cls.w = WORK / "gen"
        shutil.rmtree(cls.w, ignore_errors=True)
        cls.w.mkdir(parents=True)
        cues = (AUDIO / "cues.example.yaml").read_text()
        # short durations so the mock stays fast
        cues = cues.replace("durationS: 64", "durationS: 4").replace("durationS: 30", "durationS: 4")
        cues = cues.replace("durationMs: 9000", "durationMs: 3000").replace("durationMs: 27000", "durationMs: 3000").replace("durationMs: 28000", "durationMs: 3000")
        cues = cues.replace("    videoToMusic: build/video/bigwin.mp4   # optional: score the rendered big-win sequence\n", "")
        (cls.w / "cues.yaml").write_text(cues)

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def node(self, script, *args, key="test-key"):
        env = {**ENV, "ELEVENLABS_API_KEY": key}
        return subprocess.run(["node", str(AUDIO / script), "--cues", str(self.w / "cues.yaml"), "--api-base", self.base,
                               "--out-root", str(self.w / "raw"), "--manifest", str(self.w / "manifest.json"), *map(str, args)],
                              capture_output=True, text=True, cwd=REPO, env=env)

    def test_1_dry_run(self):
        r = self.node("gen-sfx.mjs", "--dry-run", "--cue", "land_heavy", key="")
        self.assertEqual(r.returncode, 0, r.stderr)
        d = json.loads(r.stdout)
        self.assertEqual(len(d["requests"]), 6)
        q = d["requests"][0]
        self.assertTrue(q["url"].endswith("/v1/sound-generation?output_format=pcm_48000"))
        self.assertEqual(q["body"]["model_id"], "eleven_text_to_sound_v2")
        self.assertEqual(q["headers"]["xi-api-key"], "<redacted>")
        self.assertFalse((self.w / "raw").exists())
        r = self.node("gen-music.mjs", "--dry-run", key="")
        self.assertEqual(r.returncode, 0, r.stderr)
        urls = [q["url"].split("?")[0].rsplit("/v1/", 1)[1] for q in json.loads(r.stdout)["requests"]]
        self.assertEqual(urls, ["music", "music/stem-separation", "music", "music/plan", "music"])

    def test_2_sfx_generate(self):
        r = self.node("gen-sfx.mjs", "--cue", "land_heavy", "--cue", "ui_click", "--takes", "2")
        self.assertEqual(r.returncode, 0, r.stderr)
        v = self.w / "raw" / "audio_sfx_land_heavy" / "v01"
        self.assertEqual(sorted(p.name for p in v.glob("raw_*.wav")), ["raw_01.wav", "raw_02.wav"])
        m = measure(v / "raw_01.wav")
        self.assertAlmostEqual(m["duration"], 0.6, delta=0.01)
        self.assertEqual(m["channels"], 1)
        doc = json.loads((self.w / "manifest.json").read_text())
        ids = [x["id"] for x in doc["rows"]]
        self.assertIn("audio_sfx_land_heavy.raw.v01.t01", ids)
        self._schema(doc)
        again = self.node("gen-sfx.mjs", "--cue", "land_heavy", "--takes", "2")
        self.assertIn("already generated", again.stdout)

    def test_2b_sfx_partial_failure_resumes(self):
        # take 3 of 4 fails: the next run must generate only takes 3-4 and record rows for all four
        # (the raw folder must not count as 'already generated' because raw_01 exists)
        _Eleven.sfx_budget = 2
        try:
            r = self.node("gen-sfx.mjs", "--cue", "explode", "--takes", "4")
        finally:
            _Eleven.sfx_budget = None
        self.assertEqual(r.returncode, 5, r.stderr)
        v = self.w / "raw" / "audio_sfx_explode" / "v01"
        self.assertEqual(sorted(p.name for p in v.glob("raw_*.wav")), ["raw_01.wav", "raw_02.wav"])
        n_calls = len([c for c in _Eleven.calls if c[0].startswith("/v1/sound-generation")])
        r = self.node("gen-sfx.mjs", "--cue", "explode", "--takes", "4")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(len([c for c in _Eleven.calls if c[0].startswith("/v1/sound-generation")]) - n_calls, 2)
        self.assertEqual(sorted(p.name for p in v.glob("raw_*.wav")), [f"raw_0{i}.wav" for i in range(1, 5)])
        ids = [x["id"] for x in json.loads((self.w / "manifest.json").read_text())["rows"]]
        for t in range(1, 5):
            self.assertIn(f"audio_sfx_explode.raw.v01.t0{t}", ids)
        self.assertEqual(len(json.loads((v / "job.json").read_text())["jobs"]), 4)
        self.assertIn("already generated", self.node("gen-sfx.mjs", "--cue", "explode", "--takes", "4").stdout)

    def test_3_music_chain(self):
        r = self.node("gen-music.mjs", "--stem", "base", "--stem", "freegame", "--stem", "bigwin")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        base = self.w / "raw" / "audio_music_base" / "v01"
        song = (base / "song_id.txt").read_text().strip()
        self.assertTrue(song.startswith("song-"))
        self.assertTrue((base / "stems" / "drums.wav").is_file())
        self.assertEqual(measure(base / "raw.wav")["channels"], 2)
        fg = json.loads((self.w / "raw" / "audio_music_freegame" / "v01" / "plan.json").read_text())
        self.assertTrue(all(c["conditioning_ref"]["song_id"] == song for c in fg["chunks"]))
        big = [b for p, b in _Eleven.calls if p.startswith("/v1/music?") and "composition_plan" in b][-1]
        self.assertEqual(big["composition_plan"]["chunks"][0]["conditioning_ref"]["song_id"], song)
        base_call = [b for p, b in _Eleven.calls if p.startswith("/v1/music?") and "prompt" in b][0]
        self.assertTrue(base_call["force_instrumental"])
        self.assertTrue(base_call["store_for_inpainting"])
        self._schema(json.loads((self.w / "manifest.json").read_text()))

    def test_4_refusals(self):
        bad = self.w / "bad.yaml"
        bad.write_text((self.w / "cues.yaml").read_text().replace("sfxModel: eleven_text_to_sound_v2", "sfxModel: musicgen-large"))
        r = subprocess.run(["node", str(AUDIO / "gen-sfx.mjs"), "--cues", str(bad), "--dry-run"], capture_output=True, text=True, cwd=REPO)
        self.assertEqual(r.returncode, 3, r.stderr)
        bad.write_text((self.w / "cues.yaml").read_text().replace("  land_heavy:", "  land_hevy:"))
        r = subprocess.run(["node", str(AUDIO / "gen-sfx.mjs"), "--cues", str(bad), "--dry-run"], capture_output=True, text=True, cwd=REPO)
        self.assertEqual(r.returncode, 2)
        self.assertIn("not an SfxId", r.stderr)
        r = subprocess.run(["node", str(AUDIO / "gen-sfx.mjs"), "--cues", str(self.w / "cues.yaml"), "--cue", "land_heavy"],
                           capture_output=True, text=True, cwd=REPO, env={**ENV, "ELEVENLABS_API_KEY": ""})
        self.assertEqual(r.returncode, 2)

    def _schema(self, doc):
        try:
            import jsonschema
        except ImportError:
            return
        schema = json.loads((REPO / "art" / "manifest.schema.json").read_text())
        jsonschema.Draft202012Validator(schema, format_checker=jsonschema.FormatChecker()).validate(doc)


class YamlTests(unittest.TestCase):
    def js(self, text):
        return subprocess.run(["node", "--input-type=module", "-e",
                               "import { parseYaml } from './tools/audio/lib/yaml.mjs'; let s='';"
                               "process.stdin.on('data', d => s += d).on('end', () => { try { console.log(JSON.stringify(parseYaml(s))); }"
                               " catch (e) { console.error(e.message); process.exit(3); } });"],
                              input=text, capture_output=True, text=True, cwd=REPO)

    def test_example_matches_pyyaml(self):
        try:
            import yaml
        except ImportError:
            self.skipTest("PyYAML not installed")
        text = (AUDIO / "cues.example.yaml").read_text()
        self.assertEqual(json.loads(self.js(text).stdout), yaml.safe_load(text))
        tricky = "a: 'it''s # not a comment'\nb: [1, \"x, y\", {k: v}]\nc:\n- 1\n- - 2\n  - 3\nd: -0.5e+1\ne: ~\nf: 1e3\n"  # (YAML 1.1 sexagesimal ints like 12:30 are deliberately NOT supported)
        self.assertEqual(json.loads(self.js(tricky).stdout), yaml.safe_load(tricky))
        bools = "a: yes\nb: no\nc: on\nd: Off\ne: NO\nf: 'no'\ng: 0\nh: 10\n"
        self.assertEqual(json.loads(self.js(bools).stdout), yaml.safe_load(bools))

    def test_errors(self):
        for bad in ("a:\n\tb: 1\n", "a: |\n  text\n", "a: *ref\n", "a: 1\na: 2\n", "a: 010\n", "a: 0x10\n", "a: 1_000\n"):
            self.assertEqual(self.js(bad).returncode, 3, bad)


if __name__ == "__main__":
    unittest.main(verbosity=2)
