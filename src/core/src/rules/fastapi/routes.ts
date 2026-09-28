/**
 * @file The routes each FastAPI app ends up with, read off the app and router
 * graph (`graph.ts`): every path operation an app reaches through
 * `include_router`, in the order the app matches them, with its full path
 * (the prefixes of each router and inclusion on the way, joined) and whether
 * a call on the way leaves it out of the OpenAPI schema. FAPI005 and FAPI008
 * read this list; it reports nothing itself.
 *
 * A `mount` isn't followed: a mounted app matches and documents its own
 * routes. A prefix that isn't a string literal makes the full path unknown
 * (null), and the rules skip such routes rather than guess.
 */
import type { GraphEdge, WiringGraph } from "./graph.ts";
import { hiddenBy } from "./placement.ts";
import type { FastApiFile, PathOperation } from "./records.ts";
import type { Value } from "./values.ts";

/** One path operation as one app serves it. */
export interface Route {
  readonly op: PathOperation;
  /** The file the operation is declared in. */
  readonly file: FastApiFile;
  /** The full path, prefixes joined, or null when some part isn't a string literal. */
  readonly path: string | null;
  /** True when the operation, or a router or inclusion above it, leaves it out of the schema. */
  readonly hidden: boolean;
}

/** One step of an app's route list while it is walked: a path operation or an inclusion. */
type Step = { readonly file: FastApiFile; readonly row: number } & (
  | { readonly op: PathOperation }
  | { readonly edge: GraphEdge }
);

/**
 * Lists every app's routes, in the order the app matches them: an app or
 * router's own operations and its `include_router` calls in source order,
 * each inclusion replaced by the included router's routes.
 *
 * @param graph - the project's app and router graph.
 * @returns each app's routes, by the app's qualified name.
 */
export function appRoutes(graph: WiringGraph): ReadonlyMap<string, readonly Route[]> {
  const apps = [...graph.nodes.values()].filter((node) => node.object.kind === "app");
  return new Map(
    apps.map((app) => {
      const out: Route[] = [];
      walk(graph, app.object.name, { prefix: "", hidden: false, stack: new Set() }, out);
      return [app.object.name, out];
    }),
  );
}

/**
 * Appends an app or router's routes to `out`, then those of the routers it
 * includes, in the order its decorators and inclusions run.
 *
 * Steps in the file that builds the node come first, in source order; steps
 * in other files (`@app.get` in a module that imports `app`) follow, by path.
 * ponytail: a decorator in another file really runs when that module is
 * imported, which static reading can't order; fine while such cases are rare.
 *
 * @param graph - the project's graph.
 * @param name - the node's qualified name.
 * @param above - what the path to it gives.
 * @param above.prefix - the prefixes of the inclusions above it, or null when one isn't literal.
 * @param above.hidden - true when an inclusion above it leaves it out of the schema.
 * @param above.stack - the nodes on the path, which ends an inclusion cycle.
 * @param out - the routes so far, appended to.
 */
function walk(
  graph: WiringGraph,
  name: string,
  above: { prefix: string | null; hidden: boolean; stack: ReadonlySet<string> },
  out: Route[],
): void {
  const node = graph.nodes.get(name);
  if (node === undefined || above.stack.has(name)) {
    return;
  }
  const { object } = node;
  const own = object.kind === "router" ? object.keywords.get("prefix")?.value : undefined;
  const base = join(above.prefix, prefixOf(own, object.splat));
  const hidden = above.hidden || hiddenBy(object);
  const stack = new Set([...above.stack, name]);
  const steps: Step[] = [
    ...node.operations.map((op) => ({
      file: graph.fileOf(op) ?? node.file,
      row: op.node.startPosition.row,
      op,
    })),
    ...graph
      .outOf(name)
      .filter((edge) => edge.kind === "include")
      .map((edge) => ({ file: edge.file, row: edge.wiring.node.startPosition.row, edge })),
  ];
  const home = node.file.path;
  steps.sort(
    (a, b) =>
      Number(a.file.path !== home) - Number(b.file.path !== home) ||
      a.file.path.localeCompare(b.file.path) ||
      a.row - b.row,
  );
  for (const step of steps) {
    if ("op" in step) {
      const { op, file } = step;
      const path = op.path?.kind === "str" ? join(base, op.path.value) : null;
      out.push({ op, file, path, hidden: hidden || hiddenBy(op) });
    } else {
      const { to, wiring } = step.edge;
      const prefix = join(base, prefixOf(wiring.path, wiring.splat));
      walk(graph, to, { prefix, hidden: hidden || hiddenBy(wiring), stack }, out);
    }
  }
}

/**
 * Reads the `prefix=` of a router's constructor or an `include_router` call.
 *
 * @param value - the prefix as written, null or undefined when not given.
 * @param splat - true when a `**kwargs` of the call may set it.
 * @returns the prefix, "" when not given, or null when it isn't a string
 *   literal or a `**kwargs` may set it.
 */
function prefixOf(value: Value | null | undefined, splat: boolean): string | null {
  if (splat) {
    return null;
  }
  if (value === undefined || value === null || value.kind === "none") {
    return "";
  }
  return value.kind === "str" ? value.value : null;
}

/**
 * Joins two parts of a path, as FastAPI does: by concatenation.
 *
 * @param head - the part above, or null when unknown.
 * @param tail - the part below, or null when unknown.
 * @returns the joined path, or null when either part is unknown.
 */
function join(head: string | null, tail: string | null): string | null {
  return head === null || tail === null ? null : `${head}${tail}`;
}
