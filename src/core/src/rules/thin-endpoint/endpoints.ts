/**
 * @file Finds the HTTP endpoints in one file's syntax tree, for INW012: the
 * functions a route decorator marks (FastAPI's `@router.get(...)`, Flask's
 * `@bp.route(...)`, Litestar's `@get(...)`, DRF's `@api_view` and
 * `@action`), the ones a configured decorator marks, the request methods of
 * class-based views (`classes.ts`), plain Django function views in a module
 * `modules` names, and the functions a route registration names
 * (`add_api_route`, `add_url_rule`, Starlette's `Route`, FastAPI's
 * `APIRoute`, Django's `path` and `re_path`). It reads one tree: a receiver
 * counts when the file binds it to an app or router or imports it, a
 * registered handler from another module is handed back by its qualified
 * name for `remote.ts`, and a view base from another module goes to the
 * caller's resolver. Websocket routes are left out, since a receive loop is
 * their job.
 */
import type { Node } from "web-tree-sitter";
import { argumentAt } from "../../python/literals.ts";
import { identifierName, namedChildren } from "../../python/nodes.ts";
import type { Qualify } from "../../python/qualify.ts";
import { type ResolveBase, viewMethods } from "./classes.ts";
import {
  type Framework,
  frameworksIn,
  type Kind,
  OPERATIONS,
  REGISTER_CALLS,
  REGISTER_METHODS,
  ROUTERS,
  standaloneDecorator,
} from "./frameworks.ts";
import { type NameMatch, nameMatcher, type Recognise } from "./settings.ts";

/** The frameworks whose apps and routers declare and register routes through methods. */
const ROUTER_FRAMEWORKS: readonly ("fastapi" | "flask")[] = ["fastapi", "flask"];

/** A wildcard, which makes a pattern's last segment useless to the pre-filter. */
const WILDCARD = /[*?]/u;

/** An endpoint function, and how it was recognised. */
export interface Endpoint {
  /** The `function_definition` node. */
  readonly fn: Node;
  /** The function's name; `Class.method` for a view method. */
  readonly name: string;
  /** The framework that marked it, or `custom` for a configured decorator or base class. */
  readonly kind: Kind;
}

/** A route registered in this file whose handler lives in another module. */
export interface Registration {
  /** The handler argument, where the finding goes. */
  readonly handler: Node;
  /** The handler's qualified name, e.g. `shop.api.views.create_order`. */
  readonly target: string;
  /** What registers it, e.g. `add_api_route`, `add_url_rule` or `path`. */
  readonly how: string;
  /** The framework the registration belongs to. */
  readonly kind: Kind;
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
  /** The file's text, for the framework pre-filters. */
  readonly text: string;
  /** The configured decorators, base classes and frameworks. */
  readonly recognise: Recognise;
  /** The module's top-level functions by name, which a registration may name. */
  readonly functions: ReadonlyMap<string, Node>;
  /** Resolves a view base class from another first-party module; undefined reads none. */
  readonly resolveBase: ResolveBase | undefined;
}

/** The file's own apps and routers, by framework. */
type Routers = ReadonlyMap<"fastapi" | "flask", ReadonlySet<string>>;

/**
 * Tells whether a file may hold an endpoint, before any parse: it mentions a
 * recognised framework, or the last literal segment of a configured
 * decorator or base class (a pattern whose last segment has a wildcard
 * can't be filtered, so any file passes).
 *
 * @param text - the file's text.
 * @param recognise - the configured decorators, base classes and frameworks.
 * @returns true when the file needs the full parse.
 */
export function mayHoldEndpoints(text: string, recognise: Recognise): boolean {
  if (frameworksIn(text, recognise.frameworks).size > 0) {
    return true;
  }
  return [...recognise.decorators, ...recognise.baseClasses].some((pattern) => {
    const last = pattern.split(".").at(-1) ?? pattern;
    return WILDCARD.test(last) || text.includes(last);
  });
}

/**
 * Lists the qualified names the file binds to an app or router of each
 * active framework, in any scope, as the FastAPI model does (an app
 * factory's app counts).
 *
 * @param root - the module node.
 * @param context - the file's module and qualifier.
 * @param active - the frameworks recognised in the file.
 * @returns the qualified names by active framework, e.g. `app.api.orders.router`.
 */
function routerNames(
  root: Node,
  context: EndpointContext,
  active: ReadonlySet<Framework>,
): Routers {
  const names = new Map(
    ROUTER_FRAMEWORKS.filter((f) => active.has(f)).map((f) => [f, new Set<string>()]),
  );
  for (const assignment of root.descendantsOfType("assignment")) {
    const left = assignment.childForFieldName("left");
    const right = assignment.childForFieldName("right");
    const callee = right?.type === "call" ? right.childForFieldName("function") : null;
    const made = callee ? context.qualify(callee) : null;
    const framework = [...names.keys()].find((f) => made !== null && ROUTERS[f].has(made));
    if (left?.type === "identifier" && framework) {
      names.get(framework)?.add(`${context.module}.${identifierName(left)}`);
    }
  }
  return names;
}

/**
 * Finds which framework's app or router a callee calls one of some methods
 * on: an app or router the file binds, or a name it imports.
 *
 * @param callee - a call's `function` node.
 * @param routers - the file's own apps and routers.
 * @param context - the file's module and qualifier.
 * @param methods - the method names that count, by framework.
 * @returns the framework and the method, or undefined.
 */
function routerMethod(
  callee: Node | null,
  routers: Routers,
  context: EndpointContext,
  methods: (framework: "fastapi" | "flask") => boolean,
): { framework: "fastapi" | "flask"; method: string } | undefined {
  const object = callee?.type === "attribute" ? callee.childForFieldName("object") : null;
  const attribute = callee?.childForFieldName("attribute");
  const receiver = object ? context.qualify(object) : null;
  if (!(attribute && receiver !== null)) {
    return undefined;
  }
  const method = identifierName(attribute);
  const imported = !receiver.startsWith(`${context.module}.`);
  const framework = [...routers.keys()].find(
    (f) => methods(f) && (routers.get(f)?.has(receiver) || imported),
  );
  return framework === undefined ? undefined : { framework, method };
}

/**
 * Tells which framework, if any, one decorator marks an endpoint for: a
 * route decorator on an app or router, a standalone handler decorator, or a
 * configured decorator.
 *
 * @param expression - what follows the `@`, e.g. `router.get("/x")`.
 * @param routers - the file's own apps and routers.
 * @param custom - matches the configured `decorators` patterns.
 * @param context - the file's module, qualifier and frameworks.
 * @returns what marked it, or undefined for any other decorator.
 */
function decoratorKind(
  expression: Node,
  routers: Routers,
  custom: NameMatch,
  context: EndpointContext & { readonly active: ReadonlySet<Framework> },
): Kind | undefined {
  const callee = expression.type === "call" ? expression.childForFieldName("function") : expression;
  const operation = routerMethod(callee, routers, context, (f) => {
    const attribute = callee?.childForFieldName("attribute");
    return expression.type === "call" && attribute
      ? OPERATIONS[f].has(identifierName(attribute))
      : false;
  });
  if (operation) {
    return operation.framework;
  }
  const name = callee ? context.qualify(callee) : null;
  if (name === null) {
    return undefined;
  }
  return standaloneDecorator(name, context.active) ?? (custom(name) ? "custom" : undefined);
}

/**
 * Reads one route registration: `add_api_route` or `add_url_rule` on an app
 * or router, or a route class or URLconf call, with its handler where that
 * call takes it.
 *
 * @param call - a `call` node.
 * @param routers - the file's own apps and routers.
 * @param context - the file's module, qualifier and frameworks.
 * @returns the handler node, its qualified name, what registers it and its framework; null for any other call.
 */
function registrationOf(
  call: Node,
  routers: Routers,
  context: EndpointContext & { readonly active: ReadonlySet<Framework> },
): (Omit<Registration, "kind"> & { kind: Framework }) | null {
  const callee = call.childForFieldName("function");
  const name = callee ? context.qualify(callee) : null;
  const byName = name === null ? undefined : REGISTER_CALLS.get(name);
  const byMethod = routerMethod(callee, routers, context, (f) => {
    const attribute = callee?.childForFieldName("attribute");
    return attribute ? REGISTER_METHODS[f].has(identifierName(attribute)) : false;
  });
  const how =
    byName && name !== null && context.active.has(byName.framework)
      ? { ...byName, how: name.split(".").at(-1) ?? name }
      : byMethod && {
          ...(REGISTER_METHODS[byMethod.framework].get(byMethod.method) ?? {
            index: 1,
            keyword: "",
          }),
          framework: byMethod.framework,
          how: byMethod.method,
        };
  const handler = how ? argumentAt(call, how.index, how.keyword) : null;
  const target = handler ? context.qualify(handler) : null;
  return how && handler && target !== null
    ? { handler, target, how: how.how, kind: how.framework }
    : null;
}

/**
 * Finds the functions a decorator marks as endpoints, at any depth.
 *
 * @param root - the module node.
 * @param routers - the file's own apps and routers.
 * @param context - the file's module, qualifier, frameworks and decorator patterns.
 * @returns the endpoints, in source order.
 */
function decorated(
  root: Node,
  routers: Routers,
  context: EndpointContext & { readonly active: ReadonlySet<Framework> },
): Endpoint[] {
  const custom = nameMatcher(context.recognise.decorators);
  const found: Endpoint[] = [];
  for (const definition of root.descendantsOfType("decorated_definition")) {
    const fn = definition.childForFieldName("definition");
    const name = fn?.type === "function_definition" ? fn.childForFieldName("name") : null;
    const kind = namedChildren(definition)
      .filter((child) => child.type === "decorator")
      .flatMap((decorator) => namedChildren(decorator).slice(0, 1))
      .map((expression) => decoratorKind(expression, routers, custom, context))
      .find((k) => k !== undefined);
    if (fn && name && kind) {
      const cls = fn.parent?.parent?.parent;
      const owner = cls?.type === "class_definition" ? cls.childForFieldName("name") : null;
      const own = identifierName(name);
      found.push({ fn, name: owner ? `${identifierName(owner)}.${own}` : own, kind });
    }
  }
  return found;
}

/**
 * Finds plain Django function views: module-level functions whose first
 * parameter is `request`. Only asked for in a module `modules` names, since
 * "a function that takes a request" is too broad anywhere else.
 *
 * @param functions - the module's top-level functions by name.
 * @returns the functions that take `request` first, as Django endpoints.
 */
function functionViews(functions: ReadonlyMap<string, Node>): Endpoint[] {
  return [...functions].flatMap(([name, fn]) => {
    const [first] = namedChildren(fn.childForFieldName("parameters") ?? fn);
    const param = first?.type === "identifier" ? first : first?.namedChildren[0];
    return param?.type === "identifier" && identifierName(param) === "request"
      ? [{ fn, name, kind: "django" as const }]
      : [];
  });
}

/**
 * Lists one file's own endpoints, each once in source order: decorated
 * functions and methods, view class methods, and plain Django function
 * views in a module `modules` names.
 *
 * @param root - the module node.
 * @param routers - the file's own apps and routers.
 * @param context - the file's module, qualifier, frameworks, options, functions and base resolver.
 * @returns the endpoints, without the ones a registration names.
 */
function ownEndpoints(
  root: Node,
  routers: Routers,
  context: EndpointContext & { readonly active: ReadonlySet<Framework> },
): Endpoint[] {
  const { active, recognise } = context;
  const classViews =
    active.has("flask") || active.has("django") || recognise.baseClasses.length > 0;
  const views = classViews
    ? viewMethods(root, {
        module: context.module,
        qualify: context.qualify,
        active,
        custom: nameMatcher(recognise.baseClasses),
        resolveBase: context.resolveBase,
      })
    : [];
  const plain = active.has("django") && recognise.scoped ? functionViews(context.functions) : [];
  return unique([...decorated(root, routers, context), ...views, ...plain]);
}

/**
 * Keeps the first endpoint for each function, so a function two forms mark counts once.
 *
 * @param endpoints - the endpoints found, in the order their forms were tried.
 * @returns each function once, the first form winning.
 */
function unique(endpoints: readonly Endpoint[]): Endpoint[] {
  const seen = new Set<number>();
  return endpoints.filter(
    ({ fn }) => !seen.has(fn.startIndex) && seen.add(fn.startIndex) !== undefined,
  );
}

/**
 * Finds the file's endpoints: its own (see `ownEndpoints`) and the
 * module-level functions a route registration in the file names. A
 * registration whose handler is another module's comes back on its own.
 *
 * @param root - the module node.
 * @param context - the file's module, qualifier, text, options, functions and base resolver.
 * @returns the endpoints, each once in source order, and the registrations of other modules' handlers.
 */
export function findEndpoints(root: Node, context: EndpointContext): Found {
  const active = frameworksIn(context.text, context.recognise.frameworks);
  const full = { ...context, active };
  const routers = routerNames(root, context, active);
  const registered: Endpoint[] = [];
  const registrations: Registration[] = [];
  const prefix = `${context.module}.`;
  const registers = active.has("fastapi") || active.has("flask") || active.has("django");
  for (const call of registers ? root.descendantsOfType("call") : []) {
    const registration = registrationOf(call, routers, full);
    const target = registration?.target ?? "";
    const local = target.startsWith(prefix);
    const fn = local ? context.functions.get(target.slice(prefix.length)) : undefined;
    if (registration && !local) {
      registrations.push(registration);
    } else if (fn && registration) {
      registered.push({ fn, name: target.slice(prefix.length), kind: registration.kind });
    }
  }
  const endpoints = unique([...ownEndpoints(root, routers, full), ...registered]);
  return { endpoints: endpoints.sort((a, b) => a.fn.startIndex - b.fn.startIndex), registrations };
}
