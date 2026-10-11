/**
 * @file Reads other first-party modules for a content rule that follows a
 * name out of the checked file: INW012's handlers registered from another
 * module (#271), INW013's sync helpers one hop away (#294) and INW015's
 * classes built through a re-export. `ModuleTrees` reads and parses each
 * module at most once per run, for every rule and every checked file
 * (#359): a large async codebase calls the same helper modules from
 * hundreds of files. `ParsedModules` turns those trees into one rule's view
 * of each module, only when the rule asks for a name in it and admits it by
 * name (INW013's `follow-modules`); `follow` walks re-exports (`from .views
 * import create_order` in an `__init__.py`) up to `MAX_HOPS` times. The run
 * frees every tree with `ModuleTrees.dispose()`. It decides nothing about
 * what a rule reports, and reads files only through the project port the
 * caller passes.
 */
import type { Node, Parser, Tree } from "web-tree-sitter";
import type { SourceFile } from "../../contracts/records.ts";
import { normalizeSource, parsePython } from "../../python/parser.ts";

/** How many re-exports a name is followed through (a re-export cycle ends here). */
const MAX_HOPS = 4;

/** What reading first-party modules needs from the project; `ProjectIndex` provides it. */
export interface FirstPartySource {
  /** Finds the first-party module that owns a dotted name, if any. */
  readonly ownerOf: (target: string) => string | undefined;
  /** Reads a first-party module's file, if one holds it. */
  readonly sourceOf: (module: string) => SourceFile | undefined;
}

/** The part of a rule's view of a module that following re-exports reads. */
export interface ModuleNames {
  readonly src: SourceFile;
  /** What each name the module imports refers to, by local name. */
  readonly names: ReadonlyMap<string, string>;
}

/** A definition `follow` found, and the module that holds it. */
export interface Followed<V> {
  readonly view: V;
  readonly node: Node;
  /** The definition's name in its own module. */
  readonly rest: string;
}

/** A first-party module as one run parsed it. */
interface ParsedModule {
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

  /** Frees every tree read so far; the views and nodes handed out are invalid afterwards. */
  dispose(): void {
    for (const parsed of this.parsed.values()) {
      parsed?.tree.delete(); // WASM memory is not garbage collected
    }
    this.parsed.clear();
  }
}

/**
 * One rule's view of the other first-party modules it reads, built on demand
 * from the run's trees. Build one per check of a file; the trees belong to
 * the `ModuleTrees` it reads from.
 */
export class ParsedModules<V extends ModuleNames> {
  private readonly trees: ModuleTrees;
  private readonly read: (tree: Tree, src: SourceFile) => V;
  private readonly admit: (module: string) => boolean;
  private readonly views = new Map<string, V | undefined>();

  /**
   * Wraps the run's trees and the rule's reader. Nothing is read yet.
   *
   * @param trees - the run's first-party modules, parsed once each.
   * @param read - turns a parsed module into the rule's view; the tree stays alive until the run ends.
   * @param admit - tells whether a module may be read at all, by its dotted name; every one by default.
   */
  constructor(
    trees: ModuleTrees,
    read: (tree: Tree, src: SourceFile) => V,
    admit: (module: string) => boolean = (): boolean => true,
  ) {
    this.trees = trees;
    this.read = read;
    this.admit = admit;
  }

  /**
   * Finds a module-level definition by qualified name in a first-party
   * module, following re-exports up to `MAX_HOPS` times.
   *
   * @param target - the qualified name, e.g. `shop.api.views.create_order`.
   * @param pick - finds the definition by its name in a module.
   * @returns the module, the node and its name there, or undefined when no
   *   first-party module defines it.
   */
  follow(
    target: string,
    pick: (view: V, rest: string) => Node | undefined,
  ): Followed<V> | undefined {
    let name = target;
    for (let hop = 0; hop < MAX_HOPS; hop += 1) {
      const owner = this.trees.ownerOf(name);
      const view = owner === undefined ? undefined : this.viewOf(owner);
      const rest = owner === undefined ? "" : name.slice(owner.length + 1);
      if (view === undefined || rest === "" || rest.includes(".")) {
        return undefined;
      }
      const node = pick(view, rest);
      if (node) {
        return { view, node, rest };
      }
      const next = view.names.get(rest);
      if (next === undefined) {
        return undefined;
      }
      name = next;
    }
    return undefined;
  }

  /**
   * Builds the rule's view of a first-party module once per check of a file.
   *
   * @param module - a dotted module name.
   * @returns its view, or undefined when no file holds it or `admit` refuses it.
   */
  viewOf(module: string): V | undefined {
    if (this.views.has(module)) {
      return this.views.get(module);
    }
    const parsed = this.admit(module) ? this.trees.moduleOf(module) : undefined;
    const view = parsed === undefined ? undefined : this.read(parsed.tree, parsed.src);
    this.views.set(module, view);
    return view;
  }
}
