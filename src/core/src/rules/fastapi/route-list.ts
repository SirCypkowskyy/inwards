/**
 * @file The routes of FastAPI apps in the order FastAPI holds them (#224):
 * each app, and each router no known app or router includes, flattened through
 * `include_router` with the literal `prefix=` of every step. Two lists only
 * reach the rules that read them: the whole project's (`graphRoutes`) and one
 * file's, per router (`fileRoutes`), which needs no other file. Unknown
 * pieces stay in the list as routes without a path, so a rule can tell
 * "unreachable" from "can't tell". `mount` is not followed: a mounted app
 * routes on its own.
 */
import type { GraphEdge, GraphNode, WiringGraph } from "./graph.ts";
import { type Segment, segmentsOf } from "./path-match.ts";
import type { FastApiProject } from "./project.ts";
import type { FastApiFile, PathOperation } from "./records.ts";

/** A path operation as one list of routes holds it: where it answers, and to what. */
export interface Route {
  readonly op: PathOperation;
  readonly file: FastApiFile;
  /** The full path, or null when a prefix or the path isn't a literal. */
  readonly path: string | null;
  readonly segments: readonly Segment[] | null;
  /** Lower-case methods, or null when unknown. */
  readonly methods: readonly string[] | null;
  /** False when the order of this route against the others of its list isn't known. */
  readonly ordered: boolean;
}

/** A path operation or an inclusion of an app or router, where it is written. */
type Item =
  | { readonly file: FastApiFile; readonly at: number; readonly op: PathOperation }
  | { readonly file: FastApiFile; readonly at: number; readonly edge: GraphEdge };

/** Where `flatten` stands: the prefix so far, the call that included the node, and whether order is known. */
interface Position {
  /** Everything the inclusions above add, or null when one isn't a literal. */
  readonly prefix: string | null;
  readonly from: GraphEdge | null;
  /** False once a router on the way holds its routes in several files. */
  readonly ordered: boolean;
}

/** What `flatten` reads and writes. */
interface Walk {
  readonly graph: WiringGraph;
  readonly files: ReadonlyMap<PathOperation, FastApiFile>;
  readonly out: Route[];
}

/**
 * Appends two prefixes.
 *
 * @param first - the outer prefix, or null when unknown.
 * @param second - the inner prefix, or null when unknown.
 * @returns the joined prefix, or null when either is unknown.
 */
function joinPrefix(first: string | null, second: string | null): string | null {
  return first === null || second === null ? null : `${first}${second}`;
}

/**
 * Reads a `prefix=` as a literal.
 *
 * @param call - an `APIRouter(...)` or `include_router(...)` call's syntax.
 * @param call.splat - true when `**kwargs` may hide a prefix.
 * @param call.keywords - the call's keyword arguments.
 * @returns the prefix, "" when absent, or null when it isn't a literal.
 */
function prefixOf(call: Pick<GraphNode["object"], "splat" | "keywords">): string | null {
  const value = call.keywords.get("prefix")?.value;
  if (call.splat || (value !== undefined && value.kind !== "str")) {
    return null;
  }
  return value?.value ?? "";
}

/**
 * Builds a route for an operation.
 *
 * @param op - the path operation.
 * @param file - the file it is declared in.
 * @param prefix - everything before the operation's own path, or null when unknown.
 * @param ordered - whether its place in the list is known.
 * @returns the route, with its full path and methods read as far as they are literal.
 */
function routeOf(
  op: PathOperation,
  file: FastApiFile,
  prefix: string | null,
  ordered: boolean,
): Route {
  const own = op.path?.kind === "str" && !op.splat ? op.path.value : null;
  const path = joinPrefix(prefix, own);
  const methods = op.methods === "unknown" || op.splat ? null : op.methods;
  return { op, file, path, segments: path === null ? null : segmentsOf(path), methods, ordered };
}

/**
 * Lists the operations and inclusions of an app or router in declaration order.
 *
 * @param node - the graph node.
 * @param walk - the graph and the operations' files.
 * @returns the items sorted by file and offset, and whether one file holds them all.
 */
function itemsOf(node: GraphNode, walk: Walk): { items: Item[]; ordered: boolean } {
  const ops = node.operations.flatMap((op): Item[] => {
    const file = walk.files.get(op);
    return file === undefined ? [] : [{ file, at: op.node.startIndex, op }];
  });
  const edges = walk.graph
    .outOf(node.object.name)
    .filter((edge) => edge.kind === "include")
    .map((edge): Item => ({ file: edge.file, at: edge.wiring.node.startIndex, edge }));
  const items = [...ops, ...edges].sort(
    (a, b) => a.file.path.localeCompare(b.file.path) || a.at - b.at,
  );
  return { items, ordered: new Set(items.map((item) => item.file.path)).size <= 1 };
}

/**
 * Tells whether an include_router call had copied an item by the time it ran.
 * It copies the routes that exist then, so one written below the call in the
 * same file isn't there.
 *
 * @param item - an operation or inclusion of the included router.
 * @param from - the call that included the router, if any.
 * @returns false for an item below the call in the call's file.
 */
function copied(item: Item, from: GraphEdge | null): boolean {
  return (
    from === null || item.file.path !== from.file.path || item.at < from.wiring.node.startIndex
  );
}

/**
 * Appends the routes an app or router holds, those of the routers it
 * includes in place.
 *
 * @param walk - the graph, the operations' files and the list being built.
 * @param name - the node's qualified name.
 * @param position - the prefix above it and how it was reached.
 * @param stack - the nodes on the way here, which ends an inclusion cycle.
 */
function flatten(walk: Walk, name: string, position: Position, stack: readonly string[]): void {
  const node = walk.graph.nodes.get(name);
  if (node === undefined || stack.includes(name)) {
    return;
  }
  const { items, ordered } = itemsOf(node, walk);
  const own = node.object.kind === "router" ? prefixOf(node.object) : "";
  const base = joinPrefix(position.prefix, own);
  const known = position.ordered && ordered;
  for (const item of items.filter((it) => copied(it, position.from))) {
    if ("op" in item) {
      walk.out.push(routeOf(item.op, item.file, base, known));
    } else {
      const prefix = joinPrefix(base, prefixOf(item.edge.wiring));
      flatten(walk, item.edge.to, { prefix, from: item.edge, ordered: known }, [...stack, name]);
    }
  }
}

/**
 * Lists the routes of every app in the project, and of every router that no
 * known app or router includes, each in the order FastAPI holds them.
 *
 * @param scope - this check's FastAPI lookups; the project graph is built on first use.
 * @returns one list per app or top-level router.
 */
export function graphRoutes(scope: FastApiProject): Route[][] {
  const graph = scope.graph();
  const files = new Map<PathOperation, FastApiFile>();
  for (const file of scope.fastApiFiles()) {
    for (const op of file.operations) {
      files.set(op, file);
    }
  }
  const roots = [...graph.nodes.values()].filter(
    ({ object }) =>
      object.kind === "app" || graph.into(object.name).every(({ from }) => from === null),
  );
  return roots.map(({ object }) => {
    const out: Route[] = [];
    flatten({ graph, files, out }, object.name, { prefix: "", from: null, ordered: true }, []);
    return out;
  });
}

/**
 * Lists one file's routes per router, in source order, with paths as written.
 * The routers' prefixes are the same for every route of a router, so they
 * don't change which one comes first.
 *
 * @param file - the file's FastAPI records.
 * @param scope - this check's FastAPI lookups.
 * @returns one list per app or router the file declares routes on.
 */
export function fileRoutes(file: FastApiFile, scope: FastApiProject): Route[][] {
  const byRouter = new Map<string, Route[]>();
  for (const op of file.operations) {
    const object = scope.objectOf(op.receiver);
    if (object !== null) {
      byRouter.set(object.name, [
        ...(byRouter.get(object.name) ?? []),
        routeOf(op, file, "", true),
      ]);
    }
  }
  return [...byRouter.values()];
}
