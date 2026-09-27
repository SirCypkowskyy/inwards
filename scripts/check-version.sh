#!/usr/bin/env bash
# Every version field agrees with .release-please-manifest.json, the one source
# (ADR-016). release-please stamps them all in its release PR; nothing else
# edits them. Usage: scripts/check-version.sh [expected]  (cd.yml passes the tag's version)
set -euo pipefail
want="$(jq -r '."."' .release-please-manifest.json)"
if [ -n "${1:-}" ] && [ "$1" != "$want" ]; then
  echo "::error::Tag version $1 does not match .release-please-manifest.json ($want)"
  exit 1
fi
bad=0
check() {
  if [ "$2" != "$want" ]; then
    echo "::error file=$1::$1 has version '$2', expected $want"
    bad=1
  fi
}
check src/core/src/meta/product.ts "$(sed -nE 's/^export const VERSION = "([^"]*)";$/\1/p' src/core/src/meta/product.ts)"
for f in src/core/package.json src/cli/package.json src/vscode-extension/package.json; do
  check "$f" "$(jq -r .version "$f")"
done
check pyproject.toml "$(sed -nE '/^\[project\]/,/^\[/{s/^version = "([^"]*)".*/\1/p;}' pyproject.toml)"
check uv.lock "$(awk '/^\[\[package\]\]/{n=""} /^name = /{n=$3} n=="\"inwards\"" && /^version = /{gsub(/"/,"",$3); print $3; exit}' uv.lock)"
exit "$bad"
