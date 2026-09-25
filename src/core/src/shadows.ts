/**
 * Builtins that a module rebinds. After `from re import compile` or
 * `def exec(...)` at module level, a call to `compile` or `exec` is no longer
 * the builtin, and reading its string argument as Python source would report
 * imports that don't exist.
 *
 * Only unconditional module-level rebindings count, and only from the point
 * they run. A name that is also bound to a loader anywhere, deleted anywhere,
 * or possibly restored by a wildcard import keeps its builtin meaning, so this
 * can drop a false positive but never a real finding.
 */
import type { Node } from "web-tree-sitter";
import {
  type Bindings,
  importBindings,
  isTracked,
  isWildcard,
  plainAssignment,
  qualify,
  type Scope,
} from "./callees.ts";
import { identifierName, namedChildren } from "./literals.ts";

/** Builtins that INW011 reads and a module may rebind. */
const SHADOWABLE: ReadonlySet<string> = new Set([
  "exec",
  "eval",
  "compile",
  "__import__",
  "getattr",
  "vars",
]);

/**
 * Finds the builtins a module rebinds, and from which offset.
 *
 * @param root - the module node.
 * @param syntax - its nodes, as `syntaxOf` returns them.
 * @param bindings - the module's bindings, from `collectBindings`.
 * @returns each shadowed builtin name with the offset where the rebinding takes effect.
 */
export function moduleShadows(
  root: Node,
  syntax: readonly Node[],
  bindings: Bindings,
): Map<string, number> {
  const scope: Scope = { bindings, shadows: new Map() };
  const keep = new Set<string>();
  for (const node of syntax) {
    if (node.type === "import_from_statement" && isWildcard(node)) {
      return new Map(); // `from builtins import *` may restore any builtin
    }
    for (const name of keptNames(node, scope)) {
      keep.add(name);
    }
  }
  const shadows = new Map<string, number>();
  for (const stmt of namedChildren(root)) {
    for (const [name, at] of rebindings(stmt, scope)) {
      if (SHADOWABLE.has(name) && !keep.has(name) && !shadows.has(name)) {
        shadows.set(name, at);
      }
    }
  }
  return shadows;
}

/**
 * Lists the names a node binds to a loader, or deletes: those keep their builtin meaning.
 *
 * @param node - an import, assignment or `del` node.
 * @param scope - the module's bindings, without shadows.
 * @returns the names to keep.
 */
function keptNames(node: Node, scope: Scope): string[] {
  switch (node.type) {
    case "import_statement":
    case "import_from_statement":
      return importBindings(node).flatMap(({ local, qualified }) =>
        qualified !== null && isTracked(qualified) ? [local] : [],
      );
    case "assignment":
      return plainAssignment(node).flatMap(({ name, right }) =>
        qualify(right, scope).length > 0 ? [name] : [],
      );
    case "delete_statement":
      return node.descendantsOfType("identifier").flatMap((n) => (n ? [identifierName(n)] : []));
    default:
      return [];
  }
}

/**
 * Lists the names one module-level statement rebinds to something other than a loader.
 * A function's name is bound before its body can run, so it counts from the
 * body; a class, import or assignment counts from the end of the statement.
 *
 * @param stmt - a direct child of the module node.
 * @param scope - the module's bindings, without shadows.
 * @returns each rebound name with the offset where it takes effect.
 */
function rebindings(stmt: Node, scope: Scope): [string, number][] {
  switch (stmt.type) {
    case "decorated_definition": {
      const definition = stmt.childForFieldName("definition");
      return definition ? rebindings(definition, scope) : [];
    }
    case "function_definition":
    case "class_definition": {
      const name = stmt.childForFieldName("name");
      const body = stmt.childForFieldName("body");
      const at = stmt.type === "function_definition" ? body?.startIndex : stmt.endIndex;
      return name && at !== undefined ? [[identifierName(name), at]] : [];
    }
    case "import_statement":
    case "import_from_statement":
      return importBindings(stmt).flatMap(({ local, qualified }) =>
        qualified !== null && isTracked(qualified) ? [] : [[local, stmt.endIndex]],
      );
    case "expression_statement": {
      const [assignment] = namedChildren(stmt);
      const plain = assignment?.type === "assignment" ? plainAssignment(assignment) : [];
      return plain.flatMap(({ name, right }) =>
        qualify(right, scope).length > 0 ? [] : [[name, stmt.endIndex]],
      );
    }
    default:
      return [];
  }
}

/**
 * Returns the bindings in effect at an offset, with shadowed builtins removed.
 * Code run by `exec` sees the caller's globals as they are at the call.
 *
 * @param scope - the calling module's scope.
 * @param offset - the call's start offset.
 * @returns a new bindings map.
 */
export function bindingsAt(scope: Scope, offset: number): Bindings {
  const out: Bindings = new Map([...scope.bindings].map(([name, qs]) => [name, new Set(qs)]));
  for (const [name, from] of scope.shadows) {
    if (offset >= from) {
      out.get(name)?.delete(`builtins.${name}`);
    }
  }
  return out;
}
