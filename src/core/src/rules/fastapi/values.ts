/**
 * @file How the FastAPI model reads arguments: a literal where it is one, a
 * qualified name, a call such as `Depends(get_db)`, or `unknown`. Names are
 * qualified through the file's imports (`python/parser.ts`'s
 * `importedNames`), so `status.HTTP_404_NOT_FOUND` reads as
 * `fastapi.status.HTTP_404_NOT_FOUND`. Nothing here resolves a name to its
 * definition; `model.ts` does that across files.
 */
import type { Node } from "web-tree-sitter";
import { hasSplat, literalString } from "../../python/literals.ts";
import { identifierName, keywordOf, namedChildren, signedInteger } from "../../python/nodes.ts";

/**
 * An argument as written: a literal where it is one, a qualified name, a
 * call, or `unknown` for anything else (an f-string, arithmetic, a lambda).
 */
export type Value =
  | { readonly kind: "str"; readonly value: string }
  | { readonly kind: "int"; readonly value: number }
  | { readonly kind: "bool"; readonly value: boolean }
  | { readonly kind: "none" }
  /** A list or a tuple. */
  | { readonly kind: "list"; readonly items: readonly Value[] }
  /** A dict display; `spread` holds what each `**x` in it names. */
  | {
      readonly kind: "dict";
      readonly entries: readonly (readonly [Value, Value])[];
      readonly spread: readonly Value[];
    }
  /** A name or an attribute, qualified: `status.HTTP_404_NOT_FOUND` is `fastapi.status.HTTP_404_NOT_FOUND`. */
  | { readonly kind: "name"; readonly name: string }
  | {
      readonly kind: "call";
      readonly callee: string | null;
      readonly args: readonly Value[];
      readonly keywords: ReadonlyMap<string, Value>;
    }
  | { readonly kind: "unknown" };

/** A keyword argument's value node and what it reads as. */
export interface Argument {
  readonly node: Node;
  readonly value: Value;
}

/** What the model keeps of every call it records. */
export interface CallSyntax {
  /** The `call` node. */
  readonly node: Node;
  /** The keyword arguments written out, by keyword. */
  readonly keywords: ReadonlyMap<string, Argument>;
  /** True when `*args` or `**kwargs` may hide more arguments. */
  readonly splat: boolean;
}

/** Qualifies a name or attribute node, or returns null for any other expression. */
export type Qualify = (node: Node) => string | null;

const UNKNOWN: Value = { kind: "unknown" };

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

/**
 * Reads a call's keyword arguments and whether a splat may hide more.
 *
 * @param call - a `call` node.
 * @param qualify - qualifies a name through the file's imports.
 * @returns the call's syntax, as the model keeps it.
 */
export function callSyntax(call: Node, qualify: Qualify): CallSyntax {
  const list = call.childForFieldName("arguments");
  const keywords = new Map<string, Argument>();
  for (const arg of list ? namedChildren(list) : []) {
    const value = arg.type === "keyword_argument" ? arg.childForFieldName("value") : null;
    if (value) {
      keywords.set(keywordOf(arg), { node: value, value: valueFrom(value, qualify) });
    }
  }
  return { node: call, keywords, splat: hasSplat(call) };
}

/**
 * Reads an expression as a `Value`: literals, lists and tuples, dicts,
 * qualified names and calls, and `unknown` for anything else.
 *
 * @param node - an expression node.
 * @param qualify - qualifies a name through the file's imports.
 * @returns what the expression reads as.
 */
export function valueFrom(node: Node, qualify: Qualify): Value {
  switch (node.type) {
    case "string":
    case "concatenated_string": {
      const value = literalString(node);
      return value === null ? UNKNOWN : { kind: "str", value };
    }
    case "integer":
    case "unary_operator": {
      const value = signedInteger(node);
      return value === null ? UNKNOWN : { kind: "int", value };
    }
    case "true":
    case "false":
      return { kind: "bool", value: node.type === "true" };
    case "none":
      return { kind: "none" };
    case "list":
    case "tuple":
      return { kind: "list", items: namedChildren(node).map((item) => valueFrom(item, qualify)) };
    case "dictionary":
      return dictFrom(node, qualify);
    case "identifier":
    case "attribute": {
      const name = qualify(node);
      return name === null ? UNKNOWN : { kind: "name", name };
    }
    case "call":
      return callFrom(node, qualify);
    case "parenthesized_expression": {
      const [inner] = namedChildren(node);
      return inner ? valueFrom(inner, qualify) : UNKNOWN;
    }
    default:
      return UNKNOWN;
  }
}

/**
 * Reads a dict display: its `key: value` pairs and its `**x` spreads.
 *
 * @param node - a `dictionary` node.
 * @param qualify - qualifies a name through the file's imports.
 * @returns the dict value.
 */
function dictFrom(node: Node, qualify: Qualify): Value {
  const entries: (readonly [Value, Value])[] = [];
  const spread: Value[] = [];
  for (const child of namedChildren(node)) {
    const key = child.childForFieldName("key");
    const value = child.childForFieldName("value");
    const [splatted] = child.type === "dictionary_splat" ? namedChildren(child) : [];
    if (key && value) {
      entries.push([valueFrom(key, qualify), valueFrom(value, qualify)]);
    } else {
      spread.push(splatted ? valueFrom(splatted, qualify) : UNKNOWN);
    }
  }
  return { kind: "dict", entries, spread };
}

/**
 * Reads a call inside an argument, such as `Depends(get_db)`.
 *
 * @param node - a `call` node.
 * @param qualify - qualifies a name through the file's imports.
 * @returns the callee's qualified name, the positional arguments and the keywords.
 */
function callFrom(node: Node, qualify: Qualify): Value {
  const fn = node.childForFieldName("function");
  const list = node.childForFieldName("arguments");
  const args = (list ? namedChildren(list) : []).filter((a) => a.type !== "keyword_argument");
  const keywords = new Map<string, Value>();
  for (const [keyword, arg] of callSyntax(node, qualify).keywords) {
    keywords.set(keyword, arg.value);
  }
  return {
    kind: "call",
    callee: fn ? qualify(fn) : null,
    args: args.map((a) => valueFrom(a, qualify)),
    keywords,
  };
}
