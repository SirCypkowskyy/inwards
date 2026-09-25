import { readFileSync } from "node:fs";
import {
  Engine,
  type GrammarBinaries,
  moduleNameFor,
  parseConfig,
  type SourceFile,
} from "../src/index.ts";

/**
 * Reads a WASM file from an installed package.
 *
 * @param spec - a module specifier such as `tree-sitter-python/tree-sitter-python.wasm`.
 * @returns the file's bytes.
 */
function load(spec: string): Uint8Array {
  return new Uint8Array(readFileSync(Bun.resolveSync(spec, import.meta.dir)));
}

/**
 * Loads the grammars from node_modules, the test suite's GrammarBinaries adapter.
 *
 * @returns the tree-sitter runtime and Python grammar.
 */
function grammars(): GrammarBinaries {
  return {
    runtime: load("web-tree-sitter/web-tree-sitter.wasm"),
    python: load("tree-sitter-python/tree-sitter-python.wasm"),
  };
}

const CONFIG = parseConfig(`
[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "application", modules = ["shop.application"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
  { name = "interface", modules = ["shop.api"] },
]
`);

/**
 * Builds an in-memory source file whose module name comes from its path.
 *
 * @param path - project-relative path, e.g. `shop/domain/order.py`.
 * @param text - the Python source.
 * @returns the file as the engine expects it.
 */
export function file(path: string, text: string): SourceFile {
  return { path, text, ...moduleNameFor(path) };
}

export const engine: Engine = await Engine.create(grammars(), CONFIG);
