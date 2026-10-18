/**
 * @file What a router's route class does that the FAPI rules can read
 * (#392). FastAPI builds every route of a router with its `route_class`
 * (`APIRouter.add_api_route`), keeps that class when `include_router`
 * copies the route, and Starlette's router picks the first route whose
 * `matches` answers in full. So a first-party `APIRoute` subclass that
 * overrides `matches` (Polar's `VersionedAPIRoute`) may pick routes by more
 * than method and path, and one whose `__init__` sets
 * `self.include_in_schema` from the route's tags (Polar's
 * `IncludedInSchemaAPIRoute`) decides which routes the schema shows.
 *
 * It reads the route class from `route_class=`, or from a first-party
 * router class that sets it (`kwargs["route_class"] = route_class` in a
 * class factory, as Polar's `get_api_router_class`). The include_in_schema
 * rule is read only as an `if`/`elif`/`else` chain over `<tag> in
 * self.tags`, with literal `True` or `False`; any other value, condition or
 * statement makes the answer unknown, and unknown means silent. It reports
 * nothing and reads no file itself: the project lookups it is given do.
 */
import type { Node } from "web-tree-sitter";
import { identifierName, namedChildren } from "../../../python/nodes.ts";
import type { Qualify } from "../../../python/qualify.ts";
import { argumentFor, parameterNamed } from "./_callers.ts";
import type { FastApiFile, FastApiObject, PathOperation } from "./_records.ts";
import { RouteTags, type TagLookups } from "./_route-tags.ts";
import {
  type ClassSyntax,
  join,
  type SchemaRule,
  schemaRule,
  stringText,
  type Visibility,
} from "./_schema-rule.ts";
import { evaluate } from "./_tag-rule.ts";

/** FastAPI's own route class, the default of every router. */
const FASTAPI_ROUTE: ReadonlySet<string> = new Set(["fastapi.routing.APIRoute"]);

/** The methods Starlette's router calls to pick and run a route: overriding one changes matching. */
const DISPATCH: ReadonlySet<string> = new Set(["matches", "handle", "__call__"]);

/** What this module needs from the project; `FastApiProject` provides it. */
export interface RouteLookups extends TagLookups {
  /** Finds a first-party class and its bases, the class first. */
  readonly lineage: (
    qualified: string,
  ) => { readonly classes: readonly ClassSyntax[]; readonly external: ReadonlySet<string> } | null;
  /** The FastAPI model, which qualifies names in the files it read. */
  readonly model: { readonly qualifierOf: (file: FastApiFile) => Qualify | null };
}

/** What a router's route class does. */
export interface RouteClassInfo {
  /** False when its routes may be matched by more than method and path, or the class is unknown. */
  readonly ordered: boolean;
  readonly schema: SchemaRule;
}

const UNKNOWN_CLASS: RouteClassInfo = { ordered: false, schema: { kind: "unknown" } };
const DEFAULT_CLASS: RouteClassInfo = { ordered: true, schema: { kind: "default" } };
const FACTORY_CLASS: RouteClassInfo = { ordered: false, schema: { kind: "default" } };

/**
 * Reads route classes for one check, once per router.
 */
export class RouteClasses {
  private readonly lookups: RouteLookups;
  private readonly tags: RouteTags;
  private readonly infos = new Map<string, RouteClassInfo>();

  /**
   * Wraps the project lookups. Nothing is read yet.
   *
   * @param lookups - resolves names, classes and inclusions.
   */
  constructor(lookups: RouteLookups) {
    this.lookups = lookups;
    this.tags = new RouteTags(lookups);
  }

  /**
   * Tells what a router's route class does.
   *
   * @param object - the app or router routes are declared on.
   * @returns whether its route order counts and how it decides the schema.
   */
  info(object: FastApiObject): RouteClassInfo {
    let found = this.infos.get(object.name);
    if (found === undefined) {
      const name = this.routeClassOf(object);
      found = name === null ? UNKNOWN_CLASS : this.classInfo(name);
      // A factory's router counts as shown, as `hiddenBy` has it (#358), but its order is unknown.
      found = object.factory && name === null ? FACTORY_CLASS : found;
      this.infos.set(object.name, found);
    }
    return found;
  }

  /**
   * Tells whether a path operation is in the schema as its route class
   * decides, with its own tags, its router's and each inclusion's above.
   * FastAPI builds the route again with the joined tags at each
   * `include_router`, so every inclusion path is read: shown when one shows
   * it, unknown when one can't be read.
   *
   * @param op - the path operation.
   * @param object - the app or router it is declared on.
   * @returns shown, hidden, or unknown.
   */
  visibility(op: PathOperation, object: FastApiObject): Visibility {
    const { schema } = this.info(object);
    if (schema.kind !== "tags") {
      return schema.kind === "default" ? "shown" : "unknown";
    }
    const own = this.tags.tagsOf(op.splat ? null : op.keywords.get("tags")?.value);
    const answers = this.tags
      .tagPaths(object, new Set())
      .map((path) =>
        evaluate(schema, join(own, path), (node) => this.tags.tagValue(node, schema.qualify)),
      );
    if (answers.includes("unknown")) {
      return "unknown";
    }
    return answers.includes("shown") ? "shown" : "hidden";
  }

  /**
   * Reads the route class an app or router builds its routes with.
   *
   * @param object - the app or router.
   * @returns its qualified name, or null when it can't be read.
   */
  private routeClassOf(object: FastApiObject): string | null {
    const keyword = object.factory ? undefined : object.keywords.get("route_class")?.value;
    if (object.factory || keyword !== undefined) {
      return keyword?.kind === "name" ? keyword.name : null;
    }
    if (object.splat) {
      return null;
    }
    return object.custom ? this.customRouteClass(object) : "fastapi.routing.APIRoute";
  }

  /**
   * Reads the route class a first-party router class or class factory builds a router with.
   *
   * @param object - a router a first-party class builds.
   * @returns the route class's qualified name, or null when it can't be read.
   */
  private customRouteClass(object: FastApiObject): string | null {
    const found = this.lookups.resolve(object.name);
    const qualify = found?.kind === "object" ? this.lookups.model.qualifierOf(found.file) : null;
    const fn = object.node.childForFieldName("function");
    if (qualify === null || fn === null) {
      return null;
    }
    // `get_api_router_class(TransactionalAPIRoute)()` calls the class a factory returns.
    if (fn.type === "call") {
      const inner = fn.childForFieldName("function");
      const factory = inner ? qualify(inner) : null;
      return factory === null ? null : this.fromFactory(factory, fn, qualify);
    }
    const callee = qualify(fn);
    return callee === null ? null : this.fromRouterClass(callee);
  }

  /**
   * Reads the route class a first-party router class sets: a module-level
   * `NAME = factory(...)` (a class built at run time) or a subclass.
   *
   * @param callee - the router class's qualified name.
   * @returns the route class's qualified name, FastAPI's when nothing sets it, or null.
   */
  private fromRouterClass(callee: string): string | null {
    const found = this.lookups.resolve(callee);
    if (found?.kind === "constant" && found.node.type === "call") {
      const inner = found.node.childForFieldName("function");
      const factory = inner ? found.qualify(inner) : null;
      return factory === null ? null : this.fromFactory(factory, found.node, found.qualify);
    }
    const classes = found?.kind === "class" ? this.lookups.lineage(callee)?.classes : undefined;
    if (classes === undefined) {
      return null;
    }
    const set = classes.flatMap((c) => routeClassSettings(c.node).map((value) => ({ value, c })));
    const [only] = set;
    if (only === undefined) {
      return "fastapi.routing.APIRoute";
    }
    const name = set.length === 1 ? only.c.qualify(only.value) : null;
    return name === null || name.length === 0 ? null : name;
  }

  /**
   * Reads the route class a router class factory sets, following a
   * parameter to the argument the call passes for it.
   *
   * @param factory - the factory's qualified name.
   * @param call - the call to the factory.
   * @param qualify - qualifies names in the call's file.
   * @returns the route class's qualified name, FastAPI's when nothing sets it, or null.
   */
  private fromFactory(factory: string, call: Node, qualify: Qualify): string | null {
    const found = this.lookups.resolve(factory);
    if (found?.kind !== "function") {
      return null;
    }
    const settings = routeClassSettings(found.node);
    const [value] = settings;
    if (value === undefined) {
      return "fastapi.routing.APIRoute";
    }
    const name = value.type === "identifier" ? identifierName(value) : null;
    const parameter = name === null ? null : parameterNamed(found.node, name);
    if (settings.length !== 1) {
      return null;
    }
    if (parameter === null || name === null) {
      return found.qualify(value);
    }
    const passed = argumentFor(call, found.node, parameter, name);
    return passed === null ? null : qualify(passed);
  }

  /**
   * Reads what a route class does from its first-party classes.
   *
   * @param name - the route class's qualified name.
   * @returns the info; unknown for a third-party class other than FastAPI's.
   */
  private classInfo(name: string): RouteClassInfo {
    if (FASTAPI_ROUTE.has(name)) {
      return DEFAULT_CLASS;
    }
    const lineage = this.lookups.lineage(name);
    if (lineage === null || [...lineage.external].some((base) => !FASTAPI_ROUTE.has(base))) {
      return UNKNOWN_CLASS;
    }
    const ordered = !lineage.classes.some((c) => methodsOf(c.node).some((m) => DISPATCH.has(m)));
    return { ordered, schema: schemaRule(lineage.classes) };
  }
}

/**
 * Lists what a router class or factory sets `route_class` to:
 * `kwargs["route_class"] = X` or `route_class=X` passed on.
 *
 * @param node - the class or function definition.
 * @returns the value nodes, in source order.
 */
function routeClassSettings(node: Node): Node[] {
  const assigned = node.descendantsOfType("assignment").flatMap((assignment) => {
    const left = assignment?.childForFieldName("left");
    const key = left?.type === "subscript" ? left.childForFieldName("subscript") : null;
    const right = assignment?.childForFieldName("right");
    return key && right && stringText(key) === "route_class" ? [right] : [];
  });
  const passed = node.descendantsOfType("keyword_argument").flatMap((argument) => {
    const name = argument?.childForFieldName("name");
    const value = argument?.childForFieldName("value");
    return name && value && identifierName(name) === "route_class" ? [value] : [];
  });
  return [...assigned, ...passed].sort((a, b) => a.startIndex - b.startIndex);
}

/**
 * Lists the names of the methods a class body defines.
 *
 * @param cls - a `class_definition`.
 * @returns the method names.
 */
function methodsOf(cls: Node): string[] {
  const body = cls.childForFieldName("body");
  return (body ? namedChildren(body) : []).flatMap((statement) => {
    const fn =
      statement.type === "decorated_definition"
        ? statement.childForFieldName("definition")
        : statement;
    const name = fn?.type === "function_definition" ? fn.childForFieldName("name") : null;
    return name ? [identifierName(name)] : [];
  });
}
