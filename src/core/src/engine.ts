import type { Parser } from "web-tree-sitter";
import { acceptedModules } from "./baseline.ts";
import type { InwardsConfig } from "./config.ts";
import { checkDynamicImports, extractDynamicImports, mentionsDynamicImport } from "./dynamic.ts";
import { checkEncoding } from "./encoding.ts";
import { checkLayers, layerIndexOf } from "./layers.ts";
import { checkLibraries } from "./libraries.ts";
import { skeletonImports } from "./prescan.ts";
import { type ProjectFiles, ProjectIndex } from "./project.ts";
import {
  createPythonParser,
  extractImports,
  type GrammarBinaries,
  normalizeSource,
  parsePython,
} from "./python.ts";
import { checkShape } from "./shape.ts";
import type { Diagnostic, ImportRef, SourceFile } from "./types.ts";
import { checkUnassignedImports, type ModuleLookup, unassignedWarning } from "./unassigned.ts";

/** A file after the prescan, before any full parse. */
interface Scan {
  /** The findings so far; null when the prescan was skipped or refused the file. */
  found: Diagnostic[] | null;
  /** True when `found` is final and needs no full parse. */
  exact: boolean;
  /** True when the full parse must also look for dynamic imports (INW011). */
  dynamic: boolean;
}

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
   * Checks one file against every rule.
   * The package shape (INW007) comes first and reads only the path. Then only
   * the import skeleton is parsed. Violations are rare, so the full parse runs
   * only to confirm one (or when the prescan declines the file), and not even
   * then when a baseline accepts them all (see `checkFiles`).
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
   * A file outside every layer isn't parsed: besides its shape, it gets at
   * most an INW006 warning naming its package.
   *
   * @param file - the source file as read by the adapter.
   * @param project - the project's module index (see `index`).
   * @returns the violations found, empty when the file is clean.
   */
  checkFile(file: SourceFile, project: ProjectIndex): Diagnostic[] {
    const src = { ...file, text: normalizeSource(file.text) };
    const { ownerOf } = project;
    return [
      ...checkShape(src, this.config),
      ...this.confirm(src, this.scan(src, ownerOf), ownerOf),
    ];
  }

  /**
   * Applies the text rules that need no full parse, see `checkFile`.
   *
   * @param src - the source file, with normalised text.
   * @param ownerOf - finds the first-party module an import lands in (INW006).
   * @returns the findings so far, and what the full parse would still have to do.
   */
  private scan(src: SourceFile, ownerOf: ModuleLookup): Scan {
    if (layerIndexOf(src.module, this.config.layers) === -1) {
      const warning = unassignedWarning(src, this.config);
      return { found: warning ? [warning] : [], exact: true, dynamic: false };
    }
    const unreadable = checkEncoding(src);
    if (unreadable) {
      return { found: [unreadable], exact: true, dynamic: false };
    }
    const dynamic = mentionsDynamicImport(src.text);
    const fast = dynamic ? null : skeletonImports(this.parser, src);
    const found = fast ? this.importFindings(src, fast, ownerOf) : null;
    return { found, exact: found?.length === 0, dynamic };
  }

  /**
   * Finishes a scan: exact findings stand, anything else gets the full parse,
   * unless `skip` says the baseline hides every skeleton finding anyway.
   *
   * @param src - the source file, with normalised text.
   * @param scan - its scan.
   * @param ownerOf - finds the first-party module an import lands in (INW006).
   * @param skip - true to return the skeleton's findings unconfirmed.
   * @returns the violations found.
   */
  private confirm(src: SourceFile, scan: Scan, ownerOf: ModuleLookup, skip = false): Diagnostic[] {
    if (scan.found && (scan.exact || skip)) {
      return scan.found;
    }
    return this.fullCheck(src, scan.dynamic, ownerOf);
  }

  /**
   * Applies the rules that look at import statements: INW001, INW005 and INW006.
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
      ...checkLibraries(file, imports, layers, ownerOf),
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
        const readable = refs.filter((ref) => ref.unreadable === null);
        found.push(
          ...checkDynamicImports(file, refs, layers),
          ...checkLibraries(file, readable, layers, ownerOf),
          ...checkUnassignedImports(file, readable, layers, ownerOf),
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
   * Builds the project's module index, the input `checkFile` and `checkFiles`
   * take. Free: nothing is listed or read until a rule asks (see
   * `ProjectIndex`). The reverse-import map reads imports skeleton-first,
   * like `checkFile`.
   *
   * @param files - the adapter's view of the files under the config root.
   * @returns the index.
   */
  index(files: ProjectFiles): ProjectIndex {
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
   * With `accepted`, the baseline's copies by key (see `baselineKey`), a
   * module the baseline hides in full skips the confirming parse: every file
   * of it is scanned first, and if the skeleton's findings, false positives
   * included, add up to no more than the accepted copies of each key, the
   * real ones do too, so the adapter's baseline hides them all either way.
   * Those findings are returned unconfirmed. See `acceptedModules`.
   *
   * @param files - the source files to check.
   * @param project - the project's module index (see `index`).
   * @param accepted - accepted copies by baseline key, when a baseline applies.
   * @returns every violation across all files, baselined ones included.
   */
  checkFiles(
    files: Iterable<SourceFile>,
    project: ProjectIndex,
    accepted?: ReadonlyMap<string, number>,
  ): Diagnostic[] {
    const { ownerOf } = project;
    const scanned = [...files].map((file) => {
      const src = { ...file, text: normalizeSource(file.text) };
      return { src, scan: this.scan(src, ownerOf) };
    });
    const hidden = accepted
      ? acceptedModules(
          scanned.map(({ src, scan }) => ({ module: src.module, found: scan.found })),
          accepted,
        )
      : new Set<string>();
    const all: Diagnostic[] = [];
    const warned = new Set<string>();
    for (const { src, scan } of scanned) {
      const skip = hidden.has(src.module);
      for (const found of [
        ...checkShape(src, this.config),
        ...this.confirm(src, scan, ownerOf, skip),
      ]) {
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
