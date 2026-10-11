/**
 * @file The syntax trees one run shares across its content rules (#359,
 * #387): the first-party modules they follow into and the checked files
 * themselves. Each text is parsed at most once per run, whichever rule,
 * checked file or hop asks first, because a large codebase has INW012,
 * INW013, INW015, INW016 and the FastAPI rules reading the same files. The
 * engine builds one per run and frees every tree with `dispose()` at its
 * end. It reads files only through the project port the caller passes, and
 * builds no rule's view of them (`first-party.ts` does).
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

/** Hands out a file's syntax tree; the owner, not the caller, frees it. */
export interface FileTrees {
  /** Gives the tree of a file (normalised text), parsed at most once per run and valid until it ends. */
  readonly treeOf: (src: SourceFile) => Tree;
}

/** A first-party module as one run parsed it. */
export interface ParsedModule {
  readonly tree: Tree;
  /** Its file, with normalised text. */
  readonly src: SourceFile;
}

/**
 * The trees one run parses on the content rules' behalf, the checked files'
 * and the first-party modules' they follow into, each text parsed at most
 * once, whichever rule and file asks first. The engine builds one per run (a
 * `check` of many files, or one file's check) and calls `dispose()` at its
 * end; until then the trees stay alive, so the nodes the rules' views hold
 * stay valid.
 */
export class ModuleTrees implements FileTrees {
  private readonly parser: Parser;
  private readonly project: FirstPartySource;
  private readonly parsed = new Map<string, ParsedModule | undefined>();
  private readonly sources = new Map<string, SourceFile | undefined>();
  /** Every tree of the run by the text it was parsed from: the tree depends on the text alone. */
  private readonly trees = new Map<string, Tree>();

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
    const parsed = src === undefined ? undefined : { tree: this.treeOf(src), src };
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
   * Gives the tree of a file's text, parsing it only when no rule, checked
   * file or hop of the run has parsed the same text yet.
   *
   * The tree depends on the text alone, so the paths needn't agree: the CLI
   * names a checked file from the working directory and the index from the
   * config root, and a checked file and the module a hop reads share one tree.
   *
   * @param src - the file, with normalised text.
   * @returns its tree; the run frees it, not the caller.
   */
  treeOf(src: SourceFile): Tree {
    let tree = this.trees.get(src.text);
    if (tree === undefined) {
      tree = parsePython(this.parser, src.text);
      this.trees.set(src.text, tree);
    }
    return tree;
  }

  /** Frees every tree read so far; the views and nodes handed out are invalid afterwards. */
  dispose(): void {
    for (const tree of this.trees.values()) {
      tree.delete(); // WASM memory is not garbage collected
    }
    this.trees.clear();
    this.parsed.clear();
    this.sources.clear();
  }
}
