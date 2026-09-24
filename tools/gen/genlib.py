#!/usr/bin/env python3
"""Shared generation library (stdlib only): prompt rendering, licence gate, raw-folder layout.

JS twin: tools/gen/lib/genlib.mjs. `test_gen.py` renders every template/section with both and
asserts byte-identical prompts and hashes, so either language may drive a vendor.

CLI (for humans and CI):
  python3 tools/gen/genlib.py render --template symbol.txt --symbol H1 [--rig-ready] [--var K=V ...] [--json]
  python3 tools/gen/genlib.py render --template background.txt#A
  python3 tools/gen/genlib.py gate --route vertex --model gemini-3-pro-image
  python3 tools/gen/genlib.py list-templates
"""
from __future__ import annotations

import argparse
import colorsys
import json
import re
import sys
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import provenance as prov  # noqa: E402

REPO = prov.REPO
BIBLE_PATH = REPO / "art" / "bible" / "artbible.json"
PROMPTS_DIR = REPO / "art" / "bible" / "prompts"
ALLOWLIST_PATH = REPO / "licenses" / "allowlist.json"
DENYLIST_PATH = REPO / "licenses" / "denylist.json"
TOS_DIR = REPO / "licenses" / "tos"
RAW_ROOT = REPO / "art" / "_raw"
TEMPLATE_VARS = HERE / "template-vars.json"
FORBIDDEN = HERE / "forbidden-words.json"

PLACEHOLDER = re.compile(r"\{([A-Z0-9_]+)\}")
SECTION = re.compile(r"^## SECTION ([A-Z0-9]+)\b")


class GenError(Exception):
    """User-facing failure (bad template, unfilled placeholder, licence refusal)."""

    def __init__(self, msg: str, code: int = 2):
        super().__init__(msg)
        self.code = code


def load_json(p: Path):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def bible() -> dict:
    return load_json(BIBLE_PATH)


# --------------------------------------------------------------------------- templates


def split_template_ref(ref: str) -> tuple[str, str | None]:
    """'symbol_parts_sheet.txt#C' -> ('symbol_parts_sheet.txt', 'C')."""
    name, _, section = ref.partition("#")
    if not name.endswith(".txt"):
        name += ".txt"
    return name, (section or None)


def template_sections(name: str) -> list[str]:
    text = (PROMPTS_DIR / name).read_text(encoding="utf-8")
    return [m.group(1) for line in text.splitlines() if (m := SECTION.match(line))]


def template_body(name: str, section: str | None) -> str:
    path = PROMPTS_DIR / name
    if not path.is_file():
        raise GenError(f"unknown template {name} (see {prov.rel(PROMPTS_DIR)})")
    sections = template_sections(name)
    if sections and section is None:
        raise GenError(f"{name} has sections {sections}: pick one as {name}#<X>")
    if section is not None and section not in sections:
        raise GenError(f"{name} has no SECTION {section} (has {sections or 'none'})")
    keep = section is None
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        m = SECTION.match(line)
        if m:
            keep = m.group(1) == section
            continue
        if line.startswith("#") or not keep:
            continue
        out.append(line)
    return "\n".join(out)


def placeholders(name: str, section: str | None) -> list[str]:
    return sorted(set(PLACEHOLDER.findall(template_body(name, section))))


def normalize(text: str) -> str:
    """Canonical whitespace (tools/gen/README.md): NFC, strip each line, collapse runs of
    spaces/tabs, drop blank lines, no trailing newline. promptHash = sha256(result)."""
    text = unicodedata.normalize("NFC", text)
    lines = [re.sub(r"[ \t]{2,}", " ", ln).strip() for ln in text.split("\n")]
    return "\n".join(ln for ln in lines if ln)


def forbidden_terms(b: dict) -> list[str]:
    child = b.get("mascots", {}).get("rules", {}).get("forbiddenPromptWords", [])
    brands = load_json(FORBIDDEN).get("brands", [])
    return [w.lower() for w in [*child, *brands]]


def check_forbidden(text: str, terms: list[str]) -> list[str]:
    low = text.lower()
    hits = []
    for t in terms:
        if re.search(r"(?<![a-z0-9])" + re.escape(t) + r"(?![a-z0-9])", low):
            hits.append(t)
    return hits


def render(ref: str, values: dict) -> tuple[str, str]:
    """Render template `ref` ('file.txt' or 'file.txt#X') with `values`. Returns (text, sha256)."""
    name, section = split_template_ref(ref)
    body = template_body(name, section)
    out = PLACEHOLDER.sub(lambda m: str(values[m.group(1)]) if m.group(1) in values else m.group(0), body)
    out = normalize(out)
    left = sorted(set(PLACEHOLDER.findall(out)))
    if left:
        raise GenError(f"{ref}: unfilled placeholder(s) {left}; pass --var NAME=value")
    if not out:
        raise GenError(f"{ref}: rendered prompt is empty")
    hits = check_forbidden(out, forbidden_terms(bible()))
    if hits:
        raise GenError(f"{ref}: forbidden word(s) in prompt: {hits}")
    return out, prov.sha256_text(out)


# --------------------------------------------------------------------------- bible context


CHILD_WORDS = ("kid", "child", "cute", "chibi", "baby")


def subject_from_brief(brief: str) -> str:
    """A bible brief -> prompt subject: drop a leading 'PROPOSAL (...):' tag, negated child-coded
    words ('not cute'), and any sentence
    that is an instruction to humans (live text / in code), lowercase a leading capital so it
    reads after 'Slot machine symbol of', and end with a period."""
    s = re.sub(r"^\s*PROPOSAL\s*(\([^)]*\))?\s*:\s*", "", brief.strip())
    # negated child-coded words ("attitude, not cute") still prime the model: drop the phrase
    s = re.sub(r"[,;]?\s*\bnot\s+(?:" + "|".join(CHILD_WORDS) + r")\b", "", s, flags=re.I)
    sentences = re.split(r"(?<=\.)\s+", s)
    keep = [x for x in sentences if not re.search(r"live text|in code|never painted", x, re.I)]
    s = " ".join(keep).strip()
    if len(s) > 1 and s[0].isupper() and s[1].islower():
        s = s[0].lower() + s[1:]
    if s and not s.endswith("."):
        s += "."
    return s


def hue_name(hex_: str) -> str:
    """Plain colour word for an enamel face hex (FACE_NAME), deterministic."""
    r, g, b = (int(hex_.lstrip("#")[i:i + 2], 16) / 255 for i in (0, 2, 4))
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    deg = h * 360
    if s < 0.15:
        return "grey" if 0.2 < l < 0.8 else ("black" if l <= 0.2 else "white")
    if deg < 15 or deg >= 345:
        name = "red"
    elif deg < 40:
        name = "orange" if l < 0.55 or s > 0.75 else "peach"
    elif deg < 70:
        name = "yellow"
    elif deg < 160:
        name = "green"
    elif deg < 200:
        name = "teal"
    elif deg < 260:
        name = "blue"
    elif deg < 300:
        name = "purple"
    else:
        name = "pink"
    if name == "orange" and l < 0.42:
        name = "amber brown"
    return name


FILL_KIND = {"royal": "royal", "high": "high", "wild": "special", "scatter": "special"}


def symbol_context(b: dict, sid: str, rig_ready: bool, tv: dict) -> dict:
    sym = b["symbols"].get(sid)
    if not sym or not isinstance(sym, dict) or "kind" not in sym:
        raise GenError(f"unknown symbol {sid!r} (artbible.symbols)")
    kind = sym["kind"]
    ctx = {
        "SYMBOL_NAME": sym["label"].lower(),
        "KEY_HEX": sym.get("keyHex", b["keyColors"]["default"]),
    }
    fill = b["cellFill"]["promptFillPctOfFrame"]
    ctx["FILL_PCT"] = str(fill[FILL_KIND.get(kind, "high")])
    if kind == "royal":
        ctx["GLYPH"] = sym["glyph"]
        ctx["FACE_HEX"] = sym["face"]
        ctx["FACE_NAME"] = hue_name(sym["face"])
        ctx["SUBJECT"] = subject_from_brief(b["symbols"]["royalsCommon"]["brief"].split(".")[0])
    else:
        ctx["SUBJECT"] = subject_from_brief(sym["brief"])
        ctx["PART_LIST"] = ", ".join(re.sub(r"\s*\(.*?\)", "", p).strip() for p in sym.get("rigParts", []))
    st = tv.get("symbol.txt", {})
    ctx["LIGHT_NOTE"] = st.get("negativeTiltLightNote", "") if sym.get("restAngle", 0) < 0 else ""
    ctx["RIG_READY_LINE"] = st.get("rigReadyLine", "") if rig_ready else ""
    return ctx


def mascot_context(b: dict, mid: str) -> dict:
    m = b["mascots"].get(mid)
    if not m or mid == "rules":
        raise GenError(f"unknown mascot {mid!r} (artbible.mascots)")
    return {
        "CHARACTER": subject_from_brief(m["brief"]).rstrip("."),
        "IDENTITY_LOCK": b["mascots"]["rules"]["identityLock"],
        "KEY_HEX": m.get("keyHex", b["keyColors"]["default"]),
    }


def build_values(ref: str, *, symbol: str | None = None, mascot: str | None = None, rig_ready: bool = False,
                 overrides: dict | None = None) -> dict:
    """Precedence (low -> high): bible globals < template-vars.json defaults < the asset's own
    bible context (symbol / mascot) < overrides; then 'choices' fill dependent placeholders."""
    b = bible()
    tv = load_json(TEMPLATE_VARS)
    name, _ = split_template_ref(ref)
    spec = tv.get(name, {})
    vals = {"STYLE_FORMULA": b["styleFormula"], "KEY_HEX": b["keyColors"]["default"]}
    vals.update(spec.get("defaults", {}))
    if symbol:
        vals.update(symbol_context(b, symbol, rig_ready, tv))
    if mascot:
        vals.update(mascot_context(b, mascot))
    vals.update(overrides or {})
    for k, ch in spec.get("choices", {}).items():
        if k not in (overrides or {}) and ch["by"] in vals:
            choice = ch["map"].get(str(vals[ch["by"]]))
            if choice is None:
                raise GenError(f"{name}: {ch['by']}={vals[ch['by']]!r} not in {sorted(ch['map'])}")
            vals[k] = choice
    return vals


def parse_vars(items) -> dict:
    out = {}
    for it in items or ():
        k, sep, v = it.partition("=")
        if not sep or not re.fullmatch(r"[A-Z0-9_]+", k):
            raise GenError(f"--var expects NAME=value with NAME in [A-Z0-9_], got {it!r}")
        out[k] = v
    return out


# --------------------------------------------------------------------------- licence gate

ROUTES = {
    # route -> (allowlist id or None=by model, vendor label, ToS folder slug)
    "higgsfield-cli": ("higgsfield", "Higgsfield", "higgsfield"),
    "higgsfield-mcp": ("higgsfield", "Higgsfield", "higgsfield"),
    "vertex": (None, "Google Cloud", "google-cloud"),
    "scenario": ("scenario", "Scenario", "scenario"),
    "elevenlabs": ("elevenlabs", "ElevenLabs", "elevenlabs"),
    "stability": ("stability-audio-api", "Stability AI", "stability"),
}

# Model families refused regardless of route (licenses/denylist.json, by family name, so a
# reseller's renamed id - 'openai_hazel', 'hunyuan_image_3' - is still caught).
FAMILY_DENY = [
    (r"gpt[-_ .]?image|(^|[^a-z])gpt[-_ .]?\d|openai|dall[-_ ]?e|(^|[^a-z])sora([^a-z]|$)|codex", "openai-gpt-image"),
    (r"hunyuan|hy[-_ ]?motion", "tencent-hunyuan"),
    (r"midjourney|(^|[^a-z])mj[-_ ]?v\d", "midjourney"),
    (r"flux[-_ .]?1[-_ .]?(fill[-_ .]?)?dev|flux[-_ .]?2[-_ .]?dev|klein[-_ .]?9b", "flux-dev-self-hosted"),
    (r"qwen[-_ .]?image[-_ .]?2[-_ .]?1", "qwen-image-2.1"),
    (r"ideogram[-_ .]?4", "ideogram-4-weights"),
    (r"(^|[^a-z])bria([^a-z]|$)|rmbg", "bria-rmbg-2.0"),
    (r"trellis", "trellis-2-default"),
    (r"matanyone|videomama|sam2matting|transpix", "video-matting-nc"),
    (r"musicgen|audiogen|mmaudio", "audio-nc-models"),
    (r"(^|[^a-z])suno([^a-z]|$)", "suno"),
    (r"(^|[^a-z])udio([^a-z]|$)", "udio"),
    (r"ace[-_ ]?step", "ace-step-shipped"),
    (r"stable[-_ ]?audio[-_ ]?3[-_ ]?(small|medium)", "stable-audio-3-open-over-1m"),
    (r"mirelo|sonilo", "higgsfield-audio"),
    (r"see[-_ ]?through", "see-through"),
]


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def denylist_hits(route: str, model: str, deny: dict | None = None) -> list[str]:
    deny = deny if deny is not None else load_json(DENYLIST_PATH)
    hits = []
    m_low = model.lower()
    for pat, did in FAMILY_DENY:
        if re.search(pat, m_low):
            hits.append(did)
    vendor = route.split("-")[0]
    nm = _norm(model)
    for e in deny.get("entries", []):
        for item in e.get("appliesTo", []):
            scope, sep, name = item.partition(":")
            if sep:
                if _norm(scope) != _norm(vendor):
                    continue
                target = name
            else:
                target = item
            t = _norm(re.sub(r"\(.*?\)", "", target))
            if len(t) >= 4 and len(nm) >= 4 and (nm.startswith(t) or t.startswith(nm)):
                hits.append(e["id"])
    return sorted(set(hits))


def gate(route: str, model: str) -> dict:
    """Licence gate for a vendor call. Raises GenError(code=3) on refusal."""
    if route not in ROUTES:
        raise GenError(f"unknown route {route!r} (known: {sorted(ROUTES)})", 3)
    allow = load_json(ALLOWLIST_PATH)
    hits = denylist_hits(route, model)
    if hits:
        raise GenError(f"REFUSED: {route}:{model} matches licenses/denylist.json {hits}", 3)
    lid, vendor, slug = ROUTES[route]
    entries = {e["id"]: e for e in allow["entries"]}
    if lid is None:
        cands = [e for e in allow["entries"] if model in e.get("modelIds", [])]
        if not cands:
            raise GenError(f"REFUSED: model {model!r} is not listed in any licenses/allowlist.json modelIds", 3)
        entry = cands[0]
    else:
        entry = entries.get(lid)
        if entry is None:
            raise GenError(f"REFUSED: allowlist entry {lid!r} missing from licenses/allowlist.json", 3)
        if entry.get("modelIds") and model not in entry["modelIds"]:
            raise GenError(f"REFUSED: {model!r} not in allowlist[{lid}].modelIds {entry['modelIds']}", 3)
    warnings = []
    if entry.get("clearance") != "cleared" and entry.get("clearance") != "not-required":
        warnings.append(f"clearance for '{entry['id']}' is '{entry.get('clearance')}': build now, but outputs "
                        f"cannot ship until licenses/clearances/ holds the written answer")
    tos = latest_tos(slug)
    if tos is None:
        warnings.append(f"no archived ToS under licenses/tos/{slug}/ (tosVersion will be null)")
    return {"licenseId": entry["id"], "vendor": vendor, "clearance": entry.get("clearance"), "tosVersion": tos,
            "warnings": warnings}


def latest_tos(slug: str) -> str | None:
    d = TOS_DIR / slug
    if not d.is_dir():
        return None
    pdfs = sorted(p for p in d.iterdir() if p.suffix.lower() == ".pdf")
    return prov.rel(pdfs[-1]) if pdfs else None


# --------------------------------------------------------------------------- raw folders


def canonical(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def fingerprint(request: dict) -> str:
    """Identity of a generation request (route, model, prompt hash, ref hashes, params)."""
    return prov.sha256_text(canonical(request))


def version_dirs(asset_dir: Path) -> list[Path]:
    if not asset_dir.is_dir():
        return []
    return sorted((p for p in asset_dir.iterdir() if p.is_dir() and re.fullmatch(r"v\d{2,}", p.name)),
                  key=lambda p: int(p.name[1:]))


def raw_outputs(vdir: Path) -> list[Path]:
    return sorted(p for p in vdir.glob("raw*") if p.is_file())


def allocate(asset: str, fp: str, root: Path = RAW_ROOT, force_new: bool = False) -> tuple[Path, str]:
    """Pick art/_raw/<asset>/vNN for a request. Returns (dir, state) with state:
    'done' (same request already produced raw output: skip, idempotent),
    'resume' (same request, no output yet), or 'new'."""
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", asset):
        raise GenError(f"asset name {asset!r} must match [A-Za-z0-9][A-Za-z0-9_.-]*")
    adir = root / asset
    vers = version_dirs(adir)
    if not force_new:
        for v in reversed(vers):
            args = v / "args.json"
            if args.is_file():
                try:
                    if load_json(args).get("fingerprint") == fp:
                        return v, ("done" if raw_outputs(v) else "resume")
                except json.JSONDecodeError:
                    pass
    n = int(vers[-1].name[1:]) + 1 if vers else 1
    return adir / f"v{n:02d}", "new"


def default_asset(ref: str, symbol: str | None, mascot: str | None, rig_ready: bool, extra: str | None = None) -> str:
    name, section = split_template_ref(ref)
    base = name[:-4]
    if symbol:
        stem = f"sym_{symbol}" + ("_rig" if rig_ready else "")
        return stem if base == "symbol" else f"{stem}_{base}" + (f"_{section}" if section else "")
    if mascot:
        return f"mascot_{mascot}_{base.removeprefix('mascot_')}" + (f"_{section}" if section else "") + (f"_{extra}" if extra else "")
    return base + (f"_{section}" if section else "") + (f"_{extra}" if extra else "")


def seed_from(*parts: str) -> int:
    """Deterministic 31-bit seed for vendors that accept one (recorded in the row)."""
    return int(prov.sha256_text("|".join(parts))[:8], 16) & 0x7FFFFFFF


class RawJob:
    """One generation request -> art/_raw/<asset>/vNN/{prompt.txt,args.json,refs/,job.json,raw.*}.

    args.json is written first, so a crashed or refused call leaves a 'resume' folder that the
    next identical request reuses instead of burning a new version number."""

    def __init__(self, *, asset: str, prompt: str, request: dict, refs: list[str], root: Path = RAW_ROOT,
                 force_new: bool = False, tool: str):
        self.prompt = prompt
        self.request = request
        self.tool = tool
        self.fp = fingerprint(request)
        self.dir, self.state = allocate(asset, self.fp, Path(root), force_new)
        self.asset = asset
        self.refs = [Path(r) for r in refs]
        self.ref_targets = [self.dir / "refs" / f"{i + 1:02d}_{p.name}" for i, p in enumerate(self.refs)]

    @classmethod
    def existing(cls, vdir: Path, asset: str, tool: str) -> "RawJob":
        """Re-open a staged folder (Batch API collection)."""
        job = cls.__new__(cls)
        job.dir, job.asset, job.tool, job.state = Path(vdir), asset, tool, "resume"
        return job

    def prepare(self, extra: dict | None = None) -> None:
        (self.dir / "refs").mkdir(parents=True, exist_ok=True)
        (self.dir / "args.json").write_text(json.dumps(
            {"tool": self.tool, "fingerprint": self.fp, "request": self.request, **(extra or {})},
            indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        for src, dst in zip(self.refs, self.ref_targets):
            dst.write_bytes(src.read_bytes())
        (self.dir / "prompt.txt").write_text(self.prompt, encoding="utf-8")

    def write(self, name: str, data: bytes | str) -> Path:
        p = self.dir / name
        if isinstance(data, str):
            p.write_text(data, encoding="utf-8")
        else:
            p.write_bytes(data)
        return p

    def row(self, out: Path, index: int, **kw) -> dict:
        return prov.make_row(
            id=prov.safe_id(self.asset, "raw", self.dir.name, str(index + 1) if index else ""),
            path=prov.rel(out), sha256=prov.sha256_file(out), prompt_path=prov.rel(self.dir / "prompt.txt"), **kw)

    def record(self, rows: list[dict], manifest) -> int:
        return prov.record(rows, sidecar=self.dir / "manifest.json", manifest=manifest, generated_by=self.tool)


EXT_BY_MIME = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "video/mp4": ".mp4",
               "audio/wav": ".wav", "audio/mpeg": ".mp3"}


def mime_of(path: Path) -> str:
    b = Path(path).read_bytes()[:12]
    if b.startswith(b"\x89PNG"):
        return "image/png"
    if b[:2] == b"\xff\xd8":
        return "image/jpeg"
    if b[:4] == b"RIFF" and b[8:12] == b"WEBP":
        return "image/webp"
    raise GenError(f"{path}: reference must be PNG, JPEG or WebP")


def common_gen_args(ap: argparse.ArgumentParser) -> None:
    """Flags shared by nbp.py and scenario.py."""
    g = ap.add_argument_group("prompt (rendered from art/bible; never hand-written)")
    g.add_argument("--template", required=True, help="e.g. symbol.txt or mascot_turnaround.txt#B")
    g.add_argument("--symbol", help="symbol context (H1..H4, L1..L5, W, S)")
    g.add_argument("--mascot", help="mascot context (gumbo, croak)")
    g.add_argument("--rig-ready", action="store_true", help="add the rig-ready master line")
    g.add_argument("--var", action="append", default=[], metavar="NAME=value", help="fill/override a placeholder")
    o = ap.add_argument_group("output / provenance")
    o.add_argument("--asset", help="raw folder name (default derived, e.g. sym_H1)")
    o.add_argument("--out-root", default=str(RAW_ROOT), help="default art/_raw")
    o.add_argument("--manifest", default=str(prov.MANIFEST), help="default art/manifest.json ('none' to skip)")
    o.add_argument("--stage", default="2d-image", help="manifest stage (default 2d-image)")
    o.add_argument("--plan-tier", help="account plan recorded in the row")
    o.add_argument("--force-new", action="store_true", help="new vNN even for an identical finished request")
    o.add_argument("--dry-run", action="store_true", help="print the exact request; no network, no files")


def prompt_from_args(a) -> tuple[str, str, str]:
    """(prompt, promptHash, asset) from the shared flags."""
    vals = build_values(a.template, symbol=a.symbol, mascot=a.mascot, rig_ready=a.rig_ready,
                        overrides=parse_vars(a.var))
    text, h = render(a.template, vals)
    asset = a.asset or default_asset(a.template, a.symbol, a.mascot, a.rig_ready)
    return text, h, asset


# --------------------------------------------------------------------------- CLI


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("render", help="render a prompt template from the art bible")
    r.add_argument("--template", required=True, help="e.g. symbol.txt or symbol_parts_sheet.txt#C")
    r.add_argument("--symbol")
    r.add_argument("--mascot")
    r.add_argument("--rig-ready", action="store_true")
    r.add_argument("--var", action="append", default=[], metavar="NAME=value")
    r.add_argument("--json", action="store_true", help="print {prompt, promptHash, template, values}")
    g = sub.add_parser("gate", help="licence gate for a route/model")
    g.add_argument("--route", required=True, choices=sorted(ROUTES))
    g.add_argument("--model", required=True)
    sub.add_parser("list-templates")
    a = ap.parse_args(argv)
    try:
        if a.cmd == "render":
            vals = build_values(a.template, symbol=a.symbol, mascot=a.mascot, rig_ready=a.rig_ready,
                                overrides=parse_vars(a.var))
            text, h = render(a.template, vals)
            if a.json:
                print(json.dumps({"template": a.template, "prompt": text, "promptHash": h}, ensure_ascii=False, indent=2))
            else:
                print(text)
        elif a.cmd == "gate":
            print(json.dumps(gate(a.route, a.model), indent=2))
        else:
            for p in sorted(PROMPTS_DIR.glob("*.txt")):
                secs = template_sections(p.name)
                for s in secs or [None]:
                    ref = p.name + (f"#{s}" if s else "")
                    print(f"{ref:34s} {' '.join(placeholders(p.name, s))}")
    except GenError as e:
        print(f"error: {e}", file=sys.stderr)
        return e.code
    return 0


if __name__ == "__main__":
    sys.exit(main())
