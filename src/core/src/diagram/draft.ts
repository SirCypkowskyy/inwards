/**
 * @file What `inwards import-diagram` reads out of marked diagrams (ADR-045):
 * the layers of a `layers` diagram, ranked by the longest path of solid
 * arrows to a sink, with same-rank layers as siblings, and the contexts of a
 * `contexts` diagram, with `depends-on` from the arrows between them and
 * `public` from their `:::public` nodes. A node's quoted label is its module.
 * It refuses what has no config: a cycle, a context or public node without a
 * module, two diagrams of one kind. Pure: the CLI renders, checks and writes
 * the table.
 */
import type {
  DiagramDraft,
  DiagramSource,
  DraftDiagramContext,
  DraftDiagramLayer,
} from "../contracts/records.ts";
import { markedBlocks } from "./blocks.ts";
import { readFlowchart } from "./mermaid.ts";
import type { Diagram } from "./model.ts";
import { EXTERNAL, idsWithClass, PUBLIC, quotedLabel, topLevel } from "./names.ts";

/** The layer that holds every context when a file draws no layers diagram. */
const ONE_LAYER = "app";
/** The package an example label uses when the diagram names none. */
const EXAMPLE_PACKAGE = "mypackage";
/** Whitespace, which makes a quoted label a caption rather than a module. */
const WHITESPACE = /\s/u;

/**
 * Reads the config the marked diagrams of one file stand for: at most one
 * layers diagram and one contexts diagram.
 *
 * @param source - the file's path and text.
 * @returns the draft, or why there is none, starting with `path:line`.
 */
export function draftFromSource(source: DiagramSource): DiagramDraft | string {
  const diagrams = markedBlocks(source).map((block) => readFlowchart(block, source.path));
  if (diagrams.length === 0) {
    return `${source.path}: no marked diagram; a diagram counts when it opens with %% inwards: layers or %% inwards: contexts.`;
  }
  const byKind = new Map<string, Diagram>();
  for (const diagram of diagrams) {
    if (byKind.has(diagram.kind)) {
      return `${source.path}:${diagram.markerLine}: a second ${diagram.kind} diagram; import-diagram reads one layers and one contexts diagram per file.`;
    }
    byKind.set(diagram.kind, diagram);
  }
  const contextDiagram = byKind.get("contexts");
  const contexts = contextDiagram === undefined ? [] : draftContexts(contextDiagram);
  if (typeof contexts === "string") {
    return contexts;
  }
  const layerDiagram = byKind.get("layers");
  if (layerDiagram === undefined) {
    return {
      layers: [[{ name: ONE_LAYER, modules: contexts.flatMap((c) => c.modules) }]],
      contexts,
      notes: [
        `The file has no layers diagram, so one layer, "${ONE_LAYER}", holds every context; draw a layers diagram to split it.`,
      ],
    };
  }
  const layers = draftLayers(layerDiagram);
  if (typeof layers === "string") {
    return layers;
  }
  return { ...layers, contexts };
}

/**
 * Reads the layers of a layers diagram, innermost first.
 *
 * @param diagram - a marked diagram of kind `layers`, read.
 * @returns the places in the order and the notes, or why the diagram has no order.
 */
function draftLayers(diagram: Diagram): Pick<DiagramDraft, "layers" | "notes"> | string {
  const external = idsWithClass(diagram, EXTERNAL);
  const subgraphs = new Set(diagram.subgraphs.map((s) => s.id));
  const ids = [...new Set(diagram.nodes.map((n) => n.id))].filter(
    (id) => !(external.has(id) || subgraphs.has(id)),
  );
  const targets = new Map<string, string[]>(ids.map((id) => [id, []]));
  const lines = new Map<string, number>();
  for (const edge of diagram.edges) {
    const out = targets.get(edge.from);
    if (edge.mayImport && edge.from !== edge.to && out !== undefined && targets.has(edge.to)) {
      out.push(edge.to);
      lines.set(`${edge.from}\0${edge.to}`, lines.get(`${edge.from}\0${edge.to}`) ?? edge.line);
    }
  }
  const cycle = findCycle(ids, targets);
  if (cycle !== undefined) {
    const line = lines.get(`${cycle[0]}\0${cycle[1]}`) ?? diagram.markerLine;
    return `${diagram.path}:${line}: the layers diagram has a cycle, ${cycle.join(" --> ")}, so the layers have no order.`;
  }
  const ranks = new Map<string, number>();
  const places: DraftDiagramLayer[][] = [];
  const notes: string[] = [];
  const pkg = examplePackage(diagram);
  for (const id of ids) {
    const module = moduleLabel(diagram, id);
    const rank = rankOf(id, targets, ranks);
    const place = places[rank] ?? [];
    place.push({ name: id, modules: module === undefined ? [] : [module] });
    places[rank] = place;
  }
  const layers = places.filter((place) => place.length > 0);
  for (const layer of layers.flat()) {
    if (layer.modules.length === 0) {
      notes.push(
        `Layer "${layer.name}" has no module: give its node a quoted label such as ${layer.name}["${pkg}.${layer.name}"], or fill in its modules by hand.`,
      );
    }
  }
  return { layers, notes };
}

/**
 * Computes a layer's rank: the longest path of solid arrows from it to a
 * layer that points at nothing. The arrows must have no cycle.
 *
 * @param id - the layer node.
 * @param targets - the nodes each one points at.
 * @param ranks - the ranks found so far; updated in place.
 * @returns 0 for a sink, else one more than the highest rank it points at.
 */
function rankOf(
  id: string,
  targets: ReadonlyMap<string, readonly string[]>,
  ranks: Map<string, number>,
): number {
  const known = ranks.get(id);
  if (known !== undefined) {
    return known;
  }
  const below = (targets.get(id) ?? []).map((next) => rankOf(next, targets, ranks));
  const rank = Math.max(-1, ...below) + 1;
  ranks.set(id, rank);
  return rank;
}

/**
 * Finds a cycle among the solid arrows, if there is one.
 *
 * @param ids - the layer nodes, in the order they are first written.
 * @param targets - the nodes each one points at.
 * @returns the cycle with its first node repeated at the end, or undefined.
 */
function findCycle(
  ids: readonly string[],
  targets: ReadonlyMap<string, readonly string[]>,
): string[] | undefined {
  const walk: { done: Set<string>; path: string[] } = { done: new Set(), path: [] };
  for (const id of ids) {
    const cycle = visit(id, targets, walk);
    if (cycle !== undefined) {
      return cycle;
    }
  }
  return undefined;
}

/**
 * Walks the arrows depth first from one node, looking for a way back to a
 * node on the current path.
 *
 * @param id - the node to walk from.
 * @param targets - the nodes each one points at.
 * @param walk - the nodes already cleared and the current path; updated in place.
 * @param walk.done - nodes from which no cycle can be reached.
 * @param walk.path - the nodes on the way to this one.
 * @returns the cycle with its first node repeated at the end, or undefined.
 */
function visit(
  id: string,
  targets: ReadonlyMap<string, readonly string[]>,
  walk: { done: Set<string>; path: string[] },
): string[] | undefined {
  const at = walk.path.indexOf(id);
  if (at !== -1) {
    return [...walk.path.slice(at), id];
  }
  if (walk.done.has(id)) {
    return undefined;
  }
  walk.path.push(id);
  for (const next of targets.get(id) ?? []) {
    const cycle = visit(next, targets, walk);
    if (cycle !== undefined) {
      return cycle;
    }
  }
  walk.path.pop();
  walk.done.add(id);
  return undefined;
}

/**
 * Reads the contexts of a contexts diagram: its top-level subgraphs and the
 * nodes outside every subgraph, in the order they are first written, with
 * their `public` entries and `depends-on`.
 *
 * @param diagram - a marked diagram of kind `contexts`, read.
 * @returns the contexts, or why one, or a public node in one, has no module.
 */
function draftContexts(diagram: Diagram): DraftDiagramContext[] | string {
  const external = idsWithClass(diagram, EXTERNAL);
  const firstLine = firstLines(diagram);
  const pkg = examplePackage(diagram);
  const contexts: DraftDiagramContext[] = [];
  for (const [name, line] of firstLine) {
    if (topLevel(diagram, name) !== name || external.has(name)) {
      continue;
    }
    const module = moduleLabel(diagram, name);
    if (module === undefined) {
      const how = diagram.subgraphs.some((s) => s.id === name)
        ? `subgraph ${name}["${pkg}.${name}"]`
        : `${name}["${pkg}.${name}"]`;
      return `${diagram.path}:${line}: context "${name}" has no module: give it a quoted label such as ${how}.`;
    }
    contexts.push({ name, modules: [module], public: [], dependsOn: [] });
  }
  const problem = addPublic(diagram, contexts, firstLine);
  if (problem !== undefined) {
    return problem;
  }
  addDependsOn(diagram, contexts, external);
  return contexts;
}

/**
 * Finds the line each node and subgraph is first written on.
 *
 * @param diagram - a marked diagram, read.
 * @returns the ids in the order they are first written, with that line.
 */
function firstLines(diagram: Diagram): Map<string, number> {
  const mentions = [...diagram.subgraphs, ...diagram.nodes].sort((a, b) => a.line - b.line);
  const firstLine = new Map<string, number>();
  for (const { id, line } of mentions) {
    if (!firstLine.has(id)) {
      firstLine.set(id, line);
    }
  }
  return firstLine;
}

/**
 * Fills in each context's `public` list: its whole modules when the context
 * itself is `:::public`, else the labels of its `:::public` nodes.
 *
 * @param diagram - a marked diagram of kind `contexts`, read.
 * @param contexts - the contexts; updated in place.
 * @param firstLine - the line each id is first written on, for the refusal.
 * @returns why a public node has no module, or undefined.
 */
function addPublic(
  diagram: Diagram,
  contexts: readonly DraftDiagramContext[],
  firstLine: ReadonlyMap<string, number>,
): string | undefined {
  const external = idsWithClass(diagram, EXTERNAL);
  for (const id of idsWithClass(diagram, PUBLIC)) {
    const context = contexts.find((c) => c.name === topLevel(diagram, id));
    if (context === undefined || external.has(id)) {
      continue;
    }
    const module = id === context.name ? context.modules[0] : moduleLabel(diagram, id);
    if (module === undefined) {
      return `${diagram.path}:${firstLine.get(id) ?? diagram.markerLine}: public node "${id}" in context "${context.name}" has no module: give it a quoted label such as ${id}["${context.modules[0] ?? EXAMPLE_PACKAGE}.${id}"].`;
    }
    context.public.push(module);
  }
  return undefined;
}

/**
 * Fills in each context's `depends-on` from the solid arrows that cross from
 * it into another context.
 *
 * @param diagram - a marked diagram of kind `contexts`, read.
 * @param contexts - the contexts; updated in place.
 * @param external - the ids marked `:::external`, whose arrows don't count.
 */
function addDependsOn(
  diagram: Diagram,
  contexts: readonly DraftDiagramContext[],
  external: ReadonlySet<string>,
): void {
  for (const edge of diagram.edges) {
    if (!edge.mayImport || external.has(edge.from) || external.has(edge.to)) {
      continue;
    }
    const from = contexts.find((c) => c.name === topLevel(diagram, edge.from));
    const to = contexts.find((c) => c.name === topLevel(diagram, edge.to));
    if (from !== undefined && to !== undefined && from !== to) {
      from.dependsOn = [...new Set([...from.dependsOn, to.name])].sort();
    }
  }
}

/**
 * Takes a node's quoted label as its module, unless it is a caption.
 *
 * @param diagram - the diagram it is in.
 * @param id - the node or subgraph id.
 * @returns the module prefix or selector, or undefined.
 */
function moduleLabel(diagram: Diagram, id: string): string | undefined {
  const label = quotedLabel(diagram, id);
  return label === undefined || label === "" || WHITESPACE.test(label) ? undefined : label;
}

/**
 * Picks the package an example label in a message should use: the first
 * segment of the first module label in the diagram.
 *
 * @param diagram - a marked diagram, read.
 * @returns such as `shop`, or `mypackage` when no node has a module.
 */
function examplePackage(diagram: Diagram): string {
  for (const id of new Set(diagram.nodes.map((n) => n.id))) {
    const module = moduleLabel(diagram, id);
    if (module !== undefined) {
      return module.split(".")[0] ?? EXAMPLE_PACKAGE;
    }
  }
  return EXAMPLE_PACKAGE;
}
