// The extension runs on Node inside VS Code, so it cannot use Bun's embedded
// files. Ship the two grammars next to dist/server.js instead.
import { copyFileSync } from "node:fs";

for (const spec of [
  "web-tree-sitter/web-tree-sitter.wasm",
  "tree-sitter-python/tree-sitter-python.wasm",
]) {
  const from = Bun.resolveSync(spec, import.meta.dir);
  copyFileSync(from, `dist/${spec.split("/").at(-1)}`);
}
