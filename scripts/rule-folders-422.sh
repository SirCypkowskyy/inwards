#!/usr/bin/env bash
# #422: turn the engine's single-file rules into rules/<rule>/index.ts + _check.ts.
# Rerun after a rebase conflict: it moves the files and rewrites every reference.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
R=src/core/src/rules
declare -A EXPORTS=(
  [context-independence]="checkContextDependencies"
  [layer-dependency]="checkLayers"
  [public-api-only]="checkPublicApi"
  [pure-domain]="checkLibraries, coversModule, type LibraryInputs"
  [suppression-comment]="commentsIn, mentionsSuppression, suppress"
  [unknown-first-party]="checkUnknownImports"
  [unsupported-encoding]="checkEncoding"
)
for r in "${!EXPORTS[@]}"; do
  if [ -f "$R/$r.ts" ]; then
    mkdir -p "$R/$r"
    git mv "$R/$r.ts" "$R/$r/_check.ts"
    sed -i -E 's#from "\.\./#from "../../#; s#from "\./shared/#from "../shared/#' "$R/$r/_check.ts"
    printf '/**\n * @file The public face of the %s rule. Everything outside the folder imports\n * this module, never the private `_check.ts` behind it.\n */\nexport { %s } from "./_check.ts";\n' "$r" "${EXPORTS[$r]}" > "$R/$r/index.ts"
  fi
  # importers (src, tests, docs resource links) -> the folder's index
  grep -rlE "rules/$r\.ts" src docs .fallowrc.jsonc --exclude-dir=node_modules 2>/dev/null \
    | xargs -r sed -i -E "s#rules/$r\.ts#rules/$r/index.ts#g" || true
done
# zones: one pattern per rule, rules/<rule>/**
perl -0pi -e 's#"src/core/src/rules/([a-z-]+)/index\.ts",\s*("src/core/src/rules/\1/\*\*")#$2#g' .fallowrc.jsonc
