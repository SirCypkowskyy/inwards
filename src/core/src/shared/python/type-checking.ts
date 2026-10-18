/**
 * @file Tells whether an import statement only runs for a type checker: it
 * sits in the body of `if TYPE_CHECKING:` or `elif TYPE_CHECKING:`, which
 * `typing.TYPE_CHECKING` being `False` at runtime keeps from running (#375).
 * The import extraction marks such imports, and the rules that care whether
 * an import runs (INW004, INW015) read the mark. It looks at the syntax tree
 * only: it doesn't follow what the name `TYPE_CHECKING` is bound to.
 */
import type { Node } from "web-tree-sitter";
import { identifierName } from "./nodes.ts";

/**
 * Tells whether a condition is `TYPE_CHECKING` or an attribute that ends in
 * it (`typing.TYPE_CHECKING`, `t.TYPE_CHECKING`).
 *
 * @param node - an `if` or `elif` condition.
 * @returns true for such a name.
 */
function isTypeChecking(node: Node | null): boolean {
  const name = node?.type === "attribute" ? node.childForFieldName("attribute") : node;
  return name?.type === "identifier" && identifierName(name) === "TYPE_CHECKING";
}

/**
 * Tells whether an import statement sits, at any depth, in the body of an
 * `if TYPE_CHECKING:` or `elif TYPE_CHECKING:`. `typing.TYPE_CHECKING` is
 * false at runtime, so such a body never runs; its `else` does, and isn't
 * one. Only the plain name or an attribute ending in it counts: `if not
 * TYPE_CHECKING:` or `if TYPE_CHECKING and x:` runs or might, so its imports count.
 *
 * @param stmt - an `import_statement` or `import_from_statement` node.
 * @returns true when no runtime path reaches the import.
 */
export function underTypeChecking(stmt: Node): boolean {
  for (let node: Node | null = stmt; node !== null; node = node.parent) {
    const branch: Node | null = node.parent;
    if (
      node.type === "block" &&
      (branch?.type === "if_statement" || branch?.type === "elif_clause") &&
      branch.childForFieldName("consequence")?.equals(node) === true &&
      isTypeChecking(branch.childForFieldName("condition"))
    ) {
      return true;
    }
  }
  return false;
}
