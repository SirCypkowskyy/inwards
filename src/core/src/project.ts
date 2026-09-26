/**
 * The project-wide view the per-file rules can't give: which first-party
 * module an import lands in, every first-party module, and who imports a
 * given module. It is the engine's project input (ADR-006): every adapter
 * (the CLI's check, hook and Stop gate, the language server) builds one with
 * `Engine.index` over its own file system and passes it to `checkFile` or
 * `checkFiles`. INW006 asks it for the owner of an import; INW010 (#45) will
 * ask it whether a first-party module exists and which real ones are close.
 *
 * Building one reads nothing, so the hook pays only for what a rule asks.
 */
import { moduleNameFor } from "./python.ts";
import type { ImportRef, SourceFile } from "./types.ts";
import { type ModuleLookup, type PathKind, probeLookup } from "./unassigned.ts";

const NON_ASCII = /[^ -~\t\n\r\f]/u;

/** Reads the imports of one file; the engine supplies it, so this module needs no parser. */
type ImportReader = (file: SourceFile) => readonly ImportRef[];

/** A listed Python file, before its text is read. */
type Listed = Omit<SourceFile, "text">;

/**
 * What an adapter supplies to index a project: the port (ADR-006). Paths are
 * relative to the config root, with forward slashes. The CLI and the language
 * server list with the same walk rules (hidden entries, node_modules,
 * __pycache__ and virtualenvs skipped; symlinks followed inside the root),
 * except that the CLI skips nothing but hidden entries inside a layer's
 * top-level package. `ownerOf` probes, so it agrees in both.
 */
export interface ProjectFiles {
  /** Tells what is at a path; `ownerOf` probes through it, one path at a time. */
  kind: PathKind;
  /** Lists every Python file under the config root. Called at most once, on first use of `modules` or `importersOf`. */
  list: () => readonly string[];
  /** Reads a listed file's text. Called only by `importersOf`, at most once per file. */
  read: (path: string) => string;
}

/**
 * A project's first-party modules, answered on demand.
 *
 * - `ownerOf` probes the file system for each query (see `probeLookup`), so
 *   it is never stale and never walks the tree. It follows Python: a module
 *   in a directory the listing skips still has an owner.
 * - `modules` lists the tree once, on first use; nothing is read or parsed.
 * - `importersOf` reads and parses only candidate files: those whose
 *   NFKC-normalised text mentions the module's last name segment (an
 *   absolute import spells it; identifiers can't be split across lines), and
 *   those inside the module's package, because a relative import such as
 *   `from . import *` or `from .. import helper` reaches a package without
 *   spelling its name.
 *
 * Incremental updates: the index caches the listing and the texts it has
 * read, and never sees later changes. A long-lived adapter (the language
 * server) builds a new one when a Python file is created, deleted or
 * renamed; building is free until a rule asks. Editing a file changes
 * neither `ownerOf` nor `modules`, only `importersOf`, so an adapter that
 * relies on `importersOf` rebuilds on saves too.
 */
export class ProjectIndex {
  /** Finds the first-party module an import target lives in, e.g. `shop.domain.order` for `shop.domain.order.Order`. */
  readonly ownerOf: ModuleLookup;
  private readonly source: ProjectFiles;
  private readonly readImports: ImportReader;
  private listed: readonly Listed[] | undefined;
  private names: ReadonlySet<string> | undefined;
  private readonly imports = new Map<string, readonly ImportRef[]>();
  private readonly normalised = new Map<string, string>();
  private readonly texts = new Map<string, string>();
  private readonly importers = new Map<string, ReadonlySet<string>>();

  /**
   * Wraps an adapter's file system. Nothing is listed or read yet.
   *
   * @param source - the adapter's listing, probe and reader, rooted at the config root.
   * @param readImports - reads one file's imports (skeleton first, full parse as fallback).
   */
  constructor(source: ProjectFiles, readImports: ImportReader) {
    this.source = source;
    this.readImports = readImports;
    this.ownerOf = probeLookup(source.kind);
  }

  /**
   * Dotted names of every first-party module file, e.g. `shop.domain.order`
   * (`shop` for `shop/__init__.py`). Lists the tree on first use.
   *
   * @returns the module names.
   */
  get modules(): ReadonlySet<string> {
    this.names ??= new Set(this.files().map((file) => file.module));
    return this.names;
  }

  /**
   * Lists the modules that import a module directly.
   * For a package, that means imports that resolve to the package itself
   * (`import shop.domain`, `from shop.domain import helper` where `helper` is
   * not a module): the longest matching module wins. Importing a submodule
   * also runs the package's `__init__.py`, but does not count here.
   * Imports the prescan finds inside strings can add a spurious importer.
   * That makes a caller re-check a file too many, never too few. A file whose
   * declared encoding hides its text (INW000) is only found here if the
   * segment is also spelled out plainly; it is reported on its own check.
   *
   * @param module - a dotted module name.
   * @returns the importing modules, empty when none import it.
   */
  importersOf(module: string): ReadonlySet<string> {
    const cached = this.importers.get(module);
    if (cached !== undefined) {
      return cached;
    }
    const segment = module.split(".").at(-1) ?? module;
    const found = new Set<string>();
    for (const file of this.files()) {
      const candidate = file.module.startsWith(`${module}.`) || this.mentions(file, segment);
      if (file.module !== module && candidate && this.fileImports(file, module)) {
        found.add(file.module);
      }
    }
    this.importers.set(module, found);
    return found;
  }

  /**
   * Lists the project's Python files under their module names, once.
   *
   * @returns every listed file, text not yet read.
   */
  private files(): readonly Listed[] {
    this.listed ??= this.source.list().map((path) => ({ path, ...moduleNameFor(path) }));
    return this.listed;
  }

  /**
   * Reads a listed file's text through the adapter, once.
   *
   * @param file - a listed file.
   * @returns its text.
   */
  private text(file: Listed): string {
    let text = this.texts.get(file.path);
    if (text === undefined) {
      text = this.source.read(file.path);
      this.texts.set(file.path, text);
    }
    return text;
  }

  /**
   * Tells whether a file's NFKC-normalised text contains a word.
   *
   * @param file - a listed file.
   * @param word - the text to look for.
   * @returns true when the word appears anywhere in the file.
   */
  private mentions(file: Listed, word: string): boolean {
    let text = this.normalised.get(file.path);
    if (text === undefined) {
      const raw = this.text(file);
      // NFKC only changes non-ASCII text; most files skip the (slow) call.
      text = NON_ASCII.test(raw) ? raw.normalize("NFKC") : raw;
      this.normalised.set(file.path, text);
    }
    return text.includes(word);
  }

  /**
   * Tells whether a file imports a module, reading its imports once.
   *
   * @param file - a listed file.
   * @param module - a dotted module name.
   * @returns true when one of the file's imports resolves to that module.
   */
  private fileImports(file: Listed, module: string): boolean {
    let refs = this.imports.get(file.path);
    if (refs === undefined) {
      refs = this.readImports({ ...file, text: this.text(file) });
      this.imports.set(file.path, refs);
    }
    // The owner is a prefix of the target, so the string test spares most probes.
    return refs.some(
      (ref) =>
        (ref.target === module || ref.target.startsWith(`${module}.`)) &&
        this.ownerOf(ref.target) === module,
    );
  }
}
