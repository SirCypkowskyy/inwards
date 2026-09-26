/**
 * Decides whether an `exec`, `eval` or `compile` call whose source isn't a
 * literal is an unverifiable dynamic import (INW011). It isn't when:
 *
 * - the call is `compile`, which only builds a code object: running that
 *   takes `exec` or `eval`, which are reported themselves;
 * - the source is `compile(<literal>, ...)` with `compile` not rebound, whose
 *   imports are read at that call;
 * - a bare `exec` or `eval` names something the code binds itself where the
 *   call can see it, such as `def eval(model, loader)` in PyTorch training code.
 *
 * Only the computed case looks at rebinding: a literal source is still read
 * wherever the name comes from (ADR-015), since reading it can add findings
 * but not hide one. A rebinding counts only when it would really shadow the
 * builtin at the call (see `rebound`), so it errs toward a report.
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
  if (fn?.type === "identifier" && identifierName(fn) === via && rebound(call, via, bindings)) {
    return [];
  }
  const source = argumentAt(call, 0, "source");
  const compiler = source?.type === "call" ? source.childForFieldName("function") : null;
  const trusted =
    source &&
    compiler &&
    qualify(compiler, bindings).includes("builtins.compile") &&
    !(compiler.type === "identifier" && rebound(source, identifierName(compiler), bindings));
  const compiled = trusted ? literalSource(argumentAt(source, 0, "source")) : null;
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

/** Nodes whose body is a scope of its own. */
const SCOPES = new Set(["function_definition", "lambda", "class_definition"]);

/** Patterns whose parts are each assignment (or `del`) targets. */
const PATTERNS = new Set([
  "pattern_list",
  "tuple_pattern",
  "list_pattern",
  "tuple",
  "list",
  "parenthesized_expression",
  "list_splat_pattern",
  "expression_list",
]);

/**
 * Tells whether a name, at a call, is something the code bound itself rather
 * than the builtin. A binding counts when it sits at module level (before the
 * call, if the call runs at module level too) or in a function or lambda that
 * encloses the call; a `for` target counts only inside its loop. A binding
 * whose value mentions a loader (`exec = builtins.exec`) doesn't count, nor
 * does a relative import, which may re-export the builtin. A `del` of the name
 * where the call can see it turns the exemption off.
 *
 * @param call - the call that uses the name.
 * @param name - the name, e.g. `eval`.
 * @param bindings - what names mean in the calling module.
 * @returns true when the name is rebound where the call sees it.
 */
function rebound(call: Node, name: string, bindings: Bindings): boolean {
  const nodes = call.tree.rootNode
    .descendantsOfType([...BINDERS, "delete_statement"])
    .flatMap((n) => (n && visibleAt(n, call) ? [n] : []));
  const deleted = nodes.some(
    (n) => n.type === "delete_statement" && namedChildren(n).flatMap(targetNames).includes(name),
  );
  return !deleted && nodes.some((n) => boundNames(n, bindings).includes(name));
}

/**
 * Tells whether what a statement binds is visible at a call.
 *
 * @param binder - a binding or `del` node.
 * @param call - the call.
 * @returns true when the binding's scope encloses the call, as described in `rebound`.
 */
function visibleAt(binder: Node, call: Node): boolean {
  const definition = binder.type === "function_definition" || binder.type === "class_definition";
  const scope = enclosingScope(definition ? binder.parent : binder);
  if (binder.type === "for_statement" && !encloses(binder.childForFieldName("body"), call)) {
    return false;
  }
  // A `for` binds its target before the body runs, while other statements bind when they end.
  const left = binder.type === "for_statement" ? binder.childForFieldName("left") : null;
  const bindsAt = (left ?? binder).endIndex;
  if (scope === null) {
    const runsAtModuleLevel =
      (enclosingScope(call)?.type ?? "class_definition") === "class_definition";
    return !runsAtModuleLevel || bindsAt <= call.startIndex;
  }
  return scope.type !== "class_definition" && encloses(scope, call);
}

/**
 * Finds the function, lambda or class whose body holds a node.
 *
 * @param node - any node, or null.
 * @returns the innermost enclosing scope node, or null at module level.
 */
function enclosingScope(node: Node | null): Node | null {
  for (let n = node; n; n = n.parent) {
    if (SCOPES.has(n.type)) {
      return n;
    }
  }
  return null;
}

/**
 * Tells whether one node contains another.
 *
 * @param outer - the possible ancestor, or null.
 * @param inner - the node.
 * @returns true when `inner` lies inside `outer`.
 */
function encloses(outer: Node | null, inner: Node): boolean {
  return outer !== null && outer.startIndex <= inner.startIndex && inner.endIndex <= outer.endIndex;
}

/**
 * Lists the names one binding node binds, leaving out a value that mentions
 * a loader and imports that may be the builtin.
 *
 * @param node - a node of one of the `BINDERS` types.
 * @param bindings - what names mean in the calling module.
 * @returns the bound names.
 */
function boundNames(node: Node, bindings: Bindings): string[] {
  switch (node.type) {
    case "function_definition":
    case "class_definition": {
      const name = node.childForFieldName("name");
      return name ? [identifierName(name)] : [];
    }
    case "parameters":
    case "lambda_parameters":
      return namedChildren(node).flatMap(parameterName);
    case "assignment":
    case "for_statement":
      return valueBinds(node.childForFieldName("right"), node.childForFieldName("left"), bindings);
    case "named_expression":
      return valueBinds(node.childForFieldName("value"), node.childForFieldName("name"), bindings);
    case "delete_statement":
      return [];
    default:
      return importBindings(node).flatMap(({ local, qualified }) =>
        qualified === null || qualified.startsWith("builtins.") ? [] : [local],
      );
  }
}

/**
 * Lists the names a `target = value` binds, unless the value mentions a
 * loader or a module that holds one (`exec = exec`, `getattr(builtins, "exec")`).
 *
 * @param value - the value or iterable; null for an annotation without one.
 * @param target - the target.
 * @param bindings - what names mean in the calling module.
 * @returns the bound names.
 */
function valueBinds(value: Node | null, target: Node | null, bindings: Bindings): string[] {
  if (!value) {
    return [];
  }
  const parts = [
    value,
    ...value.descendantsOfType(["identifier", "attribute", "call", "subscript"]),
  ];
  const loader = parts.some((n) => n !== null && qualify(n, bindings).length > 0);
  return loader ? [] : targetNames(target);
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
