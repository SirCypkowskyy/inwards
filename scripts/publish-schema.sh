#!/usr/bin/env bash
# Puts the JSON Schemas for [tool.inwards] into the built docs site, where their
# $id says they live, and checks each copy: it must parse as JSON, equal its
# source, and carry the expected $id. tool-inwards.json is the table schema;
# pyproject.json is the whole-file schema built from it
# (scripts/build-pyproject-schema.ts). Run after both Zensical builds, since the
# English build's --clean empties docs/site. Usage: scripts/publish-schema.sh
set -euo pipefail
publish() {
  local src=$1 name=$2
  local dst=docs/site/schema/$name
  mkdir -p "$(dirname "$dst")"
  cp "$src" "$dst"
  python3 -m json.tool "$dst" > /dev/null
  cmp -s "$src" "$dst"
  local id
  id=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["$id"])' "$dst")
  case "$id" in
    */schema/$name) echo "Published $dst ($id)" ;;
    *) echo "::error file=$src::\$id $id doesn't end in /schema/$name" && exit 1 ;;
  esac
}
publish schema/tool-inwards.schema.json tool-inwards.json
publish schema/pyproject.schema.json pyproject.json
