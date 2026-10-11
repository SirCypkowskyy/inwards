/**
 * @file Finds first-party module-level definitions through the run's parsed
 * modules (`module-trees.ts`), for a rule that recognises routers without
 * the FastAPI model: INW012 (#358). Each module is read once per finder into
 * its imports, functions, classes and constants, and re-exports are
 * followed. It owns no tree and decides nothing about routers;
 * `fastapi-routers.ts` does.
 */
import type { Node, Tree } from "web-tree-sitter";
import type { SourceFile } from "../../contracts/records.ts";
import { moduleFunctions } from "../../python/nodes.ts";
import { importedNames } from "../../python/parser.ts";
import { type Qualify, qualifierFor } from "../../python/qualify.ts";
import { moduleDefinitions } from "./definitions.ts";
import type { FindDefinition, FoundDefinition } from "./fastapi-routers.ts";
import { ParsedModules } from "./first-party.ts";
import type { ModuleTrees } from "./module-trees.ts";

/** One module's module-level definitions, by name. */
interface Definitions {
  readonly src: SourceFile;
  readonly names: ReadonlyMap<string, string>;
  readonly qualify: Qualify;
  readonly functions: ReadonlyMap<string, Node>;
  readonly classes: ReadonlyMap<string, Node>;
  readonly constants: ReadonlyMap<string, Node>;
}

/**
 * Reads one parsed module's definitions.
 *
 * @param tree - its tree, which the run frees.
 * @param src - its file, with normalised text.
 * @returns its imports, qualifier, functions, classes and constants.
 */
function definitionsOf(tree: Tree, src: SourceFile): Definitions {
  const names = importedNames(tree, src);
  const { classes, constants } = moduleDefinitions(tree.rootNode);
  return {
    src,
    names,
    qualify: qualifierFor(names, src.module),
    functions: moduleFunctions(tree.rootNode),
    classes,
    constants,
  };
}

/**
 * Builds a `FindDefinition` over the run's first-party modules.
 *
 * @param trees - the run's first-party modules, parsed once each.
 * @returns a lookup that finds a module-level function, class or constant by
 *   qualified name, following re-exports.
 */
export function definitionFinder(trees: ModuleTrees): FindDefinition {
  const modules = new ParsedModules(trees, definitionsOf);
  return (qualified: string): FoundDefinition | null => {
    const found = modules.follow(
      qualified,
      (module, local) =>
        module.functions.get(local) ?? module.classes.get(local) ?? module.constants.get(local),
    );
    if (found === undefined) {
      return null;
    }
    const { view, node, rest } = found;
    return { kind: kindOf(view, rest, node), node, name: rest, qualify: view.qualify };
  };
}

/**
 * Tells which of a module's maps a definition came from.
 *
 * @param view - the module's definitions.
 * @param local - the definition's name in the module.
 * @param node - the node found under that name.
 * @returns `function`, `class` or `constant`.
 */
function kindOf(view: Definitions, local: string, node: Node): FoundDefinition["kind"] {
  if (view.functions.get(local) === node) {
    return "function";
  }
  return view.classes.get(local) === node ? "class" : "constant";
}
