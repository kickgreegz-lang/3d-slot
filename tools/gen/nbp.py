#!/usr/bin/env python3
"""Nano Banana Pro on Vertex AI (google-genai) -> art/_raw/<asset>/vNN + manifest row.

Model ids are licence-gated against licenses/allowlist.json modelIds (GA 'gemini-3-pro-image';
the '-preview' id is refused). Up to 14 reference images, image_size 1K/2K/4K, no seed, no alpha.

Sync call:
  python tools/gen/nbp.py --template symbol.txt --symbol H1 --ref art/source/refs/style/01.png \\
      --image-size 2K --aspect-ratio 1:1 [--project P --location global] [--dry-run]
Batch API (~50% price):
  nbp.py --template ... --batch-jsonl build/nbp/batch.jsonl   # stage a request (raw folder + JSONL line)
  nbp.py batch-submit --src gs://B/in/batch.jsonl --dest gs://B/out/ [--dry-run]   (after gsutil cp)
  nbp.py batch-collect --jsonl build/nbp/batch.jsonl --results predictions.jsonl  (downloaded output)

Auth: Application Default Credentials (gcloud auth application-default login) and
GOOGLE_CLOUD_PROJECT / GOOGLE_CLOUD_LOCATION (or --project/--location). Exit codes: 0 ok/skipped,
2 usage, 3 licence refusal, 5 vendor failure.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import genlib  # noqa: E402
import provenance as prov  # noqa: E402

TOOL = "tools/gen/nbp.py"
ROUTE = "vertex"
ASPECTS = ["1:1", "3:2", "2:3", "4:3", "3:4", "4:5", "5:4", "9:16", "16:9", "21:9"]
SIZES = ["1K", "2K", "4K"]
MAX_REFS = 14
# USD per output image (Vertex pricing page, verified 2026-09-24); Batch API = 50%.
PRICE = {"gemini-3-pro-image": {"1K": 0.134, "2K": 0.134, "4K": 0.24},
         "gemini-3.1-flash-image": {"1K": 0.067, "2K": 0.101, "4K": 0.15}}


def price(model: str, size: str, batch: bool) -> float | None:
    p = PRICE.get(model, {}).get(size)
    return None if p is None else round(p * (0.5 if batch else 1.0), 4)


def build_config(aspect: str, size: str):
    from google.genai import types
    return types.GenerateContentConfig(
        response_modalities=["IMAGE"],
        image_config=types.ImageConfig(aspect_ratio=aspect, image_size=size),
    )


def build_contents(prompt: str, refs: list[Path]):
    from google.genai import types
    parts = [types.Part.from_text(text=prompt)]
    for r in refs:
        parts.append(types.Part.from_bytes(data=r.read_bytes(), mime_type=genlib.mime_of(r)))
    return [types.Content(role="user", parts=parts)]


def describe_contents(prompt: str, refs: list[Path]) -> list:
    """Printable form of the request contents (reference bytes replaced by hash/size)."""
    out = [{"text": prompt}]
    for r in refs:
        out.append({"inlineData": {"mimeType": genlib.mime_of(r), "sha256": prov.sha256_file(r),
                                   "bytes": r.stat().st_size, "path": prov.rel(r)}})
    return [{"role": "user", "parts": out}]


def label(v: str) -> str:
    """Vertex label value: lowercase [a-z0-9_-], <= 63 chars."""
    return re.sub(r"[^a-z0-9_-]", "_", v.lower())[:63]


def batch_line(labels: dict, prompt: str, refs: list[Path], aspect: str, size: str) -> dict:
    """Vertex batch-prediction input line: {"request": GenerateContentRequest}. The raw folder is
    identified by request.labels (echoed back in the output) with a prompt-hash fallback."""
    parts = [{"text": prompt}] + [
        {"inlineData": {"mimeType": genlib.mime_of(r), "data": base64.b64encode(r.read_bytes()).decode()}}
        for r in refs]
    return {"request": {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": aspect, "imageSize": size}},
        "labels": labels}}


def index_path(jsonl: Path) -> Path:
    return jsonl.with_name(jsonl.name + ".index.json")


def require_sdk() -> None:
    """Real calls need google-genai (tools/requirements.txt); --dry-run works without it."""
    try:
        import google.genai  # noqa: F401
    except ImportError as e:
        raise genlib.GenError("google-genai is not installed in this Python: use tools/.venv/bin/python "
                              "(pip install -r tools/requirements.txt), or --dry-run") from e


def client(project: str | None, location: str):
    require_sdk()
    from google import genai
    project = project or os.environ.get("GOOGLE_CLOUD_PROJECT")
    if not project:
        raise genlib.GenError("set --project or GOOGLE_CLOUD_PROJECT (Vertex AI, ADC credentials)")
    return genai.Client(vertexai=True, project=project, location=location)


def images_from_response(resp) -> list[tuple[bytes, str]]:
    out = []
    cands = getattr(resp, "candidates", None) or []
    for c in cands:
        fr = str(getattr(c, "finish_reason", "") or "")
        for part in (getattr(getattr(c, "content", None), "parts", None) or []):
            inline = getattr(part, "inline_data", None)
            if inline is not None and inline.data:
                out.append((inline.data, inline.mime_type or "image/png"))
        if not out and fr and "STOP" not in fr:
            raise genlib.GenError(f"no image returned (finish_reason={fr})", 5)
    if not out:
        fb = getattr(resp, "prompt_feedback", None)
        raise genlib.GenError(f"no image in response (prompt_feedback={fb})", 5)
    return out


def images_from_prediction(line: dict) -> list[tuple[bytes, str]]:
    resp = line.get("response") or {}
    out = []
    for c in resp.get("candidates", []):
        for part in (c.get("content") or {}).get("parts", []):
            inl = part.get("inlineData") or part.get("inline_data")
            if inl and inl.get("data"):
                out.append((base64.b64decode(inl["data"]), inl.get("mimeType") or inl.get("mime_type") or "image/png"))
    if not out:
        raise genlib.GenError(f"prediction without image: status={line.get('status')!r}", 5)
    return out


def row_kwargs(a, gate: dict, prompt_hash: str, ref_hashes: list[str], cost: float | None, job_id, batch: bool) -> dict:
    return dict(stage=a.stage, route=ROUTE, vendor="Google Cloud", model=a.model,
                version=f"google-genai {genai_version()}; image_size={a.image_size}", seed=None, job_id=job_id,
                prompt_hash=prompt_hash, template=genlib.template_path(a.template) if a.template else None, ref_hashes=ref_hashes,
                parents=[], plan_tier=a.plan_tier or "Vertex pay-as-you-go", tos_version=gate["tosVersion"],
                license_id=gate["licenseId"],
                cost={"amount": cost or 0, "currency": "USD", "unit": "per image" + (" (batch 50%)" if batch else ""),
                      "estimated": True},
                notes="SynthID + C2PA embedded by Google; no alpha (matte downstream)")


def genai_version() -> str:
    try:
        from google.genai import version
        return version.__version__
    except Exception:  # noqa: BLE001 - dry-run on a machine without the SDK
        return "not-installed"


def cmd_generate(a) -> int:
    if a.aspect_ratio not in ASPECTS:
        raise genlib.GenError(f"--aspect-ratio must be one of {ASPECTS}")
    if a.image_size not in SIZES:
        raise genlib.GenError(f"--image-size must be one of {SIZES}")
    if len(a.ref) > MAX_REFS:
        raise genlib.GenError(f"at most {MAX_REFS} reference images (got {len(a.ref)})")
    gate = genlib.gate(ROUTE, a.model)
    for w in gate["warnings"]:
        print(f"warning: {w}", file=sys.stderr)
    prompt, phash, asset = genlib.prompt_from_args(a)
    refs = [Path(r) for r in a.ref]
    for r in refs:
        if not r.is_file():
            raise genlib.GenError(f"reference not found: {r}")
    ref_hashes = [prov.sha256_file(r) for r in refs]
    batch = bool(a.batch_jsonl)
    request = {"route": ROUTE, "model": a.model, "promptHash": phash, "refHashes": ref_hashes,
               "imageSize": a.image_size, "aspectRatio": a.aspect_ratio, "batch": batch}
    job = genlib.RawJob(asset=asset, prompt=prompt, request=request, refs=a.ref, root=Path(a.out_root),
                        force_new=a.force_new, tool=TOOL)
    est = price(a.model, a.image_size, batch)
    if a.dry_run:
        req = {"endpoint": f"Vertex AI projects/{a.project or os.environ.get('GOOGLE_CLOUD_PROJECT', '<GOOGLE_CLOUD_PROJECT>')}"
                           f"/locations/{a.location}/publishers/google/models/{a.model}:generateContent",
               "model": a.model, "contents": describe_contents(prompt, refs),
               "config": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": a.aspect_ratio, "imageSize": a.image_size}}}
        try:  # validate the request with the SDK's own pydantic types when it is installed
            build_config(a.aspect_ratio, a.image_size)
            build_contents(prompt, refs)
            req["sdkValidated"] = f"google-genai {genai_version()}"
        except ImportError:
            req["sdkValidated"] = False
        out = {"dryRun": True, "gate": gate, "asset": asset, "rawDir": prov.rel(job.dir), "state": job.state,
               "promptHash": phash, "fingerprint": job.fp, "estimatedCostUSD": est, "prompt": prompt, "request": req}
        if batch:
            line = batch_line({"asset": label(asset), "version": job.dir.name}, prompt, refs,
                              a.aspect_ratio, a.image_size)
            for part in line["request"]["contents"][0]["parts"]:
                if "inlineData" in part:
                    part["inlineData"]["data"] = f"<{len(part['inlineData']['data'])} base64 chars>"
            out["batchJsonlLine"] = line
            out["batchJsonl"] = a.batch_jsonl
        print(json.dumps(out, indent=2, ensure_ascii=False))
        return 0
    if job.state == "done":
        print(f"already generated: {prov.rel(job.dir)} (identical request; --force-new to regenerate)")
        return 0
    if not batch:
        require_sdk()   # before any file is written
    job.prepare({"price": est, "sdk": genai_version()})
    if batch:
        key = f"{asset}/{job.dir.name}"
        labels = {"asset": label(asset), "version": job.dir.name}
        line = batch_line(labels, prompt, job.ref_targets, a.aspect_ratio, a.image_size)
        jl = Path(a.batch_jsonl)
        jl.parent.mkdir(parents=True, exist_ok=True)
        idx = json.loads(index_path(jl).read_text(encoding="utf-8")) if index_path(jl).exists() else {}
        if key not in idx:
            with jl.open("a", encoding="utf-8") as f:
                f.write(json.dumps(line, ensure_ascii=False) + "\n")
            idx[key] = {"labels": labels, "promptHash": phash, "rawDir": prov.rel(job.dir), "template": a.template}
            index_path(jl).write_text(json.dumps(idx, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        job.write("batch.json", json.dumps({"key": key, "jsonl": prov.rel(jl), "state": "staged"}, indent=2) + "\n")
        print(json.dumps({"staged": key, "rawDir": prov.rel(job.dir), "jsonl": prov.rel(jl)}, indent=2))
        return 0
    require_sdk()
    from google.genai import errors as gerr
    c = client(a.project, a.location)
    try:
        resp = c.models.generate_content(model=a.model, contents=build_contents(prompt, job.ref_targets),
                                         config=build_config(a.aspect_ratio, a.image_size))
    except gerr.APIError as e:
        raise genlib.GenError(f"Vertex error {getattr(e, 'code', '?')}: {e}", 5) from e
    meta = {"response_id": getattr(resp, "response_id", None), "model_version": getattr(resp, "model_version", None),
            "usage": resp.usage_metadata.model_dump(mode="json") if getattr(resp, "usage_metadata", None) else None}
    job.write("job.json", json.dumps(meta, indent=2) + "\n")
    rows = []
    for i, (data, mime) in enumerate(images_from_response(resp)):
        out = job.write(("raw" if i == 0 else f"raw_{i + 1}") + genlib.EXT_BY_MIME.get(mime, ".png"), data)
        rows.append(job.row(out, i, **row_kwargs(a, gate, phash, ref_hashes, est if i == 0 else 0,
                                                  meta["response_id"], False)))
    added = job.record(rows, a.manifest)
    print(json.dumps({"rawDir": prov.rel(job.dir), "outputs": [r["path"] for r in rows], "manifestRowsAdded": added}, indent=2))
    return 0


def cmd_batch_submit(a) -> int:
    gate = genlib.gate(ROUTE, a.model)
    req = {"model": a.model, "src": a.src, "config": {"dest": a.dest, "display_name": a.display_name}}
    if a.dry_run:
        print(json.dumps({"dryRun": True, "gate": gate, "batches.create": req,
                          "upload": f"gsutil cp {a.jsonl or '<batch.jsonl>'} {a.src}"}, indent=2))
        return 0
    require_sdk()
    from google.genai import types
    c = client(a.project, a.location)
    job = c.batches.create(model=a.model, src=a.src,
                           config=types.CreateBatchJobConfig(dest=a.dest, display_name=a.display_name))
    print(json.dumps({"name": job.name, "state": str(job.state)}, indent=2))
    return 0


def cmd_batch_collect(a) -> int:
    """Match downloaded predictions to their staged raw folders (by request.labels, else prompt hash)."""
    idx = json.loads(index_path(Path(a.jsonl)).read_text(encoding="utf-8"))
    by_labels = {(v["labels"]["asset"], v["labels"]["version"]): k for k, v in idx.items()}
    by_hash = {v["promptHash"]: k for k, v in idx.items()}
    root = Path(a.out_root)
    total = 0
    for line in Path(a.results).read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        pred = json.loads(line)
        req = pred.get("request") or {}
        labels = req.get("labels") or {}
        key = by_labels.get((labels.get("asset"), labels.get("version")))
        if key is None:
            try:
                key = by_hash.get(prov.sha256_text(req["contents"][0]["parts"][0]["text"]))
            except (KeyError, IndexError, TypeError):
                key = None
        if key is None:
            print("warning: prediction without a matching staged request skipped", file=sys.stderr)
            continue
        asset, ver = key.split("/")
        vdir = root / asset / ver
        args = json.loads((vdir / "args.json").read_text(encoding="utf-8"))
        rq = args["request"]
        ns = argparse.Namespace(stage=a.stage, model=rq["model"], image_size=rq["imageSize"],
                                template=a.template or idx[key].get("template"), plan_tier=a.plan_tier)
        gate = genlib.gate(ROUTE, rq["model"])
        job = genlib.RawJob.existing(vdir, asset, TOOL)
        rows = []
        for i, (data, mime) in enumerate(images_from_prediction(pred)):
            out = job.write(("raw" if i == 0 else f"raw_{i + 1}") + genlib.EXT_BY_MIME.get(mime, ".png"), data)
            rows.append(job.row(out, i, **row_kwargs(ns, gate, rq["promptHash"], rq["refHashes"],
                                                      price(rq["model"], rq["imageSize"], True) if i == 0 else 0,
                                                      a.job, True)))
        job.write("job.json", json.dumps({"batchJob": a.job, "key": key}, indent=2) + "\n")
        total += job.record(rows, a.manifest)
    print(json.dumps({"manifestRowsAdded": total}, indent=2))
    return 0


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] in ("batch-submit", "batch-collect"):
        ap = argparse.ArgumentParser(prog=f"nbp.py {argv[0]}", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
        ap.add_argument("--model", default="gemini-3-pro-image")
        ap.add_argument("--project")
        ap.add_argument("--location", default=os.environ.get("GOOGLE_CLOUD_LOCATION", "global"))
        ap.add_argument("--dry-run", action="store_true")
        ap.add_argument("--jsonl", help="staged batch JSONL (from --batch-jsonl)")
        if argv[0] == "batch-submit":
            ap.add_argument("--src", required=True, help="gs://.../batch.jsonl (uploaded)")
            ap.add_argument("--dest", required=True, help="gs://.../out/")
            ap.add_argument("--display-name", default="swamp-funk-nbp")
            a = ap.parse_args(argv[1:])
            fn = cmd_batch_submit
        else:
            ap.add_argument("--results", required=True, help="downloaded predictions JSONL")
            ap.add_argument("--job", help="batch job name (recorded as jobId)")
            ap.add_argument("--template", help="template recorded in the rows (default: the one recorded when staging)")
            ap.add_argument("--out-root", default=str(genlib.RAW_ROOT))
            ap.add_argument("--manifest", default=str(prov.MANIFEST))
            ap.add_argument("--stage", default="2d-image")
            ap.add_argument("--plan-tier", default="Vertex batch")
            a = ap.parse_args(argv[1:])
            if not a.jsonl:
                ap.error("--jsonl is required")
            fn = cmd_batch_collect
    else:
        ap = argparse.ArgumentParser(prog="nbp.py", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
        genlib.common_gen_args(ap)
        m = ap.add_argument_group("model")
        m.add_argument("--model", default="gemini-3-pro-image", help="GA id; must be in allowlist modelIds")
        m.add_argument("--ref", action="append", default=[], help=f"reference image (repeatable, <= {MAX_REFS})")
        m.add_argument("--image-size", default="2K", help="1K | 2K | 4K (4K for backgrounds / sheets)")
        m.add_argument("--aspect-ratio", default="1:1", help=" | ".join(ASPECTS))
        m.add_argument("--project")
        m.add_argument("--location", default=os.environ.get("GOOGLE_CLOUD_LOCATION", "global"))
        m.add_argument("--batch-jsonl", help="stage for the Batch API instead of calling now")
        a = ap.parse_args(argv)
        fn = cmd_generate
    try:
        return fn(a)
    except genlib.GenError as e:
        print(f"error: {e}", file=sys.stderr)
        return e.code


if __name__ == "__main__":
    sys.exit(main())
