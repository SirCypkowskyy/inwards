/**
 * @file Finds a module's string constants, so INW011 can read
 * `TARGET = "shop.infrastructure.db"` followed by `import_module(TARGET)` as an
 * exact target instead of an unverifiable one.
 *
 * A name is a constant only when it is surely bound once: one plain
 * `NAME = <constant>` statement directly in the module body, and every other
 * use of the name in the file a plain read. Any other binding anywhere
 * (a parameter, a `for` target, `global`, `del`, an import, an assignment in a
 * function) rules the name out, and so does a file that rewrites a namespace,
 * has a wildcard import, or calls `exec` or `eval`, which can rebind any name.
 * Nothing is evaluated beyond the folds in `python/literals.ts`.
 */
import type { Node } from "web-tree-sitter";
import type { Literal } from "../../python/folding.ts";
import { type Constants, constantValue } from "../../python/literals.ts";
import { identifierName } from "../../python/nodes.ts";
import { type Bindings, qualify } from "./callees.ts";
import { rewritesNamespace } from "./computed-source.ts";

/** Loaders that can bind names in the caller's namespace. */
const REBINDERS = new Set(["builtins.exec", "builtins.eval"]);

/** Expressions a name can sit inside, as a whole or as a part, and still be read. */
const CONTAINERS = new Set([
  "parenthesized_expression",
  "tuple",
  "list",
  "set",
  "expression_list",
  "list_splat",
]);

/** Parents under which a name is only read. */
const READS = new Set([
  "argument_list",
  "call",
  "attribute",
  "subscript",
  "slice",
  "binary_operator",
  "unary_operator",
  "comparison_operator",
  "boolean_operator",
  "not_operator",
  "conditional_expression",
  "interpolation",
  "format_expression",
  "keyword_argument",
  "pair",
  "dictionary",
  "lambda",
  "return_statement",
  "expression_statement",
  "if_statement",
  "elif_clause",
  "while_statement",
  "assert_statement",
  "await",
  "yield",
]);

/** Parents where a name is read in one field and bound in the others. */
const READ_FIELDS: ReadonlyMap<string, string> = new Map([
  ["assignment", "right"],
  ["augmented_assignment", "right"],
  ["for_statement", "right"],
  ["for_in_clause", "right"],
  ["named_expression", "value"],
]);

/**
 * Lists the module's string and bytes constants.
 *
 * @param root - the module node.
 * @param syntax - the module's nodes, as `syntaxOf` returns them.
 * @param bindings - what names mean in the module, to find `exec` and `eval` calls.
 * @returns each constant name with its value; empty when the file can rebind names unseen.
 */
export function moduleConstants(
  root: Node,
  syntax: readonly Node[],
  bindings: Bindings,
): Constants {
  const { defined, repeated } = moduleAssignments(root);
  if (defined.size === 0 || rewritesNamespace(root) || callsRebinder(syntax, bindings)) {
    return new Map();
  }
  for (const id of root.descendantsOfType("identifier")) {
    const name = id ? identifierName(id) : "";
    const own = defined.get(name);
    if (id && own && id.id !== own.id && !isRead(id)) {
      repeated.add(name);
    }
  }
  const constants = new Map<string, Literal>();
  // Source order: a constant may use the ones defined above it, as Python requires.
  for (const [name, left] of defined) {
    const right = left.parent?.childForFieldName("right");
    const value = right && !repeated.has(name) ? constantValue(right, constants) : null;
    if (value) {
      constants.set(name, value);
    }
  }
  return constants;
}

/**
 * Lists the names assigned by plain `NAME = ...` statements in the module body.
 *
 * @param root - the module node.
 * @returns the last target node of each name, in source order, and the names assigned more than once.
 */
function moduleAssignments(root: Node): { defined: Map<string, Node>; repeated: Set<string> } {
  const defined = new Map<string, Node>();
  const repeated = new Set<string>();
  for (const statement of root.namedChildren) {
    const assignment = statement?.type === "expression_statement" ? statement.firstChild : null;
    const left = assignment?.type === "assignment" ? assignment.childForFieldName("left") : null;
    if (left?.type === "identifier") {
      const name = identifierName(left);
      if (defined.has(name)) {
        repeated.add(name);
      }
      defined.set(name, left);
    }
  }
  return { defined, repeated };
}

/**
 * Tells whether the module calls `exec` or `eval`, either of which can rebind a name.
 *
 * @param syntax - the module's nodes, as `syntaxOf` returns them.
 * @param bindings - what names mean in the module.
 * @returns true when some call's callee may be `exec` or `eval`.
 */
function callsRebinder(syntax: readonly Node[], bindings: Bindings): boolean {
  return syntax.some((node) => {
    const fn = node.type === "call" ? node.childForFieldName("function") : null;
    return fn !== null && qualify(fn, bindings).some((q) => REBINDERS.has(q));
  });
}

/**
 * Tells whether an identifier is only read where it stands. Anything this
 * doesn't recognise counts as a binding, so an unusual use rules a constant
 * out rather than in.
 *
 * @param id - an `identifier` node.
 * @returns true for a plain read.
 */
function isRead(id: Node): boolean {
  let node: Node = id;
  while (node.parent && CONTAINERS.has(node.parent.type)) {
    node = node.parent;
  }
  const { parent } = node;
  if (!parent) {
    return false;
  }
  const field = READ_FIELDS.get(parent.type);
  if (field === undefined) {
    return READS.has(parent.type);
  }
  const read = parent.childForFieldName(field);
  return read !== null && read.startIndex <= node.startIndex && node.endIndex <= read.endIndex;
}
