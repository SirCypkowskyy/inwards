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

/** Reads the names a file binds at its top level; the engine supplies it too. */
type BindingReader = (file: SourceFile) => ReadonlySet<string>;

/**
 * Where a module path stands in a pruned search of the tree (`holdsMatch`):
 * the pattern matches it, could match something below it, or can't.
 */
export type TreeStep = "match" | "descend" | "prune";

/** One directory's entries, as `listDir` gives them. */
type Entries = ReturnType<ListDir>;

/** A Python source or stub file name, with its stem. */
const PYTHON_FILE = /^(?<stem>.+)\.pyi?$/u;

/** A listed Python file, before its text is read. */
type Listed = Omit<SourceFile, "text">;

/**
 * What an adapter supplies to index a project: the port (ADR-006). Paths are
 * relative to the config root, with forward slashes. The CLI and the language
 * server list with the same walk rules (hidden entries, node_modules,
 * __pycache__ and virtualenvs skipped; symlinks followed inside the root),
 * and both skip nothing but hidden entries inside a layer's top-level
 * package (`layerPackages`). `ownerOf` probes, so it agrees in both.
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
  /**
   * Tells what is at a path relative to the other directories Python merges
   * namespace packages from (another uv workspace member's import root, the
   * project virtualenv's site-packages), so INW010 doesn't report a module
   * another portion holds. None by default.
   */
  portions?: PathKind;
}

/**
 * A project's first-party modules, answered on demand.
 *
 * - `ownerOf` probes the file system (see `probeLookup`), each path at most
 *   once, and never walks the tree; a compiled or sourceless module
 *   (`.so`, `.pyd`, `.pyc`, `.pyx`) is found in its package's listing. It follows Python, not the
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
  private readonly readBindings: BindingReader | undefined;
  private readonly bindings = new Map<string, ReadonlySet<string>>();
  private listed: readonly Listed[] | undefined;
  private names: ReadonlySet<string> | undefined;
  private readonly imports = new Map<string, readonly ImportRef[]>();
  private readonly normalised = new Map<string, string>();
  private readonly texts = new Map<string, string>();
  private readonly importers = new Map<string, ReadonlySet<string>>();
  private readonly extended = new Map<string, boolean>();
  /** Finds a module in the other portions of namespace packages, when the adapter gave any. */
  private readonly portions: ModuleLookup | undefined;
  private readonly dirs = new Map<string, Entries>();
  private readonly pythonBelow = new Map<string, boolean>();
  private readonly held = new Map<string, boolean>();

  /**
   * Wraps an adapter's file system. Nothing is listed or read yet.
   *
   * @param source - the adapter's listing, probe and reader, rooted at the config root.
   * @param readImports - reads one file's imports (skeleton first, full parse as fallback).
   * @param readBindings - reads the names one file binds at its top level (full parse), for `exposes`.
   */
  constructor(source: ProjectFiles, readImports: ImportReader, readBindings?: BindingReader) {
    this.source = source;
    this.readImports = readImports;
    this.readBindings = readBindings;
    this.listDir = source.listDir;
    this.portions = source.portions ? probeLookup(source.portions) : undefined;
    // Imports share prefixes, so each path is probed once: INW010 asks for every import.
    // A long-lived adapter must rebuild the index when a path that could be a module is
    // created or deleted; the language server does, or builds one per check without file events.
    const kinds = new Map<string, ReturnType<PathKind>>();
    /**
     * Lists a directory once, for the compiled modules the probe looks for.
     *
     * @param dir - a directory relative to the config root, `""` for the root.
     * @returns its entries, or undefined when it isn't a readable directory.
     */
    const listed = (dir: string): Entries => this.entries(dir);
    const lookup = probeLookup((rel: string): ReturnType<PathKind> => {
      if (!kinds.has(rel)) {
        kinds.set(rel, source.kind(rel));
      }
      return kinds.get(rel);
    }, listed);
    // Several rules, and the import graph, ask about the same targets.
    const owners = new Map<string, string | undefined>();
    this.ownerOf = (target: string): string | undefined => {
      if (!owners.has(target)) {
        owners.set(target, lookup(target));
      }
      return owners.get(target);
    };
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
   * Tells whether a module missing under the config root belongs to another
   * portion of its namespace package (PEP 420). Its owner here must be an
   * implicit namespace package all the way down (no `__init__.py` or
   * `__init__.pyi` from the top-level package on), since Python merges only
   * those from every directory that has them. Then the module counts when
   * the adapter's `portions` probe finds it (another uv workspace member,
   * the project's virtualenv), or when the owner is one of the `shared`
   * namespace packages the config lists: a name directly inside it that
   * isn't here comes from an installed distribution. A missing module deeper
   * down, inside a subpackage that is here, still needs a portion to hold it.
   *
   * @param module - the dotted module that isn't under the config root.
   * @param owner - its longest existing prefix here, a package.
   * @param shared - the namespace packages the config says installed distributions add to.
   * @returns true when another portion holds, or may hold, the module.
   */
  inOtherPortion(module: string, owner: string, shared: readonly string[] = []): boolean {
    const { portions } = this;
    if (portions === undefined && !shared.includes(owner)) {
      return false;
    }
    const parts = owner.split(".");
    const namespace = parts.every((_, i) => {
      const dir = parts.slice(0, i + 1).join("/");
      return (
        this.source.kind(dir) === "dir" &&
        this.source.kind(`${dir}/__init__.py`) === undefined &&
        this.source.kind(`${dir}/__init__.pyi`) === undefined
      );
    });
    return namespace && (shared.includes(owner) || portions?.(module) === module);
  }

  /**
   * Tells whether the project has a module at or below a package that a
   * pattern matches: a path the pattern matches exactly (`step` says
   * "match") that is a module file or a directory holding Python code, with
   * everything below it. INW006 asks it whether a package holds a selector's
   * layer (`shop` holds `shop.*.domain` only when some `shop/<x>/domain`
   * holds code).
   *
   * It lists only the directories `step` lets it descend into, each once,
   * and never the whole tree; hidden entries are skipped, and a symlinked
   * directory is not followed (`listDir` reports it as no directory).
   *
   * @param pkg - a dotted package name; the search starts there.
   * @param key - names the pattern, for the cache: the same key must mean the same `step`.
   * @param step - where a module path, split on dots, stands against the pattern.
   * @returns true when some module at or below `pkg` matches.
   */
  holdsMatch(pkg: string, key: string, step: (segments: readonly string[]) => TreeStep): boolean {
    const cacheKey = `${key}\u0000${pkg}`;
    let found = this.held.get(cacheKey);
    if (found === undefined) {
      const segments = pkg.split(".");
      const base = segments.join("/");
      const here = step(segments);
      const file = [".py", ".pyi"].some((ext) => this.source.kind(`${base}${ext}`) === "file");
      found =
        here === "match"
          ? file || this.holdsPython(base)
          : here === "descend" && this.searchBelow(segments, step);
      this.held.set(cacheKey, found);
    }
    return found;
  }

  /**
   * Searches below a directory the pattern descends into (see `holdsMatch`).
   *
   * @param segments - the directory as a module path.
   * @param step - where a module path stands against the pattern.
   * @returns true when a matching module lies below it.
   */
  private searchBelow(
    segments: readonly string[],
    step: (segments: readonly string[]) => TreeStep,
  ): boolean {
    const dir = segments.join("/");
    return (this.entries(dir) ?? []).some((entry) => {
      const stem = entry.dir ? entry.name : PYTHON_FILE.exec(entry.name)?.groups?.["stem"];
      if (stem === undefined || stem === "__init__" || entry.name.startsWith(".")) {
        return false; // `__init__` is the directory itself, which didn't match
      }
      const path = [...segments, stem];
      const where = step(path);
      if (!entry.dir) {
        return where === "match";
      }
      if (where === "match") {
        return this.holdsPython(`${dir}/${entry.name}`);
      }
      return where === "descend" && this.searchBelow(path, step);
    });
  }

  /**
   * Tells whether a directory holds a Python file at any depth, hidden entries aside.
   *
   * @param dir - a directory relative to the config root.
   * @returns true when some `.py` or `.pyi` file lies below it.
   */
  private holdsPython(dir: string): boolean {
    let found = this.pythonBelow.get(dir);
    if (found === undefined) {
      found = (this.entries(dir) ?? []).some(
        (entry) =>
          !entry.name.startsWith(".") &&
          (entry.dir ? this.holdsPython(`${dir}/${entry.name}`) : PYTHON_FILE.test(entry.name)),
      );
      this.pythonBelow.set(dir, found);
    }
    return found;
  }

  /**
   * Lists a directory through the adapter, once.
   *
   * @param dir - a directory relative to the config root.
   * @returns its entries, or undefined when it isn't a directory or can't be read.
   */
  private entries(dir: string): Entries {
    if (!this.dirs.has(dir)) {
      let entries: Entries;
      try {
        entries = this.source.listDir(dir);
      } catch {
        // Unreadable: no evidence from here, so INW006 reports more, never less.
      }
      this.dirs.set(dir, entries);
    }
    return this.dirs.get(dir);
  }

  /**
   * Tells whether a module binds a name at its top level (a `def`, a
   * `class`, an assignment with a value, or an import, under its `as` name),
   * so other code can import the name from it: INW003's fix names the public
   * module that does. Reads the module's full syntax tree once, through the
   * engine's reader; without one, nothing is exposed.
   *
   * @param module - a dotted module name.
   * @param name - an identifier, e.g. `Discount`.
   * @returns true when the module's file binds the name.
   */
  exposes(module: string, name: string): boolean {
    const file = this.readBindings && IDENTIFIER.test(name) ? this.fileOf(module) : undefined;
    if (file === undefined || this.readBindings === undefined) {
      return false;
    }
    let names = this.bindings.get(file.path);
    if (names === undefined) {
      names = this.readBindings({ ...file, text: this.text(file) });
      this.bindings.set(file.path, names);
    }
    return names.has(name);
  }

  /**
   * Reads a module's source through the adapter, once: `a/b.py`, else
   * `a/b/__init__.py`, else their stubs. The FastAPI model reads the files a
   * name leads to with it, so names resolve across files without importing
   * anything.
   *
   * @param module - a dotted module name.
   * @returns the file with its text as read, or undefined when no file holds the module.
   */
  sourceOf(module: string): SourceFile | undefined {
    const file = this.fileOf(module);
    return file === undefined ? undefined : { ...file, text: this.text(file) };
  }

  /**
   * Finds a module's file on disk: `a/b.py`, `a/b/__init__.py`, then their
   * `.pyi` stubs, which describe the same names.
   *
   * @param module - a dotted module name.
   * @returns the file, text not yet read, or undefined when neither exists.
   */
  private fileOf(module: string): Listed | undefined {
    const base = module.split(".").join("/");
    const path = [`${base}.py`, `${base}/__init__.py`, `${base}.pyi`, `${base}/__init__.pyi`].find(
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
