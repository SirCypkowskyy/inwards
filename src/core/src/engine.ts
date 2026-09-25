import type { Parser } from "web-tree-sitter";
import type { StratumConfig } from "./config.ts";
import { checkLayers } from "./layers.ts";
import { importSkeleton } from "./prescan.ts";
import { createPythonParser, extractImports, type GrammarBinaries, parsePython } from "./python.ts";
import type { Diagnostic, ImportRef, SourceFile } from "./types.ts";

/** The whole engine surface. Adapters (CLI, LSP) call this and nothing deeper. */
export class Engine {
  private constructor(
    private readonly parser: Parser,
    private readonly config: StratumConfig,
  ) {}

  static async create(wasm: GrammarBinaries, config: StratumConfig): Promise<Engine> {
    return new Engine(await createPythonParser(wasm), config);
  }

  /**
   * Parses only the import skeleton first. Violations are rare, so the full
   * parse runs only to confirm one (or when the prescan declines the file).
   */
  checkFile(file: SourceFile): Diagnostic[] {
    const skeleton = importSkeleton(file.text);
    if (skeleton) {
      const imports = this.imports(file, skeleton.text).map((ref) => ({
        ...ref,
        column: ref.column + (skeleton.indent[ref.line - 1] ?? 0),
        endColumn: ref.endColumn + (skeleton.indent[ref.endLine - 1] ?? 0),
      }));
      const found = checkLayers(file, imports, this.config.layers);
      if (found.length === 0) return found;
    }
    return checkLayers(file, this.imports(file, file.text), this.config.layers);
  }

  private imports(file: SourceFile, text: string): ImportRef[] {
    const tree = parsePython(this.parser, text);
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
