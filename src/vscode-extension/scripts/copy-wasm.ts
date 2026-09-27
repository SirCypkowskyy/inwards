/**
 * @file Copies the two tree-sitter grammars next to `dist/server.js` after the build.
 * The extension runs on Node inside VS Code, so it can't use Bun's embedded
 * files; the server reads the grammars from its own directory instead.
 */
import { copyFileSync } from "node:fs";

for (const spec of [
  "web-tree-sitter/web-tree-sitter.wasm",
  "tree-sitter-python/tree-sitter-python.wasm",
]) {
  const from = Bun.resolveSync(spec, import.meta.dir);
  copyFileSync(from, `dist/${spec.split("/").at(-1)}`);
}
