#!/usr/bin/env bash
# Puts the JSON Schema for [tool.inwards] into the built docs site, where its
# $id says it lives (<DOCS_BASE>/schema/tool-inwards.json), and checks the copy:
# it must parse as JSON and equal the source. Run after both Zensical builds,
# since the English build's --clean empties docs/site. Usage: scripts/publish-schema.sh
set -euo pipefail
src=schema/tool-inwards.schema.json
dst=docs/site/schema/tool-inwards.json
mkdir -p "$(dirname "$dst")"
cp "$src" "$dst"
python3 -m json.tool "$dst" > /dev/null
cmp -s "$src" "$dst"
id=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["$id"])' "$dst")
case "$id" in
  */schema/tool-inwards.json) echo "Published $dst ($id)" ;;
  *) echo "::error file=$src::\$id $id doesn't end in /schema/tool-inwards.json" && exit 1 ;;
esac
