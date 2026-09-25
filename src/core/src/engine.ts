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
  private constructor(
    private readonly parser: Parser,
    private readonly config: InwardsConfig,
  ) {}

  static async create(wasm: GrammarBinaries, config: InwardsConfig): Promise<Engine> {
    return new Engine(await createPythonParser(wasm), config);
  }

  /**
   * Parses only the import skeleton first. Violations are rare, so the full
   * parse runs only to confirm one (or when the prescan declines the file).
   */
  checkFile(file: SourceFile): Diagnostic[] {
    const src = { ...file, text: normalizeSource(file.text) };
    const fast = skeletonImports(this.parser, src);
    if (fast) {
      const found = checkLayers(src, fast, this.config.layers);
      if (found.length === 0) return found;
    }
    return checkLayers(src, this.imports(src), this.config.layers);
  }

  private imports(file: SourceFile): ImportRef[] {
    const tree = parsePython(this.parser, file.text);
    try {
      return extractImports(tree, file);
    } finally {
      tree.delete(); // WASM memory is not garbage collected
    }
  }

  checkFiles(files: Iterable<SourceFile>): Diagnostic[] {
    const all: Diagnostic[] = [];
    for (const file of files) all.push(...this.checkFile(file));
    return all;
  }
}
