/**
 * @file The names a module binds at its top level, read from its full
 * syntax tree: what another module can import from it with `from M import
 * name`. INW003's fix uses them to name a public module that already
 * exposes an imported name. Only statements directly in the module count
 * (a function's local import or a `TYPE_CHECKING` block doesn't), in order,
 * so a later `del` takes a name away again. An annotation without a value
 * binds nothing, except in a `.pyi` stub, where it declares the name. An
 * assignment binds plain names, through tuples and lists, but not an
 * attribute or a subscript. An import binds its `as` name when it has one.
 * Text in strings and comments never counts.
 */
import type { Node, Tree } from "web-tree-sitter";

/**
 * Lists the names a module binds at its top level.
 *
 * @param tree - the module's full syntax tree.
 * @param stub - true for a `.pyi` stub, whose annotations declare names.
 * @returns the bound names, NFKC-normalised as Python sees them.
 */
export function topLevelBindings(tree: Tree, stub = false): Set<string> {
  const names = new Set<string>();
  for (const stmt of tree.rootNode.namedChildren) {
    if (stmt?.type === "delete_statement") {
      for (const name of deleted(stmt)) {
        names.delete(name.normalize("NFKC"));
      }
    } else if (stmt !== null) {
      for (const name of bound(stmt, stub)) {
        names.add(name.normalize("NFKC"));
      }
    }
  }
  return names;
}

/**
 * Lists the plain names a `del` statement removes.
 *
 * @param stmt - a `delete_statement` node.
 * @returns the names; `del obj.x` and `del d[k]` remove none.
 */
function deleted(stmt: Node): string[] {
  return stmt.namedChildren.flatMap((child) => (child ? targetNames(child) : []));
}

/**
 * Lists the names one top-level statement binds.
 *
 * @param stmt - a direct child of the module node.
 * @param stub - true for a `.pyi` stub.
 * @returns the names, possibly none.
 */
function bound(stmt: Node, stub: boolean): string[] {
  switch (stmt.type) {
    case "function_definition":
    case "class_definition":
      return textOf(stmt.childForFieldName("name"));
    case "decorated_definition": {
      const definition = stmt.childForFieldName("definition");
      return definition === null ? [] : bound(definition, stub);
    }
    case "expression_statement":
      return stmt.namedChildren.flatMap((child) =>
        child?.type === "assignment" ? assigned(child, stub) : [],
      );
    case "import_from_statement":
      return stmt.childrenForFieldName("name").flatMap((name) => (name ? importedAs(name) : []));
    case "import_statement":
      return stmt
        .childrenForFieldName("name")
        .flatMap((name) => (name ? importedAs(name, true) : []));
    default:
      return [];
  }
}

/**
 * Lists the names an assignment binds: its targets when it has a value,
 * following `a = b = 1` to its end. `x: int` alone binds nothing, except in
 * a stub, where it declares `x`.
 *
 * @param node - an `assignment` node.
 * @param stub - true for a `.pyi` stub.
 * @returns the plain names on its left, and those of a chained assignment.
 */
function assigned(node: Node, stub: boolean): string[] {
  const right = node.childForFieldName("right");
  if (right === null && !stub) {
    return [];
  }
  const left = node.childForFieldName("left");
  const targets = left ? targetNames(left) : [];
  return right?.type === "assignment" ? [...targets, ...assigned(right, stub)] : targets;
}

/**
 * Lists the plain names an assignment or `del` target names, through tuples,
 * lists, parentheses and `*rest`; an attribute or a subscript names none.
 *
 * @param node - the left of an assignment, or what `del` names.
 * @returns the identifiers it binds or removes.
 */
function targetNames(node: Node): string[] {
  if (node.type === "identifier") {
    return [node.text];
  }
  if (node.type === "attribute" || node.type === "subscript") {
    return [];
  }
  return node.namedChildren.flatMap((child) => (child ? targetNames(child) : []));
}

/**
 * Names what one entry of an import list binds.
 *
 * @param name - a `dotted_name` or `aliased_import` node.
 * @param plain - true for `import a.b`, which binds `a`; false for `from X import a`.
 * @returns the alias when there is one, else the (first) name.
 */
function importedAs(name: Node, plain = false): string[] {
  if (name.type === "aliased_import") {
    return textOf(name.childForFieldName("alias"));
  }
  const first = name.type === "dotted_name" ? name.namedChildren[0] : name;
  const parts = name.type === "dotted_name" ? name.namedChildren.length : 1;
  // `from X import a.b` isn't Python; `import a.b` binds `a`.
  return first && (plain || parts === 1) ? [first.text] : [];
}

/**
 * Reads a node's text, if there is a node.
 *
 * @param node - a node or null.
 * @returns its text in a list, or nothing.
 */
function textOf(node: Node | null): string[] {
  return node === null ? [] : [node.text];
}
