import { readFileSync } from "node:fs";
import {
  Engine,
  type GrammarBinaries,
  moduleNameFor,
  parseConfig,
  type SourceFile,
} from "../src/index.ts";

export function grammars(): GrammarBinaries {
  const load = (spec: string) =>
    new Uint8Array(readFileSync(Bun.resolveSync(spec, import.meta.dir)));
  return {
    runtime: load("web-tree-sitter/web-tree-sitter.wasm"),
    python: load("tree-sitter-python/tree-sitter-python.wasm"),
  };
}

export const CONFIG = parseConfig(`
[tool.stratum]
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

export const engine = await Engine.create(grammars(), CONFIG);
