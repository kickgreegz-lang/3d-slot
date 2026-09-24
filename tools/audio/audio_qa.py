#!/usr/bin/env python3
"""Audio measurements for tools/audio (stdlib only; ffmpeg from $FFMPEG).

  FFMPEG=... python3 tools/audio/audio_qa.py measure FILE             -> JSON {I, LRA, TP, samplePeak, duration, ...}
  FFMPEG=... python3 tools/audio/audio_qa.py loudnorm-json STDERR_FILE -> the JSON block loudnorm printed
  FFMPEG=... python3 tools/audio/audio_qa.py check --mode music|loop|sfx --lufs -16 --tp -1 [--peak -6] FILE... --report qa.json

`measure` runs ffmpeg ebur128 (peak=true) and decodes 48 kHz s16 PCM for sample statistics:
leading/trailing silence (below -60 dBFS) and, for loops, the seam jump = |x[0] - x[-1]|
relative to the median |x[n+1] - x[n]| (a click at the loop point shows up as a large ratio).
`check` applies the gates: music/loop integrated loudness within +-1 LU of the target and true
peak <= tp + tol; sfx sample peak <= ceiling + tol, where tol = 0.1 dB for WAV and 1.0 dB for the
lossy encodes (AAC/Opus/Vorbis overshoot the master's peaks); loop seam ratio <= 8.
With --master PCM (what master.sh encoded from), the sfx ceiling is gated on that master (tol 0.1 dB)
and the lossy encodes only have to stay unclipped (sample peak <= -0.1 dBFS): codec overshoot on
abrupt attacks and noise bursts (clicks, zaps) reaches +2..5 dB and is not a mastering error, so
gating it against the ceiling rejected ordinary SFX. The overshoot is reported per file.
"""
from __future__ import annotations

import argparse
import array
import json
import math
import os
import re
import statistics
import subprocess
import sys
from pathlib import Path


def ff() -> str:
    return os.environ.get("FFMPEG", "ffmpeg")


def ebur128(path: str) -> dict:
    r = subprocess.run([ff(), "-hide_banner", "-nostats", "-nostdin", "-i", path, "-filter_complex",
                        "ebur128=peak=true:framelog=quiet", "-f", "null", "-"], capture_output=True, text=True)
    t = r.stderr
    summary = t[t.rfind("Summary:"):] if "Summary:" in t else t

    def grab(label, unit):
        m = re.search(label + r":\s+(-?[\d.]+|-inf)\s+" + unit, summary)
        if not m:
            return None
        return -math.inf if m.group(1) == "-inf" else float(m.group(1))

    return {"I": grab("I", "LUFS"), "LRA": grab("LRA", "LU"), "TP": grab("Peak", "dBFS")}


def pcm(path: str, sr: int = 48000) -> tuple[list[array.array], int]:
    r = subprocess.run([ff(), "-hide_banner", "-loglevel", "error", "-nostdin", "-i", path, "-f", "s16le",
                        "-acodec", "pcm_s16le", "-ar", str(sr), "-"], capture_output=True, check=True)
    probe = subprocess.run([ff(), "-hide_banner", "-nostdin", "-i", path], capture_output=True, text=True).stderr
    ch = 2 if re.search(r"Audio:.*\b(stereo|2 channels)\b", probe) else 1
    m = re.search(r"Audio:.*?(\d+) channels", probe)
    if m:
        ch = int(m.group(1))
    a = array.array("h")
    a.frombytes(r.stdout)
    if sys.byteorder != "little":
        a.byteswap()
    return [a[c::ch] for c in range(ch)], ch


def measure(path: str) -> dict:
    out = {"file": path, **ebur128(path)}
    chans, ch = pcm(path)
    n = len(chans[0])
    out["channels"] = ch
    out["samples48k"] = n
    out["duration"] = round(n / 48000, 4)
    peak = max((max(abs(min(c)), abs(max(c))) for c in chans if len(c)), default=0)
    out["samplePeak"] = round(20 * math.log10(peak / 32768), 2) if peak else -math.inf
    thr = 32768 * 10 ** (-60 / 20)

    def lead(c):
        for i, v in enumerate(c):
            if abs(v) > thr:
                return i
        return len(c)

    out["leadSilence"] = round(min(lead(c) for c in chans) / 48000, 4)
    out["tailSilence"] = round(min(lead(c[::-1]) for c in chans) / 48000, 4)
    ratios = []
    for c in chans:
        if len(c) < 4:
            continue
        step = 97 if len(c) > 200000 else 1        # subsample the median on long files
        diffs = [abs(c[i + 1] - c[i]) for i in range(0, len(c) - 1, step)]
        med = statistics.median(diffs) or 1
        ratios.append(abs(c[0] - c[-1]) / med)
    out["seamJumpRatio"] = round(max(ratios), 3) if ratios else None
    return out


def loudnorm_json(text: str) -> dict:
    blocks = re.findall(r"\{[^{}]*\"input_i\"[^{}]*\}", text, re.S)
    if not blocks:
        raise SystemExit("error: no loudnorm JSON in the ffmpeg output")
    return json.loads(blocks[-1])


LOSSLESS = (".wav", ".flac")
CLIP_DBFS = -0.1


def check(a) -> int:
    results = []
    ok = True
    master = None
    if a.master:
        master = measure(a.master)
        master["file"] = "master (pre-encode PCM)"
        mg = {}
        if a.mode == "sfx" and a.lufs_sfx is None:
            mg["peakCeiling"] = master["samplePeak"] <= a.peak + 0.1
            mg["trimmed"] = master["leadSilence"] <= 0.02
        master["gates"] = mg
        master["passed"] = all(mg.values())
        ok &= master["passed"]
    for f in a.files:
        m = measure(f)
        gates = {}
        lossless = Path(f).suffix.lower() in LOSSLESS
        # lossy codecs overshoot the master's peaks a little (AAC most): 1 dB allowance, 0.1 for PCM
        tol = 0.1 if lossless else 1.0
        m["peakTolerance"] = tol
        if a.mode in ("music", "loop") or a.lufs_sfx is not None:
            target = a.lufs if a.mode != "sfx" else a.lufs_sfx
            gates["loudness"] = m["I"] is not None and abs(m["I"] - target) <= 1.0
            gates["truePeak"] = m["TP"] is not None and m["TP"] <= a.tp + tol
        if a.mode == "sfx":
            if master is not None and not lossless and a.lufs_sfx is None:
                m["peakOvershootDb"] = round(m["samplePeak"] - a.peak, 2) if math.isfinite(m["samplePeak"]) else None
                gates["noClip"] = m["samplePeak"] <= CLIP_DBFS
            else:
                gates["peakCeiling"] = m["samplePeak"] <= a.peak + tol
            gates["trimmed"] = m["leadSilence"] <= 0.02
        if a.mode == "loop" and Path(f).suffix.lstrip(".").lower() not in (a.no_seam_ext or []):
            gates["seam"] = m["seamJumpRatio"] is not None and m["seamJumpRatio"] <= 8
        m["gates"] = gates
        m["passed"] = all(gates.values())
        ok &= m["passed"]
        results.append(m)
    rep = {"tool": "tools/audio/master.sh", "mode": a.mode, "targetLUFS": a.lufs, "targetTP": a.tp,
           "sfxPeakCeiling": a.peak, "master": master, "outputs": results, "passed": ok}
    if a.extra:
        rep.update(json.loads(Path(a.extra).read_text()))
    text = json.dumps(rep, indent=2, default=lambda x: None if isinstance(x, float) and math.isinf(x) else x)
    if a.report:
        Path(a.report).write_text(text.replace("-Infinity", "null") + "\n", encoding="utf-8")
    print(text.replace("-Infinity", "null"))
    return 0 if ok else 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("measure")
    m.add_argument("file")
    l = sub.add_parser("loudnorm-json")
    l.add_argument("stderr_file")
    c = sub.add_parser("check")
    c.add_argument("files", nargs="+")
    c.add_argument("--mode", choices=["music", "loop", "sfx"], required=True)
    c.add_argument("--lufs", type=float, default=-16.0)
    c.add_argument("--lufs-sfx", type=float)
    c.add_argument("--tp", type=float, default=-1.0)
    c.add_argument("--peak", type=float, default=-1.0)
    c.add_argument("--report")
    c.add_argument("--no-seam-ext", action="append", help="skip the loop seam gate for this extension")
    c.add_argument("--extra", help="JSON file merged into the report (e.g. loudnorm pass-2 stats)")
    c.add_argument("--master", help="the PCM master the outputs were encoded from (sfx ceiling gated on it)")
    a = ap.parse_args(argv)
    if a.cmd == "measure":
        print(json.dumps(measure(a.file), indent=2).replace("-Infinity", "null"))
        return 0
    if a.cmd == "loudnorm-json":
        print(json.dumps(loudnorm_json(Path(a.stderr_file).read_text())))
        return 0
    return check(a)


if __name__ == "__main__":
    sys.exit(main())
