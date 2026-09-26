/**
 * The project-wide view the per-file rules can't give: every first-party
 * module, and who imports each one. No command, hook or adapter uses it yet: the Stop
 * gate checks only the changed files (an import's verdict depends only on
 * module names), and INW006 probes the file system (`probeLookup`). Only the
 * tests call it today; #44 makes it an engine input for every adapter, and
 * INW010 (imports of first-party modules that don't exist, #45) needs it.
 */
import type { ImportRef, SourceFile } from "./types.ts";

const NON_ASCII = /[^ -~\t\n\r\f]/u;

/** Reads the imports of one file; the engine supplies it, so this module needs no parser. */
type ImportReader = (file: SourceFile) => readonly ImportRef[];

/**
 * Every module of a project, and who imports a given module, answered on demand.
 * Reading every file's imports costs about as much as a full check, so
 * `importersOf` only parses candidate files:
 *
 * - files whose NFKC-normalised text mentions the module's last name segment
 *   (an absolute import spells it; identifiers can't be split across lines);
 * - files inside the module's package, because a relative import such as
 *   `from . import *` or `from .. import helper` reaches a package without
 *   spelling its name.
 */
export class ProjectIndex {
  /** Dotted names of every first-party module, e.g. `shop.domain.order`. */
  readonly modules: ReadonlySet<string>;
  private readonly files: readonly SourceFile[];
  private readonly readImports: ImportReader;
  private readonly imports = new Map<SourceFile, readonly ImportRef[]>();
  private readonly normalised = new Map<SourceFile, string>();
  private readonly importers = new Map<string, ReadonlySet<string>>();

  /**
   * Indexes the modules of the given files. No file is parsed yet.
   *
   * @param files - every source file of the project, under each of its module names.
   * @param readImports - reads one file's imports (skeleton first, full parse as fallback).
   */
  constructor(files: readonly SourceFile[], readImports: ImportReader) {
    this.files = files;
    this.readImports = readImports;
    this.modules = new Set(files.map((file) => file.module));
  }

  /**
   * Finds the first-party module an import target lives in.
   * `from shop.domain.order import Order` targets `shop.domain.order.Order`,
   * which lives in `shop.domain.order`: the longest prefix that is a module.
   *
   * @param target - a resolved dotted import target.
   * @returns the owning module, or undefined for a third-party or missing one.
   */
  ownerOf(target: string): string | undefined {
    const parts = target.split(".");
    for (let end = parts.length; end > 0; end -= 1) {
      const candidate = parts.slice(0, end).join(".");
      if (this.modules.has(candidate)) {
        return candidate;
      }
    }
    return undefined;
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
    for (const file of this.files) {
      const candidate = file.module.startsWith(`${module}.`) || this.mentions(file, segment);
      if (file.module !== module && candidate && this.fileImports(file, module)) {
        found.add(file.module);
      }
    }
    this.importers.set(module, found);
    return found;
  }

  /**
   * Tells whether a file's NFKC-normalised text contains a word.
   *
   * @param file - a source file.
   * @param word - the text to look for.
   * @returns true when the word appears anywhere in the file.
   */
  private mentions(file: SourceFile, word: string): boolean {
    let text = this.normalised.get(file);
    if (text === undefined) {
      // NFKC only changes non-ASCII text; most files skip the (slow) call.
      text = NON_ASCII.test(file.text) ? file.text.normalize("NFKC") : file.text;
      this.normalised.set(file, text);
    }
    return text.includes(word);
  }

  /**
   * Tells whether a file imports a module, reading its imports once.
   *
   * @param file - a source file.
   * @param module - a dotted module name.
   * @returns true when one of the file's imports resolves to that module.
   */
  private fileImports(file: SourceFile, module: string): boolean {
    let refs = this.imports.get(file);
    if (refs === undefined) {
      refs = this.readImports(file);
      this.imports.set(file, refs);
    }
    return refs.some((ref) => this.ownerOf(ref.target) === module);
  }
}
