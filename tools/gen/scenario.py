#!/usr/bin/env python3
"""Scenario REST custom-model generation (style / character LoRA) -> art/_raw/<asset>/vNN + manifest row.

  python tools/gen/scenario.py --template symbol.txt --symbol H1 --model-id model_XXXX \\
      [--size 2048] [--seed N] [--param guidance=3.5 --param numInferenceSteps=28] [--ref img.png] [--dry-run]

Calls (https://api.cloud.scenario.com/v1, HTTP Basic auth SCENARIO_API_KEY:SCENARIO_API_SECRET):
  POST /assets                        upload each --ref (base64 data URL) -> asset id
  POST /generate/custom/{modelId}     {prompt, numSamples, width, height, seed, ...--param}
  GET  /jobs/{jobId}                  poll until status success | failure | canceled
  GET  /assets/{assetId}              -> signed url, downloaded to raw.<ext>
Parameter names are model-specific: take them from the Scenario MCP's model discovery and pass
them with --param NAME=JSON. --price asks Scenario for the CU cost (?dryRun=true) without
generating; --dry-run prints the exact requests without any network call.

The LoRA id and dataset hash belong in the row's `version` (--lora-version). Only LoRAs trained
on Apache-2.0 bases (qwen-image, z-image, flux2-klein-4b-base) may be used (licenses/allowlist.json
'scenario' conditions); --base names the base and is licence-gated.
Exit codes: 0 ok/skipped, 2 usage, 3 licence refusal, 4 cost cap, 5 vendor failure.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import genlib  # noqa: E402
import provenance as prov  # noqa: E402

TOOL = "tools/gen/scenario.py"
ROUTE = "scenario"
API = "https://api.cloud.scenario.com/v1"
APACHE_BASES = {"qwen-image": "qwen-image-2512", "z-image": "z-image", "flux2-klein-4b-base": "flux2-klein-4b-base"}


class Api:
    def __init__(self, base: str, key: str | None, secret: str | None, project_id: str | None, dry: bool):
        self.base = base.rstrip("/")
        self.project_id = project_id
        self.dry = dry
        if not dry and not (key and secret):
            raise genlib.GenError("set SCENARIO_API_KEY and SCENARIO_API_SECRET (Scenario > API keys)")
        self.auth = "Basic " + base64.b64encode(f"{key}:{secret}".encode()).decode() if key else None
        self.log: list[dict] = []

    def url(self, path: str, query: dict | None = None) -> str:
        q = dict(query or {})
        if self.project_id:
            q["projectId"] = self.project_id
        return self.base + path + ("?" + urllib.parse.urlencode(q) if q else "")

    def call(self, method: str, path: str, body: dict | None = None, query: dict | None = None,
             redact: dict | None = None):
        url = self.url(path, query)
        self.log.append({"method": method, "url": url, "headers": {"Authorization": "Basic <redacted>",
                                                                    "Content-Type": "application/json"},
                         "body": redact if redact is not None else body})
        if self.dry:
            return None
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers={
            "Authorization": self.auth, "Content-Type": "application/json", "Accept": "application/json"})
        last = None
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    return json.loads(r.read().decode() or "{}")
            except urllib.error.HTTPError as e:
                msg = e.read().decode(errors="replace")[:1000]
                if e.code in (429, 500, 502, 503, 504) and attempt < 3:
                    last = f"HTTP {e.code}: {msg}"
                    time.sleep(2 ** attempt)
                    continue
                raise genlib.GenError(f"Scenario {method} {path}: HTTP {e.code}: {msg}", 5) from e
            except urllib.error.URLError as e:
                last = str(e)
                time.sleep(2 ** attempt)
        raise genlib.GenError(f"Scenario {method} {path}: {last}", 5)

    @staticmethod
    def fetch(url: str) -> tuple[bytes, str]:
        # urllib also opens file:// and ftp:// URLs: a vendor-supplied asset URL must be http(s)
        if urllib.parse.urlsplit(url).scheme not in ("http", "https"):
            raise genlib.GenError(f"refusing asset URL {url[:200]} (http/https only)", 5)
        with urllib.request.urlopen(url, timeout=300) as r:
            return r.read(), (r.headers.get("Content-Type") or "").split(";")[0].strip()


def parse_params(items) -> dict:
    out = {}
    for it in items or ():
        k, sep, v = it.partition("=")
        if not sep or not k:
            raise genlib.GenError(f"--param expects NAME=value, got {it!r}")
        try:
            out[k] = json.loads(v)
        except json.JSONDecodeError:
            out[k] = v
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="scenario.py", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    genlib.common_gen_args(ap)
    m = ap.add_argument_group("model")
    m.add_argument("--model-id", required=True, help="Scenario custom model id (your trained LoRA), e.g. model_abc123")
    m.add_argument("--base", required=True, choices=sorted(APACHE_BASES),
                   help="LoRA base family (licence-gated; Apache-2.0 bases only)")
    m.add_argument("--lora-version", default="", help="LoRA id + dataset hash, recorded in the row's version")
    m.add_argument("--size", type=int, default=2048, help="square output edge (<= 3840), default 2048")
    m.add_argument("--width", type=int)
    m.add_argument("--height", type=int)
    m.add_argument("--seed", type=int, help="default: derived from the prompt hash + asset (recorded)")
    m.add_argument("--num-samples", type=int, default=1)
    m.add_argument("--param", action="append", default=[], metavar="NAME=JSON", help="extra model parameter")
    m.add_argument("--ref", action="append", default=[], help="reference image uploaded as a Scenario asset")
    m.add_argument("--ref-param", default="referenceImages", help="body key that receives the uploaded asset ids")
    m.add_argument("--api-base", default=os.environ.get("SCENARIO_API_BASE", API))
    m.add_argument("--project-id", default=os.environ.get("SCENARIO_PROJECT_ID"))
    m.add_argument("--price", action="store_true", help="ask Scenario for the CU cost (?dryRun=true) and exit")
    m.add_argument("--max-cu", type=float, help="abort if the CU cost preview is higher")
    m.add_argument("--poll-interval", type=float, default=2.0)
    m.add_argument("--timeout", type=float, default=600.0)
    a = ap.parse_args(argv)
    try:
        return run(a)
    except genlib.GenError as e:
        print(f"error: {e}", file=sys.stderr)
        return e.code


def run(a) -> int:
    gate = genlib.gate(ROUTE, a.model_id)
    # the LoRA base is an open-weights model: it must be allowlisted and not denylisted
    allow = {e["id"]: e for e in genlib.load_json(genlib.ALLOWLIST_PATH)["entries"]}
    if APACHE_BASES[a.base] not in allow:
        raise genlib.GenError(f"REFUSED: LoRA base {a.base} not in licenses/allowlist.json", 3)
    for w in gate["warnings"]:
        print(f"warning: {w}", file=sys.stderr)
    width, height = a.width or a.size, a.height or a.size
    if max(width, height) > 3840 or min(width, height) < 256:
        raise genlib.GenError("width/height must be within 256..3840")
    prompt, phash, asset = genlib.prompt_from_args(a)
    refs = [Path(r) for r in a.ref]
    for r in refs:
        if not r.is_file():
            raise genlib.GenError(f"reference not found: {r}")
        genlib.mime_of(r)
    ref_hashes = [prov.sha256_file(r) for r in refs]
    seed = a.seed if a.seed is not None else genlib.seed_from(phash, asset)
    params = {"prompt": prompt, "numSamples": a.num_samples, "width": width, "height": height, "seed": seed,
              **parse_params(a.param)}
    request = {"route": ROUTE, "modelId": a.model_id, "base": a.base, "promptHash": phash, "refHashes": ref_hashes,
               "params": {k: v for k, v in params.items() if k != "prompt"}}
    job = genlib.RawJob(asset=asset, prompt=prompt, request=request, refs=a.ref, root=Path(a.out_root),
                        force_new=a.force_new, tool=TOOL)
    api = Api(a.api_base, os.environ.get("SCENARIO_API_KEY"), os.environ.get("SCENARIO_API_SECRET"),
              a.project_id, dry=a.dry_run)
    gen_path = f"/generate/custom/{urllib.parse.quote(a.model_id)}"

    if a.dry_run:
        for i, r in enumerate(refs):
            api.call("POST", "/assets", redact={"image": f"data:{genlib.mime_of(r)};base64,<{r.stat().st_size} bytes "
                                                         f"sha256 {ref_hashes[i][:12]}>", "name": r.name})
        body = dict(params)
        if refs:
            body[a.ref_param] = [f"<asset id of ref {i + 1}>" for i in range(len(refs))]
        api.call("POST", gen_path, body)
        api.call("GET", "/jobs/<jobId>")
        api.call("GET", "/assets/<assetId>")
        print(json.dumps({"dryRun": True, "gate": gate, "asset": asset, "rawDir": prov.rel(job.dir), "state": job.state,
                          "promptHash": phash, "fingerprint": job.fp, "seed": seed, "requests": api.log},
                         indent=2, ensure_ascii=False))
        return 0
    if job.state == "done" and not a.price:
        print(f"already generated: {prov.rel(job.dir)} (identical request; --force-new to regenerate)")
        return 0

    def cu_of(resp) -> float | None:
        for k in ("creativeUnitsCost", "cost", "creativeUnits"):
            v = (resp or {}).get(k)
            if isinstance(v, (int, float)):
                return float(v)
        return None

    body = dict(params)
    preview = api.call("POST", gen_path, body, query={"dryRun": "true"})
    cu = cu_of(preview)
    print(f"cost preview: {cu if cu is not None else '?'} CU", file=sys.stderr)
    if a.price:
        print(json.dumps({"creativeUnitsCost": cu, "response": preview}, indent=2))
        return 0
    if a.max_cu is not None and cu is None:
        # fail closed: an unparseable preview must not bypass the spending cap
        raise genlib.GenError(f"--max-cu {a.max_cu} set but the cost preview had no CU figure: "
                              f"{json.dumps(preview)[:300]}", 4)
    if a.max_cu is not None and cu > a.max_cu:
        raise genlib.GenError(f"cost {cu} CU exceeds --max-cu {a.max_cu}", 4)
    job.prepare({"apiBase": a.api_base, "seed": seed, "costPreviewCU": cu})
    if refs:
        ids = []
        for r in job.ref_targets:
            data = base64.b64encode(r.read_bytes()).decode()
            resp = api.call("POST", "/assets", {"image": f"data:{genlib.mime_of(r)};base64,{data}", "name": r.name},
                            redact={"image": "<base64>", "name": r.name})
            aid = (resp.get("asset") or {}).get("id")
            if not aid:
                raise genlib.GenError(f"asset upload returned no id: {json.dumps(resp)[:300]}", 5)
            ids.append(aid)
        body[a.ref_param] = ids
    created = api.call("POST", gen_path, body)
    jinfo = created.get("job") or {}
    job_id = jinfo.get("jobId") or jinfo.get("id")
    if not job_id:
        raise genlib.GenError(f"no jobId in response: {json.dumps(created)[:300]}", 5)
    cu = cu_of(created) or cu
    t0 = time.monotonic()
    while True:
        st = api.call("GET", f"/jobs/{urllib.parse.quote(job_id)}")
        jj = st.get("job") or {}
        status = str(jj.get("status", "")).lower()
        if status == "success":
            break
        if status in ("failure", "failed", "canceled", "cancelled"):
            job.write("job.json", json.dumps(st, indent=2) + "\n")
            raise genlib.GenError(f"Scenario job {job_id} ended with status {status}", 5)
        if time.monotonic() - t0 > a.timeout:
            raise genlib.GenError(f"Scenario job {job_id} timed out after {a.timeout:.0f} s (status {status})", 5)
        time.sleep(a.poll_interval)
    job.write("job.json", json.dumps({"create": created, "final": st}, indent=2) + "\n")
    asset_ids = (jj.get("metadata") or {}).get("assetIds") or []
    if not asset_ids:
        raise genlib.GenError(f"job {job_id} succeeded without assetIds", 5)
    rows = []
    for i, aid in enumerate(asset_ids):
        info = api.call("GET", f"/assets/{urllib.parse.quote(aid)}").get("asset") or {}
        if not info.get("url"):
            raise genlib.GenError(f"asset {aid} has no url", 5)
        data, ctype = Api.fetch(info["url"])
        if not data:
            raise genlib.GenError(f"empty download for asset {aid}", 5)
        mime = info.get("mimeType") or ctype or "image/png"
        out = job.write(("raw" if i == 0 else f"raw_{i + 1}") + genlib.EXT_BY_MIME.get(mime, ".png"), data)
        rows.append(job.row(
            out, i, stage=a.stage, route=ROUTE, vendor="Scenario", model=a.model_id,
            version=f"base={a.base}; {a.lora_version}".strip("; "), seed=seed, job_id=job_id, prompt_hash=phash,
            template=genlib.template_path(a.template), ref_hashes=ref_hashes, parents=[],
            plan_tier=a.plan_tier, tos_version=gate["tosVersion"], license_id=gate["licenseId"],
            cost={"amount": (cu or 0) if i == 0 else 0, "currency": "credits", "unit": "Scenario CU", "estimated": cu is None},
            notes=f"scenario asset {aid}; LoRA base {a.base} (Apache-2.0)"))
    added = job.record(rows, a.manifest)
    print(json.dumps({"rawDir": prov.rel(job.dir), "outputs": [r["path"] for r in rows], "jobId": job_id,
                      "creativeUnits": cu, "manifestRowsAdded": added}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
