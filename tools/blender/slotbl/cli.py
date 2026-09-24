"""Command-line plumbing shared by every tools/blender script (no bpy import).

Every script must run both ways:
    blender -b --factory-startup --python-exit-code 1 -P tools/blender/<x>.py -- <args>
    python tools/blender/<x>.py <args>          # bpy-as-a-module (pip install bpy==5.2.2)

`script_argv()` returns the script's own arguments in both cases, and `run()` turns
exceptions into a non-zero exit code (Blender itself would exit 0 on a Python error
unless `--python-exit-code` is passed).
"""
from __future__ import annotations

import os
import sys
import time
import traceback
from pathlib import Path

TOOLS_BLENDER = Path(__file__).resolve().parent.parent


def find_repo_root(start: Path | None = None) -> Path:
    p = (start or TOOLS_BLENDER).resolve()
    for cand in [p, *p.parents]:
        if (cand / "package.json").is_file() and (cand / "art").is_dir():
            return cand
    return TOOLS_BLENDER.parents[1]


REPO = find_repo_root()


def script_argv(argv: list[str] | None = None) -> list[str]:
    """Arguments meant for the script.

    - `blender ... -P x.py -- a b`  -> [a, b]
    - `python x.py a b`             -> [a, b]   (argv[0] is the script path)
    - `python x.py -- a b`          -> [a, b]
    - `blender -b -P x.py`          -> []       (Blender's own flags are never parsed)
    """
    argv = list(sys.argv if argv is None else argv)
    if "--" in argv:
        return argv[argv.index("--") + 1:]
    if argv and argv[0].endswith(".py"):
        return argv[1:]
    return []


class Log:
    def __init__(self, tag: str):
        self.tag = tag
        self.t0 = time.time()
        self.warnings: list[str] = []

    def __call__(self, *parts) -> None:
        print(f"[{self.tag}]", *parts, flush=True)

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)
        print(f"[{self.tag}] WARNING: {msg}", flush=True)

    def error(self, msg: str) -> None:
        print(f"[{self.tag}] ERROR: {msg}", file=sys.stderr, flush=True)

    def elapsed(self) -> float:
        return time.time() - self.t0


class ToolError(RuntimeError):
    """Expected failure with a user-facing message (exit code 1, no traceback)."""

    def __init__(self, msg: str, code: int = 1):
        super().__init__(msg)
        self.code = code


class GateFailure(ToolError):
    """Outputs were written but an automated QA/budget gate failed (exit code 3)."""

    def __init__(self, msg: str):
        super().__init__(msg, code=3)


def run(main, argv: list[str] | None = None) -> None:
    """Call main(script_args) and exit with its code. Never returns."""
    try:
        rc = main(script_argv(argv))
    except SystemExit as e:  # argparse --help (0) / usage error (2)
        rc = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
    except ToolError as e:
        print(f"ERROR: {e}", file=sys.stderr, flush=True)
        rc = e.code
    except KeyboardInterrupt:
        rc = 130
    except Exception:  # noqa: BLE001 - report everything, exit non-zero
        traceback.print_exc()
        rc = 1
    sys.stdout.flush()
    sys.stderr.flush()
    # os._exit would skip Blender's cleanup; sys.exit makes both `blender -b -P` and
    # plain python exit with this code.
    sys.exit(int(rc or 0))


def rel(path: str | os.PathLike) -> str:
    """Repo-relative POSIX path when inside the repo, else the absolute path."""
    p = Path(path).resolve()
    try:
        return p.relative_to(REPO).as_posix()
    except ValueError:
        return p.as_posix()


def repo_path(p: str | os.PathLike) -> Path:
    """Resolve a user path: absolute stays, relative is taken from the CWD if it exists there,
    else from the repo root (so `npm run` from any folder works)."""
    q = Path(p)
    if q.is_absolute():
        return q
    if (Path.cwd() / q).exists() or not (REPO / q).exists():
        return (Path.cwd() / q).resolve()
    return (REPO / q).resolve()


def out_path(p: str | os.PathLike) -> Path:
    """Output paths: absolute stays; relative is relative to the repo root (deterministic
    regardless of CWD)."""
    q = Path(p)
    return q if q.is_absolute() else (REPO / q).resolve()


def bpy_available() -> bool:
    try:
        import bpy  # noqa: F401
        return True
    except Exception:  # noqa: BLE001
        return False
