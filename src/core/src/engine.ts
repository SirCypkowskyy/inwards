import type { Parser } from "web-tree-sitter";
import type { InwardsConfig } from "./config.ts";
import { checkLayers } from "./layers.ts";
import { skeletonImports } from "./prescan.ts";
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
   * reported lines and columns match what an editor shows.
   *
   * @param file - the source file as read by the adapter.
   * @returns the violations found, empty when the file is clean.
   */
  checkFile(file: SourceFile): Diagnostic[] {
    const src = { ...file, text: normalizeSource(file.text) };
    const fast = skeletonImports(this.parser, src);
    if (fast) {
      const found = checkLayers(src, fast, this.config.layers);
      if (found.length === 0) {
        return found;
      }
    }
    return checkLayers(src, this.imports(src), this.config.layers);
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
