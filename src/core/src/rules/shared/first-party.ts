/**
 * @file Reads other first-party modules for a content rule that follows a
 * name out of the checked file: INW012's handlers registered from another
 * module (#271), INW013's sync helpers one hop away (#294) and INW015's
 * classes built through a re-export. `ParsedModules` turns the run's trees
 * (`module-trees.ts`, one parse per module per run, #359) into one rule's
 * view of each module, only when the rule asks for a name in it and admits
 * it by name (INW013's `follow-modules`); `follow` walks re-exports (`from
 * .views import create_order` in an `__init__.py`) up to `MAX_HOPS` times.
 * It decides nothing about what a rule reports, owns no tree, and reads
 * files only through the run's trees.
 */
import type { Node, Tree } from "web-tree-sitter";
import type { SourceFile } from "../../shared/contracts/records.ts";
import type { ModuleTrees } from "./module-trees.ts";

/** How many re-exports a name is followed through (a re-export cycle ends here). */
const MAX_HOPS = 4;

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
 * One rule's view of the other first-party modules it reads, built on demand
 * from the run's trees, once per module. Build one per check of a file, or
 * one per run when the view of a module doesn't depend on the checked file
 * (INW013's); the trees belong to the `ModuleTrees` it reads from.
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
      const rest = owner === undefined ? "" : name.slice(owner.length + 1);
      // A method of a module-level object (`service.create`) is no definition: don't parse for it.
      const view =
        owner === undefined || rest === "" || rest.includes(".") ? undefined : this.viewOf(owner);
      if (view === undefined) {
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
   * Builds the rule's view of a first-party module, once for this object.
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
