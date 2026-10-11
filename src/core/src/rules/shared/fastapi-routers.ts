/**
 * @file Which names in a file are FastAPI apps or routers, for the FastAPI
 * model and INW012 alike (#358). FastAPI's own `FastAPI(...)` and
 * `APIRouter(...)` count as they always did; besides those, a name that the
 * file uses as a router (`@router.get(...)`, `router.include_router(...)`)
 * counts when the callee it is bound to is a first-party router class
 * (a subclass of FastAPI's; a module-level `NAME = factory(...)` whose
 * first-party class factory returns one, as Polar's `get_api_router_class`
 * does; any module-level `APIRouter = <call>`) or a first-party function that
 * returns one, one hop deep. A name a function returns counts too when the
 * function's return annotation is a router class, which is how
 * fastapi-clean-example declares routes inside `make_*_router()` factories.
 *
 * It reads trees and asks a `FindDefinition` port for other modules'
 * definitions; each rule's adapter reads and parses them. It reports nothing.
 */
import type { Node } from "web-tree-sitter";
import { identifierName, namedChildren } from "../../python/nodes.ts";
import type { Qualify } from "../../python/qualify.ts";
import {
  ownCallBindings,
  returnedCalls,
  returnedClasses,
  returnedClassType,
  returnedNames,
  returnType,
} from "./function-returns.ts";

/** What a name is bound to: an app, which serves requests, or a router, which an app includes. */
export type RouterKind = "app" | "router";

/** FastAPI's own constructors, by qualified name. */
const FASTAPI_CONSTRUCTORS: ReadonlyMap<string, RouterKind> = new Map([
  ["fastapi.FastAPI", "app"],
  ["fastapi.applications.FastAPI", "app"],
  ["fastapi.APIRouter", "router"],
  ["fastapi.routing.APIRouter", "router"],
]);

/** The names a module-level `NAME = <call>` must have to count as a class built at run time. */
const BUILT_NAMES: ReadonlyMap<string, RouterKind> = new Map([
  ["APIRouter", "router"],
  ["FastAPI", "app"],
]);

/**
 * The methods that make a name a router where it is called on: the path
 * operations, the registrations and the wiring. Only such a name is worth a
 * look into another module.
 */
const ROUTER_METHODS: ReadonlySet<string> = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
  "trace",
  "api_route",
  "websocket",
  "add_api_route",
  "add_api_websocket_route",
  "include_router",
  "mount",
  "exception_handler",
  "add_exception_handler",
  "on_event",
  "add_event_handler",
]);

/** How many first-party bases or aliases a class is followed through (a cycle ends here). */
const MAX_DEPTH = 8;

/** A first-party module-level definition, as a rule's adapter found it. */
export interface FoundDefinition {
  /** A function, a class, or a `NAME = value` constant (its `node` is the value). */
  readonly kind: "function" | "class" | "constant";
  readonly node: Node;
  /** The name in its own module. */
  readonly name: string;
  /** Qualifies a name in the definition's own module. */
  readonly qualify: Qualify;
}

/** Finds a first-party module-level definition by qualified name, following re-exports; null when there is none. */
export type FindDefinition = (qualified: string) => FoundDefinition | null;

/** What a callee builds, and whether its keywords are the constructor's own. */
export interface Built {
  readonly kind: RouterKind;
  /** True for a factory function, whose arguments aren't the router's keywords. */
  readonly factory: boolean;
}

/** A name a file binds to an app or a router. */
export interface RouterBinding {
  readonly assignment: Node;
  /** The name as bound, e.g. `router`. */
  readonly local: string;
  /** The call it is bound to. */
  readonly call: Node;
  readonly kind: RouterKind;
  /** True when a factory built it, so the call's keywords aren't the router's. */
  readonly factory: boolean;
  /** True when a first-party class or factory built it, not FastAPI's own constructor. */
  readonly custom: boolean;
}

/**
 * Tells what first-party callees build, through a `FindDefinition` port,
 * once per callee. Build one per check (or per file, for a rule whose
 * adapter reads per file).
 */
export class RouterKinds {
  private readonly find: FindDefinition;
  private readonly known = new Map<string, Built | null>();
  private readonly resolving = new Set<string>();

  /**
   * Wraps the adapter's lookup. Nothing is read yet.
   *
   * @param find - finds a first-party definition by qualified name.
   */
  constructor(find: FindDefinition) {
    this.find = find;
  }

  /**
   * Tells what calling a name builds: FastAPI's constructors, a first-party
   * router class, or a first-party function that returns a router.
   *
   * @param callee - the callee's qualified name.
   * @returns the kind and whether a factory builds it, or null for anything else.
   */
  builtBy(callee: string): Built | null {
    return this.cached(`call:${callee}`, () => this.callee(callee, true, 0));
  }

  /**
   * Tells what calling the class a first-party class factory returns builds:
   * `get_api_router_class(TransactionalAPIRoute)()`.
   *
   * @param factory - the class factory's qualified name.
   * @returns the kind of its class, or null when it isn't a router class factory.
   */
  builtByClassOf(factory: string): Built | null {
    return this.cached(`class-of:${factory}`, () => {
      const found = this.find(factory);
      return found?.kind === "function" ? this.classFactory(found, 0) : null;
    });
  }

  /**
   * Tells whether a name, written as a type, is a router or app class.
   *
   * @param type - the annotation's qualified name.
   * @returns the kind, or null when it isn't one.
   */
  classKind(type: string): RouterKind | null {
    return this.cached(`type:${type}`, () => this.callee(type, false, 0))?.kind ?? null;
  }

  /**
   * Answers a question once, and null for one asked again while it is answered (a cycle).
   *
   * @param key - the question.
   * @param answer - computes the answer.
   * @returns the cached or computed answer.
   */
  private cached(key: string, answer: () => Built | null): Built | null {
    const known = this.known.get(key);
    if (known !== undefined || this.resolving.has(key)) {
      return known ?? null;
    }
    this.resolving.add(key);
    try {
      const found = answer();
      this.known.set(key, found);
      return found;
    } finally {
      this.resolving.delete(key);
    }
  }

  /**
   * Reads what a callee builds.
   *
   * @param callee - its qualified name.
   * @param hop - true when a factory function may be followed (one hop).
   * @param depth - how many bases or aliases were followed so far.
   * @returns what it builds, or null.
   */
  private callee(callee: string, hop: boolean, depth: number): Built | null {
    const own = FASTAPI_CONSTRUCTORS.get(callee);
    if (own !== undefined) {
      return { kind: own, factory: false };
    }
    const found = depth < MAX_DEPTH ? this.find(callee) : null;
    if (found?.kind === "class") {
      return this.inherited(found, depth);
    }
    if (found?.kind === "constant") {
      return this.constant(found, depth);
    }
    return found?.kind === "function" && hop ? this.factory(found) : null;
  }

  /**
   * Reads a first-party class: a router class when a base is, first-party
   * bases followed.
   *
   * @param found - the class.
   * @param depth - how many bases were followed so far.
   * @returns the router kind its bases give, or null.
   */
  private inherited(found: FoundDefinition, depth: number): Built | null {
    const list = found.node.childForFieldName("superclasses");
    for (const base of list ? namedChildren(list) : []) {
      const name = base.type === "keyword_argument" ? null : found.qualify(base);
      const kind = name === null ? null : this.callee(name, false, depth + 1);
      if (kind !== null) {
        return { kind: kind.kind, factory: false };
      }
    }
    return null;
  }

  /**
   * Reads a first-party `NAME = value`: a router class built at run time
   * when the value calls a first-party class factory whose router class can
   * be read (`-> type[APIRouter]`, or a nested router subclass it returns),
   * or when the name is `APIRouter` or `FastAPI` and the value is any call;
   * an alias when the value names a router class.
   *
   * @param found - the module-level assignment, its value as the node.
   * @param depth - how many aliases were followed so far.
   * @returns the router kind, or null.
   */
  private constant(found: FoundDefinition, depth: number): Built | null {
    const { node, qualify } = found;
    if (node.type === "call") {
      const fn = node.childForFieldName("function");
      const callee = fn ? qualify(fn) : null;
      const factory = callee === null || depth >= MAX_DEPTH ? null : this.find(callee);
      const made = factory?.kind === "function" ? this.classFactory(factory, depth) : null;
      const named = BUILT_NAMES.get(found.name);
      return made ?? (named === undefined ? null : { kind: named, factory: false });
    }
    const alias = node.type === "identifier" || node.type === "attribute" ? qualify(node) : null;
    return alias === null ? null : this.callee(alias, false, depth + 1);
  }

  /**
   * Reads what router class a first-party class factory returns, as Polar's
   * `get_api_router_class(route_class)` does: its `-> type[X]` annotation,
   * or a class it defines and returns.
   *
   * @param found - the factory function.
   * @param depth - how many bases or aliases were followed so far.
   * @returns the router kind of the class it returns, or null.
   */
  private classFactory(found: FoundDefinition, depth: number): Built | null {
    const type = returnedClassType(found.node, found.qualify);
    const typed = type === null ? null : this.callee(type, false, depth + 1);
    if (typed !== null) {
      return typed;
    }
    for (const cls of returnedClasses(found.node)) {
      const kind = this.inherited({ ...found, kind: "class", node: cls }, depth + 1);
      if (kind !== null) {
        return kind;
      }
    }
    return null;
  }

  /**
   * Reads a first-party function, one hop: it builds a router when its
   * return annotation is a router class, or when it returns a router class
   * call, directly or through a name bound in its body. Another factory it
   * calls isn't followed.
   *
   * @param found - the function.
   * @returns the router kind, marked as a factory's, or null.
   */
  private factory(found: FoundDefinition): Built | null {
    const annotated = returnType(found.node, found.qualify);
    const typed = annotated === null ? null : this.callee(annotated, false, 0);
    if (typed !== null) {
      return { kind: typed.kind, factory: true };
    }
    for (const call of returnedCalls(found.node)) {
      const fn = call.childForFieldName("function");
      const name = fn ? found.qualify(fn) : null;
      const kind = name === null ? null : this.callee(name, false, 0);
      if (kind !== null) {
        return { kind: kind.kind, factory: true };
      }
    }
    return null;
  }
}

/**
 * Lists the names a file calls a router method on, or passes to
 * `include_router`: the only names worth a look into another module.
 *
 * @param root - the module node.
 * @returns the bare names, e.g. `router`.
 */
function routerUses(root: Node): Set<string> {
  const used = new Set<string>();
  for (const call of root.descendantsOfType("call")) {
    const fn = call?.childForFieldName("function");
    const object = fn?.type === "attribute" ? fn.childForFieldName("object") : null;
    const attribute = fn?.childForFieldName("attribute");
    const method = attribute ? identifierName(attribute) : "";
    if (object?.type === "identifier" && ROUTER_METHODS.has(method)) {
      used.add(identifierName(object));
    }
    const args = method === "include_router" ? call?.childForFieldName("arguments") : null;
    const [first] = args ? namedChildren(args) : [];
    if (first?.type === "identifier") {
      used.add(identifierName(first));
    }
  }
  return used;
}

/**
 * Reads one assignment as a router binding: FastAPI's own constructors
 * always, and a first-party router class or factory when the file uses the
 * name as a router.
 *
 * @param assignment - an `assignment` node.
 * @param qualify - qualifies a name through the file's imports.
 * @param used - the names the file uses as routers.
 * @param kinds - what first-party callees build; undefined looks at FastAPI's constructors only.
 * @returns the binding, or null for any other assignment.
 */
function bindingOf(
  assignment: Node,
  qualify: Qualify,
  used: ReadonlySet<string>,
  kinds: RouterKinds | undefined,
): RouterBinding | null {
  const left = assignment.childForFieldName("left");
  const call = assignment.childForFieldName("right");
  const callee = call?.type === "call" ? call.childForFieldName("function") : null;
  // `factory(...)()` calls the class a class factory returns.
  const inner = callee?.type === "call" ? callee.childForFieldName("function") : null;
  const name = callee ? qualify(inner ?? callee) : null;
  if (left?.type !== "identifier" || !call || name === null) {
    return null;
  }
  const local = identifierName(left);
  const own = inner ? undefined : FASTAPI_CONSTRUCTORS.get(name);
  if (own !== undefined) {
    return { assignment, local, call, kind: own, factory: false, custom: false };
  }
  if (!(used.has(local) && kinds)) {
    return null;
  }
  const built = inner ? kinds.builtByClassOf(name) : kinds.builtBy(name);
  return built ? { assignment, local, call, ...built, custom: true } : null;
}

/**
 * Lists the names a file binds to a FastAPI app or router, in any scope.
 * FastAPI's own constructors always count. With `kinds`, a name the file
 * uses as a router also counts when it is bound to a first-party router
 * class or factory, or returned by a function annotated to return a router
 * class.
 *
 * @param root - the module node.
 * @param qualify - qualifies a name through the file's imports.
 * @param kinds - what first-party callees build; undefined looks at FastAPI's constructors only.
 * @returns the bindings, in source order.
 */
export function routerBindings(
  root: Node,
  qualify: Qualify,
  kinds: RouterKinds | undefined,
): RouterBinding[] {
  const used = kinds ? routerUses(root) : new Set<string>();
  const bindings = new Map<number, RouterBinding>();
  for (const assignment of root.descendantsOfType("assignment")) {
    const binding = assignment ? bindingOf(assignment, qualify, used, kinds) : null;
    if (binding) {
      bindings.set(binding.assignment.startIndex, binding);
    }
  }
  const annotated = kinds ? annotatedReturns(root, qualify, kinds) : [];
  for (const binding of annotated.filter(({ local }) => used.has(local))) {
    if (!bindings.has(binding.assignment.startIndex)) {
      bindings.set(binding.assignment.startIndex, binding);
    }
  }
  return [...bindings.values()].sort((a, b) => a.assignment.startIndex - b.assignment.startIndex);
}

/**
 * Finds the names functions return when their return annotation is a router
 * class: `def make_router() -> APIRouter: router = wrap(); ...; return router`.
 *
 * @param root - the module node.
 * @param qualify - qualifies a name through the file's imports.
 * @param kinds - tells whether the annotation is a router class.
 * @returns the bindings of the returned names, marked as a factory's.
 */
function annotatedReturns(root: Node, qualify: Qualify, kinds: RouterKinds): RouterBinding[] {
  return root.descendantsOfType("function_definition").flatMap((fn) => {
    const type = fn ? returnType(fn, qualify) : null;
    const kind = fn && type !== null ? kinds.classKind(type) : null;
    if (!fn || kind === null) {
      return [];
    }
    const names = returnedNames(fn);
    return ownCallBindings(fn)
      .filter(({ local }) => names.has(local))
      .map((binding) => ({ ...binding, kind, factory: true, custom: true }));
  });
}
