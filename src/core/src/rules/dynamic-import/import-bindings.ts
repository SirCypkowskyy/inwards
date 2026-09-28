/**
 * @file Lists the names an import statement binds and what each refers to, for
 * the loader search (`callees.ts`) and the rebinding check (`computed-source.ts`).
 * A wildcard import binds the loaders of its module under their own names; no
 * other module's contents are known.
 */
import type { Node } from "web-tree-sitter";
import { identifierName, namedChildren } from "../../python/nodes.ts";
import { LOADERS } from "./loaders.ts";

/** A name an import statement binds, and what it refers to. */
interface ImportBinding {
  local: string;
  /** The dotted name bound, or null for a relative import (never a loader module). */
  qualified: string | null;
}

/**
 * Lists the names an import statement binds.
 * `import a.b` binds `a`, `import a.b as c` binds `c` to `a.b`,
 * `from m import x as y` binds `y` to `m.x`, and `from m import *` binds the
 * loaders of `m` under their own names.
 *
 * @param stmt - an `import_statement` or `import_from_statement` node.
 * @returns each bound local name with its meaning.
 */
export function importBindings(stmt: Node): ImportBinding[] {
  const entries = stmt.childrenForFieldName("name").map(importEntry);
  if (stmt.type === "import_statement") {
    return entries.map(({ name, alias }) => {
      const top = name.split(".")[0] ?? name;
      return alias ? { local: alias, qualified: name } : { local: top, qualified: top };
    });
  }
  const moduleNode = stmt.childForFieldName("module_name");
  const from = moduleNode?.type === "dotted_name" ? dottedName(moduleNode) : null;
  const out: ImportBinding[] = entries.map(({ name, alias }) => ({
    local: alias ?? name,
    qualified: from === null ? null : `${from}.${name}`,
  }));
  if (from !== null && isWildcard(stmt)) {
    for (const qualified of LOADERS.keys()) {
      if (qualified.startsWith(`${from}.`)) {
        out.push({ local: qualified.slice(from.length + 1), qualified });
      }
    }
  }
  return out;
}

/**
 * Tells whether a `from` import is `from m import *`.
 *
 * @param stmt - an `import_from_statement` node.
 * @returns true for a wildcard import.
 */
function isWildcard(stmt: Node): boolean {
  return stmt.children.some((c) => c?.type === "wildcard_import");
}

/**
 * Reads one entry of an import list.
 *
 * @param entry - a `dotted_name` or `aliased_import` node.
 * @returns the imported dotted name and its alias, if any.
 */
function importEntry(entry: Node): { name: string; alias: string | undefined } {
  if (entry.type !== "aliased_import") {
    return { name: dottedName(entry), alias: undefined };
  }
  const name = entry.childForFieldName("name");
  const alias = entry.childForFieldName("alias");
  return { name: name ? dottedName(name) : "", alias: alias ? identifierName(alias) : undefined };
}

/**
 * Spells a dotted name the way Python does, ignoring spaces and comments.
 *
 * @param node - a `dotted_name` or `identifier` node.
 * @returns the name's parts joined by dots, spaces and comments dropped.
 */
function dottedName(node: Node): string {
  const parts = node.type === "dotted_name" ? namedChildren(node) : [node];
  return parts.map(identifierName).join(".");
}
