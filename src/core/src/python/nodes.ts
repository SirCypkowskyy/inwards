/**
 * @file Small readers for tree-sitter Python nodes that several modules share:
 * named children without comments, identifiers as Python spells them, keyword
 * argument names, integer literals and a module's top-level functions. They
 * read one node each and hold no state.
 */
import type { Node, Tree } from "web-tree-sitter";

/** The node types `moduleNodes` collects for a whole module, in one walk. */
export type ModuleWide =
  | "call"
  | "assignment"
  | "function_definition"
  | "class_definition"
  | "decorated_definition";

const MODULE_WIDE: readonly ModuleWide[] = [
  "call",
  "assignment",
  "function_definition",
  "class_definition",
  "decorated_definition",
];

/** Each tree's `moduleNodes` walks, by the walked node's id, then by type. */
const walked = new WeakMap<Tree, Map<number, ReadonlyMap<string, readonly Node[]>>>();

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
 * Lists a module's descendants of one type, in pre-order, as
 * `descendantsOfType` does, from one walk per tree that collects every
 * `ModuleWide` type at once and is kept while the tree lives.
 *
 * The FastAPI model, INW012, INW016 and FAPI007 each walk the same shared
 * tree for calls, assignments and definitions, and each walk visits every
 * node inside WASM and copies the hits out; on Polar those walks cost about
 * as much as the rules' own work (#395). The lists are shared, so callers
 * must not change them.
 *
 * @param root - the node to walk, usually a tree's `rootNode`.
 * @param type - the node type to list.
 * @returns the nodes of that type below `root`, outermost first.
 */
export function moduleNodes(root: Node, type: ModuleWide): readonly Node[] {
  let byNode = walked.get(root.tree);
  if (byNode === undefined) {
    byNode = new Map();
    walked.set(root.tree, byNode);
  }
  let byType = byNode.get(root.id);
  if (byType === undefined) {
    const lists = new Map<string, Node[]>(MODULE_WIDE.map((t) => [t, []]));
    for (const hit of root.descendantsOfType([...MODULE_WIDE])) {
      if (hit) {
        lists.get(hit.type)?.push(hit);
      }
    }
    byType = lists;
    byNode.set(root.id, byType);
  }
  return byType.get(type) ?? [];
}

/**
 * Lists the descendants of a node of some types, in pre-order, leaving out
 * everything below a node of a `prune` type, in one walk inside WASM.
 *
 * A recursion over `namedChildren` crosses into WASM for every node, which
 * on a large file costs more than the parse (#359). `descendantsOfType`
 * returns the wanted and pruning nodes in pre-order, so a node that starts
 * before the end of the last pruning node is below it. A node of a `prune`
 * type is itself kept when it is also `wanted`; the node passed in is never
 * kept or pruned.
 *
 * @param node - the subtree's root.
 * @param wanted - the types to return.
 * @param prune - the types whose subtrees are left out.
 * @returns the wanted nodes, outermost first.
 */
export function descendantsOutside(
  node: Node,
  wanted: ReadonlySet<string>,
  prune: ReadonlySet<string>,
): Node[] {
  const found: Node[] = [];
  let prunedUntil = -1;
  for (const hit of node.descendantsOfType([...wanted, ...prune])) {
    if (!hit || hit.id === node.id || hit.startIndex < prunedUntil) {
      continue;
    }
    if (wanted.has(hit.type)) {
      found.push(hit);
    }
    if (prune.has(hit.type)) {
      prunedUntil = hit.endIndex;
    }
  }
  return found;
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
