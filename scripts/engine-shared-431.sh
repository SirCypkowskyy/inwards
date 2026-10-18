#!/bin/sh
# Step 15 of ADR-047 (#431): moves contracts/, meta/, python/ and lookup/ under
# src/core/src/shared/ and rewrites the relative imports. Idempotent; rerun it
# after a rebase conflict (take the base's version of the file, rerun).
set -e
cd "$(dirname "$0")/.."
bun run scripts/move-slice.ts \
  src/core/src/contracts/records.ts=src/core/src/shared/contracts/records.ts \
  src/core/src/meta/product.ts=src/core/src/shared/meta/product.ts \
  src/core/src/meta/registry.ts=src/core/src/shared/meta/registry.ts \
  src/core/src/python/bindings.ts=src/core/src/shared/python/bindings.ts \
  src/core/src/python/encoding.ts=src/core/src/shared/python/encoding.ts \
  src/core/src/python/folding.ts=src/core/src/shared/python/folding.ts \
  src/core/src/python/literals.ts=src/core/src/shared/python/literals.ts \
  src/core/src/python/module-names.ts=src/core/src/shared/python/module-names.ts \
  src/core/src/python/nodes.ts=src/core/src/shared/python/nodes.ts \
  src/core/src/python/parser.ts=src/core/src/shared/python/parser.ts \
  src/core/src/python/prescan.ts=src/core/src/shared/python/prescan.ts \
  src/core/src/python/private-modules.ts=src/core/src/shared/python/private-modules.ts \
  src/core/src/python/qualify.ts=src/core/src/shared/python/qualify.ts \
  src/core/src/python/reparse.ts=src/core/src/shared/python/reparse.ts \
  src/core/src/python/stdlib.ts=src/core/src/shared/python/stdlib.ts \
  src/core/src/python/string-ops.ts=src/core/src/shared/python/string-ops.ts \
  src/core/src/python/type-checking.ts=src/core/src/shared/python/type-checking.ts \
  src/core/src/lookup/directory-listing.ts=src/core/src/shared/lookup/directory-listing.ts \
  src/core/src/lookup/module-lookup.ts=src/core/src/shared/lookup/module-lookup.ts \
  src/core/src/lookup/project-index.ts=src/core/src/shared/lookup/project-index.ts
