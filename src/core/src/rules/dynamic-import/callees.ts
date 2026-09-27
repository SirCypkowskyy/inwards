/**
 * @file Works out which calls in a file are module loaders, whatever they are called
 * locally. `il.import_module`, `im` and `getattr(importlib, "import_module")`
 * can all be `importlib.import_module`.
 *
 * Names are resolved through imports (`import importlib as il`,
 * `from importlib import import_module as im`, `from builtins import *`),
 * plain assignments (`load = importlib.import_module`), `getattr(m, "name")`,
 * `m["name"]`, `m.__dict__["name"]`, `vars(m)["name"]` and
 * `__import__("importlib")`. Function and class scopes are ignored: a name
 * bound anywhere in the file counts everywhere, and `exec`, `eval`, `compile`
 * and `__import__` always count as the builtins, even where a module rebinds
 * them. Both can only add findings: `from re import compile` followed by
 * `compile("from shop.infrastructure import x")` is a known false positive.
 *
 * Other bindings are not followed (walrus, tuple assignment, attributes,
 * `functools.partial`, names bound inside `exec`), so a loader reached that
 * way is missed; #79 lists them.
 */
import type { Node } from "web-tree-sitter";
import { argumentAt, identifierName, literalString, namedChildren } from "../../python/literals.ts";

/** How a loading call names what it loads. */
export type LoaderKind = "import_module" | "__import__" | "run_module" | "source";

/** Every call INW011 reads, by fully qualified name. */
export const LOADERS: ReadonlyMap<string, LoaderKind> = new Map<string, LoaderKind>([
  ["importlib.import_module", "import_module"],
  ["importlib.__import__", "__import__"],
  ["builtins.__import__", "__import__"],
  ["runpy.run_module", "run_module"],
  ["builtins.exec", "source"],
  ["builtins.eval", "source"],
  ["builtins.compile", "source"],
]);

/**
 * The only values worth tracking: the loaders, `getattr`, and the modules that
 * hold them. A closed set keeps `a = a.x` from growing names without end.
 */
const TRACKED: ReadonlySet<string> = new Set([
  ...LOADERS.keys(),
  "builtins.getattr",
  "builtins.vars",
  "builtins",
  "importlib",
  "runpy",
]);

/** Local name to every qualified name it may be bound to. */
export type Bindings = Map<string, Set<string>>;

/**
 * Returns the names every module starts with: the builtins, and the loader
 * modules under their own names.
 *
 * @returns a fresh bindings map.
 */
export function builtinBindings(): Bindings {
  const names: [string, string][] = [
    ["exec", "builtins.exec"],
    ["eval", "builtins.eval"],
    ["compile", "builtins.compile"],
    ["__import__", "builtins.__import__"],
    ["getattr", "builtins.getattr"],
    ["vars", "builtins.vars"],
    ["__builtins__", "builtins"],
    ["builtins", "builtins"],
    ["importlib", "importlib"],
    ["runpy", "runpy"],
  ];
  return new Map(names.map(([name, qualified]) => [name, new Set([qualified])]));
}

/** Node types `collectBindings` reads; `syntaxOf` collects them in one walk. */
const BINDING_NODES = ["import_statement", "import_from_statement", "assignment", "call"];

/**
 * Collects, in one walk of the tree, the nodes the loader search needs:
 * imports and assignments for the bindings, and calls to inspect.
 * One walk instead of four matters: each walk crosses into WASM for every node.
 *
 * @param root - the module node.
 * @returns the matching nodes in source order.
 */
export function syntaxOf(root: Node): Node[] {
  return root.descendantsOfType(BINDING_NODES).flatMap((n) => (n ? [n] : []));
}

/**
 * Collects what each local name may refer to among the loader modules.
 * Reads import statements anywhere in the tree, then plain `name = expr`
 * assignments until nothing new is learned (at most one pass per assignment,
 * however the file is written). Only loaders, `getattr` and the modules that
 * hold them are kept.
 *
 * @param syntax - the module's nodes, as `syntaxOf` returns them.
 * @param outer - bindings already in effect.
 * @returns a new bindings map; `outer` is not changed.
 */
export function collectBindings(syntax: readonly Node[], outer: Bindings): Bindings {
  const bindings: Bindings = new Map([...outer].map(([name, qs]) => [name, new Set(qs)]));
  const assignments: { name: string; right: Node }[] = [];
  for (const node of syntax) {
    if (node.type === "import_statement" || node.type === "import_from_statement") {
      bindImport(node, bindings);
    } else if (node.type === "assignment") {
      assignments.push(...plainAssignment(node));
    }
  }
  for (let pass = 0; pass <= assignments.length; pass += 1) {
    const learned = assignments.map(({ name, right }) =>
      qualify(right, bindings)
        .map((q) => bind(bindings, name, q))
        .includes(true),
    );
    if (!learned.includes(true)) {
      break;
    }
  }
  return bindings;
}

/**
 * Records the names an import statement binds to loaders or loader modules.
 *
 * @param stmt - an `import_statement` or `import_from_statement` node.
 * @param bindings - the map to add to.
 */
function bindImport(stmt: Node, bindings: Bindings): void {
  for (const { local, qualified } of importBindings(stmt)) {
    if (qualified !== null) {
      bind(bindings, local, qualified);
    }
  }
}

/**
 * Reads a `name = expr` assignment; other targets (tuples, attributes) are skipped.
 *
 * @param node - an `assignment` node from the module or a function body.
 * @returns the assigned name and value, or nothing for another shape.
 */
function plainAssignment(node: Node): { name: string; right: Node }[] {
  const left = node.childForFieldName("left");
  const right = node.childForFieldName("right");
  return left?.type === "identifier" && right ? [{ name: identifierName(left), right }] : [];
}

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

/**
 * Adds one possible meaning to a local name, if it is under a loader module.
 *
 * @param bindings - the map to add to.
 * @param name - the local name.
 * @param qualified - what it may refer to, e.g. `importlib.import_module`.
 * @returns true when the map changed.
 */
function bind(bindings: Bindings, name: string, qualified: string): boolean {
  if (!TRACKED.has(qualified)) {
    return false;
  }
  const known = bindings.get(name);
  if (!known) {
    bindings.set(name, new Set([qualified]));
    return true;
  }
  if (known.has(qualified)) {
    return false;
  }
  known.add(qualified);
  return true;
}

/**
 * Lists the qualified names an expression may evaluate to.
 * Understands names, attributes, `m["name"]`, `m.__dict__["name"]`,
 * `vars(m)["name"]`, `getattr(m, "name")` and `importlib.import_module("m")`
 * or `__import__("m")` with literal names.
 *
 * @param node - an expression node.
 * @param bindings - what local names refer to.
 * @returns every qualified name the expression may be, empty when unknown.
 */
export function qualify(node: Node, bindings: Bindings): string[] {
  switch (node.type) {
    case "parenthesized_expression": {
      const [inner] = namedChildren(node);
      return inner ? qualify(inner, bindings) : [];
    }
    case "identifier":
      return [...(bindings.get(identifierName(node)) ?? [])];
    case "attribute": {
      const object = node.childForFieldName("object");
      const attribute = node.childForFieldName("attribute");
      if (!(object && attribute)) {
        return [];
      }
      const name = identifierName(attribute);
      // `m.__dict__[k]` is `m.k`: the subscript below appends k.
      return name === "__dict__"
        ? qualify(object, bindings)
        : member(qualify(object, bindings), name);
    }
    case "subscript": {
      const value = node.childForFieldName("value");
      const key = literalString(node.childForFieldName("subscript"));
      return value && key !== null ? member(qualify(value, bindings), key) : [];
    }
    case "call":
      return qualifyCall(node, bindings);
    default:
      return [];
  }
}

/**
 * Lists what a call expression may return, when it returns a module or a loader.
 *
 * @param call - a `call` node.
 * @param bindings - what local names refer to.
 * @returns the qualified names, empty when the call returns something else.
 */
function qualifyCall(call: Node, bindings: Bindings): string[] {
  const fn = call.childForFieldName("function");
  return fn
    ? qualify(fn, bindings).flatMap((qualified) => returnedBy(qualified, call, bindings))
    : [];
}

/**
 * Lists what one known callee returns for a call, when that is a module or a loader.
 *
 * @param qualified - the callee's qualified name.
 * @param call - the `call` node.
 * @param bindings - what local names refer to.
 * @returns the qualified names returned, empty for any other callee.
 */
function returnedBy(qualified: string, call: Node, bindings: Bindings): string[] {
  const object = argumentAt(call, 0, "");
  if (qualified === "builtins.getattr") {
    const attribute = literalString(argumentAt(call, 1, ""));
    return object && attribute !== null ? member(qualify(object, bindings), attribute) : [];
  }
  if (qualified === "builtins.vars") {
    return object ? qualify(object, bindings) : []; // `vars(m)[k]` is `m.k`
  }
  const kind = LOADERS.get(qualified);
  const name = literalString(argumentAt(call, 0, "name"));
  if (name === null) {
    return [];
  }
  if (kind === "import_module") {
    return [name];
  }
  // `__import__` returns the leaf with a fromlist, else the top package.
  return kind === "__import__" ? [name, name.split(".")[0] ?? name] : [];
}

/**
 * Appends an attribute to each qualified name.
 *
 * @param owners - qualified names of the object.
 * @param attribute - the attribute's name.
 * @returns `owner.attribute` for each owner.
 */
function member(owners: readonly string[], attribute: string): string[] {
  return owners.map((owner) => `${owner}.${attribute}`);
}
