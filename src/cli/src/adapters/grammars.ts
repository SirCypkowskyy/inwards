import type { GrammarBinaries } from "@inwards/core";
// `type: "file"` makes `bun build --compile` embed both blobs in the binary.
// At dev time the same imports resolve to paths inside node_modules.
import pythonPath from "tree-sitter-python/tree-sitter-python.wasm" with { type: "file" };
import runtimePath from "web-tree-sitter/web-tree-sitter.wasm" with { type: "file" };

/**
 * Reads the tree-sitter runtime and Python grammar for the engine.
 * In the compiled binary both files are embedded; from source they are read
 * from node_modules.
 *
 * @returns the two WASM blobs the engine's GrammarBinaries port expects.
 */
export async function loadGrammars(): Promise<GrammarBinaries> {
  const [runtime, python] = await Promise.all([
    Bun.file(runtimePath).bytes(),
    Bun.file(pythonPath).bytes(),
  ]);
  return { runtime, python };
}
