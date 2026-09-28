/**
 * @file FAPI003 `router-wiring` (#184): every `APIRouter` with path operations
 * is reached from an app through `include_router`, no routers include each
 * other in a cycle, and no `include_router` runs above the included router's
 * own routes in the same file. The first two read the project's
 * `WiringGraph`; the last one, and a router that includes itself, need one
 * file only, which is all the per-edit hook asks for.
 *
 * Findings are reported only in the files the caller checks, each on a line
 * of its own, so a suppression comment covers it. Nothing here reads a file
 * or resolves a name; the engine builds the model and the graph.
 */
import type { Node } from "web-tree-sitter";
import { matchEntry } from "../../config/layer-selector.ts";
import type { RuleOptions } from "../../config/rule-settings.ts";
import type { Diagnostic, SourceFile, Span } from "../../contracts/records.ts";
import { diagnostic, RULES, type RuleMeta } from "../../meta/registry.ts";
import type { GraphEdge, GraphNode, WiringGraph } from "./graph.ts";
import type { FastApiFile, Wiring } from "./records.ts";

const RULE: RuleMeta = RULES.FAPI003;
const DONT_DELETE = "Don't delete the router or its routes to make this finding go away.";

/**
 * Checks one file on its own: an `include_router` above the included
 * router's decorators, unless `check-order = false`, and a router that
 * includes itself.
 *
 * @param file - the file's FastAPI records.
 * @param src - the file, for the diagnostics.
 * @param options - `[tool.inwards.rules.router-wiring]`.
 * @returns the file's findings, in source order.
 */
export function checkFileWiring(
  file: FastApiFile,
  src: SourceFile,
  options: RuleOptions,
): Diagnostic[] {
  const found = file.wiring.flatMap((wiring) => {
    const self = wiring.kind === "include" && wiring.target === wiring.receiver;
    return [
      ...(self ? [selfInclusion(wiring, src)] : []),
      ...(options.checkOrder === false ? [] : includedEarly(file, wiring, src)),
    ];
  });
  return found.sort((a, b) => a.line - b.line || a.column - b.column);
}

/**
 * Checks the project's graph: routers with path operations that no app
 * reaches, and inclusion cycles. Only nodes and calls in `checked` files are
 * reported. When some `include_router` can't be followed, an unmounted
 * router is a warning that says so, or nothing with
 * `unresolved-includes = "silent"`.
 *
 * @param graph - the project's app and router graph.
 * @param checked - the checked files, by path.
 * @param options - `[tool.inwards.rules.router-wiring]`.
 * @returns the findings, unmounted routers first, then cycles.
 */
export function checkGraphWiring(
  graph: WiringGraph,
  checked: ReadonlyMap<string, SourceFile>,
  options: RuleOptions,
): Diagnostic[] {
  return [...unmounted(graph, checked, options), ...cycles(graph, checked)];
}

/**
 * Picks the apps unmounted routers are measured from: every app, or with
 * `entrypoints`, the apps they name, by the name the app is bound to or the
 * top-level function that builds it (`app.main:create_app`).
 *
 * @param graph - the project's graph.
 * @param entrypoints - `module:name` entries, if configured.
 * @returns the apps' qualified names.
 */
function rootsOf(graph: WiringGraph, entrypoints: readonly string[] | undefined): string[] {
  const apps = [...graph.nodes.values()].filter((node) => node.object.kind === "app");
  return apps
    .filter(
      (node) =>
        entrypoints === undefined ||
        [node.object.local, factoryOf(node.object.node)].some((name) =>
          entrypoints.includes(`${node.file.module}:${name}`),
        ),
    )
    .map((node) => node.object.name);
}

/**
 * Reports the routers in checked files that no root reaches.
 *
 * @param graph - the project's graph.
 * @param checked - the checked files, by path.
 * @param options - the rule's options.
 * @returns one finding per unmounted router, on its `APIRouter(...)` line.
 */
function unmounted(
  graph: WiringGraph,
  checked: ReadonlyMap<string, SourceFile>,
  options: RuleOptions,
): Diagnostic[] {
  const [unknown] = graph.unresolved;
  if (unknown !== undefined && options.unresolvedIncludes === "silent") {
    return [];
  }
  const roots = rootsOf(graph, options.entrypoints);
  const reached = graph.reachable(roots);
  const allowed = options.allowUnmounted ?? [];
  const caveat = unknown
    ? ` Inwards can't follow the include_router call at ${where(unknown.file, unknown.wiring.node)}, so that call may include it.`
    : "";
  return [...graph.nodes.values()].flatMap((node) => {
    const src = checked.get(node.file.path);
    const { object } = node;
    const lonely =
      object.kind === "router" &&
      object.topLevel &&
      node.operations.length > 0 &&
      !reached.has(object.name) &&
      !allowed.some((entry) => matchEntry(entry, object.name) !== undefined);
    if (src === undefined || !lonely) {
      return [];
    }
    return [
      diagnostic(RULE, src, {
        span: spanOf(object.node),
        ...(unknown ? { severity: "warning" as const } : {}),
        message: `APIRouter \`${object.name}\` has path operations, but no app includes it, directly or through another router, so its routes don't exist at runtime.${caveat}`,
        fix: {
          summary: `Include \`${object.local}\` in the app or router that serves its siblings.`,
          steps: [
            parentStep(graph, node, reached, roots),
            ...includedBy(graph, node),
            "If it is meant to stay unmounted (a later release, a test-only router), tell the user: they can add it to allow-unmounted in [tool.inwards.rules.router-wiring], or suppress this line with a reason.",
            DONT_DELETE,
          ],
        },
      }),
    ];
  });
}

/**
 * Says where to include an unmounted router: in the app or router that
 * includes most of its reached siblings (routers under the same grandparent
 * package), else in the first root app.
 *
 * @param graph - the project's graph.
 * @param node - the unmounted router.
 * @param reached - what the roots reach.
 * @param roots - the root apps.
 * @returns one fix step.
 */
function parentStep(
  graph: WiringGraph,
  node: GraphNode,
  reached: ReadonlySet<string>,
  roots: readonly string[],
): string {
  const area = node.file.module.split(".").slice(0, -2).join(".");
  const votes = new Map<string, number>();
  for (const edge of graph.edges) {
    const sibling = graph.nodes.get(edge.to);
    const near = area === "" || sibling?.file.module.startsWith(`${area}.`) === true;
    if (edge.kind === "include" && edge.from !== null && reached.has(edge.to) && near) {
      votes.set(edge.from, (votes.get(edge.from) ?? 0) + 1);
    }
  }
  const [best] = [...votes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const parent = graph.nodes.get(best?.[0] ?? roots[0] ?? "");
  const { local, name } = node.object;
  if (parent === undefined) {
    return `Include it where the app is built: import \`${local}\` from \`${node.file.module}\` and pass it to \`app.include_router(...)\`.`;
  }
  const what = parent.object.kind === "app" ? "the app" : "the router";
  const siblings = best === undefined ? "" : ", where its sibling routers are included";
  return `In ${parent.file.path}, which builds ${what} \`${parent.object.local}\`${siblings}: import \`${name}\` and add \`${parent.object.local}.include_router(...)\` for it.`;
}

/**
 * Names the routers that include an unmounted router but aren't reached
 * themselves, so the fix can point at the missing link higher up.
 *
 * @param graph - the project's graph.
 * @param node - the unmounted router.
 * @returns zero or one fix step.
 */
function includedBy(graph: WiringGraph, node: GraphNode): string[] {
  const parents = graph.into(node.object.name).flatMap((edge) => edge.from ?? []);
  return parents.length === 0
    ? []
    : [
        `It is included by ${parents.map((p) => `\`${p}\``).join(", ")}, which no app reaches either: including that one may be the missing link.`,
      ];
}

/**
 * Reports each group of routers that include each other once: the shortest
 * cycle through its first member, on the call that closes it, or on the
 * last call of the cycle in a checked file. A router including itself is
 * `checkFileWiring`'s.
 *
 * @param graph - the project's graph.
 * @param checked - the checked files, by path.
 * @returns one finding per cyclic group that has a call in a checked file.
 */
function cycles(graph: WiringGraph, checked: ReadonlyMap<string, SourceFile>): Diagnostic[] {
  // ponytail: one search per node, O(V*(V+E)); router graphs have tens of nodes.
  const reach = new Map([...graph.nodes.keys()].map((name) => [name, reachFrom(graph, name)]));
  const covered = new Set<string>();
  const found: Diagnostic[] = [];
  for (const [name, reached] of [...reach].sort(([a], [b]) => a.localeCompare(b))) {
    if (covered.has(name) || !reached.has(name)) {
      continue;
    }
    for (const member of reached) {
      if (reach.get(member)?.has(name) === true) {
        covered.add(member);
      }
    }
    const path = shortestCycle(graph, name);
    const at = path.findLast((edge) => checked.has(edge.file.path));
    const src = at === undefined ? undefined : checked.get(at.file.path);
    if (at !== undefined && src !== undefined) {
      found.push(cycleFinding(path, at, src));
    }
  }
  return found;
}

/**
 * Lists the `include_router` edges out of a node, without self-inclusions.
 *
 * @param graph - the project's graph.
 * @param name - a node's qualified name.
 * @returns the edges.
 */
function includesOf(graph: WiringGraph, name: string): GraphEdge[] {
  return graph.outOf(name).filter((edge) => edge.kind === "include" && edge.to !== name);
}

/**
 * Finds every router a node includes, directly or through others.
 *
 * @param graph - the project's graph.
 * @param name - a node's qualified name.
 * @returns the names reached; the node itself only when it is on a cycle.
 */
function reachFrom(graph: WiringGraph, name: string): ReadonlySet<string> {
  const found = new Set<string>();
  const queue = includesOf(graph, name).map((edge) => edge.to);
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    if (!found.has(next)) {
      found.add(next);
      queue.push(...includesOf(graph, next).map((edge) => edge.to));
    }
  }
  return found;
}

/**
 * Finds the shortest cycle of inclusions through a router, breadth first.
 *
 * @param graph - the project's graph.
 * @param start - a router on a cycle.
 * @returns the cycle's edges in order, from `start` back to it.
 */
function shortestCycle(graph: WiringGraph, start: string): GraphEdge[] {
  const via = new Map<string, GraphEdge>();
  const queue = [start];
  for (let at = queue.shift(); at !== undefined; at = queue.shift()) {
    for (const edge of includesOf(graph, at)) {
      if (edge.to === start) {
        const path = [edge];
        for (let back = via.get(at); back !== undefined; back = via.get(back.from ?? "")) {
          path.unshift(back);
        }
        return path;
      }
      if (!via.has(edge.to)) {
        via.set(edge.to, edge);
        queue.push(edge.to);
      }
    }
  }
  return [];
}

/**
 * Builds the finding for one inclusion cycle.
 *
 * @param path - the cycle's edges, in order.
 * @param at - the edge the finding sits on.
 * @param src - the file that edge is in.
 * @returns the diagnostic.
 */
function cycleFinding(path: readonly GraphEdge[], at: GraphEdge, src: SourceFile): Diagnostic {
  const names = [...path.map((edge) => edge.from ?? "?"), path[0]?.from ?? "?"];
  return diagnostic(RULE, src, {
    span: spanOf(at.wiring.node),
    message: `Routers include each other in a cycle: ${names.join(" -> ")}. The routes an app ends up with then depend on the order the include_router calls run in.`,
    fix: {
      summary:
        "Remove one include_router call of the cycle; the parent should be the router closer to the app.",
      steps: [
        `The calls that make the cycle: ${path.map((edge) => `\`${edge.from}\` includes \`${edge.to}\` at ${where(edge.file, edge.wiring.node)}`).join("; ")}.`,
        "Keep the call that goes from the router closer to the app down to its child, and remove the one that goes back up.",
      ],
    },
  });
}

/**
 * Builds the finding for a router that includes itself.
 *
 * @param wiring - the `include_router` call.
 * @param src - its file.
 * @returns the diagnostic.
 */
function selfInclusion(wiring: Wiring, src: SourceFile): Diagnostic {
  return diagnostic(RULE, src, {
    span: spanOf(wiring.node),
    message: `\`${wiring.receiver}\` includes itself, so its route set depends on when this call runs.`,
    fix: {
      summary: "Remove this include_router call.",
      steps: ["A router can't be its own parent: include it in an app or another router instead."],
    },
  });
}

/**
 * Reports an `include_router` at module level that runs above a path
 * operation decorator of the router it includes, in the same file.
 * `include_router` copies the routes that exist when it runs.
 *
 * @param file - the file's records.
 * @param wiring - one of its calls.
 * @param src - the file.
 * @returns zero or one finding.
 */
function includedEarly(file: FastApiFile, wiring: Wiring, src: SourceFile): Diagnostic[] {
  const line = wiring.node.startPosition.row;
  const later = file.operations.filter(
    (op) =>
      op.receiver === wiring.target &&
      op.node.startPosition.row > line &&
      factoryOf(op.node) === null,
  );
  const last = later.at(-1);
  if (wiring.kind !== "include" || last === undefined || factoryOf(wiring.node) !== null) {
    return [];
  }
  return [
    diagnostic(RULE, src, {
      span: spanOf(wiring.node),
      message: `This include_router call runs before ${later.length === 1 ? "a route" : "routes"} of \`${wiring.target}\` declared below it in this file, and include_router copies only the routes that exist when it runs, so those are missing at runtime.`,
      fix: {
        summary: `Move this call below the last \`@${last.receiver.split(".").at(-1)}.${last.decorator}(...)\` decorator (line ${last.node.startPosition.row + 1}).`,
        steps: [
          "Declare every route before including the router: move the include_router call to the end of the file, or into the module that builds the app.",
        ],
      },
    }),
  ];
}

/**
 * Finds the top-level function a node sits in, such as an app factory.
 *
 * @param node - a syntax node.
 * @returns the outermost enclosing function's name, or null at module level.
 */
function factoryOf(node: Node): string | null {
  let name: string | null = null;
  for (let at = node.parent; at !== null; at = at.parent) {
    if (at.type === "function_definition") {
      name = at.childForFieldName("name")?.text ?? null;
    }
  }
  return name;
}

/**
 * Gives a node's 1-based span.
 *
 * @param node - a syntax node.
 * @returns where it starts and ends.
 */
function spanOf(node: Node): Span {
  return {
    line: node.startPosition.row + 1,
    column: node.startPosition.column + 1,
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column + 1,
  };
}

/**
 * Spells a place for a message: path and line.
 *
 * @param file - the file the node is in.
 * @param node - a node in it.
 * @returns e.g. `app/main.py:12`.
 */
function where(file: FastApiFile, node: Node): string {
  return `${file.path}:${node.startPosition.row + 1}`;
}
