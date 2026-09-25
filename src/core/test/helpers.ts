import { readFileSync } from "node:fs";
import type { Parser } from "web-tree-sitter";
import {
  Engine,
  type GrammarBinaries,
  moduleNameFor,
  parseConfig,
  type SourceFile,
} from "../src/index.ts";
import { createPythonParser } from "../src/python.ts";

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

/** A bare parser, for tests of the prescan and extractors below the engine. */
export const parser: Parser = await createPythonParser(grammars());

const TARGET = /imports "(?<t>[^"]+)"/u;

/**
 * Checks a snippet as a domain module and lists what INW011 reports.
 *
 * @param src - Python source.
 * @param path - where the file sits; a domain module by default.
 * @returns `[code, target]` for each diagnostic, the target read from the message.
 */
export function found(src: string, path = "shop/domain/order.py"): [string, string][] {
  return engine
    .checkFile(file(path, src))
    .map((d) => [d.code, TARGET.exec(d.message)?.groups?.["t"] ?? ""]);
}
