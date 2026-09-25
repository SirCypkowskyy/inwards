/**
 * The project-wide view the per-file rules can't give: every first-party
 * module, and who imports each one. The Stop gate uses the importers to
 * re-check files that depend on an edited module; INW006 uses the module set
 * to find packages that belong to no layer.
 */
import type { ImportRef, SourceFile } from "./types.ts";

const NON_ASCII = /[^ -~\t\n\r\f]/u;

/** Reads the imports of one file; the engine supplies it, so this module needs no parser. */
type ImportReader = (file: SourceFile) => readonly ImportRef[];

/**
 * Every module of a project, and who imports a given module, answered on demand.
 * Reading every file's imports costs about as much as a full check, so
 * `importersOf` only parses files whose text mentions the module's last name
 * segment. An import can't name a module without spelling that segment
 * (identifiers can't be split across lines), and the text is NFKC-normalised
 * first, as Python does with identifiers.
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
      if (
        file.module !== module &&
        this.mentions(file, segment) &&
        this.fileImports(file, module)
      ) {
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
