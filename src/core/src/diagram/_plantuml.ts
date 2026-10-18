/**
 * @file A hand-written reader for the subset of PlantUML component diagrams
 * that marked diagrams use (#346, ADR-045): components (`[x]`,
 * `component x`, `"text" as x`, `[text] as x`, and the other element
 * keywords), `<<stereotypes>>` as classes, packages and the other groups in
 * braces, and arrows between components with their direction, style and
 * label. It covers what ArchUnitPython's `generate_rule` reads (`component
 * [x]`, `[a] --> [b]`, `[a] -> [b]`) and more. Lines that name nothing are
 * `plantuml-skip.ts`'s; a statement the reader can't follow is skipped too,
 * which gives no finding rather than an error. Pure, one line at a time.
 * Syntax per https://plantuml.com/component-diagram.
 */
import type { MarkedBlock } from "./_blocks.ts";
import type { Diagram, DiagramEdge, NodeMention, SubgraphMention } from "./_model.ts";
import { KEYWORD, type SkipState, skipped } from "./_plantuml-skip.ts";
import { readArrowTo, readName, readRef, stereotypes } from "./_plantuml-syntax.ts";
import { type Cursor, skipSpace } from "./_syntax.ts";

/** A space or tab first. */
const SPACE = /^\s/u;
/** Keywords whose statement names a node, or a group when it ends with `{`. */
const ELEMENTS = new Set([
  "component",
  "package",
  "node",
  "folder",
  "frame",
  "cloud",
  "database",
  "rectangle",
  "queue",
  "storage",
  "artifact",
  "card",
  "file",
  "stack",
  "agent",
  "hexagon",
]);

/** What the reader has collected so far, and where it is. */
interface State extends SkipState {
  nodes: NodeMention[];
  subgraphs: SubgraphMention[];
  edges: DiagramEdge[];
  classes: Map<string, string[]>;
  /** Open groups, innermost last; undefined for one without a name (`cloud {`). */
  open: (string | undefined)[];
}

/**
 * Reads a marked PlantUML diagram's body into a diagram.
 *
 * @param block - the marked block, with its body lines and their line numbers.
 * @param path - the file, as the report shows it.
 * @returns every component and group mention, every arrow, and the groups' stereotypes.
 */
export function readPlantUml(block: MarkedBlock, path: string): Diagram {
  const state: State = {
    nodes: [],
    subgraphs: [],
    edges: [],
    classes: new Map(),
    open: [],
    skipDepth: 0,
    until: undefined,
  };
  for (const [i, text] of block.lines.entries()) {
    readStatement(state, text, block.firstLine + i);
  }
  const { nodes, subgraphs, edges, classes } = state;
  const { kind, markerLine } = block;
  return { kind, notation: "plantuml", path, markerLine, nodes, subgraphs, edges, classes };
}

/**
 * Reads one line, which holds at most one statement in PlantUML: skips what
 * names nothing, closes a group at `}`, then reads an element, a group or an
 * arrow.
 *
 * @param state - what has been read so far; updated in place.
 * @param text - the line as written, indentation included.
 * @param line - its 1-based number in the file.
 */
function readStatement(state: State, text: string, line: number): void {
  const trimmed = text.trim();
  if (skipped(state, trimmed)) {
    return;
  }
  if (trimmed.startsWith("}")) {
    state.open.pop();
    return;
  }
  const cursor: Cursor = { text, pos: 0, column: 1 };
  skipSpace(cursor);
  const keyword = KEYWORD.exec(trimmed)?.[0] ?? "";
  const bare = trimmed.length === keyword.length || SPACE.test(trimmed.slice(keyword.length));
  if (ELEMENTS.has(keyword) && bare) {
    cursor.pos += keyword.length;
    readElement(state, cursor, line);
  } else if (keyword === "together" && trimmed.endsWith("{")) {
    state.open.push(undefined);
  } else if (!readArrow(state, { ...cursor }, line) && trimmed.startsWith("[")) {
    readElement(state, cursor, line);
  }
}

/**
 * Reads an element or a group: its name, then stereotypes, a color and, for
 * a group, `{`. A group without a name (`cloud {`) only nests.
 *
 * @param state - what has been read so far; updated in place.
 * @param cursor - the statement, after its keyword.
 * @param line - its 1-based line in the file.
 */
function readElement(state: State, cursor: Cursor, line: number): void {
  skipSpace(cursor);
  const group = cursor.text.trimEnd().endsWith("{");
  const named = readName(cursor);
  if (named === undefined) {
    if (group && cursor.text[cursor.pos] === "{") {
      state.open.push(undefined);
    }
    return;
  }
  const { id, label } = named;
  const classes = stereotypes(cursor.text.slice(cursor.pos));
  const enclosing = innermost(state);
  const mention = {
    id: id.text,
    line,
    column: id.column,
    endColumn: id.endColumn,
    ...(label === undefined ? {} : { label }),
  };
  if (!group) {
    state.nodes.push({
      ...mention,
      classes,
      ...(enclosing === undefined ? {} : { subgraph: enclosing }),
    });
    return;
  }
  state.subgraphs.push({ ...mention, ...(enclosing === undefined ? {} : { parent: enclosing }) });
  if (classes.length > 0) {
    state.classes.set(id.text, [...(state.classes.get(id.text) ?? []), ...classes]);
  }
  state.open.push(id.text);
}

/**
 * Reads `from arrow to`, with anything after it (`: label`) ignored, and
 * records both ends as nodes.
 *
 * @param state - what has been read so far; updated in place.
 * @param cursor - the statement.
 * @param line - its 1-based line in the file.
 * @returns true when the statement was an arrow.
 */
function readArrow(state: State, cursor: Cursor, line: number): boolean {
  const from = readRef(cursor, false);
  const arrow = from === undefined ? undefined : readArrowTo(cursor, from.text);
  if (from === undefined || arrow === undefined) {
    return false;
  }
  const subgraph = innermost(state);
  for (const end of [from, arrow.to]) {
    state.nodes.push({
      id: end.text,
      line,
      column: end.column,
      endColumn: end.endColumn,
      classes: [],
      ...(subgraph === undefined ? {} : { subgraph }),
    });
  }
  state.edges.push({ ...arrow.edge, line });
  return true;
}

/**
 * Finds the innermost open group that has a name.
 *
 * @param state - the open groups.
 * @returns its id, or undefined at the top level.
 */
function innermost(state: State): string | undefined {
  for (let i = state.open.length - 1; i >= 0; i -= 1) {
    const id = state.open[i];
    if (id !== undefined) {
      return id;
    }
  }
  return undefined;
}
