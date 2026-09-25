import type { Parser } from "web-tree-sitter";
import type { InwardsConfig } from "./config.ts";
import { checkDynamicImports, extractDynamicImports, mentionsDynamicImport } from "./dynamic.ts";
import { checkEncoding } from "./encoding.ts";
import { checkLayers, layerIndexOf } from "./layers.ts";
import { skeletonImports } from "./prescan.ts";
import { ProjectIndex } from "./project.ts";
import {
  createPythonParser,
  extractImports,
  type GrammarBinaries,
  normalizeSource,
  parsePython,
} from "./python.ts";
import type { Diagnostic, ImportRef, SourceFile } from "./types.ts";

/** The whole engine surface. Adapters (CLI, LSP) call this and nothing deeper. */
export class Engine {
  private readonly parser: Parser;
  private readonly config: InwardsConfig;

  /**
   * Stores a ready parser and a validated config.
   * Private: `Engine.create` is the only way in, because loading the grammar is async.
   *
   * @param parser - tree-sitter parser with the Python grammar already set.
   * @param config - layers and root read from `[tool.inwards]`.
   */
  private constructor(parser: Parser, config: InwardsConfig) {
    this.parser = parser;
    this.config = config;
  }

  /**
   * Builds an engine from the grammar bytes an adapter supplies.
   * Initialises the tree-sitter runtime and loads the Python grammar once;
   * every later check reuses that parser.
   *
   * @param wasm - the tree-sitter runtime and Python grammar as WASM bytes.
   * @param config - layers and root read from `[tool.inwards]`.
   * @returns an engine ready to check files.
   */
  static async create(wasm: GrammarBinaries, config: InwardsConfig): Promise<Engine> {
    return new Engine(await createPythonParser(wasm), config);
  }

  /**
   * Checks one file against every layer rule.
   * Parses only the import skeleton first. Violations are rare, so the full
   * parse runs only to confirm one (or when the prescan declines the file).
   *
   * The text is normalised first (BOM dropped, lone \r turned into \n), so
   * reported lines and columns match what an editor shows. A file in a layer
   * that declares an encoding Inwards can't read faithfully gets one INW000
   * diagnostic instead of a check (see `encoding.ts`).
   *
   * The skeleton keeps import statements only, so it can't see
   * `importlib.import_module("...")` or `exec("import ...")`. A file in a layer
   * whose text names a loader (`mentionsDynamicImport`) skips the skeleton and
   * gets the full parse, which also looks for dynamic imports (INW011).
   *
   * @param file - the source file as read by the adapter.
   * @returns the violations found, empty when the file is clean.
   */
  checkFile(file: SourceFile): Diagnostic[] {
    const src = { ...file, text: normalizeSource(file.text) };
    const layered = layerIndexOf(src.module, this.config.layers) !== -1;
    if (layered) {
      const unreadable = checkEncoding(src);
      if (unreadable) {
        return [unreadable];
      }
    }
    const dynamic = layered && mentionsDynamicImport(src.text);
    if (!dynamic) {
      const fast = skeletonImports(this.parser, src);
      if (fast && checkLayers(src, fast, this.config.layers).length === 0) {
        return [];
      }
    }
    return this.fullCheck(src, dynamic);
  }

  /**
   * Checks a file against a full parse, the exact path.
   * Diagnostics come back in source order, static and dynamic imports mixed.
   *
   * @param file - the source file, with normalised text.
   * @param dynamic - true to look for dynamic imports as well (INW011).
   * @returns the violations found.
   */
  private fullCheck(file: SourceFile, dynamic: boolean): Diagnostic[] {
    const { layers } = this.config;
    const tree = parsePython(this.parser, file.text);
    try {
      const found = checkLayers(file, extractImports(tree, file), layers);
      if (dynamic) {
        const refs = extractDynamicImports(this.parser, tree, file);
        found.push(...checkDynamicImports(file, refs, layers));
      }
      return found.sort((a, b) => a.line - b.line || a.column - b.column);
    } finally {
      tree.delete(); // WASM memory is not garbage collected
    }
  }

  /**
   * Extracts every import from a full parse of the file.
   * The slow, exact path. The tree is freed before returning because WASM
   * memory is not garbage collected.
   *
   * @param file - the source file, with normalised text.
   * @returns every import statement target with its span.
   */
  private imports(file: SourceFile): ImportRef[] {
    const tree = parsePython(this.parser, file.text);
    try {
      return extractImports(tree, file);
    } finally {
      tree.delete(); // WASM memory is not garbage collected
    }
  }

  /**
   * Builds the project-wide index over every source file of a project.
   * Cheap: only the module set is computed now. The reverse-import map is
   * built on first use, reading imports skeleton-first like `checkFile`.
   *
   * @param files - every source file under the config root, as the adapter read them.
   * @returns the index; `importersOf` reads imports lazily.
   */
  index(files: readonly SourceFile[]): ProjectIndex {
    return new ProjectIndex(files, (file) => {
      const src = { ...file, text: normalizeSource(file.text) };
      return skeletonImports(this.parser, src) ?? this.imports(src);
    });
  }

  /**
   * Checks many files and concatenates their violations.
   * Order follows the input, so a sorted file list gives sorted output.
   *
   * @param files - the source files to check.
   * @returns every violation across all files.
   */
  checkFiles(files: Iterable<SourceFile>): Diagnostic[] {
    const all: Diagnostic[] = [];
    for (const file of files) {
      all.push(...this.checkFile(file));
    }
    return all;
  }
}
