#!/usr/bin/env bash
# Spine CLI wrapper (PIPELINE 3.4): import -> clean -> export binary -> pack, with a pinned
# editor patch, stdout teed to a log, and FAILURE ON ANY WARNING LINE (the CLI exits 0 on
# warnings such as missing images, so the exit code alone proves nothing).
#
#   tools/spine/export.sh import <skeleton.json> <project.spine> [<skeleton-name>]
#   tools/spine/export.sh import-anims <anims.json> <project.spine> <skeleton-name> <anim> [<anim>...]
#   tools/spine/export.sh clean  [<projects-root>]                     default art/source/spine
#   tools/spine/export.sh export [<projects-root>] [<out-dir>] [binary|json]   default public/assets/spine binary
#   tools/spine/export.sh pack   [<images-dir>] [<out-dir>] [<atlas-name>] [<projects-root>]
#                                                 default art/source/spine/images public/assets/spine symbols art/source/spine
#   tools/spine/export.sh symbol <ID>                                   all four steps for sym_<ID> (contract paths)
#   tools/spine/export.sh version                                       run `$SPINE -u $SPINE_VERSION --version` (downloads/pins the patch)
# Options (before the command): --dry-run (print commands only)  --log-dir DIR (default build/spine/logs)
#   --settings FILE (pack settings; default config/spine/pack-symbols.json, else tools/spine/config/pack-symbols.json)
# Env: SPINE        path to the launcher (Linux /opt/spine/Spine.sh, macOS .../Spine.app/Contents/MacOS/Spine)
#      SPINE_VERSION pinned patch, e.g. 4.3.23 (required; betas and "latest" are refused)
#      SPINE_FAIL_PATTERN  extended regex of output lines that fail the step
#                          (default: warn|error|exception|missing|not found|could not|unable to|failed)
# Exit: 0 ok, 1 Spine failed or printed a warning, 2 usage/config error.
# NOTE: needs an activated Spine seat (Professional/Enterprise); it cannot run in a cloud
# session. tools/spine/test/run.sh exercises it with tools/spine/test/fake-spine.sh.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
DRY=0
LOG_DIR="$REPO/build/spine/logs"
SETTINGS=""
FAIL_RE="${SPINE_FAIL_PATTERN:-warn|error|exception|missing|not found|could not|unable to|failed}"

usage() { sed -n '2,/^set -uo pipefail$/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; }
die() { echo "export.sh: $*" >&2; exit 2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1; shift ;;
    --log-dir) [ $# -ge 2 ] || die "--log-dir needs a value"; LOG_DIR="$2"; shift 2 ;;
    --settings) [ $# -ge 2 ] || die "--settings needs a value"; SETTINGS="$2"; shift 2 ;;
    -h|--help|help) usage; exit 0 ;;
    --) shift; break ;;
    -*) die "unknown option $1 (see --help)" ;;
    *) break ;;
  esac
done
[ $# -ge 1 ] || { usage >&2; exit 2; }
CMD="$1"; shift

# ---------------------------------------------------------------- pinned editor
check_env() {
  [ -n "${SPINE:-}" ] || die "set SPINE to the Spine launcher (e.g. /opt/spine/Spine.sh)"
  [ -n "${SPINE_VERSION:-}" ] || die "set SPINE_VERSION to the pinned 4.3 patch (e.g. 4.3.23)"
  [[ "$SPINE_VERSION" =~ ^4\.3\.[0-9]+$ ]] || die "SPINE_VERSION '$SPINE_VERSION' must be an exact 4.3.x patch (no beta, no 'latest')"
  if [ "$DRY" = 0 ]; then
    [ -x "$SPINE" ] || die "SPINE '$SPINE' is not an executable file"
  fi
}

pack_settings() {
  if [ -n "$SETTINGS" ]; then echo "$SETTINGS"
  elif [ -f "$REPO/config/spine/pack-symbols.json" ]; then echo "$REPO/config/spine/pack-symbols.json"
  else echo "$HERE/config/pack-symbols.json"; fi
}

# run <step-name> <args...>: tee to the log, fail on exit code OR any matching line
run() {
  local step="$1"; shift
  local cmd=("$SPINE" -u "$SPINE_VERSION" "$@")
  echo "+ ${cmd[*]}"
  [ "$DRY" = 1 ] && return 0
  mkdir -p "$LOG_DIR"
  local log="$LOG_DIR/$step.log"
  "${cmd[@]}" 2>&1 | tee "$log"
  local rc=${PIPESTATUS[0]}
  if [ "$rc" -ne 0 ]; then
    echo "export.sh: FAIL $step: Spine exited $rc (log: $log)" >&2
    exit 1
  fi
  local bad
  bad="$(grep -Ein -- "$FAIL_RE" "$log" || true)"
  if [ -n "$bad" ]; then
    echo "export.sh: FAIL $step: Spine printed warning/error lines (exit code was 0; log: $log):" >&2
    echo "$bad" | sed 's/^/  /' >&2
    exit 1
  fi
  echo "export.sh: ok $step"
}

need_file() { [ "$DRY" = 1 ] || [ -f "$1" ] || die "$2 not found: $1"; }
# skeleton / animation names end up in Spine's --to / -a and in log file names: no paths, no spaces
need_name() { [[ "$1" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]*$ ]] || die "bad $2 '$1' (letters, digits, _ . - only)"; }
need_dir() { [ "$DRY" = 1 ] || [ -d "$1" ] || die "$2 not found: $1"; }

do_import() {
  [ $# -ge 2 ] && [ $# -le 3 ] || die "usage: import <skeleton.json> <project.spine> [<skeleton-name>]"
  local json="$1" project="$2" name="${3:-}"
  [ -n "$name" ] || name="$(basename "$project" .spine)"
  need_name "$name" "skeleton name"
  need_file "$json" "skeleton JSON"
  [[ "$project" == *.spine ]] || die "project must end in .spine: $project"
  [ "$DRY" = 1 ] || mkdir -p "$(dirname "$project")"
  run "import-$name" --hide-license --disable-audio -i "$json" -o "$project" --to "$name" --replace -r
}

do_import_anims() {
  [ $# -ge 4 ] || die "usage: import-anims <anims.json> <project.spine> <skeleton-name> <anim> [<anim>...]"
  local json="$1" project="$2" name="$3"; shift 3
  need_name "$name" "skeleton name"
  need_file "$json" "animations JSON"
  need_file "$project" "project"
  local a=()
  for anim in "$@"; do need_name "$anim" "animation name"; a+=(-a "$anim"); done
  run "import-anims-$name" --hide-license --disable-audio -i "$json" -o "$project" --to "$name" "${a[@]}" --replace -r
}

do_clean() {
  local root="${1:-$REPO/art/source/spine}"
  need_dir "$root" "projects root"
  run "clean" -i "$root,**/*.spine" -m
}

do_export() {
  local root="${1:-$REPO/art/source/spine}" out="${2:-$REPO/public/assets/spine}" fmt="${3:-binary}"
  [[ "$fmt" == binary || "$fmt" == json ]] || die "export format must be binary or json"
  need_dir "$root" "projects root"
  [ "$DRY" = 1 ] || mkdir -p "$out"
  run "export-$fmt" -i "$root,**/*.spine" -o "$out" --set nonessential=false -e "$fmt"
}

do_pack() {
  local images="${1:-$REPO/art/source/spine/images}" out="${2:-$REPO/public/assets/spine}" name="${3:-symbols}" root="${4:-$REPO/art/source/spine}"
  local settings; settings="$(pack_settings)"
  need_name "$name" "atlas name"
  need_dir "$images" "images dir"
  need_file "$settings" "pack settings"
  [ "$DRY" = 1 ] || mkdir -p "$out"
  run "pack-$name" -i "$images" -o "$out" -n "$name" -j "$root,sym_*.spine" -p "$settings"
}

do_symbol() {
  [ $# -eq 1 ] || die "usage: symbol <ID>"
  local id="$1" name="sym_$1"
  [[ "$id" =~ ^[A-Za-z0-9_]+$ ]] || die "bad symbol id '$id'"
  do_import "$REPO/build/spine/$name.json" "$REPO/art/source/spine/$name.spine" "$name"
  do_clean "$REPO/art/source/spine"
  do_export "$REPO/art/source/spine" "$REPO/public/assets/spine" binary
  do_export "$REPO/art/source/spine" "$REPO/build/spine/export-json" json   # diff-friendly copy
  do_pack "$REPO/art/source/spine/images" "$REPO/public/assets/spine" symbols "$REPO/art/source/spine"
}

case "$CMD" in
  version) check_env; run "version" --version ;;
  import) check_env; do_import "$@" ;;
  import-anims) check_env; do_import_anims "$@" ;;
  clean) check_env; do_clean "$@" ;;
  export) check_env; do_export "$@" ;;
  pack) check_env; do_pack "$@" ;;
  symbol) check_env; do_symbol "$@" ;;
  *) echo "export.sh: unknown command '$CMD'" >&2; usage >&2; exit 2 ;;
esac
exit 0
