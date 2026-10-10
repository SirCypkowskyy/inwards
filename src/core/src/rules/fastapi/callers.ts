/**
 * @file What a function's parameter can hold, read from the calls to the
 * function in the same file, for `kwargs.ts` (#242): its default and the
 * argument each call passes, by keyword or by position. It finds the value
 * nodes only; reading them as dicts is `kwargs.ts`'s job. Callers in other
 * files, methods and `*args` or `**kwargs` parameters are unknown.
 */
import type { Node } from "web-tree-sitter";
import { identifierName, keywordOf, namedChildren } from "../../python/nodes.ts";

/** Parameter nodes that end the positional ones: `*`, `*args` and `**kwargs`. */
const KEYWORD_ONLY: ReadonlySet<string> = new Set([
  "keyword_separator",
  "list_splat_pattern",
  "dictionary_splat_pattern",
]);

/**
 * Lists what a parameter can hold: its default, and the argument each call to
 * the function in the same file passes for it, by name. A function no call in
 * the file reaches, a method, or a `*args` or `**kwargs` parameter is
 * unknown: its callers are elsewhere.
 *
 * @param fn - the `function_definition`.
 * @param parameter - the parameter node.
 * @param name - what the parameter is called, for keyword arguments.
 * @returns the value nodes, or null when the callers can't be read.
 */
export function parameterValues(fn: Node, parameter: Node, name: string): Node[] | null {
  const fnName = fn.childForFieldName("name");
  const root = rootOf(fn);
  const holder = fn.parent?.type === "decorated_definition" ? fn.parent : fn;
  const method =
    holder.parent?.type === "block" && holder.parent.parent?.type === "class_definition";
  if (!fnName || KEYWORD_ONLY.has(parameter.type) || method) {
    return null;
  }
  const own = identifierName(fnName);
  const calls = root.descendantsOfType("call").filter((call) => {
    const callee = call?.childForFieldName("function");
    return callee?.type === "identifier" && identifierName(callee) === own;
  });
  if (calls.length === 0) {
    return null;
  }
  const index = positionOf(fn, parameter);
  const values: Node[] = [];
  const fallback = parameter.childForFieldName("value");
  if (fallback) {
    values.push(fallback);
  }
  for (const call of calls) {
    const passed = call ? passedFor(call, name, index) : null;
    if (passed === null) {
      return null;
    }
    values.push(...passed);
  }
  return values;
}

/**
 * Finds the argument a call passes for one parameter.
 *
 * @param call - a call to the function.
 * @param name - what the parameter is called, for a keyword argument.
 * @param index - its position, or -1 when it can only be passed by keyword.
 * @returns the argument node, none when the call leaves the default, or null
 *   when a splat may pass it.
 */
function passedFor(call: Node, name: string, index: number): Node[] | null {
  const list = call.childForFieldName("arguments");
  const args = list ? namedChildren(list) : [];
  const keyword = args.find((a) => a.type === "keyword_argument" && keywordOf(a) === name);
  const value = keyword?.childForFieldName("value");
  if (value) {
    return [value];
  }
  const positional = args.filter((a) => a.type !== "keyword_argument" && a.type !== "comment");
  const at = index >= 0 ? positional[index] : undefined;
  if (at?.type === "list_splat" || at?.type === "dictionary_splat") {
    return null;
  }
  if (at) {
    return [at];
  }
  return args.some((a) => a.type === "list_splat" || a.type === "dictionary_splat") ? null : [];
}

/**
 * Finds a function's parameter by name.
 *
 * @param fn - the `function_definition`.
 * @param name - what the parameter is called.
 * @returns the parameter node, or null when it has none of that name.
 */
export function parameterNamed(fn: Node, name: string): Node | null {
  const list = fn.childForFieldName("parameters");
  return (list ? namedChildren(list) : []).find((p) => parameterName(p) === name) ?? null;
}

/**
 * Reads a parameter's name, in any of its forms (`x`, `x=1`, `x: T`, `x: T = 1`, `*x`, `**x`).
 *
 * @param parameter - a node of the parameter list.
 * @returns the name, or null for `*` and `/`.
 */
function parameterName(parameter: Node): string | null {
  if (parameter.type === "identifier") {
    return identifierName(parameter);
  }
  const named = parameter.childForFieldName("name");
  const [first] = namedChildren(parameter);
  const id = named ?? (first?.type === "identifier" ? first : null);
  return id ? identifierName(id) : null;
}

/**
 * Gives a parameter's position among the ones a call can pass positionally.
 *
 * @param fn - the `function_definition`.
 * @param parameter - the parameter node.
 * @returns its index, or -1 when it comes after `*`, `*args` or `**kwargs`.
 */
function positionOf(fn: Node, parameter: Node): number {
  const list = fn.childForFieldName("parameters");
  let index = 0;
  for (const p of list ? namedChildren(list) : []) {
    if (KEYWORD_ONLY.has(p.type)) {
      return -1;
    }
    if (p.id === parameter.id) {
      return index;
    }
    index += p.type === "positional_separator" || p.type === "comment" ? 0 : 1;
  }
  return -1;
}

/**
 * Finds the module a node is in.
 *
 * @param node - a node of a parsed file.
 * @returns the file's `module` node.
 */
function rootOf(node: Node): Node {
  let at = node;
  while (at.parent !== null) {
    at = at.parent;
  }
  return at;
}
