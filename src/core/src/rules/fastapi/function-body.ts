/**
 * @file Reads what a function's own body holds, for the FAPI rules that look
 * inside one function: its `yield`, `return` and `try` statements. A nested
 * function, class or lambda is another scope, so what is in it belongs to it
 * and not to the function around it.
 */
import type { Node } from "web-tree-sitter";
import { namedChildren } from "../../python/nodes.ts";

/** Nodes whose bodies run in another scope. */
const SCOPES: ReadonlySet<string> = new Set(["function_definition", "class_definition", "lambda"]);

/**
 * Lists the nodes of some types in a function's own body, in source order,
 * leaving out nested functions, classes and lambdas.
 *
 * @param fn - a `function_definition` node.
 * @param types - the node types to collect.
 * @returns the matching nodes.
 */
export function ownNodes(fn: Node, types: ReadonlySet<string>): Node[] {
  const body = fn.childForFieldName("body");
  const found: Node[] = [];
  const stack = body ? [body] : [];
  for (let node = stack.pop(); node; node = stack.pop()) {
    if (types.has(node.type)) {
      found.push(node);
    }
    if (!SCOPES.has(node.type)) {
      stack.push(...namedChildren(node).reverse());
    }
  }
  return found;
}
