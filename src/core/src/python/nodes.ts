/**
 * @file Small readers for tree-sitter Python nodes that several modules share:
 * named children without comments, identifiers as Python spells them, keyword
 * argument names, integer literals and a module's top-level functions. They
 * read one node each and hold no state.
 */
import type { Node } from "web-tree-sitter";

/**
 * Lists a node's named children, without comments.
 *
 * @param node - any node.
 * @returns the named children that are not comments.
 */
export function namedChildren(node: Node): Node[] {
  return node.namedChildren.flatMap((c) => (c && c.type !== "comment" ? [c] : []));
}

/**
 * Spells an identifier the way Python does: NFKC-normalised.
 *
 * @param node - a name as tree-sitter parsed it (an `identifier` node).
 * @returns the identifier's text in NFKC form, as Python compares names.
 */
export function identifierName(node: Node): string {
  return node.text.normalize("NFKC");
}

/**
 * Reads the name of a keyword argument.
 *
 * @param arg - a `keyword_argument` node.
 * @returns the keyword, or "" when the node has none.
 */
export function keywordOf(arg: Node): string {
  const name = arg.childForFieldName("name");
  return name ? identifierName(name) : "";
}

/**
 * Reads an integer literal such as `2`, `0x1` or `1_0`.
 *
 * @param node - an expression node.
 * @returns the value, or null when the node is not an integer literal.
 */
export function integerLiteral(node: Node): number | null {
  if (node.type !== "integer") {
    return null;
  }
  const value = Number(node.text.replaceAll("_", ""));
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Reads an integer literal that may carry a sign, such as `-1` in a slice.
 *
 * @param node - an expression node.
 * @returns the value, or null when the node is not a signed integer literal.
 */
export function signedInteger(node: Node): number | null {
  if (node.type !== "unary_operator") {
    return integerLiteral(node);
  }
  const operand = node.childForFieldName("argument");
  const sign = node.childForFieldName("operator")?.type;
  const value = operand ? integerLiteral(operand) : null;
  if (value === null || !(sign === "-" || sign === "+")) {
    return null;
  }
  return sign === "-" ? -value : value;
}

/**
 * Lists a module's top-level functions, decorated or not.
 *
 * @param root - the module node.
 * @returns each function's `function_definition` node by name.
 */
export function moduleFunctions(root: Node): Map<string, Node> {
  const functions = new Map<string, Node>();
  for (const child of namedChildren(root)) {
    const fn =
      child.type === "decorated_definition" ? child.childForFieldName("definition") : child;
    const name = fn?.type === "function_definition" ? fn.childForFieldName("name") : null;
    if (fn && name) {
      functions.set(identifierName(name), fn);
    }
  }
  return functions;
}
