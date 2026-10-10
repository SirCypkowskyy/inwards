/**
 * @file INW015's call form: a call that builds a class defined in the role,
 * reached through a module outside it, such as a package `__init__.py` that
 * re-exports the adapter (`from app.adapters import SqlRepo`) or a module
 * attribute (`app.adapters.outbound.sql.SqlRepo()` after `import
 * app.adapters`). The import form already reports a call whose name comes
 * from a role import, so those are skipped. Only a callee whose last name
 * starts with a capital letter is followed, as Python names classes; the
 * class must be a top-level `class` of a role module, found through the
 * project index and up to a few re-exports. Another module is read only
 * when it is in the role, in `allowed-in`, or a package above the role
 * whose `__init__.py` may re-export it, once per check of the file. No I/O:
 * the project port reads the modules.
 */
import type { Node, Parser, Tree } from "web-tree-sitter";
import { entryReach, matchEntry } from "../../config/layer-selector.ts";
import type { SourceFile } from "../../contracts/records.ts";
import { identifierName, namedChildren } from "../../python/nodes.ts";
import { importedNames } from "../../python/parser.ts";
import { type Qualify, qualifierFor } from "../../python/qualify.ts";
import { type FirstPartySource, type ModuleNames, ParsedModules } from "../shared/first-party.ts";
import type { Construction, Scope } from "./wording.ts";

/** A name Python code gives a class: it starts with a capital letter. */
const CLASS_NAME = /^\p{Lu}/u;

/** What the call form keeps of another module: its imports and its top-level classes. */
interface ClassView extends ModuleNames {
  /** Top-level `class` statements, by name. */
  readonly classes: ReadonlyMap<string, Node>;
}

/**
 * Tells whether a module is in one of a list of entries.
 *
 * @param entries - module prefixes or selectors.
 * @param module - a dotted module name.
 * @returns true when an entry matches it.
 */
export function inEntries(entries: readonly string[], module: string): boolean {
  return entries.some((entry) => matchEntry(entry, module) !== undefined);
}

/**
 * Lists a module's top-level classes, decorated or not.
 *
 * @param root - the module node.
 * @returns each `class_definition` node by name.
 */
function moduleClasses(root: Node): Map<string, Node> {
  const classes = new Map<string, Node>();
  for (const child of namedChildren(root)) {
    const def =
      child.type === "decorated_definition" ? child.childForFieldName("definition") : child;
    const name = def?.type === "class_definition" ? def.childForFieldName("name") : null;
    if (def && name) {
      classes.set(identifierName(name), def);
    }
  }
  return classes;
}

/**
 * Reads another module into the call form's view.
 *
 * @param tree - its syntax tree.
 * @param src - its file.
 * @returns its imports and its classes.
 */
function readClasses(tree: Tree, src: SourceFile): ClassView {
  return { src, names: importedNames(tree, src), classes: moduleClasses(tree.rootNode) };
}

/**
 * Tells whether a module may be read on the way to a role class: it is in
 * the role or `allowed-in`, or it is a package a role entry could match
 * something below, whose `__init__.py` may re-export the class.
 *
 * @param module - a dotted module name.
 * @param scope - the role and `allowed-in`.
 * @returns false for a module that can't lead to a role class.
 */
function admitted(module: string, scope: Scope): boolean {
  const segments = module.split(".");
  return (
    inEntries(scope.role, module) ||
    inEntries(scope.allowed, module) ||
    scope.role.some((entry) => entryReach(entry, segments) === "descend")
  );
}

/**
 * Tells whether a qualified name comes through an import the import form
 * reports (or INW001 reports in its place): it is that import's target or
 * something inside it.
 *
 * @param qualified - the callee's qualified name.
 * @param covered - the targets of the role imports.
 * @returns true when the import already accounts for the call.
 */
function coveredBy(qualified: string, covered: readonly string[]): boolean {
  return covered.some((target) => qualified === target || qualified.startsWith(`${target}.`));
}

/**
 * Lists every call in a subtree, nested ones included.
 *
 * @param node - any node.
 * @returns the `call` nodes, outermost first.
 */
function callsIn(node: Node): Node[] {
  return namedChildren(node).flatMap((child) =>
    child.type === "call" ? [child, ...callsIn(child)] : callsIn(child),
  );
}

/** What `constructions` needs besides the checked file's tree. */
export interface CallInputs {
  readonly parser: Parser;
  readonly project: FirstPartySource;
  readonly scope: Scope;
  /** The targets of the file's role imports, whose calls the import form covers. */
  readonly covered: readonly string[];
}

/**
 * Finds the calls in a file that build a class of the role through a module
 * outside it.
 *
 * @param tree - the checked file's syntax tree.
 * @param src - the checked file.
 * @param inputs - the parser, the project, the role and the covered imports.
 * @returns one entry per such call, in source order.
 */
export function constructions(tree: Tree, src: SourceFile, inputs: CallInputs): Construction[] {
  const { parser, project, scope, covered } = inputs;
  const qualify: Qualify = qualifierFor(importedNames(tree, src), src.module);
  const modules = new ParsedModules(parser, project, readClasses, (m) => admitted(m, scope));
  try {
    return callsIn(tree.rootNode).flatMap((call): Construction[] => {
      const callee = call.childForFieldName("function");
      const last = callee?.type === "attribute" ? callee.childForFieldName("attribute") : callee;
      const qualified = callee ? qualify(callee) : null;
      if (!(callee && last && qualified && CLASS_NAME.test(identifierName(last)))) {
        return [];
      }
      if (coveredBy(qualified, covered) || project.ownerOf(qualified) === src.module) {
        return [];
      }
      const found = modules.follow(qualified, (view, rest) => view.classes.get(rest));
      const home = found?.view.src.module;
      if (!(found && home !== undefined && inEntries(scope.role, home))) {
        return [];
      }
      return [{ call, written: callee.text, defined: `${home}.${found.rest}` }];
    });
  } finally {
    modules.dispose();
  }
}
