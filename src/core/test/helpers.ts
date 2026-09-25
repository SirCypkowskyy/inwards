import { readFileSync } from "node:fs";
import {
  Engine,
  type GrammarBinaries,
  moduleNameFor,
  parseConfig,
  type SourceFile,
} from "../src/index.ts";

function load(spec: string): Uint8Array {
  return new Uint8Array(readFileSync(Bun.resolveSync(spec, import.meta.dir)));
}

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

export function file(path: string, text: string): SourceFile {
  return { path, text, ...moduleNameFor(path) };
}

export const engine: Engine = await Engine.create(grammars(), CONFIG);
