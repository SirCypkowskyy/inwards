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
import type { ModuleLookup } from "../../lookup/module-lookup.ts";
import type { FastApiModel } from "./model.ts";
import type { FastApiFile, FastApiObject, PathOperation, Wiring } from "./records.ts";

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
 * (`getattr(m, "router")`, `importlib.import_module(...).router`), or a
 * first-party name that isn't bound to a router the model knows (a factory's
 * result, a loop over something other than a literal).
 */
export interface UnresolvedInclude {
  readonly wiring: Wiring;
  readonly file: FastApiFile;
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
  private readonly out = new Map<string, GraphEdge[]>();
  private readonly in = new Map<string, GraphEdge[]>();

  /**
   * Stores the parts and indexes the edges by both ends.
   *
   * @param nodes - apps and routers by qualified name.
   * @param edges - the resolved calls.
   * @param unresolved - the inclusions that couldn't be followed.
   */
  private constructor(
    nodes: ReadonlyMap<string, GraphNode>,
    edges: readonly GraphEdge[],
    unresolved: readonly UnresolvedInclude[],
  ) {
    this.nodes = nodes;
    this.edges = edges;
    this.unresolved = unresolved;
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
    const { edges, unresolved } = building;
    const nodes = new Map(
      [...building.nodes].map(([name, { object, file, ops }]) => [
        name,
        { object, file, operations: ops },
      ]),
    );
    return new WiringGraph(nodes, edges, unresolved);
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

/**
 * Adds one `include_router` or `mount` call: an edge per target that
 * resolves, and an unresolved inclusion per target that doesn't and isn't a
 * library's name.
 *
 * @param building - the graph so far.
 * @param wiring - the call.
 * @param file - the file that makes it.
 */
function addWiring(building: Building, wiring: Wiring, file: FastApiFile): void {
  const from = nameOf(building, wiring.receiver);
  const targets = wiring.loopTargets.length > 0 ? wiring.loopTargets : [wiring.target];
  for (const target of targets) {
    const to = target === null ? null : nameOf(building, target);
    if (to !== null) {
      building.edges.push({ kind: wiring.kind, from, to, wiring, file });
    } else if (wiring.kind === "include" && (target === null || building.ownerOf(target))) {
      building.unresolved.push({ wiring, file });
    }
  }
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
