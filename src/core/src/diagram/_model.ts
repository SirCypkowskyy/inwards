/**
 * @file What the diagram readers give the diagram rules: a marked diagram with
 * its kind, every place a node or subgraph is named, and the edges between
 * them, each on the line of the file it came from (ADR-045). Mermaid and
 * PlantUML diagrams read into the same records. Types only; the reading is in
 * `blocks.ts` and `mermaid.ts` for Mermaid, `plantuml-blocks.ts` and
 * `plantuml.ts` for PlantUML, and `read.ts` picks between them.
 */

/** What a marked diagram draws: `%% inwards: layers` or `%% inwards: contexts`. */
export type DiagramKind = "layers" | "contexts";

/** The language a diagram is written in, which the rules' hints follow. */
export type DiagramNotation = "mermaid" | "plantuml";

/** A node's text, from its shape (`id["text"]`) or from `@{ label: "text" }`. */
export interface NodeLabel {
  text: string;
  /** True when written in double quotes, which makes it a module prefix (ADR-045). */
  quoted: boolean;
}

/**
 * One place a node is named in a diagram; a node named on three lines has
 * three. In PlantUML a node is a component and a subgraph is a package (or
 * another group in braces); the `<<stereotypes>>` are its classes.
 */
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
  /**
   * The link as written, e.g. `-->`, `-.->` or `---o`; a PlantUML arrow
   * written right to left (`b <-- a`) is turned around (`-->`) to match `from`
   * and `to`.
   */
  link: string;
  /** True for a solid or thick arrow that points one way only: "may import" (ADR-045). */
  mayImport: boolean;
}

/**
 * One marked diagram: a fenced block in Markdown, a whole `.mmd` file, or one
 * `@startuml` ... `@enduml` of a `.puml` file.
 */
export interface Diagram {
  kind: DiagramKind;
  /** Mermaid or PlantUML. */
  notation: DiagramNotation;
  /** The file it is in, as the report shows it. */
  path: string;
  /** 1-based line of the `%% inwards:` (or `' inwards:`) marker. */
  markerLine: number;
  nodes: NodeMention[];
  subgraphs: SubgraphMention[];
  edges: DiagramEdge[];
  /**
   * Classes given by `class a,b name` statements (Mermaid) or by a package's
   * `<<stereotype>>` (PlantUML), by node or subgraph id.
   */
  classes: ReadonlyMap<string, readonly string[]>;
}
