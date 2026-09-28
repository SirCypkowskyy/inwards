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
  private handlerMap: ReadonlyMap<string, HandlerInfo> | undefined;
  /** True when some handler registration's exception can't be read. */
  private handlersOpen = false;
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
   * Finds the handler an app registers for a first-party exception class, by
   * the class's canonical name. Scans the project once, on first use.
   *
   * @param name - a canonical class name (`ClassInfo.name`).
   * @returns the handler, or undefined when no app registers one.
   */
  handlerFor(name: string): HandlerInfo | undefined {
    this.handlerMap ??= this.scanHandlers();
    return this.handlerMap.get(name);
  }

  /**
   * Tells whether every exception handler registration in the project names
   * its exception: one registered from a variable (a dict and a loop, say)
   * could handle any class, so no handler lookup can be trusted.
   *
   * @returns false when some registration's exception Inwards can't read.
   */
  handlersKnown(): boolean {
    this.handlerMap ??= this.scanHandlers();
    return !this.handlersOpen;
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
   * first-party exception class to its handler. The first registration of a
   * class wins, as a later one on another app can't be told apart.
   *
   * @returns handlers by canonical class name.
   */
  private scanHandlers(): Map<string, HandlerInfo> {
    const handlers = new Map<string, HandlerInfo>();
    const registered = this.projectFiles().flatMap((file) =>
      file.handlers.map((handler) => ({ file, handler })),
    );
    for (const { file, handler } of registered) {
      const { exception } = handler;
      const handled = exception.kind === "name" ? this.classOf(exception.name) : null;
      const readable = exception.kind === "int" || exception.kind === "name";
      const dynamic = exception.kind === "name" && handled === null && this.bound(exception.name);
      this.handlersOpen ||= !readable || dynamic;
      if (handled !== null && !handlers.has(handled.name)) {
        const where = `${file.path}:${handler.node.startPosition.row + 1}`;
        handlers.set(handled.name, { codes: this.handlerCodes(handler), where });
      }
    }
    return handlers;
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
