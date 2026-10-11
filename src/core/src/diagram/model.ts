/**
 * @file What the Mermaid reader gives the diagram rules: a marked diagram with
 * its kind, every place a node or subgraph is named, and the edges between
 * them, each on the line of the file it came from (ADR-045). Types only; the
 * reading is in `blocks.ts` and `mermaid.ts`.
 */

/** What a marked diagram draws: `%% inwards: layers` or `%% inwards: contexts`. */
export type DiagramKind = "layers" | "contexts";

/** A node's text, from its shape (`id["text"]`) or from `@{ label: "text" }`. */
export interface NodeLabel {
  text: string;
  /** True when written in double quotes, which makes it a module prefix (ADR-045). */
  quoted: boolean;
}

/** One place a node is named in a diagram; a node named on three lines has three. */
export interface NodeMention {
  id: string;
  label?: NodeLabel;
  /** 1-based line in the file, and the columns of the id on it. */
  line: number;
  column: number;
  endColumn: number;
  /** The `:::class` names written on this mention. */
  classes: string[];
  /** The innermost subgraph the mention sits in; absent at the top level. */
  subgraph?: string;
}

/** A `subgraph id [title]` line. */
export interface SubgraphMention {
  id: string;
  label?: NodeLabel;
  line: number;
  column: number;
  endColumn: number;
  /** The subgraph it is nested in; absent at the top level. */
  parent?: string;
}

/** One link between two nodes (or subgraphs); a chain or `&` gives several. */
export interface DiagramEdge {
  from: string;
  to: string;
  line: number;
  /** The link as written, e.g. `-->`, `-.->` or `---o`. */
  link: string;
  /** True for a solid or thick arrow that points one way only: "may import" (ADR-045). */
  mayImport: boolean;
}

/** One marked diagram: a fenced block in Markdown or a whole `.mmd` file. */
export interface Diagram {
  kind: DiagramKind;
  /** The file it is in, as the report shows it. */
  path: string;
  /** 1-based line of the `%% inwards:` marker. */
  markerLine: number;
  nodes: NodeMention[];
  subgraphs: SubgraphMention[];
  edges: DiagramEdge[];
  /** Classes given by `class a,b name` statements, by node or subgraph id. */
  classes: ReadonlyMap<string, readonly string[]>;
}
