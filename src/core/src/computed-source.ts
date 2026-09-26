/**
 * Decides whether an `exec`, `eval` or `compile` call whose source isn't a
 * literal is an unverifiable dynamic import (INW011). It isn't when:
 *
 * - the call is `compile`, which only builds a code object: running that
 *   takes `exec` or `eval`, which are reported themselves;
 * - the source is `compile(<literal>, ...)`, whose imports are read at that call;
 * - a bare `exec` or `eval` names something the file binds itself, such as
 *   `def eval(model, loader)` in PyTorch training code.
 *
 * Only the computed case looks at rebinding: a literal source is still read
 * wherever the name comes from (ADR-015), since reading it can add findings
 * but not hide one.
 */
import type { Node } from "web-tree-sitter";
import { type Bindings, importBindings, qualify } from "./callees.ts";
import { argumentAt, identifierName, literalSource, namedChildren } from "./literals.ts";
import { COMPUTED, type Loaded } from "./loader-targets.ts";

/**
 * Lists what a source-running call with a non-literal source loads.
 *
 * @param call - the `exec`, `eval` or `compile` call.
 * @param via - the loader's name: `exec`, `eval` or `compile`.
 * @param bindings - what names mean in the calling module.
 * @returns `COMPUTED`, or nothing when the call is not an unverifiable load.
 */
export function computedSource(call: Node, via: string, bindings: Bindings): Loaded[] {
  if (via === "compile") {
    return [];
  }
  const fn = call.childForFieldName("function");
  if (fn?.type === "identifier" && identifierName(fn) === via && rebinds(call.tree.rootNode, via)) {
    return [];
  }
  const source = argumentAt(call, 0, "source");
  const compiler = source?.type === "call" ? source.childForFieldName("function") : null;
  const compiled =
    source && compiler && qualify(compiler, bindings).includes("builtins.compile")
      ? literalSource(argumentAt(source, 0, "source"))
      : null;
  return compiled === null ? [COMPUTED] : [];
}

/** Nodes that can bind a name in a module or one of its functions. */
const BINDERS = [
  "function_definition",
  "class_definition",
  "parameters",
  "lambda_parameters",
  "assignment",
  "named_expression",
  "for_statement",
  "import_statement",
  "import_from_statement",
];

/** Patterns whose parts are each assignment targets. */
const PATTERNS = new Set([
  "pattern_list",
  "tuple_pattern",
  "list_pattern",
  "tuple",
  "list",
  "parenthesized_expression",
  "list_splat_pattern",
]);

/**
 * Tells whether a file binds a name anywhere: a `def` or `class` outside a
 * class body, a parameter, an assignment, a walrus or `for` target, or an
 * import from a module other than `builtins`. Scopes are ignored, as in
 * `callees.ts`: a name rebound in one function counts for the whole file.
 *
 * @param root - the module node.
 * @param name - the name, e.g. `eval`.
 * @returns true when some statement in the file binds it.
 */
function rebinds(root: Node, name: string): boolean {
  return root.descendantsOfType(BINDERS).some((n) => n !== null && boundNames(n).includes(name));
}

/**
 * Lists the names one binding node binds.
 *
 * @param node - a node of one of the `BINDERS` types.
 * @returns the bound names.
 */
function boundNames(node: Node): string[] {
  switch (node.type) {
    case "function_definition":
    case "class_definition": {
      const name = node.childForFieldName("name");
      return name && !inClassBody(node) ? [identifierName(name)] : [];
    }
    case "parameters":
    case "lambda_parameters":
      return namedChildren(node).flatMap(parameterName);
    case "assignment":
    case "for_statement":
      return targetNames(node.childForFieldName("left"));
    case "named_expression":
      return targetNames(node.childForFieldName("name"));
    default:
      return importBindings(node).flatMap(({ local, qualified }) =>
        qualified?.startsWith("builtins.") ? [] : [local],
      );
  }
}

/**
 * Tells whether a definition is a class member, which binds no module or function name.
 *
 * @param node - a `function_definition` or `class_definition` node.
 * @returns true when it sits directly in a class body.
 */
function inClassBody(node: Node): boolean {
  const outer = node.parent?.type === "decorated_definition" ? node.parent.parent : node.parent;
  return outer?.type === "block" && outer.parent?.type === "class_definition";
}

/**
 * Reads the name of one parameter: plain, typed, with a default, or `*args` / `**kwargs`.
 *
 * @param param - a child of `parameters` or `lambda_parameters`.
 * @returns the name, or nothing for a separator such as `*` or `/`.
 */
function parameterName(param: Node): string[] {
  const inner =
    param.type === "identifier"
      ? param
      : (param.childForFieldName("name") ?? namedChildren(param)[0]);
  return inner?.type === "identifier" ? [identifierName(inner)] : [];
}

/**
 * Lists the names an assignment target binds; attributes and subscripts bind none.
 *
 * @param node - the target, or null.
 * @returns the bound names.
 */
function targetNames(node: Node | null): string[] {
  if (node?.type === "identifier") {
    return [identifierName(node)];
  }
  return node && PATTERNS.has(node.type) ? namedChildren(node).flatMap(targetNames) : [];
}
