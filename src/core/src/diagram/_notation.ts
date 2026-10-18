/**
 * @file How a fix hint writes a piece of diagram in the notation the diagram
 * uses (#346): a node marked external, a solid and a dotted arrow, a node or
 * group that names its module, and what a group is called. INW017, INW018,
 * INW019 and `import-diagram` take their examples from here, so a PlantUML
 * user is never told to write Mermaid. Pure strings; no reading.
 */
import type { DiagramNotation } from "./_model.ts";

/** The pieces of diagram syntax a hint may show. */
export interface Notation {
  /** What a group is called: `subgraph` or `package`. */
  group: string;
  /** How a node is marked external, written alone: `:::external` or `<<external>>`. */
  externalClass: string;
  /** A dotted arrow, which means no import. */
  dotted: string;
  /**
   * Writes a solid arrow between two nodes, which means "may import".
   *
   * @param from - the importing node's id.
   * @param to - the imported node's id.
   * @returns such as `api --> domain`.
   */
  arrow: (from: string, to: string) => string;
  /** How a node gets its module, in words: "a quoted label". */
  moduleLabel: string;
  /** How a label becomes a caption that isn't checked. */
  caption: string;
  /**
   * Writes a node marked external.
   *
   * @param id - the node's id.
   * @returns such as `db:::external`.
   */
  external: (id: string) => string;
  /**
   * Writes a node that names its module.
   *
   * @param id - the node's id, the layer or context it names.
   * @param module - the module prefix it stands for.
   * @returns such as `api["shop.api"]`.
   */
  node: (id: string, module: string) => string;
  /**
   * Writes the opening of a group that names its module.
   *
   * @param id - the group's id, the context it names.
   * @param module - the context's module prefix.
   * @returns such as `subgraph sales["shop.sales"]`.
   */
  groupNode: (id: string, module: string) => string;
}

/** Mermaid flowchart syntax. */
const MERMAID: Notation = {
  group: "subgraph",
  externalClass: ":::external",
  dotted: "-.->",
  arrow: (from: string, to: string): string => `${from} --> ${to}`,
  moduleLabel: "a quoted label",
  caption: "drop the quotes to make the label a caption",
  external: (id: string): string => `${id}:::external`,
  node: (id: string, module: string): string => `${id}["${module}"]`,
  groupNode: (id: string, module: string): string => `subgraph ${id}["${module}"]`,
};

/** PlantUML component syntax. */
const PLANTUML: Notation = {
  group: "package",
  externalClass: "<<external>>",
  dotted: "..>",
  arrow: (from: string, to: string): string => `[${from}] --> [${to}]`,
  moduleLabel: "a module and an alias",
  caption: "write a caption with a space in it instead",
  external: (id: string): string => `[${id}] <<external>>`,
  node: (id: string, module: string): string => `[${module}] as ${id}`,
  groupNode: (id: string, module: string): string => `package "${module}" as ${id} {`,
};

/**
 * Picks the syntax a hint for a diagram should use.
 *
 * @param notation - the diagram's notation.
 * @returns its pieces of syntax.
 */
export function notationOf(notation: DiagramNotation): Notation {
  return notation === "plantuml" ? PLANTUML : MERMAID;
}
