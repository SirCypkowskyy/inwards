/**
 * @file Finds the HTTP endpoints in one file's syntax tree, for INW012: the
 * functions a FastAPI path operation decorator marks (`@router.get(...)`,
 * `@app.api_route(...)`) and the ones a configured decorator marks. It reads
 * one tree and resolves nothing across files: a receiver counts when the file
 * binds it to `FastAPI(...)` or `APIRouter(...)`, or imports it, as the
 * FastAPI model's path operations do. Websocket routes are left out, since a
 * receive loop is their job.
 */
import type { Node } from "web-tree-sitter";
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

/** The text pre-filter for FastAPI: a file that spells none of these declares no path operation. */
const FASTAPI = /fastapi|FastAPI|APIRouter/u;

/** A wildcard, which makes a decorator's last segment useless to the pre-filter. */
const WILDCARD = /[*?]/u;

/** An endpoint function, and how it was recognised. */
export interface Endpoint {
  /** The `function_definition` node. */
  readonly fn: Node;
  /** The function's name. */
  readonly name: string;
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
  const object = callee?.type === "attribute" ? callee.childForFieldName("object") : null;
  const attribute = callee?.childForFieldName("attribute");
  const receiver = object ? context.qualify(object) : null;
  if (!(attribute && receiver !== null && OPERATIONS.has(identifierName(attribute)))) {
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
 * Finds the file's endpoints: functions, at any depth, with a FastAPI path
 * operation decorator (when the file mentions FastAPI) or a configured one.
 *
 * @param root - the module node.
 * @param context - the file's module, qualifier, text and decorator patterns.
 * @returns the endpoints, in source order.
 */
export function findEndpoints(root: Node, context: EndpointContext): Endpoint[] {
  const fastapi = FASTAPI.test(context.text);
  const routers = fastapi ? routerNames(root, context) : new Set<string>();
  const custom = nameMatcher(context.decorators);
  const found: Endpoint[] = [];
  for (const decorated of root.descendantsOfType("decorated_definition")) {
    const fn = decorated.childForFieldName("definition");
    const name = fn?.type === "function_definition" ? fn.childForFieldName("name") : null;
    const marks = namedChildren(decorated)
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
