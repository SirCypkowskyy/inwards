/**
 * Decides whether an `exec`, `eval` or `compile` call whose source isn't a
 * literal is an unverifiable dynamic import (INW011). It isn't when:
 *
 * - the call is `compile`, which only builds a code object: running that
 *   takes `exec` or `eval`, which are reported themselves;
 * - the source is `compile(<literal>, ...)` with `compile` not rebound, whose
 *   imports are read at that call;
 * - a bare `exec` or `eval` names something the code binds itself, such as
 *   `def eval(model, loader)` in PyTorch training code (see `rebound`).
 *
 * Only the computed case looks at rebinding: a literal source is still read
 * wherever the name comes from (ADR-015), since reading it can add findings
 * but not hide one. The exemption is conservative: anything that could leave
 * the builtin in place at the call turns it off, so it errs toward a report.
 */
import type { Node } from "web-tree-sitter";
import { type Bindings, importBindings, qualify } from "./callees.ts";
import { argumentAt, identifierName, literalSource, namedChildren } from "./literals.ts";
import { COMPUTED, type Loaded } from "./loader-targets.ts";
import type { ModuleLookup } from "./unassigned.ts";

/**
 * Lists what a source-running call with a non-literal source loads.
 *
 * @param call - the `exec`, `eval` or `compile` call.
 * @param via - the loader's name: `exec`, `eval` or `compile`.
 * @param bindings - what names mean in the calling module.
 * @param ownerOf - finds first-party modules, whose imports may re-export the builtin.
 * @returns `COMPUTED`, or nothing when the call is not an unverifiable load.
 */
export function computedSource(
  call: Node,
  via: string,
  bindings: Bindings,
  ownerOf: ModuleLookup,
): Loaded[] {
  if (via === "compile") {
    return [];
  }
  const fn = call.childForFieldName("function");
  if (
    fn?.type === "identifier" &&
    identifierName(fn) === via &&
    rebound(call, via, bindings, ownerOf)
  ) {
    return [];
  }
  const source = argumentAt(call, 0, "source");
  const compiler = source?.type === "call" ? source.childForFieldName("function") : null;
  const trusted =
    source &&
    compiler &&
    qualify(compiler, bindings).includes("builtins.compile") &&
    !(
      compiler.type === "identifier" && rebound(source, identifierName(compiler), bindings, ownerOf)
    );
  const compiled = trusted ? literalSource(argumentAt(source, 0, "source")) : null;
  return compiled === null ? [COMPUTED] : [];
}

/** Nodes that bind a name, or declare or delete one. */
const BINDERS = [
  "function_definition",
  "class_definition",
  "parameters",
  "lambda_parameters",
  "default_parameter",
  "typed_default_parameter",
  "assignment",
  "named_expression",
  "for_statement",
  "as_pattern",
  "import_statement",
  "import_from_statement",
  "global_statement",
  "nonlocal_statement",
  "delete_statement",
];

/**
 * Names through which code can rewrite a module's namespace behind a binding's
 * back: `globals()["exec"] = ...`, `setattr(module, "exec", ...)`,
 * `sys.modules[__name__].__dict__`...
 */
const NAMESPACE_WRITERS = new Set([
  "globals",
  "vars",
  "locals",
  "setattr",
  "delattr",
  "__dict__",
  "__builtins__",
]);

/** Modules an import of a loader can come from; relative imports count too. */
const LOADER_MODULES = new Set(["builtins", "importlib", "runpy"]);

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
 * Tells whether a name, at a call, is surely something the code bound itself
 * rather than the builtin. All of these must hold:
 *
 * 1. no binding of the name anywhere in the file may be the builtin: an
 *    assignment, walrus, `for`, `with` / `except` target or parameter default
 *    whose value mentions a loader, an import from `builtins`, `importlib`,
 *    `runpy` or a relative module, or a `del`;
 * 2. no `global` or `nonlocal` declares the name;
 * 3. some binding is certain to have run: a `def`, `class`, plain assignment
 *    or import that is a direct statement of the module body or of the body
 *    of a function enclosing the call; a parameter of a function or lambda
 *    whose body holds the call; a `for` target whose loop body holds it;
 * 4. a module-level binding comes before the top-level statement holding the call;
 * 5. the file never rewrites a namespace (`globals`, `vars`, `locals`,
 *    `setattr`, `delattr`, `__dict__`, `__builtins__`, `sys.modules`) and has
 *    no wildcard import, either of which can put the builtin back.
 *
 * @param call - the call that uses the name.
 * @param name - the name, e.g. `eval`.
 * @param bindings - what names mean in the calling module.
 * @param ownerOf - finds first-party modules, whose imports may re-export the builtin.
 * @returns true when the name is rebound where the call sees it.
 */
function rebound(call: Node, name: string, bindings: Bindings, ownerOf: ModuleLookup): boolean {
  const root = call.tree.rootNode;
  const nodes = root.descendantsOfType(BINDERS).flatMap((n) => (n ? [n] : []));
  return (
    !(rewritesNamespace(root) || nodes.some((n) => mayBeBuiltin(n, name, bindings, ownerOf))) &&
    nodes.some((n) => surelyBinds(n, name, call))
  );
}

/**
 * Tells whether a file can rewrite a namespace or pulls in names it can't see.
 *
 * @param root - the module node.
 * @returns true for a namespace writer (see `NAMESPACE_WRITERS`), `sys.modules` or a wildcard import.
 */
function rewritesNamespace(root: Node): boolean {
  return root
    .descendantsOfType(["identifier", "wildcard_import"])
    .some((n) => n !== null && (n.type === "wildcard_import" || writesNamespace(n)));
}

/**
 * Tells whether an identifier names a namespace writer or `sys.modules`.
 *
 * @param id - an `identifier` node.
 * @returns true for a name in `NAMESPACE_WRITERS`, or `modules` read from `sys`.
 */
function writesNamespace(id: Node): boolean {
  const name = identifierName(id);
  const sysModules = name === "modules" && id.parent?.childForFieldName("object")?.text === "sys";
  return NAMESPACE_WRITERS.has(name) || sysModules;
}

/**
 * Tells whether a node could leave the builtin (or an unknown value) under a name.
 *
 * @param node - a node of one of the `BINDERS` types.
 * @param name - the name.
 * @param bindings - what names mean in the calling module.
 * @param ownerOf - finds first-party modules, whose imports may re-export the builtin.
 * @returns true for a loader-valued binding, a risky import, `global`, `nonlocal` or `del`.
 */
function mayBeBuiltin(
  node: Node,
  name: string,
  bindings: Bindings,
  ownerOf: ModuleLookup,
): boolean {
  switch (node.type) {
    case "global_statement":
    case "nonlocal_statement":
    case "delete_statement":
      return namedChildren(node).flatMap(targetNames).includes(name);
    case "assignment":
    case "for_statement":
      return (
        targetNames(node.childForFieldName("left")).includes(name) &&
        mentionsLoader(node.childForFieldName("right"), bindings)
      );
    case "named_expression":
      return (
        targetNames(node.childForFieldName("name")).includes(name) &&
        mentionsLoader(node.childForFieldName("value"), bindings)
      );
    case "as_pattern":
      return (
        targetNames(node.childForFieldName("alias")?.namedChildren[0] ?? null).includes(name) &&
        mentionsLoader(namedChildren(node)[0] ?? null, bindings)
      );
    case "default_parameter":
    case "typed_default_parameter":
      return (
        targetNames(node.childForFieldName("name")).includes(name) &&
        mentionsLoader(node.childForFieldName("value"), bindings)
      );
    case "import_statement":
    case "import_from_statement":
      return importBindings(node).some(
        ({ local, qualified }) =>
          local === name &&
          (qualified === null ||
            LOADER_MODULES.has(qualified.split(".")[0] ?? "") ||
            ownerOf(qualified) !== undefined),
      );
    case "function_definition":
    case "class_definition":
      return definedName(node) === name && wrappedByLoader(node, bindings);
    default:
      return false;
  }
}

/**
 * Reads the name a `def` or `class` binds.
 *
 * @param node - a `function_definition` or `class_definition` node.
 * @returns the name, or null when the node has none.
 */
function definedName(node: Node): string | null {
  const own = node.childForFieldName("name");
  return own ? identifierName(own) : null;
}

/**
 * Tells whether a decorator or a class argument (base, `metaclass=`, keyword)
 * of a definition mentions a loader, which can make the name the builtin again.
 *
 * @param node - a `function_definition` or `class_definition` node.
 * @param bindings - what names mean in the calling module.
 * @returns true when one of them mentions a loader.
 */
function wrappedByLoader(node: Node, bindings: Bindings): boolean {
  const decorators =
    node.parent?.type === "decorated_definition"
      ? namedChildren(node.parent).filter((c) => c.type === "decorator")
      : [];
  return [...decorators, node.childForFieldName("superclasses")].some((n) =>
    mentionsLoader(n, bindings),
  );
}

/**
 * Tells whether a node binds a name in a way certain to have run before the call.
 *
 * @param node - a node of one of the `BINDERS` types.
 * @param name - the name.
 * @param call - the call.
 * @returns true for a binding that meets conditions 3 and 4 of `rebound`.
 */
function surelyBinds(node: Node, name: string, call: Node): boolean {
  switch (node.type) {
    case "parameters":
    case "lambda_parameters":
      return (
        namedChildren(node).flatMap(parameterName).includes(name) &&
        encloses(node.parent?.childForFieldName("body") ?? null, call)
      );
    case "for_statement":
      return (
        targetNames(node.childForFieldName("left")).includes(name) &&
        encloses(node.childForFieldName("body"), call)
      );
    case "function_definition":
    case "class_definition": {
      const statement = node.parent?.type === "decorated_definition" ? node.parent : node;
      return definedName(node) === name && direct(statement, call);
    }
    case "assignment":
      return (
        node.childForFieldName("right") !== null &&
        targetNames(node.childForFieldName("left")).includes(name) &&
        node.parent?.type === "expression_statement" &&
        direct(node.parent, call)
      );
    case "import_statement":
    case "import_from_statement":
      return importBindings(node).some(({ local }) => local === name) && direct(node, call);
    default:
      return false;
  }
}

/**
 * Tells whether a statement surely runs before a call: it sits directly in the
 * module body, before the top-level statement holding the call, or directly in
 * the body of a function that encloses the call.
 *
 * @param statement - a statement node.
 * @param call - the call.
 * @returns true when the statement's bindings are in effect at the call.
 */
function direct(statement: Node, call: Node): boolean {
  const { parent } = statement;
  if (parent?.type === "module") {
    let top: Node = call;
    while (top.parent && top.parent.type !== "module") {
      top = top.parent;
    }
    return statement.endIndex <= top.startIndex;
  }
  return (
    parent?.type === "block" &&
    parent.parent?.type === "function_definition" &&
    encloses(parent, call)
  );
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
 * Tells whether an expression mentions a loader or a module that holds one
 * (`exec`, `builtins.eval`, `getattr(builtins, "exec")`).
 *
 * @param value - the expression, or null.
 * @param bindings - what names mean in the calling module.
 * @returns true when some part of it resolves to a tracked name.
 */
function mentionsLoader(value: Node | null, bindings: Bindings): boolean {
  if (!value) {
    return false;
  }
  const parts = [
    value,
    ...value.descendantsOfType(["identifier", "attribute", "call", "subscript"]),
  ];
  return parts.some((n) => n !== null && qualify(n, bindings).length > 0);
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
