/**
 * @file What a node of a read diagram stands for, as the diagram rules and
 * `import-diagram` need it (ADR-045): its classes (`external`, `public`), its
 * quoted label, the context it sits in, the layer or context it names, and
 * where it is written. Shared so INW017, INW018 and the draft read a diagram
 * the same way. Pure: it takes the declared names as plain records and never
 * imports the config parser.
 */
import type { SourceFile, Span } from "../contracts/records.ts";
import type { Diagram, NodeMention, SubgraphMention } from "./model.ts";
import { ID } from "./syntax.ts";

/** The class that keeps a node out of every check: something outside `[tool.inwards]`. */
export const EXTERNAL = "external";
/** The class that makes a node in a contexts diagram one of its context's `public` entries. */
export const PUBLIC = "public";

/** A layer or context as a diagram may name it: its name and its `modules` entries. */
export interface Declared {
  name: string;
  modules: readonly string[];
}

/**
 * Collects the ids that carry a class, by `:::name` on any mention or a
 * `class a,b name` statement.
 *
 * @param diagram - a marked diagram, read.
 * @param name - the class, such as `external`.
 * @returns the ids with that class.
 */
export function idsWithClass(diagram: Diagram, name: string): Set<string> {
  const ids = new Set<string>();
  for (const node of diagram.nodes) {
    if (node.classes.includes(name)) {
      ids.add(node.id);
    }
  }
  for (const [id, classes] of diagram.classes) {
    if (classes.includes(name)) {
      ids.add(id);
    }
  }
  return ids;
}

/**
 * Finds the quoted label a node or subgraph carries on any of its mentions,
 * the first one written.
 *
 * @param diagram - a marked diagram, read.
 * @param id - the node or subgraph id.
 * @returns the label text, or undefined when no mention quotes one.
 */
export function quotedLabel(diagram: Diagram, id: string): string | undefined {
  const mentions: readonly (NodeMention | SubgraphMention)[] = [
    ...diagram.subgraphs,
    ...diagram.nodes,
  ];
  return mentions.find((m) => m.id === id && m.label?.quoted === true)?.label?.text;
}

/**
 * Finds the top-level id a node or subgraph belongs to in a contexts diagram:
 * the outermost subgraph around it, or the node itself when it sits outside
 * every subgraph. A node belongs to the subgraph it is first written in, as
 * Mermaid draws it, even when a link outside the subgraph names it again.
 *
 * @param diagram - a marked diagram, read.
 * @param id - a node or subgraph id.
 * @returns the id of the context it stands in.
 */
export function topLevel(diagram: Diagram, id: string): string {
  const parents = new Map<string, string | undefined>();
  for (const s of diagram.subgraphs) {
    if (!parents.has(s.id)) {
      parents.set(s.id, s.parent);
    }
  }
  let current = parents.has(id)
    ? id
    : (diagram.nodes.find((n) => n.id === id && n.subgraph !== undefined)?.subgraph ?? id);
  const seen = new Set([current]);
  for (
    let parent = parents.get(current);
    parent !== undefined && !seen.has(parent);
    parent = parents.get(current)
  ) {
    seen.add(parent);
    current = parent;
  }
  return current;
}

/**
 * Tells whether a layer or context name can be written as a Mermaid node id.
 *
 * @param name - the declared name.
 * @returns true for `domain` or `order-api`, false for `slices.domain` or `web api`.
 */
function isMermaidId(name: string): boolean {
  return ID.exec(name)?.[0] === name;
}

/**
 * Resolves a node or subgraph to the layer or context it names: the one whose
 * name is its id, or, for a name that can't be a Mermaid id (a template's
 * `slices.domain`), the only one that lists the node's quoted label among its
 * `modules`. A name that can be an id must be written as the id, so a typo in
 * the id is still reported.
 *
 * @param id - the node or subgraph id.
 * @param label - its quoted label, if any.
 * @param declared - the layers or contexts.
 * @returns the declared entry, or undefined when the node names none.
 */
export function resolveName<T extends Declared>(
  id: string,
  label: string | undefined,
  declared: readonly T[],
): T | undefined {
  const named = declared.find((d) => d.name === id);
  if (named !== undefined || label === undefined) {
    return named;
  }
  const byLabel = declared.filter((d) => !isMermaidId(d.name) && d.modules.includes(label));
  return byLabel.length === 1 ? byLabel[0] : undefined;
}

/**
 * Turns a mention into a span on its line.
 *
 * @param named - a node or subgraph mention.
 * @returns the span of its id.
 */
export function mentionSpan(named: NodeMention | SubgraphMention): Span {
  return {
    line: named.line,
    column: named.column,
    endLine: named.line,
    endColumn: named.endColumn,
  };
}

/**
 * Makes the diagram's file into the source a diagnostic names.
 *
 * @param diagram - a marked diagram, read.
 * @returns a source with no module, as for pyproject.toml findings.
 */
export function diagramFile(diagram: Diagram): SourceFile {
  return { path: diagram.path, module: "", isPackage: false, text: "" };
}
