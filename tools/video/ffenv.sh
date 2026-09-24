#!/usr/bin/env bash
# Sourced by tools/video/*.sh and tools/audio/*.sh: resolves a FULL ffmpeg build into $FF.
#   1. $FFMPEG if set;
#   2. the static binary shipped by imageio-ffmpeg in tools/.venv (pip install -r tools/requirements.txt),
#      or in $PIPELINE_PY (any python with imageio-ffmpeg);
#   3. `ffmpeg` on PATH (must be a full build: Playwright's bundled ffmpeg lacks most filters).
# Then checks that every filter/encoder named in $FF_NEEDS exists, so a limited build fails
# loudly instead of producing wrong output.
# Run directly, it is a diagnostic: tools/video/ffenv.sh [--help] prints the ffmpeg it resolves and
# checks the filters/encoders every tools/video + tools/audio script needs.
if [ "${BASH_SOURCE[0]}" = "$0" ] && { [ "${1:-}" = -h ] || [ "${1:-}" = --help ]; }; then
  sed -n 2,8p "$0" | sed 's/^# \{0,1\}//'; echo "Usage: tools/video/ffenv.sh   (or: source it and read \$FF)"; exit 0
fi
_ffenv_repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ff_resolve() {
  if [ -n "${FFMPEG:-}" ]; then FF="$FFMPEG"; return 0; fi
  local py
  for py in "${PIPELINE_PY:-}" "$_ffenv_repo/tools/.venv/bin/python" python3; do
    [ -n "$py" ] || continue
    command -v "$py" >/dev/null 2>&1 || [ -x "$py" ] || continue
    FF="$("$py" -c 'import imageio_ffmpeg as m; print(m.get_ffmpeg_exe())' 2>/dev/null)" && [ -x "$FF" ] && return 0
  done
  if command -v ffmpeg >/dev/null 2>&1; then FF="$(command -v ffmpeg)"; return 0; fi
  echo "error: no ffmpeg found. Set FFMPEG=/path/to/ffmpeg (8.x static build) or pip install -r tools/requirements.txt into tools/.venv" >&2
  return 1
}
ff_check() {
  local filters encoders miss=()
  filters="$("$FF" -hide_banner -filters 2>/dev/null)"
  encoders="$("$FF" -hide_banner -encoders 2>/dev/null)"
  for n in ${FF_NEEDS:-}; do
    if ! grep -qE "^ [A-Z.|]{2,3} +$n " <<<"$filters" && ! grep -qE "^ [A-Z.]{6} +$n " <<<"$encoders"; then miss+=("$n"); fi
  done
  if [ ${#miss[@]} -gt 0 ]; then
    echo "error: $FF lacks: ${miss[*]} (use a full static ffmpeg build; set FFMPEG=...)" >&2
    return 1
  fi
}
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  FF_NEEDS=${FF_NEEDS:-"fps hqdn3d chromakey colorkey despill geq erosion premultiply unpremultiply scale ssim alphaextract vstack pad loudnorm ebur128 silenceremove areverse afade acrossfade alimiter aresample libx264 libx264rgb png libopus aac libvorbis"}
  ff_resolve && ff_check || exit 2
  echo "$FF"; "$FF" -hide_banner -version | head -1; echo "all required filters/encoders present"
else
  ff_resolve && ff_check
fi
