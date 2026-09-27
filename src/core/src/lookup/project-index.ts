/**
 * @file The project-wide view the per-file rules can't give: which first-party
 * module an import lands in, every first-party module, and who imports a
 * given module. It is the engine's project input (ADR-006): every adapter
 * (the CLI's check, hook and Stop gate, the language server) builds one with
 * `Engine.index` over its own file system and passes it to `checkFile` or
 * `checkFiles`. INW006 asks it for the owner of an import; INW010 asks
 * `ownerOf` whether a first-party module exists, and `listDir` what the
 * package it would live in holds.
 *
 * Building one reads nothing, so the hook pays only for what a rule asks.
 */

import type { ImportRef, SourceFile } from "../contracts/records.ts";
import { moduleNameFor } from "../python/module-names.ts";
import type { ListDir } from "./directory-listing.ts";
import { type ModuleLookup, type PathKind, probeLookup } from "./module-lookup.ts";

const NON_ASCII = /[^ -~\t\n\r\f]/u;
/** What a package's `__init__.py` spells when it merges with packages elsewhere (pkgutil or pkg_resources style). */
const EXTENDS_PATH = /__path__|declare_namespace/u;
/** A Python identifier in ASCII, the only names `exposes` looks for. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/u;

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
  /** Reads a file's text: a listed file for `importersOf`, a package's `__init__.py` for `extendsPath`; each at most once. */
  read: (path: string) => string;
  /** Lists one directory: INW010 reads the package a missing module would live in. */
  listDir: ListDir;
}

/**
 * A project's first-party modules, answered on demand.
 *
 * - `ownerOf` probes the file system (see `probeLookup`), each path at most
 *   once, and never walks the tree. It follows Python, not the
 *   listing, and so does `importersOf`, which resolves owners through it: it
 *   can return a name missing from `modules`, such as a namespace package (a
 *   directory without `__init__.py`), a module under a virtualenv or
 *   node_modules the listing skips, or one behind a symlink that leaves the root.
 * - `modules` lists the tree once, on first use; nothing is read or parsed.
 * - `importersOf` reads and parses only candidate files: those whose
 *   NFKC-normalised text mentions the module's last name segment (an
 *   absolute import spells it; identifiers can't be split across lines), and
 *   those inside the module's package, because a relative import such as
 *   `from . import *` or `from .. import helper` reaches a package without
 *   spelling its name.
 *
 * Incremental updates: the index caches the listing, the paths it has
 * probed and the texts it has read, and never sees later changes. A
 * long-lived adapter (the language server) builds a new one when any file
 * or directory is created, deleted or renamed; building is free until a rule
 * asks. Editing a file changes neither `ownerOf` nor `modules`, only
 * `importersOf` and `extendsPath`, so an adapter that relies on those
 * rebuilds on saves too.
 */
export class ProjectIndex {
  /** Finds the first-party module an import target lives in, e.g. `shop.domain.order` for `shop.domain.order.Order`. */
  readonly ownerOf: ModuleLookup;
  /** Lists one directory under the config root, uncached. */
  readonly listDir: ListDir;
  private readonly source: ProjectFiles;
  private readonly readImports: ImportReader;
  private listed: readonly Listed[] | undefined;
  private names: ReadonlySet<string> | undefined;
  private readonly imports = new Map<string, readonly ImportRef[]>();
  private readonly normalised = new Map<string, string>();
  private readonly texts = new Map<string, string>();
  private readonly importers = new Map<string, ReadonlySet<string>>();
  private readonly extended = new Map<string, boolean>();

  /**
   * Wraps an adapter's file system. Nothing is listed or read yet.
   *
   * @param source - the adapter's listing, probe and reader, rooted at the config root.
   * @param readImports - reads one file's imports (skeleton first, full parse as fallback).
   */
  constructor(source: ProjectFiles, readImports: ImportReader) {
    this.source = source;
    this.readImports = readImports;
    this.listDir = source.listDir;
    // Imports share prefixes, so each path is probed once: INW010 asks for every import.
    // A long-lived adapter must rebuild the index when a path that could be a module is
    // created or deleted; the language server does, or builds one per check without file events.
    const kinds = new Map<string, ReturnType<PathKind>>();
    this.ownerOf = probeLookup((rel: string): ReturnType<PathKind> => {
      if (!kinds.has(rel)) {
        kinds.set(rel, source.kind(rel));
      }
      return kinds.get(rel);
    });
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
   * Tells whether a package, or one above it, extends its `__path__` in its
   * `__init__.py` (`pkgutil.extend_path`, `pkg_resources.declare_namespace`):
   * its submodules may then live outside the project, such as an installed
   * SDK that shares the top-level name. Reads each `__init__.py` once.
   *
   * @param module - a dotted package name.
   * @returns true when any `__init__.py` on the way down mentions `__path__` or `declare_namespace`.
   */
  extendsPath(module: string): boolean {
    const parts = module.split(".");
    return parts.some((_, i) => {
      const init = `${parts.slice(0, i + 1).join("/")}/__init__.py`;
      let found = this.extended.get(init);
      if (found === undefined) {
        found = this.source.kind(init) === "file" && EXTENDS_PATH.test(this.source.read(init));
        this.extended.set(init, found);
      }
      return found;
    });
  }

  /**
   * Tells whether a module defines a name at its top level (`def`, `class`,
   * an assignment) or imports it, so other code can import the name from
   * there: INW003's fix names the public module that does. Aliased imports
   * (`as`) and `__all__` aren't followed. Reads the module once.
   *
   * @param module - a dotted module name.
   * @param name - an identifier, e.g. `Discount`.
   * @returns true when the module's file defines or imports the name.
   */
  exposes(module: string, name: string): boolean {
    const file = IDENTIFIER.test(name) ? this.fileOf(module) : undefined;
    if (file === undefined) {
      return false;
    }
    const defines = new RegExp(
      `^(?:(?:async[ \\t]+)?def|class)[ \\t]+${name}\\b|^${name}[ \\t]*(?::|=(?!=))`,
      "mu",
    );
    return (
      defines.test(this.text(file)) || this.importsOf(file).some((ref) => bindsName(ref, name))
    );
  }

  /**
   * Finds a module's file on disk: `a/b.py`, else `a/b/__init__.py`.
   *
   * @param module - a dotted module name.
   * @returns the file, text not yet read, or undefined when neither exists.
   */
  private fileOf(module: string): Listed | undefined {
    const base = module.split(".").join("/");
    const path = [`${base}.py`, `${base}/__init__.py`].find(
      (candidate) => this.source.kind(candidate) === "file",
    );
    return path === undefined ? undefined : { path, ...moduleNameFor(path) };
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
    // The owner is a prefix of the target, so the string test spares most probes.
    return this.importsOf(file).some(
      (ref) =>
        (ref.target === module || ref.target.startsWith(`${module}.`)) &&
        this.ownerOf(ref.target) === module,
    );
  }

  /**
   * Reads a file's imports through the engine's reader, once.
   *
   * @param file - a listed file.
   * @returns its imports.
   */
  private importsOf(file: Listed): readonly ImportRef[] {
    let refs = this.imports.get(file.path);
    if (refs === undefined) {
      refs = this.readImports({ ...file, text: this.text(file) });
      this.imports.set(file.path, refs);
    }
    return refs;
  }
}

/**
 * Tells whether an import binds a name in the importing module: `from X
 * import name` and `import name` do, unless `as` renames it.
 *
 * @param ref - one import of the module.
 * @param name - an identifier.
 * @returns true when the import makes `name` importable from the module.
 */
function bindsName(ref: ImportRef, name: string): boolean {
  const bound = ref.from === undefined ? name : `${ref.from}.${name}`;
  const renamed = new RegExp(`\\b${name}[ \\t]+as\\b`, "u");
  return ref.target === bound && !renamed.test(ref.statement);
}
