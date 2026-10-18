/**
 * @file Qualifies a name or attribute node through one file's imports, so
 * `status.HTTP_404_NOT_FOUND` reads as `fastapi.status.HTTP_404_NOT_FOUND`
 * and `post` (from `from httpx import post`) as `httpx.post`. The FastAPI
 * model and INW012 both read names this way. It reads one node and the
 * import map `parser.ts`'s `importedNames` builds; it never resolves a name
 * to its definition.
 */
import type { Node } from "web-tree-sitter";
import { identifierName } from "./nodes.ts";

/** Qualifies a name or attribute node, or returns null for any other expression. */
export type Qualify = (node: Node) => string | null;

/**
 * Qualifies a name or an attribute through the file's imports. A name the
 * file doesn't import is its own module's: `router` in `app.routers.users`
 * is `app.routers.users.router`, and so is a builtin such as `ValueError`,
 * which then resolves to nothing.
 *
 * @param node - an expression node.
 * @param names - what each imported name refers to.
 * @param module - the file's dotted module name.
 * @returns the dotted name, or null for anything but a name or an attribute of one.
 */
function qualifiedName(
  node: Node,
  names: ReadonlyMap<string, string>,
  module: string,
): string | null {
  if (node.type === "identifier") {
    const name = identifierName(node);
    return names.get(name) ?? `${module}.${name}`;
  }
  const object = node.type === "attribute" ? node.childForFieldName("object") : null;
  const attribute = node.childForFieldName("attribute");
  const owner = object ? qualifiedName(object, names, module) : null;
  return owner !== null && attribute ? `${owner}.${identifierName(attribute)}` : null;
}

/**
 * Makes the name qualifier for one file (see `qualifiedName`).
 *
 * @param names - what each imported name refers to.
 * @param module - the file's dotted module name.
 * @returns a function that qualifies a name or attribute node.
 */
export function qualifierFor(names: ReadonlyMap<string, string>, module: string): Qualify {
  return (node: Node): string | null => qualifiedName(node, names, module);
}
