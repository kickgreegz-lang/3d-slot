#!/usr/bin/env bash
# Fake Spine launcher for testing tools/spine/export.sh without a Spine licence.
# Appends its argv (shell-quoted, one invocation per line) to $FAKE_SPINE_LOG and prints
# Spine-like progress. Env knobs:
#   FAKE_SPINE_WARN=1   print a "Warning: Missing image" line (the real CLI still exits 0)
#   FAKE_SPINE_EXIT=N   exit with N (default 0)
log="${FAKE_SPINE_LOG:-/dev/null}"
printf '%q ' "$@" >> "$log"
printf '\n' >> "$log"
echo "Spine $2 (fake)"
for a in "$@"; do
  case "$a" in
    -r) echo "Importing skeleton data..." ;;
    -m) echo "Cleaning up animations..." ;;
    -e) echo "Exporting..." ;;
    -p) echo "Packing texture atlas..." ;;
  esac
done
[ "${FAKE_SPINE_WARN:-0}" = 1 ] && echo "Warning: Missing image: sym_H1/claw_L"
echo "Complete."
exit "${FAKE_SPINE_EXIT:-0}"
