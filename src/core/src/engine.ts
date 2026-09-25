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
import { checkUnassignedImports, type ModuleLookup, unassignedWarning } from "./unassigned.ts";

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
   * A file outside every layer isn't parsed: it gets at most an INW006 warning
   * naming its package.
   *
   * @param file - the source file as read by the adapter.
   * @param ownerOf - finds the first-party module an import lands in (INW006).
   * @returns the violations found, empty when the file is clean.
   */
  checkFile(file: SourceFile, ownerOf: ModuleLookup): Diagnostic[] {
    const src = { ...file, text: normalizeSource(file.text) };
    if (layerIndexOf(src.module, this.config.layers) === -1) {
      const warning = unassignedWarning(src, this.config);
      return warning ? [warning] : [];
    }
    const unreadable = checkEncoding(src);
    if (unreadable) {
      return [unreadable];
    }
    const dynamic = mentionsDynamicImport(src.text);
    if (!dynamic) {
      const fast = skeletonImports(this.parser, src);
      if (fast && this.importFindings(src, fast, ownerOf).length === 0) {
        return [];
      }
    }
    return this.fullCheck(src, dynamic, ownerOf);
  }

  /**
   * Applies the rules that look at import statements: INW001 and INW006.
   *
   * @param file - the source file.
   * @param imports - its imports.
   * @param ownerOf - finds the first-party module an import lands in.
   * @returns the violations found.
   */
  private importFindings(
    file: SourceFile,
    imports: readonly ImportRef[],
    ownerOf: ModuleLookup,
  ): Diagnostic[] {
    const { layers } = this.config;
    return [
      ...checkLayers(file, imports, layers),
      ...checkUnassignedImports(file, imports, layers, ownerOf),
    ];
  }

  /**
   * Checks a file against a full parse, the exact path.
   * Diagnostics come back in source order, static and dynamic imports mixed.
   *
   * @param file - the source file, with normalised text.
   * @param dynamic - true to look for dynamic imports as well (INW011).
   * @param ownerOf - finds the first-party module an import lands in.
   * @returns the violations found.
   */
  private fullCheck(file: SourceFile, dynamic: boolean, ownerOf: ModuleLookup): Diagnostic[] {
    const { layers } = this.config;
    const tree = parsePython(this.parser, file.text);
    try {
      const found = this.importFindings(file, extractImports(tree, file), ownerOf);
      if (dynamic) {
        const refs = extractDynamicImports(this.parser, tree, file);
        found.push(
          ...checkDynamicImports(file, refs, layers),
          ...checkUnassignedImports(
            file,
            refs.filter((ref) => ref.unreadable === null),
            layers,
            ownerOf,
          ),
        );
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
   * Order follows the input, so a sorted file list gives sorted output. The
   * INW006 warning for an unassigned package is kept once, on its first file.
   *
   * @param files - the source files to check.
   * @param ownerOf - finds the first-party module an import lands in (INW006).
   * @returns every violation across all files.
   */
  checkFiles(files: Iterable<SourceFile>, ownerOf: ModuleLookup): Diagnostic[] {
    const all: Diagnostic[] = [];
    const warned = new Set<string>();
    for (const file of files) {
      for (const found of this.checkFile(file, ownerOf)) {
        const once = found.severity === "warning" ? found.message : undefined;
        if (once === undefined || !warned.has(once)) {
          all.push(found);
        }
        if (once !== undefined) {
          warned.add(once);
        }
      }
    }
    return all;
  }
}
