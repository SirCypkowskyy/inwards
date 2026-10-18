/**
 * @file INW019 diagram-missing-dependency (#347, ADR-045): an import in the
 * code from one layer or context a marked diagram draws into another it
 * draws, with no arrow for it, so the picture in the docs leaves out a
 * dependency the code has.
 *
 * In a `layers` diagram an import is drawn when a path of "may import"
 * arrows leads from the importing layer to the imported one, since a layer
 * may import every layer below it and a diagram draws only the steps. In a
 * `contexts` diagram it takes a direct arrow between the two contexts, from
 * any node inside one to any node inside the other, as `depends-on` isn't
 * transitive. A layer or context the diagram doesn't draw, or draws only as
 * an `external` node, is left out, and so is an import inside one layer or
 * context. An import under `if TYPE_CHECKING:` counts: INW001 to INW003
 * judge it like any other, so an arrow that leaves it out draws less than
 * the checks allow. Each missing pair is reported once per diagram, on the
 * importing node's first line, with the first import behind it in file and
 * source order. The engine hands over the imports and confirms the files
 * behind a finding with the full parse; this module only reads them. No I/O.
 */
import { contextOf, type InwardsConfig } from "../../config/index.ts";
import {
  type Diagram,
  diagramFile,
  EXTERNAL,
  idsWithClass,
  mentionSpan,
  type NodeMention,
  notationOf,
  quotedLabel,
  resolveName,
  type SubgraphMention,
  topLevel,
} from "../../diagram/index.ts";
import type { Diagnostic, ImportRef, SourceFile, Span } from "../../shared/contracts/records.ts";
import { diagnostic, RULES } from "../../shared/meta/registry.ts";
import { layerMembership } from "../shared/layer-ownership.ts";

/** One checked file and the imports read from it. */
export interface ImportingFile {
  file: SourceFile;
  imports: readonly ImportRef[];
}

/** A finding, and the file whose import it stands on. */
export interface MissingDependency {
  diagnostic: Diagnostic;
  file: SourceFile;
}

/** What one diagram draws, in terms of the layers or contexts it names. */
interface Drawn {
  /** "Layer" or "Context", for the message. */
  noun: "Layer" | "Context";
  /** The rule that reports such an import when the config forbids it. */
  codeRule: string;
  /** Where each drawn name is first written, and the id it is written as. */
  anchors: ReadonlyMap<string, { id: string; span: Span }>;
  /**
   * Names the drawn layer or context a module belongs to.
   *
   * @param module - a dotted module name or import target.
   * @returns its name, or undefined when the diagram doesn't draw it.
   */
  owner: (module: string) => string | undefined;
  /**
   * Tells whether the diagram draws an import from one name to another.
   *
   * @param from - the importing layer or context.
   * @param to - the imported one.
   * @returns true when an arrow (or, for layers, a path of arrows) covers it.
   */
  covers: (from: string, to: string) => boolean;
}

/** A missing pair found in one diagram, before it becomes a diagnostic. */
interface Gap {
  from: string;
  to: string;
  entry: ImportingFile;
  ref: ImportRef;
}

/**
 * Finds the imports each marked diagram leaves out.
 *
 * @param config - the layers and contexts.
 * @param diagrams - the marked diagrams the `diagrams` files hold.
 * @param files - every checked file with its imports.
 * @returns one finding per missing pair per diagram, diagrams in order, each
 *   diagram's in line order; `[tool.inwards.rules]` isn't applied yet.
 */
export function missingDependencies(
  config: InwardsConfig,
  diagrams: readonly Diagram[],
  files: readonly ImportingFile[],
): MissingDependency[] {
  const sorted = [...files].sort((a, b) => a.file.path.localeCompare(b.file.path));
  return diagrams.flatMap((diagram) => {
    const drawn =
      diagram.kind === "layers" ? drawnLayers(diagram, config) : drawnContexts(diagram, config);
    return gapsIn(drawn, sorted)
      .map((gap) => ({ gap, found: gapDiagnostic(diagram, drawn, gap) }))
      .sort(
        (a, b) =>
          a.found.line - b.found.line ||
          a.found.column - b.found.column ||
          a.found.message.localeCompare(b.found.message),
      )
      .map(({ gap, found }) => ({ diagnostic: found, file: gap.entry.file }));
  });
}

/**
 * Walks the imports and keeps the first one behind each pair the diagram
 * doesn't cover.
 *
 * @param drawn - what the diagram draws.
 * @param files - the checked files, in path order.
 * @returns one gap per missing pair.
 */
function gapsIn(drawn: Drawn, files: readonly ImportingFile[]): Gap[] {
  const gaps = new Map<string, Gap>();
  // One lookup per target: a project imports the same few modules many times.
  const owners = new Map<string, string | undefined>();
  /**
   * Names the drawn layer or context of an import target, once per target.
   *
   * @param target - a dotted import target.
   * @returns what `drawn.owner` says for it.
   */
  function ownerOf(target: string): string | undefined {
    if (!owners.has(target)) {
      owners.set(target, drawn.owner(target));
    }
    return owners.get(target);
  }
  for (const entry of files) {
    const from = drawn.owner(entry.file.module);
    if (from === undefined) {
      continue;
    }
    for (const ref of entry.imports) {
      const to = ref.target === "" ? undefined : ownerOf(ref.target);
      const key = `${from}\0${to ?? ""}`;
      if (to === undefined || to === from || gaps.has(key) || drawn.covers(from, to)) {
        continue;
      }
      gaps.set(key, { from, to, entry, ref });
    }
  }
  return [...gaps.values()];
}

/**
 * Words the finding for a missing pair, on the importing node's line.
 *
 * @param diagram - the diagram that leaves the import out.
 * @param drawn - what it draws.
 * @param gap - the pair and the import behind it.
 * @returns the INW019 diagnostic.
 */
function gapDiagnostic(diagram: Diagram, drawn: Drawn, gap: Gap): Diagnostic {
  const fromAnchor = drawn.anchors.get(gap.from);
  const toAnchor = drawn.anchors.get(gap.to);
  const span = fromAnchor?.span ?? {
    line: diagram.markerLine,
    column: 1,
    endLine: diagram.markerLine,
    endColumn: 2,
  };
  const noun = drawn.noun.toLowerCase();
  const path = drawn.noun === "Layer" ? "arrow or path of arrows" : "arrow";
  const notation = notationOf(diagram.notation);
  const arrow = notation.arrow(fromAnchor?.id ?? gap.from, toAnchor?.id ?? gap.to);
  return diagnostic(RULES.INW019, diagramFile(diagram), {
    span,
    message: `${drawn.noun} "${gap.from}" imports ${noun} "${gap.to}" in the code (${gap.entry.file.path}:${gap.ref.line} imports ${gap.ref.target}), and the diagram draws no ${path} from "${gap.from}" to "${gap.to}".`,
    fix: {
      summary: `Draw the import in the diagram: "${arrow}".`,
      steps: [
        `Arrows point from the importing ${noun} to the imported one, and solid arrows only: a dotted one (${notation.dotted}) stands for something other than an import.`,
        `If the code shouldn't import "${gap.to}" from "${gap.from}", remove the import instead; ${drawn.codeRule} reports it when [tool.inwards] forbids it.`,
      ],
    },
  });
}

/**
 * Reads what a layers diagram draws: its layers, where each is first
 * written, and which layers a path of arrows leads to from each.
 *
 * @param diagram - a layers diagram.
 * @param config - the config whose `layers` the nodes name.
 * @returns the drawn layers and the paths between them.
 */
function drawnLayers(diagram: Diagram, config: InwardsConfig): Drawn {
  const external = idsWithClass(diagram, EXTERNAL);
  /**
   * Names the layer a node stands for.
   *
   * @param id - a node id.
   * @returns the layer's name, or undefined for an external node or one that names no layer.
   */
  function nameOf(id: string): string | undefined {
    return external.has(id)
      ? undefined
      : resolveName(id, quotedLabel(diagram, id), config.layers)?.name;
  }
  const anchors = anchorsOf(diagram.nodes, nameOf);
  const next = new Map<string, Set<string>>();
  for (const [from, to] of arrowsBetween(diagram, nameOf)) {
    next.set(from, (next.get(from) ?? new Set<string>()).add(to));
  }
  return {
    noun: "Layer",
    codeRule: "INW001",
    anchors,
    owner: (module: string): string | undefined => {
      const name = layerMembership(module, config.layers)?.layer.name;
      return name !== undefined && anchors.has(name) ? name : undefined;
    },
    covers: (from: string, to: string): boolean => reaches(next, from, to),
  };
}

/**
 * Reads what a contexts diagram draws: its contexts (each top-level subgraph
 * or node), where each is first written, and the arrows between them.
 *
 * @param diagram - a contexts diagram.
 * @param config - the config whose `contexts` the nodes name.
 * @returns the drawn contexts and the arrows between them.
 */
function drawnContexts(diagram: Diagram, config: InwardsConfig): Drawn {
  const contexts = config.contexts ?? [];
  const external = idsWithClass(diagram, EXTERNAL);
  /**
   * Names the context a node or subgraph stands in.
   *
   * @param id - a node or subgraph id.
   * @returns the name of its top-level context, or undefined when it or that
   *   context is external, or names no context.
   */
  function nameOf(id: string): string | undefined {
    const top = topLevel(diagram, id);
    return external.has(id) || external.has(top)
      ? undefined
      : resolveName(top, quotedLabel(diagram, top), contexts)?.name;
  }
  const written = [...diagram.subgraphs, ...diagram.nodes].sort(
    (a, b) => a.line - b.line || a.column - b.column,
  );
  const anchors = anchorsOf(written, nameOf, (id) => topLevel(diagram, id));
  const arrows = new Set(arrowsBetween(diagram, nameOf).map(([from, to]) => `${from}\0${to}`));
  return {
    noun: "Context",
    codeRule: "INW002",
    anchors,
    owner: (module: string): string | undefined => {
      const name = contextOf(module, contexts)?.name;
      return name !== undefined && anchors.has(name) ? name : undefined;
    },
    covers: (from: string, to: string): boolean => arrows.has(`${from}\0${to}`),
  };
}

/**
 * Lists the "may import" arrows of a diagram between the names its ends stand for.
 *
 * @param diagram - a marked diagram.
 * @param nameOf - the layer or context a node id names, if any.
 * @returns a `[from, to]` pair per arrow whose ends both name one.
 */
function arrowsBetween(
  diagram: Diagram,
  nameOf: (id: string) => string | undefined,
): [string, string][] {
  return diagram.edges.flatMap((edge): [string, string][] => {
    const from = edge.mayImport ? nameOf(edge.from) : undefined;
    const to = edge.mayImport ? nameOf(edge.to) : undefined;
    return from === undefined || to === undefined ? [] : [[from, to]];
  });
}

/**
 * Finds where each drawn name is first written.
 *
 * @param mentions - the node (and subgraph) mentions, in line order.
 * @param nameOf - the layer or context a mention's id names, if any.
 * @param idOf - the id an arrow to the name would use; the mention's own by default.
 * @returns each name's first mention, as a span and an id.
 */
function anchorsOf(
  mentions: readonly (NodeMention | SubgraphMention)[],
  nameOf: (id: string) => string | undefined,
  idOf: (id: string) => string = (id: string): string => id,
): Map<string, { id: string; span: Span }> {
  const anchors = new Map<string, { id: string; span: Span }>();
  for (const mention of mentions) {
    const name = nameOf(mention.id);
    if (name !== undefined && !anchors.has(name)) {
      anchors.set(name, { id: idOf(mention.id), span: mentionSpan(mention) });
    }
  }
  return anchors;
}

/**
 * Tells whether a path of arrows leads from one layer to another.
 *
 * @param next - each layer's direct successors.
 * @param from - where the path starts.
 * @param to - where it must end.
 * @returns true when `to` is reachable from `from`.
 */
function reaches(
  next: ReadonlyMap<string, ReadonlySet<string>>,
  from: string,
  to: string,
): boolean {
  const seen = new Set([from]);
  const queue = [from];
  // The iterator also visits names pushed while it runs: a breadth-first queue.
  for (const name of queue) {
    for (const step of next.get(name) ?? []) {
      if (step === to) {
        return true;
      }
      if (!seen.has(step)) {
        seen.add(step);
        queue.push(step);
      }
    }
  }
  return false;
}
