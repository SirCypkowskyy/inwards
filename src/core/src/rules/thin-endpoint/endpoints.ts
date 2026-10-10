/**
 * @file Finds the HTTP endpoints in one file's syntax tree, for INW012: the
 * functions a FastAPI path operation decorator marks (`@router.get(...)`,
 * `@app.api_route(...)`), the ones a configured decorator marks, and the
 * ones a route registration names (`router.add_api_route(path, handler)`,
 * Starlette's `Route(path, handler)`, FastAPI's `APIRoute(path, handler)`).
 * It reads one tree and resolves nothing across files: a receiver counts
 * when the file binds it to `FastAPI(...)` or `APIRouter(...)`, or imports
 * it, as the FastAPI model's path operations do, and a registered handler
 * from another module is handed back by its qualified name for `remote.ts`.
 * Websocket routes are left out, since a receive loop is their job.
 */
import type { Node } from "web-tree-sitter";
import { argumentAt } from "../../python/literals.ts";
import { identifierName, namedChildren } from "../../python/nodes.ts";
import type { Qualify } from "../../python/qualify.ts";
import { type NameMatch, nameMatcher } from "./settings.ts";

/** The constructors whose result is an app or router, by qualified name. */
const CONSTRUCTORS: ReadonlySet<string> = new Set([
  "fastapi.FastAPI",
  "fastapi.applications.FastAPI",
  "fastapi.APIRouter",
  "fastapi.routing.APIRouter",
]);

/** The path operation decorators of an app or router. */
const OPERATIONS: ReadonlySet<string> = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
  "trace",
  "api_route",
]);

/** The route classes whose second argument is the handler, by qualified name. */
const ROUTE_CLASSES: ReadonlySet<string> = new Set([
  "starlette.routing.Route",
  "fastapi.routing.APIRoute",
]);

/** The router method that registers a handler as its second argument. */
const ADD_API_ROUTE = "add_api_route";

/** `ADD_API_ROUTE` as the method set `routerMethod` takes. */
const REGISTERS: ReadonlySet<string> = new Set([ADD_API_ROUTE]);

/**
 * The text pre-filter for FastAPI and Starlette: a file that spells none of
 * these declares no path operation and registers no route.
 */
const FASTAPI = /fastapi|FastAPI|APIRouter|starlette|add_api_route/u;

/** A wildcard, which makes a decorator's last segment useless to the pre-filter. */
const WILDCARD = /[*?]/u;

/** An endpoint function, and how it was recognised. */
export interface Endpoint {
  /** The `function_definition` node. */
  readonly fn: Node;
  /** The function's name. */
  readonly name: string;
}

/** A route registered in this file whose handler lives in another module. */
export interface Registration {
  /** The handler argument, where the finding goes. */
  readonly handler: Node;
  /** The handler's qualified name, e.g. `shop.api.views.create_order`. */
  readonly target: string;
  /** What registers it: `add_api_route`, `Route` or `APIRoute`. */
  readonly how: string;
}

/** The endpoints one file defines, and the routes it registers to other modules' functions. */
export interface Found {
  /** The file's own endpoint functions, each once, in source order. */
  readonly endpoints: Endpoint[];
  /** Registrations whose handler another module defines. */
  readonly registrations: Registration[];
}

/** What finding endpoints in one file needs besides its tree. */
export interface EndpointContext {
  /** The file's dotted module name. */
  readonly module: string;
  /** Qualifies a name through the file's imports. */
  readonly qualify: Qualify;
  /** The file's text, for the FastAPI pre-filter. */
  readonly text: string;
  /** The configured `decorators` patterns. */
  readonly decorators: readonly string[];
  /** The module's top-level functions by name, which a registration may name. */
  readonly functions: ReadonlyMap<string, Node>;
}

/**
 * Tells whether a file may hold an endpoint, before any parse: it mentions
 * FastAPI, or the last literal segment of a configured decorator (a pattern
 * whose last segment has a wildcard can't be filtered, so any file passes).
 *
 * @param text - the file's text.
 * @param decorators - the configured `decorators` patterns.
 * @returns true when the file needs the full parse.
 */
export function mayHoldEndpoints(text: string, decorators: readonly string[]): boolean {
  if (FASTAPI.test(text)) {
    return true;
  }
  return decorators.some((pattern) => {
    const last = pattern.split(".").at(-1) ?? pattern;
    return WILDCARD.test(last) || text.includes(last);
  });
}

/**
 * Lists the qualified names the file binds to `FastAPI(...)` or `APIRouter(...)`,
 * in any scope, as the FastAPI model does (an app factory's app counts).
 *
 * @param root - the module node.
 * @param context - the file's module and qualifier.
 * @returns the qualified names, e.g. `app.api.orders.router`.
 */
function routerNames(root: Node, context: EndpointContext): Set<string> {
  const names = new Set<string>();
  for (const assignment of root.descendantsOfType("assignment")) {
    const left = assignment.childForFieldName("left");
    const right = assignment.childForFieldName("right");
    const callee = right?.type === "call" ? right.childForFieldName("function") : null;
    if (left?.type === "identifier" && callee && CONSTRUCTORS.has(context.qualify(callee) ?? "")) {
      names.add(`${context.module}.${identifierName(left)}`);
    }
  }
  return names;
}

/**
 * Tells whether one decorator marks a FastAPI path operation: a call of an
 * operation method on an app or router the file binds, or on a name it imports.
 *
 * @param expression - the decorator's expression.
 * @param routers - the file's own apps and routers.
 * @param context - the file's module and qualifier.
 * @returns true for `@router.get(...)` and the like.
 */
function isOperation(
  expression: Node,
  routers: ReadonlySet<string>,
  context: EndpointContext,
): boolean {
  const callee = expression.type === "call" ? expression.childForFieldName("function") : null;
  return routerMethod(callee, routers, context, OPERATIONS);
}

/**
 * Tells whether a callee is one of some methods on an app or router: one the
 * file binds, or a name it imports.
 *
 * @param callee - a call's `function` node.
 * @param routers - the file's own apps and routers.
 * @param context - the file's module and qualifier.
 * @param methods - the method names that count.
 * @returns true for `router.get` when `methods` holds `get`.
 */
function routerMethod(
  callee: Node | null,
  routers: ReadonlySet<string>,
  context: EndpointContext,
  methods: ReadonlySet<string>,
): boolean {
  const object = callee?.type === "attribute" ? callee.childForFieldName("object") : null;
  const attribute = callee?.childForFieldName("attribute");
  const receiver = object ? context.qualify(object) : null;
  if (!(attribute && receiver !== null && methods.has(identifierName(attribute)))) {
    return false;
  }
  return routers.has(receiver) || !receiver.startsWith(`${context.module}.`);
}

/**
 * Tells whether one decorator matches a configured `decorators` pattern, by
 * the qualified name of what it calls or names.
 *
 * @param expression - the decorator's expression.
 * @param custom - the patterns' matcher.
 * @param qualify - qualifies a name through the file's imports.
 * @returns true when the qualified decorator matches.
 */
function isCustom(expression: Node, custom: NameMatch, qualify: Qualify): boolean {
  const callee = expression.type === "call" ? expression.childForFieldName("function") : expression;
  const name = callee ? qualify(callee) : null;
  return name !== null && custom(name);
}

/**
 * Reads one route registration: `add_api_route` on an app or router, or a
 * `Route` or `APIRoute` constructor, with its handler as the second argument
 * or the `endpoint` keyword.
 *
 * @param call - a `call` node.
 * @param routers - the file's own apps and routers.
 * @param context - the file's module and qualifier.
 * @returns the handler node, its qualified name and what registers it; null for any other call.
 */
function registrationOf(
  call: Node,
  routers: ReadonlySet<string>,
  context: EndpointContext,
): { handler: Node; target: string; how: string } | null {
  const callee = call.childForFieldName("function");
  const name = callee ? context.qualify(callee) : null;
  const how =
    name !== null && ROUTE_CLASSES.has(name)
      ? (name.split(".").at(-1) ?? name)
      : routerMethod(callee, routers, context, REGISTERS) && ADD_API_ROUTE;
  const handler = how ? argumentAt(call, 1, "endpoint") : null;
  const target = handler ? context.qualify(handler) : null;
  return how && handler && target !== null ? { handler, target, how } : null;
}

/**
 * Finds the functions a decorator marks as endpoints: a FastAPI path
 * operation (when the file mentions FastAPI) or a configured decorator.
 *
 * @param root - the module node.
 * @param routers - the file's own apps and routers.
 * @param fastapi - true when the file passes the FastAPI pre-filter.
 * @param context - the file's module, qualifier and decorator patterns.
 * @returns the endpoints, in source order.
 */
function decorated(
  root: Node,
  routers: ReadonlySet<string>,
  fastapi: boolean,
  context: EndpointContext,
): Endpoint[] {
  const custom = nameMatcher(context.decorators);
  const found: Endpoint[] = [];
  for (const definition of root.descendantsOfType("decorated_definition")) {
    const fn = definition.childForFieldName("definition");
    const name = fn?.type === "function_definition" ? fn.childForFieldName("name") : null;
    const marks = namedChildren(definition)
      .filter((child) => child.type === "decorator")
      .flatMap((decorator) => namedChildren(decorator).slice(0, 1))
      .some(
        (expression) =>
          (fastapi && isOperation(expression, routers, context)) ||
          isCustom(expression, custom, context.qualify),
      );
    if (fn && name && marks) {
      found.push({ fn, name: identifierName(name) });
    }
  }
  return found;
}

/**
 * Finds the file's endpoints: functions, at any depth, with a FastAPI path
 * operation decorator (when the file mentions FastAPI) or a configured one,
 * and the module-level functions a route registration in the file names.
 * A registration whose handler is another module's comes back on its own.
 *
 * @param root - the module node.
 * @param context - the file's module, qualifier, text, decorator patterns and functions.
 * @returns the endpoints, each once in source order, and the registrations of other modules' handlers.
 */
export function findEndpoints(root: Node, context: EndpointContext): Found {
  const fastapi = FASTAPI.test(context.text);
  const routers = fastapi ? routerNames(root, context) : new Set<string>();
  const endpoints = decorated(root, routers, fastapi, context);
  const registrations: Registration[] = [];
  const prefix = `${context.module}.`;
  for (const call of fastapi ? root.descendantsOfType("call") : []) {
    const registration = registrationOf(call, routers, context);
    const target = registration?.target ?? "";
    const fn = target.startsWith(prefix)
      ? context.functions.get(target.slice(prefix.length))
      : undefined;
    if (registration && !target.startsWith(prefix)) {
      registrations.push(registration);
    } else if (fn && !endpoints.some((e) => e.fn.startIndex === fn.startIndex)) {
      endpoints.push({ fn, name: target.slice(prefix.length) });
    }
  }
  return { endpoints: endpoints.sort((a, b) => a.fn.startIndex - b.fn.startIndex), registrations };
}
