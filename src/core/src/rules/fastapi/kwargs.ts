/**
 * @file The dict literals a name or a `**NAME` splat can hold, within one
 * file, for the FastAPI model's handler registrations (#242): `FastAPI(**KWARGS)`
 * with `KWARGS = {...}`, or an app factory `create_app(kwargs=None)` whose
 * callers in the same file pass `kwargs={"exception_handlers": {...}}`, as
 * prefect does.
 *
 * The reading is flow-insensitive: every assignment to the name in its scope
 * is a possible value, and so is every argument a same-file caller passes for
 * a parameter. Anything else (a call, an attribute, an import, a mutation such
 * as `kwargs["x"] = ...` or `kwargs.update(...)`, a factory no caller in the
 * file calls) makes the answer unknown, and the model then treats the app's
 * handlers as unknown. It reads one tree; callers in other files aren't seen.
 */
import type { Node } from "web-tree-sitter";
import { literalString } from "../../python/literals.ts";
import { identifierName, namedChildren } from "../../python/nodes.ts";
import { parameterNamed, parameterValues } from "./callers.ts";

/** How many names `dictsOf` follows before it gives up. */
const MAX_DEPTH = 4;

/** Nodes whose bodies are another scope, which the binding search doesn't enter. */
const NESTED: ReadonlySet<string> = new Set(["function_definition", "class_definition", "lambda"]);

/** Dict methods that change a dict in place, so its literal no longer says what it holds. */
const MUTATORS: ReadonlySet<string> = new Set([
  "update",
  "setdefault",
  "pop",
  "popitem",
  "clear",
  "__setitem__",
]);

/** How one scope binds a name. */
interface Binding {
  /** The right-hand sides of the assignments to the name. */
  readonly values: readonly Node[];
  /** The function's parameter of that name, when the scope is a function that has one. */
  readonly parameter: Node | null;
}

/**
 * Lists the dict literals the `**` splats of a call can hold.
 *
 * @param call - a `call` node.
 * @returns the dicts, none when the call has no `**` splat, or null when a
 *   splat (or a `*args`) holds something Inwards can't read.
 */
export function splattedDicts(call: Node): Node[] | null {
  const list = call.childForFieldName("arguments");
  const dicts: Node[] = [];
  for (const arg of list ? namedChildren(list) : []) {
    if (arg.type === "list_splat") {
      return null;
    }
    const [inner] = arg.type === "dictionary_splat" ? namedChildren(arg) : [];
    const found = inner ? dictsOf(inner) : [];
    if (found === null) {
      return null;
    }
    dicts.push(...found);
  }
  return dicts;
}

/**
 * Lists the dict literals an expression can evaluate to: a dict display,
 * `None` (none), `a or b` and `a if c else b` (both sides), and a name,
 * through its bindings in the enclosing scopes.
 *
 * @param node - an expression node.
 * @param resolving - the names being resolved, by scope, which ends a
 *   self-reference such as `kwargs = kwargs or {}`.
 * @param depth - how many names were followed to get here.
 * @returns the dict nodes, or null when some value can't be read.
 */
export function dictsOf(
  node: Node,
  resolving: ReadonlySet<string> = new Set(),
  depth = 0,
): Node[] | null {
  if (depth > MAX_DEPTH) {
    return null;
  }
  switch (node.type) {
    case "dictionary":
      return [node];
    case "none":
      return [];
    case "identifier":
      return bindingsOf(node, resolving, depth + 1);
    case "parenthesized_expression":
    case "boolean_operator":
    case "conditional_expression": {
      // `a if c else b`: the condition is the middle child, and isn't a value.
      const parts = namedChildren(node).filter(
        (_, i) => node.type !== "conditional_expression" || i !== 1,
      );
      return allOf(parts.map((part) => dictsOf(part, resolving, depth)));
    }
    default:
      return null;
  }
}

/**
 * Lists the string keys of a dict display.
 *
 * @param dict - a `dictionary` node.
 * @returns the keys, or null when some key isn't a string literal or a `**` spread hides more.
 */
export function dictKeys(dict: Node): string[] | null {
  const keys: string[] = [];
  for (const child of namedChildren(dict).filter((c) => c.type !== "comment")) {
    const key = child.type === "pair" ? child.childForFieldName("key") : null;
    const text = key ? literalString(key) : null;
    if (text === null) {
      return null;
    }
    keys.push(text);
  }
  return keys;
}

/**
 * Finds the value of a string key in a dict display.
 *
 * @param dict - a `dictionary` node.
 * @param key - the key, e.g. `exception_handlers`.
 * @returns the value node, or null when the dict has no such literal key.
 */
export function entryOf(dict: Node, key: string): Node | null {
  for (const pair of namedChildren(dict)) {
    const k = pair.type === "pair" ? pair.childForFieldName("key") : null;
    if (k && literalString(k) === key) {
      return pair.childForFieldName("value");
    }
  }
  return null;
}

/**
 * Lists the dicts a name can hold, from the nearest scope that binds it:
 * its assignments there, and for a function's parameter, its default and
 * what callers in the file pass.
 *
 * @param identifier - the name's `identifier` node.
 * @param resolving - the names being resolved, by scope.
 * @param depth - how many names were followed to get here.
 * @returns the dicts, or null when the name isn't bound in the file or a
 *   binding can't be read.
 */
function bindingsOf(
  identifier: Node,
  resolving: ReadonlySet<string>,
  depth: number,
): Node[] | null {
  const name = identifierName(identifier);
  for (let scope: Node | null = scopeOf(identifier); scope !== null; scope = enclosing(scope)) {
    const key = `${scope.id}:${name}`;
    if (resolving.has(key)) {
      return []; // `kwargs = kwargs or {}`: what `kwargs` held is counted already
    }
    const binding = bindingIn(scope, name);
    if (binding === null) {
      return null;
    }
    const { values, parameter } = binding;
    if (values.length > 0 || parameter !== null) {
      const passed = parameter === null ? [] : parameterValues(scope, parameter, name);
      if (passed === null) {
        return null;
      }
      const inner = new Set([...resolving, key]);
      return allOf([...values, ...passed].map((value) => dictsOf(value, inner, depth)));
    }
  }
  return null;
}

/**
 * Reads how one scope binds a name.
 *
 * @param scope - a `function_definition` or the `module`.
 * @param name - the variable looked up.
 * @returns the assignments and the parameter, or null when the scope
 *   changes the name some way Inwards doesn't follow (a mutation, a tuple
 *   target, a loop, an augmented assignment).
 */
function bindingIn(scope: Node, name: string): Binding | null {
  const body = scope.type === "module" ? scope : scope.childForFieldName("body");
  const values: Node[] = [];
  for (const node of body ? ownNodes(body) : []) {
    const left = node.childForFieldName("left");
    if (node.type === "assignment" && left?.type === "identifier") {
      const right = node.childForFieldName("right");
      if (identifierName(left) === name && right) {
        values.push(right);
      }
    } else if (changes(node, name)) {
      return null;
    }
  }
  const parameter = scope.type === "function_definition" ? parameterNamed(scope, name) : null;
  return { values, parameter };
}

/**
 * Tells whether a node changes a name other than by a plain assignment.
 *
 * @param node - a node of the scope.
 * @param name - the variable looked up.
 * @returns true for `name[k] = v`, `name |= ...`, `name.update(...)` and the
 *   like, and a name bound as a tuple target, a loop variable or by `:=`.
 */
function changes(node: Node, name: string): boolean {
  const left = node.childForFieldName("left");
  switch (node.type) {
    case "assignment":
    case "augmented_assignment":
    case "for_statement":
      return (
        left !== null &&
        (isName(left, name) || left.descendantsOfType("identifier").some((n) => isName(n, name)))
      );
    case "named_expression":
      return isName(node.childForFieldName("name"), name);
    case "call": {
      const fn = node.childForFieldName("function");
      const attribute = fn?.type === "attribute" ? fn.childForFieldName("attribute") : null;
      const owner = fn?.type === "attribute" ? fn.childForFieldName("object") : null;
      return attribute !== null && isName(owner, name) && MUTATORS.has(identifierName(attribute));
    }
    default:
      return false;
  }
}

/**
 * Tells whether a node is a bare use of one name.
 *
 * @param node - a node, or null.
 * @param name - the name looked for.
 * @returns true for an `identifier` that spells it.
 */
function isName(node: Node | null, name: string): boolean {
  return node?.type === "identifier" && identifierName(node) === name;
}

/**
 * Lists a scope's nodes, leaving out nested functions, classes and lambdas.
 *
 * @param body - a function's body or the module.
 * @returns the nodes, in source order.
 */
function ownNodes(body: Node): Node[] {
  const found: Node[] = [];
  const stack = namedChildren(body).reverse();
  for (let node = stack.pop(); node; node = stack.pop()) {
    if (!NESTED.has(node.type)) {
      found.push(node);
      stack.push(...namedChildren(node).reverse());
    }
  }
  return found;
}

/**
 * Finds the scope a node's names resolve in: the nearest enclosing function,
 * or the module. Class bodies are skipped, as Python skips them for names
 * used in methods.
 *
 * @param node - a node inside the module.
 * @returns the `function_definition` or the `module`.
 */
function scopeOf(node: Node): Node {
  let at = node.parent;
  while (at !== null && at.type !== "function_definition" && at.type !== "module") {
    at = at.parent;
  }
  return at ?? node;
}

/**
 * Gives the scope around another one.
 *
 * @param scope - a `function_definition` or the `module`.
 * @returns the enclosing scope, or null for the module.
 */
function enclosing(scope: Node): Node | null {
  return scope.type === "module" ? null : scopeOf(scope);
}

/**
 * Joins lists of dicts, unknown when any is.
 *
 * @param lists - the lists, null where unknown.
 * @returns their concatenation, or null.
 */
function allOf(lists: readonly (Node[] | null)[]): Node[] | null {
  const all: Node[] = [];
  for (const list of lists) {
    if (list === null) {
      return null;
    }
    all.push(...list);
  }
  return all;
}
