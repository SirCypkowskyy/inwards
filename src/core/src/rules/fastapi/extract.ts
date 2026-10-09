/**
 * @file Reads one file's FastAPI records out of its syntax tree: the names
 * bound to `FastAPI(...)` or `APIRouter(...)`, the path operations declared
 * on them, the `include_router` and `mount` calls, and the exception
 * handlers an app registers, with the status codes their responses set.
 * Function and class scopes are ignored, as INW011 ignores them, so an app
 * built inside a factory function is found too. It reads one tree and
 * resolves nothing across files; `model.ts` owns the parse and the lookups.
 */
import type { Node } from "web-tree-sitter";
import { argumentAt } from "../../python/literals.ts";
import { identifierName, namedChildren } from "../../python/nodes.ts";
import { constructorHandlers, handlerOf } from "./handlers.ts";
import type {
  Context,
  DependencyUse,
  EventHandlerUse,
  ExceptionHandler,
  FastApiFile,
  FastApiObject,
  PathOperation,
  Wiring,
} from "./records.ts";
import { type Argument, callSyntax, type Qualify, valueFrom } from "./values.ts";

/** The constructors the model looks for, by qualified name. */
const CONSTRUCTORS: ReadonlyMap<string, "app" | "router"> = new Map([
  ["fastapi.FastAPI", "app"],
  ["fastapi.applications.FastAPI", "app"],
  ["fastapi.APIRouter", "router"],
  ["fastapi.routing.APIRouter", "router"],
]);

/** The names `Depends` and `Security` are imported under. */
export const DEPENDS: ReadonlySet<string> = new Set([
  "fastapi.Depends",
  "fastapi.Security",
  "fastapi.params.Depends",
  "fastapi.params.Security",
]);

/** The path operation decorators named after one HTTP method. */
const METHODS: ReadonlySet<string> = new Set([
  "get",
  "post",
  "put",
  "delete",
  "patch",
  "options",
  "head",
  "trace",
]);

/** The records of one file while its calls are read. */
interface Found {
  /** The qualified names of the file's own objects. */
  readonly own: ReadonlySet<string>;
  readonly operations: PathOperation[];
  readonly wiring: Wiring[];
  readonly handlers: ExceptionHandler[];
  readonly events: EventHandlerUse[];
  readonly dependencies: DependencyUse[];
}

/**
 * Lists a module's top-level functions, decorated or not.
 *
 * @param root - the module node.
 * @returns each function's `function_definition` node by name.
 */
export function moduleFunctions(root: Node): Map<string, Node> {
  const functions = new Map<string, Node>();
  for (const child of namedChildren(root)) {
    const fn =
      child.type === "decorated_definition" ? child.childForFieldName("definition") : child;
    const name = fn?.type === "function_definition" ? fn.childForFieldName("name") : null;
    if (fn && name) {
      functions.set(identifierName(name), fn);
    }
  }
  return functions;
}

/**
 * Extracts one file's records from its tree, in two walks: assignments for
 * the objects, then calls for the operations, the wiring and the handlers.
 *
 * @param root - the module node.
 * @param context - the file, its name qualifier and its module-level functions.
 * @returns the file's records.
 */
export function extract(root: Node, context: Context): FastApiFile {
  const { file } = context;
  const objects = root.descendantsOfType("assignment").flatMap((a) => objectOf(a, context));
  const found: Found = {
    own: new Set(objects.map((o) => o.name)),
    operations: [],
    wiring: [],
    handlers: objects.flatMap((o) => constructorHandlers(o, context)),
    events: [],
    dependencies: [],
  };
  for (const call of root.descendantsOfType("call")) {
    const dependency = dependencyOf(call, context.qualify);
    if (dependency === null) {
      record(call, context, found);
    } else {
      found.dependencies.push(dependency);
    }
  }
  const { operations, wiring, handlers, events, dependencies } = found;
  return {
    path: file.path,
    module: file.module,
    objects,
    operations,
    wiring,
    handlers,
    events,
    dependencies,
  };
}

/**
 * Records one call if it is a path operation decorator, an inclusion, a
 * mount or a handler registration. It counts only on a receiver that is one
 * of the file's objects or an imported name, so `session.mount(...)` on a
 * local HTTP session doesn't; `include_router` counts on any named receiver.
 *
 * @param call - a `call` node.
 * @param context - the file, its qualifier and its functions.
 * @param found - the records so far; the call's record is appended to its list.
 */
function record(call: Node, context: Context, found: Found): void {
  const fn = call.childForFieldName("function");
  const object = fn?.type === "attribute" ? fn.childForFieldName("object") : null;
  const attribute = fn?.childForFieldName("attribute");
  const app = object ? context.qualify(object) : null;
  const method = attribute ? identifierName(attribute) : "";
  if (!(attribute && app !== null && counts(app, method, context, found))) {
    return;
  }
  const decorated = decoratedFunction(call);
  const exception = argumentAt(call, 0, "exc_class_or_status_code");
  if (decorated && (METHODS.has(method) || method === "api_route")) {
    found.operations.push(operationOf(call, { method, receiver: app, fn: decorated }, context));
  } else if (decorated && method === "exception_handler") {
    const via = "decorator";
    found.handlers.push(
      handlerOf({ app, via, node: call, exception, handler: decorated }, context),
    );
  } else if (method === "add_exception_handler") {
    const handler = argumentAt(call, 1, "handler");
    const via = "add_exception_handler";
    found.handlers.push(handlerOf({ app, via, node: call, exception, handler }, context));
  } else if (method === "on_event" || method === "add_event_handler") {
    found.events.push(eventOf(call, { via: method, receiver: app }, context.qualify));
  } else if (method === "include_router" || method === "mount") {
    found.wiring.push(wiringOf(call, method, app, context.qualify));
  }
}

/**
 * Tells whether a call on a receiver counts: on one of the file's objects or
 * an imported name, and `include_router` on any name, since it is FastAPI's
 * own (a `register(app)` function's parameter, which FAPI003 treats as an
 * unknown receiver).
 *
 * @param app - the receiver's qualified name.
 * @param method - the called attribute.
 * @param context - the file.
 * @param found - the records so far, with the file's own objects.
 * @returns true when the call is recorded.
 */
function counts(app: string, method: string, context: Context, found: Found): boolean {
  const imported = !app.startsWith(`${context.file.module}.`);
  return found.own.has(app) || imported || method === "include_router";
}

/**
 * Reads an assignment of `FastAPI(...)` or `APIRouter(...)` to a name.
 *
 * @param assignment - an `assignment` node.
 * @param context - the file and its name qualifier.
 * @returns the object, or nothing for any other assignment.
 */
function objectOf(assignment: Node, context: Context): FastApiObject[] {
  const { file, qualify } = context;
  const left = assignment.childForFieldName("left");
  const right = assignment.childForFieldName("right");
  const callee = right?.type === "call" ? right.childForFieldName("function") : null;
  const kind = callee ? CONSTRUCTORS.get(qualify(callee) ?? "") : undefined;
  if (left?.type !== "identifier" || !right || kind === undefined) {
    return [];
  }
  const local = identifierName(left);
  const topLevel = assignment.parent?.parent?.type === "module";
  return [
    { kind, name: `${file.module}.${local}`, local, topLevel, ...callSyntax(right, qualify) },
  ];
}

/**
 * Finds the function a decorator call decorates.
 *
 * @param call - a `call` node.
 * @returns the `function_definition` node, or null when the call isn't a function's decorator.
 */
function decoratedFunction(call: Node): Node | null {
  const definition =
    call.parent?.type === "decorator" ? call.parent.parent?.childForFieldName("definition") : null;
  return definition?.type === "function_definition" ? definition : null;
}

/**
 * Reads a path operation decorator.
 *
 * @param call - the decorator's `call` node.
 * @param decorator - what the decorator is.
 * @param decorator.method - its attribute, e.g. `get` or `api_route`.
 * @param decorator.receiver - the qualified app or router it is called on.
 * @param decorator.fn - the decorated `function_definition`.
 * @param context - the file and its name qualifier.
 * @returns the path operation.
 */
function operationOf(
  call: Node,
  { method, receiver, fn }: { method: string; receiver: string; fn: Node },
  context: Context,
): PathOperation {
  const { qualify } = context;
  const syntax = callSyntax(call, qualify);
  const path = argumentAt(call, 0, "path");
  const name = fn.childForFieldName("name");
  return {
    ...syntax,
    receiver,
    decorator: method,
    methods: method === "api_route" ? methodsOf(syntax.keywords.get("methods")) : [method],
    path: path ? valueFrom(path, qualify) : null,
    function: fn,
    name: name ? identifierName(name) : "",
  };
}

/**
 * Reads the `methods=` of an `api_route`, which defaults to GET.
 *
 * @param methods - the keyword argument, if given.
 * @returns the lower-case methods, or `unknown` when they aren't a list of literals.
 */
function methodsOf(methods: Argument | undefined): readonly string[] | "unknown" {
  if (methods === undefined) {
    return ["get"];
  }
  const { value } = methods;
  const items = value.kind === "list" ? value.items : [];
  const names = items.flatMap((item) => (item.kind === "str" ? [item.value.toLowerCase()] : []));
  return value.kind === "list" && names.length === items.length ? names : "unknown";
}

/**
 * Reads an `on_event(...)` decorator or `add_event_handler(...)` call.
 *
 * @param call - the `call` node.
 * @param on - what the call is.
 * @param on.via - `on_event` or `add_event_handler`.
 * @param on.receiver - the qualified app or router it is called on.
 * @param qualify - qualifies a name through the file's imports.
 * @returns the registration, with its event argument as the model reads it.
 */
function eventOf(
  call: Node,
  { via, receiver }: { via: EventHandlerUse["via"]; receiver: string },
  qualify: Qualify,
): EventHandlerUse {
  const event = argumentAt(call, 0, "event_type");
  return {
    ...callSyntax(call, qualify),
    receiver,
    via,
    event: event ? valueFrom(event, qualify) : null,
  };
}

/**
 * Reads a `Depends(...)` or `Security(...)` call.
 *
 * @param call - a `call` node.
 * @param qualify - qualifies a name through the file's imports.
 * @returns the call, its dependency argument and how that reads; null for any other call.
 */
function dependencyOf(call: Node, qualify: Qualify): DependencyUse | null {
  const fn = call.childForFieldName("function");
  const callee = fn ? qualify(fn) : null;
  if (callee === null || !DEPENDS.has(callee)) {
    return null;
  }
  const argument = argumentAt(call, 0, "dependency");
  return {
    ...callSyntax(call, qualify),
    argument,
    target: argument ? valueFrom(argument, qualify) : null,
  };
}

/**
 * Reads an `include_router(router, prefix=...)` or `mount(path, app)` call.
 *
 * @param call - the `call` node.
 * @param method - `include_router` or `mount`.
 * @param receiver - the qualified app or router it is called on.
 * @param qualify - qualifies a name through the file's imports.
 * @returns the edge.
 */
function wiringOf(call: Node, method: string, receiver: string, qualify: Qualify): Wiring {
  const syntax = callSyntax(call, qualify);
  const include = method === "include_router";
  const target = include ? argumentAt(call, 0, "router") : argumentAt(call, 1, "app");
  const path = include ? syntax.keywords.get("prefix")?.node : argumentAt(call, 0, "path");
  return {
    ...syntax,
    kind: include ? "include" : "mount",
    receiver,
    target: target ? qualify(target) : null,
    path: path ? valueFrom(path, qualify) : null,
    loopTargets: target ? loopItems(target, qualify) : [],
  };
}

/**
 * Reads the items of the list or tuple literal a `for` loop binds a name to,
 * when that loop encloses the name's use: `for r in [a.router, b.router]:`.
 *
 * @param target - the argument node, e.g. the identifier `r`.
 * @param qualify - qualifies a name through the file's imports.
 * @returns each item's qualified name, null for one that isn't a name; empty
 *   when the argument isn't such a loop variable.
 */
function loopItems(target: Node, qualify: Qualify): (string | null)[] {
  if (target.type !== "identifier") {
    return [];
  }
  const name = identifierName(target);
  for (let at = target.parent; at !== null; at = at.parent) {
    const left = at.type === "for_statement" ? at.childForFieldName("left") : null;
    const right = at.childForFieldName("right");
    if (left?.type === "identifier" && identifierName(left) === name) {
      const literal = right?.type === "list" || right?.type === "tuple";
      return literal ? namedChildren(right).map((item) => qualify(item)) : [];
    }
  }
  return [];
}
