/**
 * @file The app and router graph of a FastAPI project (#184): every app and
 * router the model found is a node, and every `include_router` or `mount`
 * call whose receiver and target resolve is an edge, across files through
 * the model's name resolution. FAPI003 asks it which routers no app reaches
 * and which include each other in a cycle; FAPI002 (#183), route shadowing
 * (#224) and duplicate operation ids (#227) can walk the same edges to read
 * prefixes, tags and `responses=` along an inclusion path.
 *
 * It holds the model's records, so it is valid until the model is disposed.
 * It reports nothing and knows no options: which apps are roots and what
 * counts as a problem are the rules' decisions.
 */
import type { Node } from "web-tree-sitter";
import type { ModuleLookup } from "../../../lookup/module-lookup.ts";
import { argumentAt } from "../../../python/literals.ts";
import { identifierName } from "../../../python/nodes.ts";
import { returnedNames } from "../../shared/function-returns.ts";
import type { CallSite } from "./_call-sites.ts";
import { argumentFor, enclosingParameter } from "./_callers.ts";
import type { FastApiModel } from "./_model.ts";
import type { FastApiFile, FastApiObject, PathOperation, Wiring } from "./_records.ts";

/** An app or router, where it is declared, and the path operations declared on it. */
export interface GraphNode {
  readonly object: FastApiObject;
  /** The file that builds it. */
  readonly file: FastApiFile;
  /** Its path operations, from any of the files the graph was built from. */
  readonly operations: readonly PathOperation[];
}

/** One `include_router` or `mount` call, resolved. */
export interface GraphEdge {
  readonly kind: Wiring["kind"];
  /**
   * The qualified name of the including app or router, or null when the
   * receiver isn't one the model can find, such as a `register(app)`
   * function's parameter.
   */
  readonly from: string | null;
  /** The qualified name of the included router or mounted app. */
  readonly to: string;
  readonly wiring: Wiring;
  /** The file that makes the call. */
  readonly file: FastApiFile;
}

/**
 * An `include_router` call whose target the graph can't follow: not a name
 * (`getattr(m, "router")`, `importlib.import_module(...).router`), a
 * first-party name that isn't bound to a router the model knows (a loop over
 * something other than a literal), a parameter whose calls can't all be
 * found or pass something other than a name, or a factory call whose
 * returned router the model can't read.
 */
export interface UnresolvedInclude {
  readonly wiring: Wiring;
  readonly file: FastApiFile;
  /**
   * The routers the call could include (#358): none the model knows for a
   * first-party factory call whose returned router it can't read
   * (`include_router(make_router())` is an edge when it can, #391), or `any`
   * for every other target (a parameter, `getattr`, a name the model can't bind).
   */
  readonly targets: ReadonlySet<string> | "any";
}

/** The graph while it is built: what was found and resolved so far, and how to resolve. */
interface Building {
  readonly nodes: Map<string, { object: FastApiObject; file: FastApiFile; ops: PathOperation[] }>;
  readonly edges: GraphEdge[];
  readonly unresolved: UnresolvedInclude[];
  /** Each qualified name looked up so far, and the node it names or null. */
  readonly named: Map<string, string | null>;
  readonly model: FastApiModel;
  readonly ownerOf: ModuleLookup;
}

/**
 * The project's app and router graph. Build it once per check with
 * `WiringGraph.build`; the queries are cheap and don't resolve anything.
 */
export class WiringGraph {
  /** Every app and router, by qualified name. */
  readonly nodes: ReadonlyMap<string, GraphNode>;
  /** Every resolved `include_router` and `mount` call, in file and source order. */
  readonly edges: readonly GraphEdge[];
  /** The `include_router` calls whose target couldn't be followed, in file and source order. */
  readonly unresolved: readonly UnresolvedInclude[];
  /** The apps and routers that add a route serving an OpenAPI schema of their own (#391). */
  readonly schemaServers: ReadonlySet<string>;
  private readonly out = new Map<string, GraphEdge[]>();
  private readonly in = new Map<string, GraphEdge[]>();

  /**
   * Stores the parts and indexes the edges by both ends.
   *
   * @param nodes - apps and routers by qualified name.
   * @param edges - the resolved calls.
   * @param unresolved - the inclusions that couldn't be followed.
   * @param schemaServers - the apps and routers that serve a schema of their own.
   */
  private constructor(
    nodes: ReadonlyMap<string, GraphNode>,
    edges: readonly GraphEdge[],
    unresolved: readonly UnresolvedInclude[],
    schemaServers: ReadonlySet<string>,
  ) {
    this.nodes = nodes;
    this.edges = edges;
    this.unresolved = unresolved;
    this.schemaServers = schemaServers;
    for (const edge of edges) {
      if (edge.from !== null) {
        this.out.set(edge.from, [...(this.out.get(edge.from) ?? []), edge]);
      }
      this.in.set(edge.to, [...(this.in.get(edge.to) ?? []), edge]);
    }
  }

  /**
   * Builds the graph from the FastAPI files of a project. Each receiver,
   * target and path operation receiver is resolved through the model once,
   * re-exports included; an app or router that only a name leads to (in a
   * file not passed in) becomes a node too, without its operations. A `for`
   * loop over a list literal gives one edge per item.
   *
   * @param model - the check's FastAPI model.
   * @param files - the project's files that passed the model's pre-filter.
   * @param ownerOf - finds a name's first-party module, to tell a project name
   *   that doesn't resolve (unresolved) from a library's (not an edge at all).
   * @returns the graph, with its edges indexed by both ends.
   */
  static build(
    model: FastApiModel,
    files: readonly FastApiFile[],
    ownerOf: ModuleLookup,
  ): WiringGraph {
    const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
    const building: Building = {
      nodes: new Map(),
      edges: [],
      unresolved: [],
      named: new Map(),
      model,
      ownerOf,
    };
    for (const file of sorted) {
      for (const object of file.objects) {
        addNode(building, object, file);
      }
    }
    for (const file of sorted) {
      for (const op of file.operations) {
        building.nodes.get(nameOf(building, op.receiver) ?? "")?.ops.push(op);
      }
      for (const wiring of file.wiring) {
        addWiring(building, wiring, file);
      }
    }
    const schemaServers = new Set(
      sorted.flatMap((file) =>
        file.schemaRoutes.flatMap(({ receiver, node }) => {
          const written = { receiver, targets: [] };
          const ends = endsOf(building, { file, call: node, written, argument: null });
          return ends.flatMap((end) =>
            end.receiver === null ? [] : (nameOf(building, end.receiver) ?? []),
          );
        }),
      ),
    );
    const { edges, unresolved } = building;
    const nodes = new Map(
      [...building.nodes].map(([name, { object, file, ops }]) => [
        name,
        { object, file, operations: ops },
      ]),
    );
    return new WiringGraph(nodes, edges, unresolved, schemaServers);
  }

  /**
   * Lists the calls an app or router makes to include or mount others.
   *
   * @param name - a node's qualified name.
   * @returns its outgoing edges, in file and source order.
   */
  outOf(name: string): readonly GraphEdge[] {
    return this.out.get(name) ?? [];
  }

  /**
   * Lists the calls that include or mount an app or router: walking them up
   * gives every inclusion path from an app, with each step's `prefix=`.
   *
   * @param name - a node's qualified name.
   * @returns its incoming edges, from known and unknown receivers alike.
   */
  into(name: string): readonly GraphEdge[] {
    return this.in.get(name) ?? [];
  }

  /**
   * Finds everything the given apps reach through `include_router` and
   * `mount`. A router included by a receiver the model can't find counts as
   * reached, with what it includes: something includes it, and the graph
   * can't say it isn't an app.
   *
   * @param roots - qualified names of the apps to start from.
   * @returns the qualified names reached, the roots included.
   */
  reachable(roots: Iterable<string>): ReadonlySet<string> {
    const seen = new Set<string>();
    const opaque = this.edges.filter((edge) => edge.from === null).map((edge) => edge.to);
    const queue = [...roots, ...opaque];
    for (let name = queue.pop(); name !== undefined; name = queue.pop()) {
      if (!seen.has(name)) {
        seen.add(name);
        queue.push(...this.outOf(name).map((edge) => edge.to));
      }
    }
    return seen;
  }
}

/**
 * Adds an app or router to the graph, unless a node of that name is there
 * already: the first assignment in path order wins.
 *
 * @param building - the graph so far.
 * @param object - the app or router.
 * @param file - the file that builds it.
 */
function addNode(building: Building, object: FastApiObject, file: FastApiFile): void {
  if (!building.nodes.has(object.name)) {
    building.nodes.set(object.name, { object, file, ops: [] });
  }
}

/** One way an `include_router` or `mount` call runs: its receiver and targets, as qualified names. */
interface Ends {
  /** The receiver, or null when it can't be read (a parameter no call can be followed for). */
  readonly receiver: string | null;
  /** The targets: one, or a loop literal's items; null for one that isn't a name. */
  readonly targets: readonly (string | null)[];
}

/**
 * Adds one `include_router` or `mount` call: an edge per target that
 * resolves, and an unresolved inclusion per target that doesn't and isn't a
 * library's name. A receiver or target that is a parameter of the function
 * the call sits in is followed to what each call of that function passes
 * (#391), and `include_router(make_router())` to the routers the factory
 * returns.
 *
 * @param building - the graph so far.
 * @param wiring - the call.
 * @param file - the file that makes it.
 */
function addWiring(building: Building, wiring: Wiring, file: FastApiFile): void {
  const written: Ends = {
    receiver: wiring.receiver,
    targets: wiring.loopTargets.length > 0 ? wiring.loopTargets : [wiring.target],
  };
  const argument = wiring.loopTargets.length === 0 ? targetNode(wiring) : null;
  for (const { receiver, targets } of endsOf(building, {
    file,
    call: wiring.node,
    written,
    argument,
  })) {
    const from = receiver === null ? null : nameOf(building, receiver);
    for (const target of targets) {
      addTarget(building, { wiring, file, from }, target);
    }
  }
}

/**
 * Adds one target of a call: an edge when it resolves or names a factory
 * whose routers the model reads, else an unresolved inclusion unless it is
 * a library's name.
 *
 * @param building - the graph so far.
 * @param at - the call, its file and its resolved receiver.
 * @param at.wiring - the call.
 * @param at.file - the file that makes it.
 * @param at.from - the receiver's node name, or null when it can't be found.
 * @param target - the target's qualified name, or null when it isn't a name.
 */
function addTarget(
  building: Building,
  { wiring, file, from }: { wiring: Wiring; file: FastApiFile; from: string | null },
  target: string | null,
): void {
  const to = target === null ? null : nameOf(building, target);
  const made = target === null ? factoryTargets(building, wiring, file) : null;
  const names = to === null ? [...(made ?? [])] : [to];
  for (const name of names) {
    building.edges.push({ kind: wiring.kind, from, to: name, wiring, file });
  }
  const library = target !== null && !building.ownerOf(target);
  if (names.length === 0 && wiring.kind === "include" && !library) {
    building.unresolved.push({ wiring, file, targets: made ?? "any" });
  }
}

/**
 * Lists the ways a call runs (an inclusion, a mount, a route that serves
 * a schema). Written with names, it runs one way. When its
 * receiver or its target is a parameter of the module-level function it sits
 * in (`def wire(app, api_router): app.include_router(api_router)`), it runs
 * once per call of that function in the project, with what that call passes;
 * a call that passes something other than a name leaves that end unknown.
 * When the function's calls can't all be found, the parameter stays as
 * written, which the graph can't resolve.
 *
 * @param building - the graph so far, with the model.
 * @param call - what the call is and where.
 * @param call.file - the file that makes it.
 * @param call.call - the `call` node.
 * @param call.written - its receiver and targets as written.
 * @param call.argument - the target's argument node, or null when there is
 *   none to follow (a loop's items, or a call without a target).
 * @returns the receiver and targets of each way it runs.
 */
function endsOf(
  building: Building,
  {
    file,
    call,
    written,
    argument,
  }: { file: FastApiFile; call: Node; written: Ends; argument: Node | null },
): Ends[] {
  const fn = call.childForFieldName("function");
  const object = fn?.type === "attribute" ? fn.childForFieldName("object") : null;
  const receiver = object ? enclosingParameter(object) : null;
  const target = argument ? enclosingParameter(argument) : null;
  const holder = receiver?.fn ?? target?.fn;
  const name = holder?.childForFieldName("name");
  const sites = name ? building.model.callsTo(`${file.module}.${identifierName(name)}`) : null;
  if (sites === null || holder === undefined) {
    return [written];
  }
  return sites.map((site) => ({
    receiver: receiver ? passedName(site, receiver) : written.receiver,
    targets: target ? [passedName(site, target)] : written.targets,
  }));
}

/**
 * Reads what one call passes for a parameter, as a qualified name.
 *
 * @param site - the call and its file's qualifier.
 * @param parameter - the parameter, from `enclosingParameter`.
 * @param parameter.fn - the function it belongs to.
 * @param parameter.parameter - its node in the parameter list.
 * @param parameter.name - what it is called.
 * @returns the name, or null when the call passes something else.
 */
function passedName(
  site: CallSite,
  { fn, parameter, name }: { fn: Node; parameter: Node; name: string },
): string | null {
  const value = argumentFor(site.call, fn, parameter, name);
  return value ? site.qualify(value) : null;
}

/**
 * Finds the argument an inclusion or mount passes as its target.
 *
 * @param wiring - the call.
 * @returns the router of `include_router`, the app of `mount`, or null when absent.
 */
function targetNode(wiring: Wiring): Node | null {
  return wiring.kind === "include"
    ? argumentAt(wiring.node, 0, "router")
    : argumentAt(wiring.node, 1, "app");
}

/**
 * Lists the routers a call to a first-party function, given as an
 * inclusion's target, can return: `include_router(make_router())` includes
 * a router that function returns (`return router` after
 * `router = APIRouter(...)` in its own body), which becomes an edge (#391).
 * Two routers the factory's module binds to one name are one node.
 *
 * @param building - the graph so far, with the model.
 * @param wiring - the inclusion.
 * @param file - the file that makes it.
 * @returns the routers' qualified names, empty when the factory returns
 *   none it builds, or null when the target isn't a call to a first-party function.
 */
function factoryTargets(
  building: Building,
  wiring: Wiring,
  file: FastApiFile,
): ReadonlySet<string> | null {
  const arg =
    wiring.kind === "include" && wiring.loopTargets.length === 0 ? targetNode(wiring) : null;
  const callee = arg?.type === "call" ? arg.childForFieldName("function") : null;
  const qualify = building.model.qualifierOf(file);
  const name = callee && qualify ? qualify(callee) : null;
  const found = name === null ? null : building.model.resolve(name);
  if (found?.kind !== "function") {
    return null;
  }
  const { node } = found;
  const returned = returnedNames(node);
  const records = building.model.moduleModel(found.file.module);
  const inside = (records?.objects ?? []).filter(
    (o) =>
      returned.has(o.local) &&
      o.node.startIndex >= node.startIndex &&
      o.node.endIndex <= node.endIndex,
  );
  for (const object of inside) {
    if (records !== null) {
      addNode(building, object, records);
    }
  }
  return new Set(inside.map((o) => o.name));
}

/**
 * Resolves a qualified name to the app or router it is bound to, once per name.
 *
 * @param building - the graph so far, with the model and the cache.
 * @param qualified - a record's receiver or target.
 * @returns the node's qualified name, or null when it isn't an app or router.
 */
function nameOf(building: Building, qualified: string): string | null {
  const cached = building.named.get(qualified);
  if (cached !== undefined) {
    return cached;
  }
  const found = building.model.resolve(qualified);
  const name = found?.kind === "object" ? found.object.name : null;
  if (found?.kind === "object") {
    addNode(building, found.object, found.file);
  }
  building.named.set(qualified, name);
  return name;
}
