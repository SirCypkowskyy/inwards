/**
 * @file What INW012 knows about each web framework it recognises (#270):
 * the text that makes a file worth parsing for it, the constructors of its
 * apps and routers, the methods that declare or register a route, the
 * decorators and view base classes that mark an endpoint, which methods of
 * a view class handle requests, and the errors and calls that map a failure
 * to HTTP. Plain data and name tests on qualified names; it reads no syntax.
 */

/** A framework whose endpoints INW012 recognises. Starlette goes with FastAPI, DRF with Django. */
export type Framework = "fastapi" | "flask" | "litestar" | "django";

/** What marked an endpoint: a framework's own form, or a configured decorator or base class. */
export type Kind = Framework | "custom";

/** The text a file spells when it uses a framework: its package, and FastAPI's usual names. */
const MENTIONS: Readonly<Record<Framework, RegExp>> = {
  fastapi: /fastapi|FastAPI|APIRouter|starlette|add_api_route/u,
  flask: /flask/u,
  litestar: /litestar/u,
  django: /django|rest_framework/u,
};

/** The constructors whose result is an app or router that declares routes, by qualified name. */
export const ROUTERS: Readonly<Record<"fastapi" | "flask", ReadonlySet<string>>> = {
  fastapi: new Set([
    "fastapi.FastAPI",
    "fastapi.applications.FastAPI",
    "fastapi.APIRouter",
    "fastapi.routing.APIRouter",
  ]),
  flask: new Set([
    "flask.Flask",
    "flask.app.Flask",
    "flask.Blueprint",
    "flask.blueprints.Blueprint",
  ]),
};

/** The route decorators of an app or router (FastAPI's path operations; Flask's `route` and its shortcuts). */
export const OPERATIONS: Readonly<Record<"fastapi" | "flask", ReadonlySet<string>>> = {
  fastapi: new Set([
    "get",
    "post",
    "put",
    "patch",
    "delete",
    "head",
    "options",
    "trace",
    "api_route",
  ]),
  flask: new Set(["route", "get", "post", "put", "patch", "delete"]),
};

/** Where a registration's handler sits: its position and its keyword. */
export interface HandlerArgument {
  readonly index: number;
  readonly keyword: string;
}

/** The app or router methods that register a handler, per framework, and where the handler goes. */
export const REGISTER_METHODS: Readonly<
  Record<"fastapi" | "flask", ReadonlyMap<string, HandlerArgument>>
> = {
  fastapi: new Map([["add_api_route", { index: 1, keyword: "endpoint" }]]),
  flask: new Map([["add_url_rule", { index: 2, keyword: "view_func" }]]),
};

/** The calls that register a handler by qualified name: route classes and URLconf entries. */
export const REGISTER_CALLS: ReadonlyMap<
  string,
  HandlerArgument & { readonly framework: Framework }
> = new Map([
  ["starlette.routing.Route", { index: 1, keyword: "endpoint", framework: "fastapi" }],
  ["fastapi.routing.APIRoute", { index: 1, keyword: "endpoint", framework: "fastapi" }],
  ["django.urls.path", { index: 1, keyword: "view", framework: "django" }],
  ["django.urls.re_path", { index: 1, keyword: "view", framework: "django" }],
]);

/** Litestar's HTTP route handler decorators, by the last part of their qualified name. */
const LITESTAR_HANDLERS: ReadonlySet<string> = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "route",
  "HTTPRouteHandler",
]);

/** DRF's decorators that make a function or a ViewSet method an endpoint. */
const DRF_DECORATORS: ReadonlySet<string> = new Set([
  "rest_framework.decorators.api_view",
  "rest_framework.decorators.action",
]);

/** The HTTP verbs a class-based view dispatches to a method of the same name. */
const VERBS: readonly string[] = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
  "trace",
];

/** What a view class's base says about which of its methods handle requests. */
export type ViewKind = "flask" | "django" | "custom";

/** The request-handling methods of a view class, by what kind of view it is. */
export const VIEW_METHODS: Readonly<Record<ViewKind, ReadonlySet<string>>> = {
  flask: new Set([...VERBS, "dispatch_request"]),
  django: new Set([...VERBS, "list", "create", "retrieve", "update", "partial_update", "destroy"]),
  custom: new Set([
    ...VERBS,
    "dispatch_request",
    "list",
    "create",
    "retrieve",
    "update",
    "partial_update",
    "destroy",
  ]),
};

/** The packages whose exceptions map a failure to an HTTP response when raised. */
const HTTP_ERROR_PACKAGES: readonly string[] = [
  "werkzeug.exceptions.",
  "litestar.exceptions.",
  "rest_framework.exceptions.",
];

/** Django's own exceptions that become an HTTP response. */
const DJANGO_HTTP_ERRORS: ReadonlySet<string> = new Set([
  "django.http.Http404",
  "django.http.response.Http404",
  "django.core.exceptions.PermissionDenied",
]);

/** The packages of Django's and DRF's view classes. */
const DJANGO_VIEW_PACKAGES = /^(?:django\.views|rest_framework\.(?:views|generics|viewsets))\./u;

/** The last part of a Django or DRF view class's name. */
const VIEW_CLASS_NAME = /(?:View|ViewSet)$/u;

/** The packages whose classes are a framework's own, never looked up in the project. */
const FRAMEWORK_PACKAGES =
  /^(?:fastapi|starlette|flask|werkzeug|litestar|django|rest_framework)\./u;

/** Flask's call that raises an HTTP error. */
const ABORTS: ReadonlySet<string> = new Set(["flask.abort", "werkzeug.exceptions.abort"]);

/**
 * Lists the frameworks a file may use: the ones its text mentions, out of
 * the configured `frameworks` when that is set.
 *
 * @param text - the file's text.
 * @param allowed - the `frameworks` option, or undefined for every framework.
 * @returns the frameworks whose recognisers run on the file.
 */
export function frameworksIn(
  text: string,
  allowed: readonly Framework[] | undefined,
): ReadonlySet<Framework> {
  const all: readonly Framework[] = allowed ?? ["fastapi", "flask", "litestar", "django"];
  return new Set(all.filter((framework) => MENTIONS[framework].test(text)));
}

/**
 * Tells which framework's decorator a qualified name is, for the forms
 * that need no app or router: Litestar's handlers and DRF's decorators.
 *
 * @param qualified - the decorator's qualified name, e.g. `litestar.get`.
 * @param active - the frameworks recognised in the file.
 * @returns the framework, or undefined for any other name.
 */
export function standaloneDecorator(
  qualified: string,
  active: ReadonlySet<Framework>,
): Framework | undefined {
  const last = qualified.split(".").at(-1) ?? "";
  if (active.has("litestar") && qualified.startsWith("litestar.") && LITESTAR_HANDLERS.has(last)) {
    return "litestar";
  }
  return active.has("django") && DRF_DECORATORS.has(qualified) ? "django" : undefined;
}

/**
 * Tells what kind of view a framework base class makes: Flask's `View` and
 * `MethodView`, and every view class of Django and DRF.
 *
 * @param qualified - the base's qualified name, e.g. `rest_framework.viewsets.ModelViewSet`.
 * @param active - the frameworks recognised in the file.
 * @returns the kind, or undefined when it is no framework view.
 */
export function frameworkBase(
  qualified: string,
  active: ReadonlySet<Framework>,
): ViewKind | undefined {
  const last = qualified.split(".").at(-1) ?? "";
  if (
    active.has("flask") &&
    (qualified === "flask.views.View" || qualified === "flask.views.MethodView")
  ) {
    return "flask";
  }
  const django = DJANGO_VIEW_PACKAGES.test(qualified) && VIEW_CLASS_NAME.test(last);
  return active.has("django") && django ? "django" : undefined;
}

/**
 * Tells whether a qualified name may be a framework's own class, which is
 * never looked up in the project: it lives in a framework package.
 *
 * @param qualified - a base class's qualified name.
 * @returns true for names under `fastapi`, `starlette`, `flask`, `litestar`, `django` or `rest_framework`.
 */
export function inFrameworkPackage(qualified: string): boolean {
  return FRAMEWORK_PACKAGES.test(qualified);
}

/**
 * Tells whether an exception maps a failure to HTTP when raised: any
 * `HTTPException`, Werkzeug's, Litestar's and DRF's exceptions, and
 * Django's `Http404` and `PermissionDenied`.
 *
 * @param qualified - the raised exception's qualified name.
 * @returns true for an HTTP error.
 */
export function isHttpError(qualified: string): boolean {
  return (
    qualified.split(".").at(-1) === "HTTPException" ||
    DJANGO_HTTP_ERRORS.has(qualified) ||
    HTTP_ERROR_PACKAGES.some((prefix) => qualified.startsWith(prefix))
  );
}

/**
 * Tells whether a call raises an HTTP error itself: Flask's `abort`.
 *
 * @param qualified - the callee's qualified name.
 * @returns true for `flask.abort`.
 */
export function isAbort(qualified: string): boolean {
  return ABORTS.has(qualified);
}
