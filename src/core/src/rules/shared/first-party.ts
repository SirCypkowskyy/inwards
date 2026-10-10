/**
 * @file Reads other first-party modules for a content rule that follows a
 * name out of the checked file: INW012's handlers registered from another
 * module (#271) and INW013's sync helpers one hop away (#294). A module is
 * read and parsed only when a rule asks for a name in it, once per check of
 * the checked file, and only when the rule admits it by name (INW013's
 * `follow-modules`), and turned into the rule's own view of it; `follow`
 * walks re-exports (`from .views import create_order` in an `__init__.py`)
 * up to `MAX_HOPS` times. Every tree is freed by `dispose()`. It decides
 * nothing about what a rule reports, and reads files only through the
 * project port the caller passes.
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

/**
 * The other first-party modules one check reads, parsed on demand and kept
 * as a rule's view of each. Build one per check of a file and call
 * `dispose()` when done.
 */
export class ParsedModules<V extends ModuleNames> {
  private readonly parser: Parser;
  private readonly project: FirstPartySource;
  private readonly read: (tree: Tree, src: SourceFile) => V;
  private readonly admit: (module: string) => boolean;
  private readonly trees: Tree[] = [];
  private readonly views = new Map<string, V | undefined>();

  /**
   * Wraps the parser, the project and the rule's reader. Nothing is read yet.
   *
   * @param parser - parser with the Python grammar loaded.
   * @param project - finds and reads first-party modules.
   * @param read - turns a parsed module into the rule's view; the tree stays alive until `dispose()`.
   * @param admit - tells whether a module may be read at all, by its dotted name; every one by default.
   */
  constructor(
    parser: Parser,
    project: FirstPartySource,
    read: (tree: Tree, src: SourceFile) => V,
    admit: (module: string) => boolean = (): boolean => true,
  ) {
    this.parser = parser;
    this.project = project;
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
      const owner = this.project.ownerOf(name);
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
   * Reads and parses a first-party module once.
   *
   * @param module - a dotted module name.
   * @returns its view, or undefined when no file holds it or `admit` refuses it.
   */
  viewOf(module: string): V | undefined {
    if (this.views.has(module)) {
      return this.views.get(module);
    }
    const src = this.admit(module) ? this.project.sourceOf(module) : undefined;
    let view: V | undefined;
    if (src !== undefined) {
      const text = normalizeSource(src.text);
      const tree = parsePython(this.parser, text);
      this.trees.push(tree);
      view = this.read(tree, { ...src, text });
    }
    this.views.set(module, view);
    return view;
  }

  /** Frees every tree read so far; the views and nodes handed out are invalid afterwards. */
  dispose(): void {
    for (const tree of this.trees) {
      tree.delete(); // WASM memory is not garbage collected
    }
    this.trees.length = 0;
    this.views.clear();
  }
}
