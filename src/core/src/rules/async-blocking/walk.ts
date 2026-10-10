/**
 * @file Reads one parsed module for INW013: its qualifier, aliases,
 * module-level blocking receivers and top-level functions, and finds the
 * blocking calls a function body runs. The checked file and a helper's module
 * one hop away (`hop.ts`) are read the same way. Calls in a nested `def`,
 * `lambda` or class body don't run when the function does, so they are left
 * out. It owns no tree: the caller parses and frees it.
 */
import type { Node, Tree } from "web-tree-sitter";
import type { SourceFile } from "../../contracts/records.ts";
import { identifierName, moduleFunctions, namedChildren } from "../../python/nodes.ts";
import { importedNames } from "../../python/parser.ts";
import { qualifierFor } from "../../python/qualify.ts";
import { moduleAliases, type TypeContext } from "../shared/annotations.ts";
import type { Family } from "./catalog.ts";
import { moduleReceivers, NESTED_SCOPES, type Source, valueSource } from "./receivers.ts";

/** One module, read for INW013. */
export interface Walk {
  readonly src: SourceFile;
  /** What each name the module imports refers to, by local name. */
  readonly names: ReadonlyMap<string, string>;
  readonly context: TypeContext;
  readonly families: readonly Family[];
  /** The receivers the module binds at the top level. */
  readonly module: ReadonlyMap<string, Source>;
  /** The module's top-level functions by name, decorated or not. */
  readonly functions: ReadonlyMap<string, Node>;
}

/** One blocking call, before it becomes a finding. */
export interface Blocking {
  /** The call node. */
  readonly call: Node;
  /** The call as written, e.g. `db.execute`. */
  readonly written: string;
  readonly family: Family;
  /** The qualified name the receiver or call came from. */
  readonly type: string;
  /** True for a method on a receiver, false for a call that blocks by itself. */
  readonly method: boolean;
}

/**
 * Reads a parsed module for INW013.
 *
 * @param tree - the module's tree, which the caller frees.
 * @param src - the module's file, with normalised text.
 * @param families - the blocking families to look for.
 * @returns the module's walk.
 */
export function walkOf(tree: Tree, src: SourceFile, families: readonly Family[]): Walk {
  const root = tree.rootNode;
  const names = importedNames(tree, src);
  const context = { qualify: qualifierFor(names, src.module), aliases: moduleAliases(root) };
  return {
    src,
    names,
    context,
    families,
    module: moduleReceivers(root, context, families),
    functions: moduleFunctions(root),
  };
}

/**
 * Tells whether a function is `async def`.
 *
 * @param fn - a `function_definition` node.
 * @returns true when its first token is `async`.
 */
export function isAsync(fn: Node): boolean {
  return fn.child(0)?.type === "async";
}

/**
 * Lists every function definition in a tree, nested ones and methods included.
 *
 * @param node - the module node, or any node below it.
 * @returns the `function_definition` nodes, in source order.
 */
export function functionsIn(node: Node): Node[] {
  const own = node.type === "function_definition" ? [node] : [];
  return [...own, ...namedChildren(node).flatMap(functionsIn)];
}

/**
 * Lists the calls a function body runs when the function runs, leaving out
 * nested `def`, `lambda` and `class` bodies.
 *
 * @param node - the body, or any node below it.
 * @returns the `call` nodes, outermost first.
 */
export function callsIn(node: Node): Node[] {
  return namedChildren(node).flatMap((child) => {
    if (NESTED_SCOPES.has(child.type)) {
      return [];
    }
    return child.type === "call" ? [child, ...callsIn(child)] : callsIn(child);
  });
}

/**
 * Reads an inline receiver, `Session(engine)` in `Session(engine).scalar(q)`,
 * unless that call blocks by itself and gets its own finding.
 *
 * @param call - the receiver's `call` node.
 * @param walk - the module being walked.
 * @returns its source, or undefined.
 */
function inlineSource(call: Node, walk: Walk): Source | undefined {
  const callee = call.childForFieldName("function");
  const qualified = callee ? walk.context.qualify(callee) : null;
  if (qualified !== null && walk.families.some((f) => f.isCall(qualified))) {
    return undefined;
  }
  return valueSource(call, walk.context, walk.families);
}

/**
 * Reads one call: a method on a blocking receiver, a call that blocks by
 * itself, or neither. A method on an inline call that blocks by itself
 * (`sqlite3.connect(p).execute(q)`) is left to that call's own finding.
 *
 * @param call - a `call` node.
 * @param receivers - the blocking receivers in scope, by name.
 * @param walk - the module being walked.
 * @returns the blocking call, or undefined.
 */
export function blockingCall(
  call: Node,
  receivers: ReadonlyMap<string, Source>,
  walk: Walk,
): Blocking | undefined {
  const callee = call.childForFieldName("function");
  if (!callee) {
    return undefined;
  }
  const qualified = walk.context.qualify(callee);
  const direct = qualified === null ? undefined : walk.families.find((f) => f.isCall(qualified));
  if (direct && qualified !== null) {
    return { call, written: callee.text, family: direct, type: qualified, method: false };
  }
  const object = callee.type === "attribute" ? callee.childForFieldName("object") : null;
  const attribute = callee.childForFieldName("attribute");
  if (!(object && attribute)) {
    return undefined;
  }
  let source: Source | undefined;
  if (object.type === "identifier") {
    source = receivers.get(identifierName(object));
  } else if (object.type === "call") {
    source = inlineSource(object, walk);
  }
  return source?.family.blocks(identifierName(attribute))
    ? { call, written: callee.text, family: source.family, type: source.type, method: true }
    : undefined;
}
