#!/usr/bin/env bash
# Argument-handling tests for tools/spine/export.sh against the fake Spine launcher.
#   tools/spine/test/export.test.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXPORT="$HERE/../export.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export SPINE="$HERE/fake-spine.sh" SPINE_VERSION=4.3.23 FAKE_SPINE_LOG="$TMP/argv.log"
fails=0
check() { # name expected_exit actual_exit
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected exit $2, got $3"; fails=$((fails+1)); fi
}
expect_log() { # name pattern
  if grep -qF -- "$2" "$FAKE_SPINE_LOG"; then echo "ok   $1"; else echo "FAIL $1: argv log lacks: $2"; cat "$FAKE_SPINE_LOG"; fails=$((fails+1)); fi
}
echo '{"skeleton":{"spine":"4.3.23"}}' > "$TMP/sym_T.json"
mkdir -p "$TMP/images/sym_T" "$TMP/proj" && : > "$TMP/proj/sym_T.spine"

"$EXPORT" --help >/dev/null; check "--help" 0 $?
"$EXPORT" >/dev/null 2>&1; check "no command -> usage error" 2 $?
"$EXPORT" bogus >/dev/null 2>&1; check "unknown command" 2 $?
SPINE= "$EXPORT" import "$TMP/sym_T.json" "$TMP/proj/sym_T.spine" >/dev/null 2>&1; check "SPINE unset" 2 $?
SPINE_VERSION=4.3.24-beta "$EXPORT" import "$TMP/sym_T.json" "$TMP/proj/sym_T.spine" >/dev/null 2>&1; check "beta version refused" 2 $?
SPINE_VERSION=latest "$EXPORT" clean "$TMP/proj" >/dev/null 2>&1; check "'latest' refused" 2 $?
SPINE=/nonexistent "$EXPORT" clean "$TMP/proj" >/dev/null 2>&1; check "missing launcher" 2 $?
"$EXPORT" import "$TMP/nope.json" "$TMP/proj/sym_T.spine" >/dev/null 2>&1; check "missing input JSON" 2 $?
"$EXPORT" import "$TMP/sym_T.json" "$TMP/proj/sym_T.txt" >/dev/null 2>&1; check "project must be .spine" 2 $?

: > "$FAKE_SPINE_LOG"
"$EXPORT" --log-dir "$TMP/logs" import "$TMP/sym_T.json" "$TMP/proj/sym_T.spine" >/dev/null; check "import ok" 0 $?
expect_log "import argv" "-u 4.3.23 --hide-license --disable-audio -i $TMP/sym_T.json -o $TMP/proj/sym_T.spine --to sym_T --replace -r"
[ -s "$TMP/logs/import-sym_T.log" ]; check "import stdout teed to log" 0 $?

"$EXPORT" --log-dir "$TMP/logs" import-anims "$TMP/sym_T.json" "$TMP/proj/sym_T.spine" sym_T win win_loop >/dev/null; check "import-anims ok" 0 $?
expect_log "import-anims argv" "--to sym_T -a win -a win_loop --replace -r"

FAKE_SPINE_WARN=1 "$EXPORT" --log-dir "$TMP/logs" clean "$TMP/proj" >/dev/null 2>&1; check "warning line fails (exit 0 from Spine)" 1 $?
FAKE_SPINE_EXIT=3 "$EXPORT" --log-dir "$TMP/logs" export "$TMP/proj" "$TMP/out" >/dev/null 2>&1; check "non-zero Spine exit fails" 1 $?
SPINE_FAIL_PATTERN='^never$' FAKE_SPINE_WARN=1 "$EXPORT" --log-dir "$TMP/logs" clean "$TMP/proj" >/dev/null 2>&1; check "custom fail pattern" 0 $?

: > "$FAKE_SPINE_LOG"
"$EXPORT" --log-dir "$TMP/logs" export "$TMP/proj" "$TMP/out" json >/dev/null; check "export json ok" 0 $?
expect_log "export argv" "-i $TMP/proj\\,\\*\\*/\\*.spine -o $TMP/out --set nonessential=false -e json"
"$EXPORT" --log-dir "$TMP/logs" export "$TMP/proj" "$TMP/out" webp >/dev/null 2>&1; check "bad export format" 2 $?
echo '{}' > "$TMP/pack.json"
"$EXPORT" --log-dir "$TMP/logs" --settings "$TMP/pack.json" pack "$TMP/images" "$TMP/out" symbols "$TMP/proj" >/dev/null; check "pack ok" 0 $?
expect_log "pack argv" "-n symbols -j $TMP/proj\\,sym_\\*.spine -p $TMP/pack.json"

: > "$FAKE_SPINE_LOG"
out="$("$EXPORT" --dry-run symbol H1)"; check "symbol --dry-run" 0 $?
[ "$(grep -c '^+ ' <<<"$out")" = 5 ] && [ ! -s "$FAKE_SPINE_LOG" ]; check "dry-run prints 5 steps, runs nothing" 0 $?
grep -q -- "-e binary" <<<"$out" && grep -q -- "-m" <<<"$out" && grep -q -- " -r" <<<"$out" && grep -q -- " -p " <<<"$out"
check "symbol covers import/clean/export/pack" 0 $?
"$EXPORT" --dry-run symbol 'H1;rm' >/dev/null 2>&1; check "symbol id sanitised" 2 $?
"$EXPORT" --log-dir "$TMP/logs" import "$TMP/sym_T.json" "$TMP/proj/sym_T.spine" '../../x' >/dev/null 2>&1; check "skeleton name sanitised (log path)" 2 $?
"$EXPORT" --log-dir "$TMP/logs" import "$TMP/sym_T.json" "$TMP/proj/a b.spine" >/dev/null 2>&1; check "derived skeleton name sanitised" 2 $?
"$EXPORT" --log-dir "$TMP/logs" import-anims "$TMP/sym_T.json" "$TMP/proj/sym_T.spine" sym_T 'win;x' >/dev/null 2>&1; check "animation name sanitised" 2 $?
"$EXPORT" --log-dir "$TMP/logs" --settings "$TMP/pack.json" pack "$TMP/images" "$TMP/out" '../sym' "$TMP/proj" >/dev/null 2>&1; check "atlas name sanitised" 2 $?
[ ! -e "$TMP/x.log" ] && [ ! -e "$TMP/import-../../x.log" ]; check "no log written outside --log-dir" 0 $?
: > "$FAKE_SPINE_LOG"
"$EXPORT" --log-dir "$TMP/logs" version >/dev/null; check "version runs the launcher" 0 $?
expect_log "version argv" "-u 4.3.23 --version"
[ "$("$EXPORT" --help | grep -c '^set ')" = 0 ]; check "--help prints only the header" 0 $?

[ $fails = 0 ] && echo "all export.sh tests passed" || echo "$fails export.sh test(s) failed"
exit $(( fails > 0 ))
