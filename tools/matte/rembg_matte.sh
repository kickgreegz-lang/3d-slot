#!/usr/bin/env bash
# rembg_matte.sh MODEL IN.png OUT.png - guarded wrapper for the OPTIONAL model-matting path.
#
# rembg's DEFAULT model is BRIA RMBG-2.0 (CC BY-NC 4.0, licenses/denylist.json 'bria-rmbg-2.0'):
# it is used silently whenever -m is omitted. This wrapper only runs allowlisted models
# (licenses/allowlist.json 'birefnet-rembg') and always passes -m explicitly, with -dc (colour
# decontamination). Follow it with the canvas fit + gates:
#   tools/matte/outline_matte.py IN.png OUT_canvas.png --alpha-from OUT.png --key <KEY_HEX> --symbol H1
# ToonOut (MIT BiRefNet fine-tune for cel art, HF joelseytre/toonout) is not a rembg model name:
# run its BiRefNet inference script, then feed its RGBA the same way with --alpha-from.
# Install (tools/.venv): pip install "rembg[cli]==2.0.85"   (add [gpu] on the workstation)
set -euo pipefail
# licenses/allowlist.json 'birefnet-rembg' conditions name exactly these two; isnet-anime is not allowlisted
# (docs/research/frontend-decisions.md: it deletes objects)
ALLOWED="birefnet-general birefnet-general-lite"
usage() { sed -n 2,11p "$0" | sed 's/^# \{0,1\}//'; echo "Allowed models: $ALLOWED"; }
if [ "${1:-}" = -h ] || [ "${1:-}" = --help ]; then usage; exit 0; fi
if [ $# -lt 3 ]; then usage >&2; exit 2; fi
MODEL=$1; IN=$2; OUT=$3
case " $ALLOWED " in
  *" $MODEL "*) ;;
  *) echo "error: model '$MODEL' refused. Allowed: $ALLOWED (never rembg's default bria-rmbg / RMBG-2.0)" >&2; exit 3;;
esac
[ -f "$IN" ] || { echo "error: input not found: $IN" >&2; exit 2; }
command -v rembg >/dev/null 2>&1 || { echo "error: rembg not installed (pip install 'rembg[cli]==2.0.85')" >&2; exit 2; }
mkdir -p "$(dirname "$OUT")"
rembg i -m "$MODEL" -dc "$IN" "$OUT"
echo "$OUT (rembg -m $MODEL -dc)"
