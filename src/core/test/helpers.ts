import { readFileSync } from "node:fs";
import type { Parser } from "web-tree-sitter";
import {
  type Diagnostic,
  Engine,
  type GrammarBinaries,
  moduleNameFor,
  type ProjectIndex,
  parseConfig,
  type SourceFile,
} from "../src/index.ts";
import { createPythonParser } from "../src/python.ts";
import type { ModuleLookup } from "../src/unassigned.ts";

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
export function grammars(): GrammarBinaries {
  return {
    runtime: load("web-tree-sitter/web-tree-sitter.wasm"),
    python: load("tree-sitter-python/tree-sitter-python.wasm"),
  };
}

const CONFIG = parseConfig(`
[tool.inwards]
ignore = ["scripts"]
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

/** The files and directories the test project has on disk, for INW006. */
const ON_DISK: ReadonlyMap<string, "file" | "dir"> = new Map([
  ["shop", "dir"],
  ["shop/__init__.py", "file"],
  ["shop/domain", "dir"],
  ["shop/domain/order.py", "file"],
  ["shop/application", "dir"],
  ["shop/application/place_order.py", "file"],
  ["shop/infrastructure", "dir"],
  ["shop/infrastructure/db.py", "file"],
  ["shop/infrastructure/sql_orders.py", "file"],
  ["shop/api", "dir"],
  ["shop/api/http.py", "file"],
  ["shop/persistence", "dir"],
  ["shop/persistence/repo.py", "file"],
  ["scripts", "dir"],
  ["scripts/__init__.py", "file"],
  ["logging", "dir"],
]);

/**
 * Builds a module index over an in-memory file system. Every file is listed.
 *
 * @param disk - what is at each root-relative path.
 * @param texts - file contents by path; a missing file reads as empty.
 * @returns the index.
 */
export function indexOn(
  disk: ReadonlyMap<string, "file" | "dir">,
  texts: ReadonlyMap<string, string> = new Map(),
): ProjectIndex {
  return engine.index({
    kind: (rel: string): "file" | "dir" | undefined => disk.get(rel),
    list: (): string[] => [...disk].flatMap(([rel, kind]) => (kind === "file" ? [rel] : [])),
    read: (rel: string): string => texts.get(rel) ?? "",
    listDir: (rel: string): { name: string; dir: boolean }[] | undefined =>
      disk.get(rel) === "dir"
        ? [...disk]
            .filter(
              ([path]) => path.startsWith(`${rel}/`) && !path.slice(rel.length + 1).includes("/"),
            )
            .map(([path, kind]) => ({ name: path.slice(rel.length + 1), dir: kind === "dir" }))
        : undefined,
  });
}

/** The test project's module index, over `ON_DISK`; its files are empty. */
export const PROJECT: ProjectIndex = indexOn(ON_DISK);

/** Finds first-party modules among `ON_DISK`. */
export const OWNERS: ModuleLookup = PROJECT.ownerOf;

/**
 * Checks one file with the test engine and the test project's modules.
 *
 * @param source - the file.
 * @returns the diagnostics.
 */
export function check(source: SourceFile): Diagnostic[] {
  return engine.checkFile(source, PROJECT);
}

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
  return check(file(path, src))
    .filter((d) => d.code === "INW011")
    .map((d) => [d.code, TARGET.exec(d.message)?.groups?.["t"] ?? ""]);
}
