/**
 * @file The first-party modules one run reads on the content rules' behalf
 * (#359): each is read and parsed at most once, whichever rule and checked
 * file asks first, because a large async codebase calls the same helper
 * modules from hundreds of files. The engine builds one per run and frees
 * every tree with `dispose()` at its end. It reads files only through the
 * project port the caller passes, and builds no rule's view of them
 * (`first-party.ts` does).
 */
import type { Parser, Tree } from "web-tree-sitter";
import type { ImportRef, SourceFile } from "../../contracts/records.ts";
import { normalizeSource, parsePython } from "../../python/parser.ts";
import { skeletonImports } from "../../python/prescan.ts";

/** What reading first-party modules needs from the project; `ProjectIndex` provides it. */
export interface FirstPartySource {
  /** Finds the first-party module that owns a dotted name, if any. */
  readonly ownerOf: (target: string) => string | undefined;
  /** Reads a first-party module's file, if one holds it. */
  readonly sourceOf: (module: string) => SourceFile | undefined;
  /** Every first-party module the project's listing holds, when the source can list them. */
  readonly modules?: ReadonlySet<string>;
}

/** A first-party module as one run parsed it. */
export interface ParsedModule {
  readonly tree: Tree;
  /** Its file, with normalised text. */
  readonly src: SourceFile;
}

/**
 * The first-party modules one run reads on the content rules' behalf, each
 * parsed at most once, whichever rule and checked file asks first. The
 * engine builds one per run (a `check` of many files, or one file's check)
 * and calls `dispose()` at its end; until then the trees stay alive, so the
 * nodes the rules' views hold stay valid.
 */
export class ModuleTrees {
  private readonly parser: Parser;
  private readonly project: FirstPartySource;
  private readonly parsed = new Map<string, ParsedModule | undefined>();
  private readonly sources = new Map<string, SourceFile | undefined>();

  /**
   * Wraps the parser and the project. Nothing is read yet.
   *
   * @param parser - parser with the Python grammar loaded.
   * @param project - finds and reads first-party modules.
   */
  constructor(parser: Parser, project: FirstPartySource) {
    this.parser = parser;
    this.project = project;
  }

  /**
   * Finds the first-party module that owns a dotted name.
   *
   * @param target - a dotted name, e.g. `shop.api.views.create_order`.
   * @returns the module, or undefined when no first-party module owns it.
   */
  ownerOf(target: string): string | undefined {
    return this.project.ownerOf(target);
  }

  /**
   * Reads and parses a first-party module, once per run.
   *
   * @param module - a dotted module name.
   * @returns its tree and normalised file, or undefined when no file holds it.
   */
  moduleOf(module: string): ParsedModule | undefined {
    if (this.parsed.has(module)) {
      return this.parsed.get(module);
    }
    const src = this.sourceOf(module);
    const parsed =
      src === undefined ? undefined : { tree: parsePython(this.parser, src.text), src };
    this.parsed.set(module, parsed);
    return parsed;
  }

  /**
   * Reads a first-party module's file without parsing it, once per run: the
   * same file and text `moduleOf` parses.
   *
   * @param module - a dotted module name.
   * @returns the file with normalised text, or undefined when no file holds it.
   */
  sourceOf(module: string): SourceFile | undefined {
    if (this.sources.has(module)) {
      return this.sources.get(module);
    }
    const src = this.project.sourceOf(module);
    const read = src === undefined ? undefined : { ...src, text: normalizeSource(src.text) };
    this.sources.set(module, read);
    return read;
  }

  /**
   * Reads a file's imports from its import skeleton (the prescan), without
   * parsing the whole file. Nothing is kept.
   *
   * @param src - a file, with normalised text.
   * @returns the imports, or undefined when the prescan declines the file.
   */
  skeletonOf(src: SourceFile): readonly ImportRef[] | undefined {
    return skeletonImports(this.parser, src) ?? undefined;
  }

  /**
   * Lists the project's first-party modules, for a rule that must read every
   * module a name could lead to before it skips a file.
   *
   * @returns the listed modules, or undefined when the project can't list them.
   */
  listed(): ReadonlySet<string> | undefined {
    return this.project.modules;
  }

  /**
   * Finds the tree of a file the run already parsed as a first-party module,
   * so a rule that checks the file needn't parse it again. Never parses.
   *
   * The tree depends on the text alone, so the paths needn't agree: the CLI
   * names a checked file from the working directory and the index from the
   * config root.
   *
   * @param src - the checked file, with normalised text.
   * @returns the run's tree when it parsed the same module from the same text,
   *   else undefined; the run frees it, not the caller.
   */
  parsedAs(src: SourceFile): Tree | undefined {
    const parsed = this.parsed.get(src.module);
    return parsed?.src.text === src.text ? parsed.tree : undefined;
  }

  /** Frees every tree read so far; the views and nodes handed out are invalid afterwards. */
  dispose(): void {
    for (const parsed of this.parsed.values()) {
      parsed?.tree.delete(); // WASM memory is not garbage collected
    }
    this.parsed.clear();
    this.sources.clear();
  }
}
