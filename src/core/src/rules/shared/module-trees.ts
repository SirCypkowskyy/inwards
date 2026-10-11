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
import type { SourceFile } from "../../contracts/records.ts";
import { normalizeSource, parsePython } from "../../python/parser.ts";

/** What reading first-party modules needs from the project; `ProjectIndex` provides it. */
export interface FirstPartySource {
  /** Finds the first-party module that owns a dotted name, if any. */
  readonly ownerOf: (target: string) => string | undefined;
  /** Reads a first-party module's file, if one holds it. */
  readonly sourceOf: (module: string) => SourceFile | undefined;
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
    const src = this.project.sourceOf(module);
    let parsed: ParsedModule | undefined;
    if (src !== undefined) {
      const text = normalizeSource(src.text);
      parsed = { tree: parsePython(this.parser, text), src: { ...src, text } };
    }
    this.parsed.set(module, parsed);
    return parsed;
  }

  /**
   * Finds the tree of a file the run already parsed as a first-party module,
   * so a rule that checks the file needn't parse it again. Never parses.
   *
   * @param src - the checked file, with normalised text.
   * @returns the run's tree when it holds the same path and text, else undefined;
   *   the run frees it, not the caller.
   */
  parsedAs(src: SourceFile): Tree | undefined {
    const parsed = this.parsed.get(src.module);
    return parsed?.src.path === src.path && parsed.src.text === src.text ? parsed.tree : undefined;
  }

  /** Frees every tree read so far; the views and nodes handed out are invalid afterwards. */
  dispose(): void {
    for (const parsed of this.parsed.values()) {
      parsed?.tree.delete(); // WASM memory is not garbage collected
    }
    this.parsed.clear();
  }
}
