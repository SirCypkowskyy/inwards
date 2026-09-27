/**
 * @file INW004 import-cycles: modules, or bounded contexts, that import each
 * other in a cycle. The engine hands over every checked file's imports; this
 * module turns them into a module graph (an edge to the module each import
 * lands in) and, with contexts, a context graph (imports between two
 * different contexts), finds the cycles, and words one diagnostic per
 * strongly connected component: the shortest cycle through its first node,
 * anchored at the import that makes the first step. Whole-project runs only,
 * since one file can't show a cycle (ADR-032).
 */
import { type ContextSpec, contextOf } from "../../config/contexts.ts";
import type { CycleMode } from "../../config/cycles.ts";
import type { Diagnostic, ImportRef, SourceFile } from "../../contracts/records.ts";
import { diagnostic, RULES } from "../../meta/registry.ts";
import { cyclicComponents, type Graph, shortestCycle } from "./graph.ts";

/** One checked file and the imports read from it. */
export interface FileImports {
  file: SourceFile;
  imports: readonly ImportRef[];
}

/** One step of a cycle, and the import that makes it. */
export interface Edge {
  from: string;
  to: string;
  file: SourceFile;
  ref: ImportRef;
}

/** A cycle to report: its kind, its path, the import behind each step, and its group. */
export interface Cycle {
  kind: CycleMode;
  /** The nodes, first one repeated at the end: `[a, b, a]`. */
  path: string[];
  /** The import that makes each step, in path order. */
  steps: Edge[];
  /** Every node of the strongly connected group the cycle runs through. */
  members: string[];
  /** Every import between two nodes of the group. */
  inside: Edge[];
}

/**
 * Tells whether any of the modes has something to look at.
 *
 * @param modes - which kinds of cycles to look for.
 * @param contexts - the configured contexts.
 * @returns false for no modes, or contexts only without contexts (the default).
 */
export function searches(modes: readonly CycleMode[], contexts: readonly ContextSpec[]): boolean {
  return modes.includes("modules") || (modes.includes("contexts") && contexts.length > 0);
}

/**
 * Finds the cycles to report, one per strongly connected component.
 *
 * @param edges - every import between two modules, in file and source order.
 * @param modes - which kinds of cycles to look for.
 * @param contexts - the configured contexts, for `"contexts"`.
 * @returns the cycles, modules first, each in a stable order.
 */
export function findCycles(
  edges: readonly Edge[],
  modes: readonly CycleMode[],
  contexts: readonly ContextSpec[],
): Cycle[] {
  const byModule = modes.includes("modules");
  const byContext = modes.includes("contexts") && contexts.length > 0;
  const cycles: Cycle[] = [];
  if (byModule) {
    cycles.push(...cyclesOf("modules", edges));
  }
  if (byContext) {
    cycles.push(...cyclesOf("contexts", contextEdges(edges, contexts)));
  }
  return cycles;
}

/**
 * Words the diagnostic for a cycle, on the import that makes its first step.
 *
 * @param cycle - a cycle `findCycles` returned, with an import behind each step.
 * @returns the INW004 diagnostic, or undefined for a cycle with no steps.
 */
export function cycleDiagnostic(cycle: Cycle): Diagnostic | undefined {
  const [first] = cycle.steps;
  if (first === undefined) {
    return undefined;
  }
  const path = cycle.path.join(" -> ");
  // The group's size and a hash of its links are part of the message, so a
  // baseline taken before the group changed stops matching.
  // JSON pairs: a context name may hold a space, so a plain join could make two links one.
  const links = [
    ...new Set(cycle.inside.map((edge) => JSON.stringify([edge.from, edge.to]))),
  ].sort();
  const noun = cycle.kind === "modules" ? "modules" : "contexts";
  const group = `The group holds ${cycle.members.length} ${noun} and ${links.length} links between them (link hash ${linkHash(links)}).`;
  const message =
    cycle.kind === "modules"
      ? `Modules import each other in a cycle: ${path}. ${group}`
      : `Contexts import each other in a cycle: ${path}. ${group}`;
  return diagnostic(RULES.INW004, first.file, {
    span: first.ref,
    message,
    fix: cycle.kind === "modules" ? moduleFix(cycle) : contextFix(cycle),
  });
}

/** Two polynomial string hashes, each a base and a prime modulus that keep every step exact. */
const LINK_HASHES = [
  { base: 131, modulus: 1_000_000_007 },
  { base: 137, modulus: 998_244_353 },
] as const;
/** Hashes are written in hex, 8 digits each: each modulus is below 16^8. */
const HEX = 16;
const HASH_DIGITS = 8;

/**
 * Hashes a group's links, so two groups of one size but different links get
 * different messages.
 *
 * @param links - the group's links as JSON pairs, deduplicated and sorted.
 * @returns 16 hex digits.
 */
function linkHash(links: readonly string[]): string {
  const text = links.join("\n");
  return LINK_HASHES.map(({ base, modulus }) => {
    let h = 0;
    for (let i = 0; i < text.length; i += 1) {
      h = (h * base + text.charCodeAt(i)) % modulus;
    }
    return h.toString(HEX).padStart(HASH_DIGITS, "0");
  }).join("");
}

/**
 * Turns one file's imports into edges between its module and the checked
 * modules they land in: the longest checked module a target starts with.
 * Only checked modules are nodes, so an import of anything else (the
 * standard library, a package outside every layer) can't close a cycle and
 * makes no edge; neither does an import of the module itself.
 *
 * @param entry - one checked file and its imports.
 * @param entry.file - the file, whose module the edges start from.
 * @param entry.imports - its imports.
 * @param nodes - every checked module.
 * @returns the edges, in source order.
 */
export function fileEdges({ file, imports }: FileImports, nodes: ReadonlySet<string>): Edge[] {
  return imports.flatMap((ref): Edge[] => {
    const to = landsIn(ref.target, nodes);
    return to === undefined || to === file.module ? [] : [{ from: file.module, to, file, ref }];
  });
}

/**
 * Finds the longest checked module an import target starts with: the module
 * a name lives in, or the module itself.
 *
 * @param target - a dotted import target.
 * @param nodes - every checked module.
 * @returns that module, or undefined when the target is none of them.
 */
function landsIn(target: string, nodes: ReadonlySet<string>): string | undefined {
  for (let end = target.length; end > 0; end = target.lastIndexOf(".", end - 1)) {
    const prefix = target.slice(0, end);
    if (nodes.has(prefix)) {
      return prefix;
    }
  }
  return undefined;
}

/**
 * Collapses module edges to edges between two different contexts.
 *
 * @param edges - the module edges.
 * @param contexts - the configured contexts.
 * @returns an edge per import that crosses from one context into another.
 */
function contextEdges(edges: readonly Edge[], contexts: readonly ContextSpec[]): Edge[] {
  return edges.flatMap((edge): Edge[] => {
    const from = contextOf(edge.from, contexts)?.name;
    const to = contextOf(edge.to, contexts)?.name;
    return from === undefined || to === undefined || from === to ? [] : [{ ...edge, from, to }];
  });
}

/**
 * Finds one cycle per strongly connected component of a graph of edges.
 *
 * @param kind - what the nodes are.
 * @param edges - the edges, in file and source order.
 * @returns the cycles, with the first import behind each step.
 */
function cyclesOf(kind: CycleMode, edges: readonly Edge[]): Cycle[] {
  const graph = new Map<string, Set<string>>();
  const first = new Map<string, Edge>();
  for (const edge of edges) {
    const next = graph.get(edge.from) ?? new Set<string>();
    next.add(edge.to);
    graph.set(edge.from, next);
    const key = `${edge.from}\u0000${edge.to}`;
    if (!first.has(key)) {
      first.set(key, edge);
    }
  }
  const frozen: Graph = graph;
  const components = cyclicComponents(frozen);
  // One pass over the edges: each edge between two nodes of one group belongs to it.
  const groupOf = new Map(components.flatMap((nodes, g) => nodes.map((node) => [node, g])));
  const inside = components.map((): Edge[] => []);
  for (const edge of edges) {
    const g = groupOf.get(edge.from);
    if (g !== undefined && g === groupOf.get(edge.to)) {
      inside[g]?.push(edge);
    }
  }
  return components.flatMap((component, g): Cycle[] => {
    const [start] = component;
    const path = start === undefined ? undefined : shortestCycle(frozen, component, start);
    if (path === undefined) {
      return [];
    }
    const steps = path.slice(1).flatMap((to, i): Edge[] => {
      const edge = first.get(`${path[i] ?? ""}\u0000${to}`);
      return edge === undefined ? [] : [edge];
    });
    return [{ kind, path, steps, members: component, inside: inside[g] ?? [] }];
  });
}

/**
 * Writes the repair advice for a cycle between modules.
 *
 * @param cycle - its path and the import behind each step.
 * @returns the summary and numbered steps.
 */
function moduleFix(cycle: Cycle): Diagnostic["fix"] {
  const imports = cycle.steps.map((step) => `\`${step.ref.statement}\` in ${step.from}`).join("; ");
  return {
    summary: "Break the cycle: one of these modules must stop importing the next.",
    steps: [
      `The imports that make the cycle: ${imports}.`,
      "Pick the import that points the wrong way, usually from the lower-level module back up, and remove it.",
      "Move what both modules need into a third module they can both import, or define a Protocol in the lower-level module and pass the implementation in.",
      "Don't move the import into a function or behind TYPE_CHECKING to hide the cycle; Inwards counts those imports too.",
    ],
  };
}

/**
 * Writes the repair advice for a cycle between contexts.
 *
 * @param cycle - its path and the import behind each step.
 * @returns the summary and numbered steps.
 */
function contextFix(cycle: Cycle): Diagnostic["fix"] {
  const imports = cycle.steps
    .map((step) => `\`${step.ref.statement}\` in ${step.file.module} (${step.from} -> ${step.to})`)
    .join("; ");
  return {
    summary:
      "Decide which of these contexts depends on which, and remove the imports that go the other way.",
    steps: [
      `The imports that make the cycle, one per step: ${imports}.`,
      "Keep the dependency that matches the design and remove the imports in the opposite direction. Move code both contexts need into a context they can both depend on, or let one publish events the other subscribes to.",
      "If a depends-on entry allows the direction you removed, ask the user to drop it from [tool.inwards]. Don't edit [tool.inwards] yourself.",
    ],
  };
}
