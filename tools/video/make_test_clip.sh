#!/usr/bin/env bash
# make_test_clip.sh OUT.mp4 [KEY_HEX=00FF00] [SECONDS=2] [FPS=25]
# Synthetic stand-in for an AI key-colour clip (tests only): a black-outlined orange disc with a
# white specular dot circling on a flat key colour, drawn at 2x and area-downscaled (anti-aliased
# edges), encoded as H.264 yuv420p like a vendor MP4 (so chroma subsampling fringes are real).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ "${1:-}" = -h ] || [ "${1:-}" = --help ] && { sed -n 2,5p "$0"; exit 0; }
[ $# -ge 1 ] || { sed -n 2,5p "$0" >&2; exit 2; }
OUT=$1; KEY=${2:-00FF00}; SEC=${3:-2}; FPS=${4:-25}
FF_NEEDS="color geq overlay scale libx264"
# shellcheck source=ffenv.sh
source "$HERE/ffenv.sh" || exit 2
mkdir -p "$(dirname "$OUT")"
"$FF" -hide_banner -loglevel error -nostdin -y \
  -f lavfi -i "color=c=0x$KEY:s=640x480:r=$FPS:d=$SEC" \
  -f lavfi -i "color=c=black:s=160x160:r=$FPS:d=$SEC" \
  -f lavfi -i "color=c=black:s=160x160:r=$FPS:d=$SEC" \
  -filter_complex "\
[1:v]format=rgba,geq=r=0:g=0:b=0:a='if(lte(hypot(X-80\,Y-80)\,78)\,255\,0)'[ol];\
[2:v]format=rgba,geq=r='if(lte(hypot(X-58\,Y-58)\,12)\,255\,255)':g='if(lte(hypot(X-58\,Y-58)\,12)\,255\,128)':b='if(lte(hypot(X-58\,Y-58)\,12)\,255\,32)':a='if(lte(hypot(X-80\,Y-80)\,62)\,255\,0)'[fill];\
[ol][fill]overlay=0:0:format=auto[disc];\
[0:v][disc]overlay=x='240+160*cos(2*PI*t/$SEC)':y='160+60*sin(2*PI*t/$SEC)':format=auto,scale=320:240:flags=area,format=yuv420p[v]" \
  -map "[v]" -t "$SEC" -c:v libx264 -crf 18 -preset veryfast -pix_fmt yuv420p "$OUT"
echo "$OUT"
