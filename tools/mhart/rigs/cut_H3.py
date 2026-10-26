#!/usr/bin/env python3
"""sym_H3 parts: the owned-code vector layers (tools/mhart/rigs/cut_vector.py, the build.sh --cut entry point)."""
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import cut_vector  # noqa: E402

if __name__ == "__main__":
    sys.exit(cut_vector.main("H3"))
