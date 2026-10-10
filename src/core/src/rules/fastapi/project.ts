/**
 * @file What the FAPI rules need to know beyond one file, answered lazily
 * over the FastAPI model and cached for one check: constants, classes and
 * their first-party bases, the exception handlers every app registers, and
 * the app and router graph (`graph.ts`) with the `include_router` edges that
 * lead to a router. The handlers and the graph need every FastAPI file of the
 * project, so they read the project once, on the first question.
 *
 * An inclusion the graph can't follow that may hide a first-party router
 * makes the edges into every router unknown, and the rules then stay quiet.
 */
import type { Node } from "web-tree-sitter";
import type { ProjectIndex } from "../../lookup/project-index.ts";
import { argumentAt } from "../../python/literals.ts";
import { identifierName, namedChildren } from "../../python/nodes.ts";
import { WiringGraph } from "./graph.ts";
import { returnedStatusCodes } from "./handlers.ts";
import type { Definition, FastApiModel } from "./model.ts";
import type { ExceptionHandler, FastApiFile, FastApiObject, Wiring } from "./records.ts";
import type { Qualify, Value } from "./values.ts";
import { valueFrom } from "./values.ts";

/** A name that starts lower-case, as variables do and classes don't. */
const LOWER = /^[a-z_]/u;

/** A first-party class, by its canonical name (`module.Name` where it is defined). */
export interface ClassInfo {
  readonly name: string;
  readonly node: Node;
  readonly path: string;
  readonly qualify: Qualify;
}

/** A class and what it inherits, in lookup order. */
export interface Lineage {
  /** The class and its first-party bases, depth first, the class itself first. */
  readonly classes: readonly ClassInfo[];
  /** The qualified names of the bases that aren't first-party, such as `fastapi.HTTPException`. */
  readonly external: ReadonlySet<string>;
}

/** What an app's handler for one exception class returns. */
export interface HandlerInfo {
  /** The literal status codes; null when some return isn't literal or the handler can't be read. */
  readonly codes: readonly number[] | null;
  /** Where the handler is registered, `path:line`. */
  readonly where: string;
}

/** One app's exception handlers. */
interface AppHandlers {
  /** The handler of each first-party exception class, by canonical class name. */
  readonly handlers: ReadonlyMap<string, HandlerInfo>;
  /** True when some registration's exception can't be read, so it may handle any class. */
  readonly open: boolean;
}

/** An `include_router` edge whose target is a known first-party router. */
export interface Edge {
  readonly wiring: Wiring;
  /** The qualified name of the app or router that includes, or null when the graph can't find it. */
  readonly parent: string | null;
}

/**
 * The first-party lookups the FAPI rules share during one check. Build one per
 * check, next to the `FastApiModel` it reads.
 */
export class FastApiProject {
  readonly model: FastApiModel;
  /** True in a per-edit check: rules read the rest of the project only when they must. */
  readonly lazy: boolean;
  private readonly project: ProjectIndex;
  /** The checked files that mention FastAPI, as the adapter handed them in. */
  private readonly own: readonly FastApiFile[];
  /** Each app's handlers, by the app's qualified name; built on first use. */
  private handlerMap: ReadonlyMap<string, AppHandlers> | undefined;
  /** True when some registration is on an app Inwards can't find, so it may be on any app. */
  private handlersAstray = false;
  /** Every name resolved so far: the rules ask for the same helpers and routers per route. */
  private readonly resolved = new Map<string, Definition | null>();
  private files: readonly FastApiFile[] | undefined;
  private wiring: WiringGraph | undefined;
  private open: boolean | undefined;

  /**
   * Wraps the check's model and project index. Nothing else is read yet.
   *
   * @param model - the FastAPI model of this check.
   * @param project - the project's module index.
   * @param own - the records of the checked files, already read through the model.
   * @param lazy - true for a per-edit check.
   */
  constructor(
    model: FastApiModel,
    project: ProjectIndex,
    own: readonly FastApiFile[],
    lazy = false,
  ) {
    this.model = model;
    this.lazy = lazy;
    this.project = project;
    this.own = own;
  }

  /**
   * The project's app and router graph, built on first use from every
   * FastAPI file of the project.
   *
   * @returns the graph of apps, routers and inclusions, cached for the check.
   */
  graph(): WiringGraph {
    this.wiring ??= WiringGraph.build(this.model, this.projectFiles(), this.project.ownerOf);
    return this.wiring;
  }

  /**
   * Every FastAPI file of the project, read once, for the rules that need to
   * know which file a graph record came from.
   *
   * @returns the records of every project file that mentions FastAPI.
   */
  fastApiFiles(): readonly FastApiFile[] {
    return this.projectFiles();
  }

  /**
   * Resolves a qualified name through the model, once per name.
   *
   * @param qualified - a qualified name.
   * @returns the definition, or null when it isn't first-party.
   */
  resolve(qualified: string): Definition | null {
    let found = this.resolved.get(qualified);
    if (found === undefined) {
      found = this.model.resolve(qualified);
      this.resolved.set(qualified, found);
    }
    return found;
  }

  /**
   * Reads the value a first-party module-level constant holds.
   *
   * @param qualified - a qualified name.
   * @returns the value, or null when the name isn't such a constant.
   */
  constant(qualified: string): Value | null {
    const found = this.resolve(qualified);
    return found?.kind === "constant" ? valueFrom(found.node, found.qualify) : null;
  }

  /**
   * Finds a first-party class and its bases, following re-exports.
   *
   * @param qualified - a qualified name.
   * @returns the lineage, or null when the name isn't a first-party class.
   */
  lineage(qualified: string): Lineage | null {
    const first = this.classOf(qualified);
    if (first === null) {
      return null;
    }
    const lineage: { classes: ClassInfo[]; external: Set<string> } = {
      classes: [],
      external: new Set(),
    };
    this.visit(first, lineage, new Set());
    return lineage;
  }

  /**
   * Adds a class and its bases to a lineage, depth first, each class once.
   *
   * @param info - the class.
   * @param lineage - the lineage so far, extended in place.
   * @param lineage.classes - the first-party classes found.
   * @param lineage.external - the names of bases that aren't first-party.
   * @param seen - the classes already visited.
   */
  private visit(
    info: ClassInfo,
    lineage: { classes: ClassInfo[]; external: Set<string> },
    seen: Set<string>,
  ): void {
    if (seen.has(info.name)) {
      return;
    }
    seen.add(info.name);
    lineage.classes.push(info);
    for (const base of basesOf(info)) {
      const next = this.classOf(base);
      if (next === null) {
        lineage.external.add(base);
      } else {
        this.visit(next, lineage, seen);
      }
    }
  }

  /**
   * Lists the exception handlers of every app that serves an app's or a
   * router's routes (#242): the app itself, or each app that includes the
   * router, directly or through other routers. Starlette looks a handler up
   * in the app that runs the route, so another app's handlers don't count.
   * Scans the project once, on first use.
   *
   * @param object - the app or router the route is declared on.
   * @returns each app's handlers by canonical class name, none when no app
   *   includes the router, or null when they can't be known: an inclusion
   *   Inwards can't follow, or an app with a registration it can't read (a
   *   dict and a loop, say, which could handle any class).
   */
  handlersOver(object: FastApiObject): readonly ReadonlyMap<string, HandlerInfo>[] | null {
    this.handlerMap ??= this.scanHandlers();
    const apps = this.appsOver(object, new Set());
    if (apps === null || this.handlersAstray) {
      return null;
    }
    const tables: ReadonlyMap<string, HandlerInfo>[] = [];
    for (const app of apps) {
      const entry = this.handlerMap.get(app);
      if (entry?.open === true) {
        return null;
      }
      tables.push(entry?.handlers ?? new Map());
    }
    return tables;
  }

  /**
   * Finds the apps that serve an app's or a router's routes, through the
   * `include_router` edges above it. A mount isn't followed: a mounted app
   * handles its own exceptions.
   *
   * @param object - the app or router.
   * @param seen - the routers already on this path, which ends an inclusion cycle.
   * @returns the apps' qualified names, or null when an inclusion above can't be followed.
   */
  private appsOver(object: FastApiObject, seen: ReadonlySet<string>): ReadonlySet<string> | null {
    if (object.kind === "app" || seen.has(object.name)) {
      return new Set(object.kind === "app" ? [object.name] : []);
    }
    const apps = new Set<string>();
    for (const { parent } of this.edgesTo(object.name) ?? [{ parent: null }]) {
      const above = parent === null ? null : this.objectOf(parent);
      const found = above ? this.appsOver(above, new Set([...seen, object.name])) : null;
      if (found === null) {
        return null;
      }
      for (const app of found) {
        apps.add(app);
      }
    }
    return apps;
  }

  /**
   * Tells whether a qualified name belongs to the project.
   *
   * @param qualified - a qualified name.
   * @returns true when a first-party module owns it.
   */
  firstParty(qualified: string): boolean {
    return this.project.ownerOf(qualified) !== undefined;
  }

  /**
   * Lists the `include_router` edges that include a router. Scans the
   * project once, on first use.
   *
   * @param router - the router's qualified name (`FastApiObject.name`).
   * @returns its edges, or null when some inclusion in the project has a
   *   target Inwards can't resolve, so an edge may be missing.
   */
  edgesTo(router: string): readonly Edge[] | null {
    const graph = this.graph();
    this.open ??= graph.unresolved.some(({ wiring, file }) => this.mayBeFirstParty(wiring, file));
    const into = graph.into(router).filter((edge) => edge.kind === "include");
    return this.open ? null : into.map(({ wiring, from }) => ({ wiring, parent: from }));
  }

  /**
   * Resolves an app or router by qualified name.
   *
   * @param qualified - a record's `receiver` or an edge's `parent`.
   * @returns the object, or null when the name isn't bound to one.
   */
  objectOf(qualified: string): FastApiObject | null {
    const found = this.resolve(qualified);
    return found?.kind === "object" ? found.object : null;
  }

  /**
   * Resolves a name to a first-party class.
   *
   * @param qualified - a qualified name.
   * @returns the class, or null.
   */
  private classOf(qualified: string): ClassInfo | null {
    const found = this.resolve(qualified);
    const nameNode = found?.kind === "class" ? found.node.childForFieldName("name") : null;
    if (found?.kind !== "class" || !nameNode) {
      return null;
    }
    const name = `${found.file.module}.${identifierName(nameNode)}`;
    return { name, node: found.node, path: found.file.path, qualify: found.qualify };
  }

  /**
   * Reads every file that names `exception_handler`, and maps each handled
   * first-party exception class to its handler, per app. On one app, the
   * first registration of a class wins.
   *
   * @returns each app's handlers, by the app's qualified name.
   */
  private scanHandlers(): Map<string, AppHandlers> {
    const apps = new Map<string, { handlers: Map<string, HandlerInfo>; open: boolean }>();
    const registered = this.projectFiles().flatMap((file) =>
      file.handlers.map((handler) => ({ file, handler })),
    );
    for (const { file, handler } of registered) {
      const app = this.objectOf(handler.app);
      if (app === null) {
        this.handlersAstray = true;
        continue;
      }
      const entry = apps.get(app.name) ?? { handlers: new Map(), open: false };
      apps.set(app.name, entry);
      const { exception } = handler;
      const handled = exception.kind === "name" ? this.classOf(exception.name) : null;
      const readable = exception.kind === "int" || exception.kind === "name";
      const dynamic = exception.kind === "name" && handled === null && this.bound(exception.name);
      entry.open ||= !readable || dynamic;
      if (handled !== null && !entry.handlers.has(handled.name)) {
        const where = `${file.path}:${handler.node.startPosition.row + 1}`;
        entry.handlers.set(handled.name, { codes: this.handlerCodes(handler), where });
      }
    }
    return apps;
  }

  /**
   * Tells whether a first-party name given as a handler's exception is a
   * variable rather than a class, such as a loop variable over a dict of
   * exceptions. A name bound to something other than a class counts, and so
   * does an unresolved lower-case one; an unresolved capitalised one is taken
   * for a class Inwards can't see, such as a builtin (`ValueError`).
   *
   * @param qualified - the name a handler registration gives as its exception.
   * @returns true when the name looks like a variable.
   */
  private bound(qualified: string): boolean {
    const found = this.resolve(qualified);
    const local = qualified.slice(qualified.lastIndexOf(".") + 1);
    const variable = found === null && this.firstParty(qualified) && LOWER.test(local);
    return variable || (found !== null && found.kind !== "class");
  }

  /**
   * Reads the literal status codes a handler's responses set, following a
   * handler defined in another file.
   *
   * @param handler - the registration.
   * @returns the codes, or null when there are none Inwards can read.
   */
  private handlerCodes(handler: ExceptionHandler): readonly number[] | null {
    const resolved = handler.handler === null ? null : this.resolve(handler.handler);
    let codes: readonly number[] = [];
    if (handler.function) {
      codes = handler.statusCodes;
    } else if (resolved?.kind === "function") {
      codes = returnedStatusCodes(resolved.node);
    }
    return codes.length > 0 ? codes : null;
  }

  /**
   * Tells whether an inclusion Inwards couldn't resolve may include a
   * first-party router: its target is a first-party name that isn't a router
   * (a loop variable, say), a call to a first-party function, or something
   * that isn't a name at all. A third-party router can't be one of ours.
   *
   * @param wiring - the inclusion.
   * @param file - the file it is in.
   * @returns true when a first-party router may hide behind it.
   */
  private mayBeFirstParty(wiring: Wiring, file: FastApiFile): boolean {
    const target = wiring.target ?? this.calleeOf(wiring, file);
    return target === null || this.project.ownerOf(target) !== undefined;
  }

  /**
   * Names the function that builds an included router, as in
   * `include_router(make_router())`.
   *
   * @param wiring - an inclusion whose target isn't a name.
   * @param file - the file it is in.
   * @returns the callee's qualified name, or null when the target isn't a call to a name.
   */
  private calleeOf(wiring: Wiring, file: FastApiFile): string | null {
    const arg = argumentAt(wiring.node, 0, "router");
    const callee = arg?.type === "call" ? arg.childForFieldName("function") : null;
    const qualify = this.model.qualifierOf(file);
    return callee && qualify ? qualify(callee) : null;
  }

  /**
   * Collects every FastAPI file of the project, once: the checked ones as the
   * adapter handed them in, the rest through the index (text pre-filter first).
   *
   * @returns the records of every project file that mentions FastAPI.
   */
  private projectFiles(): readonly FastApiFile[] {
    const checked = new Set(this.own.map((file) => file.module));
    this.files ??= [
      ...this.own,
      ...[...this.project.modules]
        .filter((module) => !checked.has(module))
        .flatMap((module) => this.model.moduleModel(module) ?? []),
    ];
    return this.files;
  }
}

/**
 * Lists the qualified names of a class's bases, keywords (`metaclass=`) left out.
 *
 * @param info - the class.
 * @returns the names of the bases written as names or attributes.
 */
function basesOf(info: ClassInfo): string[] {
  const list = info.node.childForFieldName("superclasses");
  return (list ? namedChildren(list) : []).flatMap((base) => {
    const name = base.type === "keyword_argument" ? null : info.qualify(base);
    return name === null ? [] : [name];
  });
}
