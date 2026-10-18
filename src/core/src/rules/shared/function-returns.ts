/**
 * @file What a Python function returns and binds in its own scope, for the
 * router recognition in `fastapi-routers.ts` (#358): its return annotation
 * as a qualified name, the `NAME = <call>` assignments of its body, and the
 * names and calls its `return` statements give back. Nested functions,
 * classes and lambdas are other scopes and are left out. It reads one
 * function's tree and resolves nothing.
 */
import type { Node } from "web-tree-sitter";
import { descendantsOutside, identifierName, namedChildren } from "../../shared/python/nodes.ts";
import type { Qualify } from "../../shared/python/qualify.ts";

/** The nodes whose bodies belong to another scope. */
const SCOPES: ReadonlySet<string> = new Set(["function_definition", "class_definition", "lambda"]);

/** A `NAME = <call>` assignment of a function's own scope. */
export interface CallBinding {
  readonly assignment: Node;
  /** The bound name. */
  readonly local: string;
  readonly call: Node;
}

/**
 * Qualifies a function's return annotation when it is a plain name or
 * attribute (`-> APIRouter`, `-> fastapi.APIRouter`).
 *
 * @param fn - a `function_definition` node.
 * @param qualify - qualifies a name in the function's module.
 * @returns the qualified name, or null for no annotation or any other type.
 */
export function returnType(fn: Node, qualify: Qualify): string | null {
  const annotation = fn.childForFieldName("return_type");
  const [type] = annotation?.type === "type" ? namedChildren(annotation) : [annotation];
  return type ? qualify(type) : null;
}

/**
 * Lists the statements of one type in a function's own scope.
 *
 * @param fn - a `function_definition` node.
 * @param type - the statement type, e.g. `return_statement`.
 * @returns the nodes, in source order.
 */
function ownStatements(fn: Node, type: string): Node[] {
  const body = fn.childForFieldName("body");
  return body ? descendantsOutside(body, new Set([type]), SCOPES) : [];
}

/**
 * Lists the `NAME = <call>` assignments of a function's own scope.
 *
 * @param fn - a `function_definition` node.
 * @returns each assignment with its bound name and call, in source order.
 */
export function ownCallBindings(fn: Node): CallBinding[] {
  return ownStatements(fn, "assignment").flatMap((assignment) => {
    const left = assignment.childForFieldName("left");
    const right = assignment.childForFieldName("right");
    return left?.type === "identifier" && right?.type === "call"
      ? [{ assignment, local: identifierName(left), call: right }]
      : [];
  });
}

/**
 * Lists the bare names that a function's own `return` statements give back.
 *
 * @param fn - a `function_definition` node.
 * @returns the names, e.g. `router` for `return router`.
 */
export function returnedNames(fn: Node): Set<string> {
  return new Set(
    ownStatements(fn, "return_statement").flatMap((statement) => {
      const [value] = namedChildren(statement);
      return value?.type === "identifier" ? [identifierName(value)] : [];
    }),
  );
}

/**
 * Lists the calls a function returns: `return Router(...)`, or `return
 * router` after `router = Router(...)` in its own scope.
 *
 * @param fn - a `function_definition` node.
 * @returns the call nodes.
 */
export function returnedCalls(fn: Node): Node[] {
  const names = returnedNames(fn);
  const direct = ownStatements(fn, "return_statement").flatMap((statement) => {
    const [value] = namedChildren(statement);
    return value?.type === "call" ? [value] : [];
  });
  const bound = ownCallBindings(fn).filter(({ local }) => names.has(local));
  return [...direct, ...bound.map(({ call }) => call)];
}

/** The names of `type` in an annotation, so `-> type[X]` says the function returns the class `X`. */
const TYPE_OF: ReadonlySet<string> = new Set(["type", "Type", "typing.Type", "builtins.type"]);

/**
 * Spells the outer name of a subscripted annotation: the builtin `type`
 * unqualified (it is never imported), anything else qualified.
 *
 * @param outer - the subscripted name, e.g. `type` or `typing.Type`.
 * @param qualify - qualifies a name in the function's module.
 * @returns the spelling `TYPE_OF` is matched against, or null.
 */
function typeName(outer: Node, qualify: Qualify): string | null {
  return outer.type === "identifier" && identifierName(outer) === "type" ? "type" : qualify(outer);
}

/**
 * Reads the class a function says it returns: `-> type[X]` or `-> typing.Type[X]`.
 *
 * @param fn - a `function_definition` node.
 * @param qualify - qualifies a name in the function's module.
 * @returns the qualified name of `X`, or null for any other annotation.
 */
export function returnedClassType(fn: Node, qualify: Qualify): string | null {
  const annotation = fn.childForFieldName("return_type");
  const [type] = annotation?.type === "type" ? namedChildren(annotation) : [];
  let outer: Node | null | undefined = null;
  let inner: Node | null | undefined = null;
  if (type?.type === "generic_type") {
    const [name, parameters] = namedChildren(type);
    outer = name;
    const [first] = parameters ? namedChildren(parameters) : [];
    [inner] = first?.type === "type" ? namedChildren(first) : [first];
  } else if (type?.type === "subscript") {
    outer = type.childForFieldName("value");
    inner = type.childForFieldName("subscript");
  }
  const spelled = outer ? typeName(outer, qualify) : null;
  return spelled !== null && TYPE_OF.has(spelled) && inner ? qualify(inner) : null;
}

/**
 * Lists the classes a function defines in its own scope and returns by name,
 * as a class factory does: `class _Router(APIRouter): ...; return _Router`.
 *
 * @param fn - a `function_definition` node.
 * @returns the `class_definition` nodes.
 */
export function returnedClasses(fn: Node): Node[] {
  const names = returnedNames(fn);
  return ownStatements(fn, "class_definition").filter((cls) => {
    const name = cls.childForFieldName("name");
    return name !== null && names.has(identifierName(name));
  });
}
