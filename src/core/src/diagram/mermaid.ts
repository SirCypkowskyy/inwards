/**
 * @file A hand-written reader for the flowchart subset of Mermaid that marked
 * diagrams use (ADR-045): node ids with any shape (`[ ]`, `( )`, `{ }`,
 * `[( )]`, `>  ]` and the rest, or `@{ label: ... }`), quoted labels,
 * `:::class`, links of every kind with their text, chains and `&`,
 * subgraphs, `class` statements, and `%%` comments. It records what is named
 * where and which links are solid arrows; it doesn't render, and it skips
 * what it can't read rather than fail, so a statement outside the subset
 * gives no finding. Mermaid's own parser needs a DOM and jison; this one is
 * pure and reads one line at a time. Syntax per
 * https://mermaid.js.org/syntax/flowchart.html.
 */
import type { MarkedBlock } from "./blocks.ts";
import type { Diagram, DiagramEdge, NodeLabel, NodeMention, SubgraphMention } from "./model.ts";
import {
  type Cursor,
  ID,
  type Named,
  readGroup,
  readLink,
  readShape,
  skipSpace,
} from "./syntax.ts";

/** The word a statement starts with. */
const KEYWORD = /^[A-Za-z]+/u;
/** A space or tab first. */
const SPACE = /^\s/u;
/** A run of whitespace. */
const SPACES = /\s+/u;
/** Statements that name no node in a link: styling and interaction (`accTitle` and `accDescr` too). */
const SKIPPED = new Set(["direction", "classDef", "style", "linkStyle", "click"]);

/** What the reader has collected so far, and where it is. */
interface State {
  nodes: NodeMention[];
  subgraphs: SubgraphMention[];
  edges: DiagramEdge[];
  classes: Map<string, string[]>;
  /** Open subgraphs, innermost last. */
  open: string[];
  /** True inside a multi-line `accDescr { ... }`. */
  inDescription: boolean;
}

/**
 * Reads a marked block's body into a diagram.
 *
 * @param block - the marked block, with its body lines and their line numbers.
 * @param path - the file, as the report shows it.
 * @returns every node and subgraph mention, every link, and the `class` statements.
 */
export function readFlowchart(block: MarkedBlock, path: string): Diagram {
  const state: State = {
    nodes: [],
    subgraphs: [],
    edges: [],
    classes: new Map(),
    open: [],
    inDescription: false,
  };
  block.lines.forEach((text, i) => {
    readLine(state, text, block.firstLine + i);
  });
  return {
    kind: block.kind,
    path,
    markerLine: block.markerLine,
    nodes: state.nodes,
    subgraphs: state.subgraphs,
    edges: state.edges,
    classes: state.classes,
  };
}

/**
 * Reads one body line: a comment, the inside of an `accDescr { }` block, or
 * statements separated by `;`.
 *
 * @param state - what has been read so far; updated in place.
 * @param text - the line as written, indentation included.
 * @param line - its 1-based number in the file.
 */
function readLine(state: State, text: string, line: number): void {
  const trimmed = text.trim();
  if (state.inDescription) {
    state.inDescription = !trimmed.includes("}");
    return;
  }
  if (trimmed.startsWith("%%")) {
    return;
  }
  for (const statement of statements(text)) {
    readStatement(state, statement, line);
  }
}

/**
 * Splits a line at `;` outside double quotes, and drops a trailing `%%` comment.
 *
 * @param text - the line as written, indentation included.
 * @returns each statement with the column of its first character.
 */
function statements(text: string): Cursor[] {
  const found: Cursor[] = [];
  let quoted = false;
  let start = 0;
  for (let i = 0; i <= text.length; i += 1) {
    const c = text[i];
    if (c === '"') {
      quoted = !quoted;
    }
    const comment = !quoted && c === "%" && text[i + 1] === "%";
    if (i === text.length || (!quoted && c === ";") || comment) {
      found.push({ text: text.slice(start, i), pos: 0, column: start + 1 });
      start = i + 1;
      if (comment) {
        break;
      }
    }
  }
  return found;
}

/**
 * Reads one statement: `subgraph`, `end`, `class`, a skipped keyword, or a
 * chain of nodes and links.
 *
 * @param state - what has been read so far; updated in place.
 * @param statement - one statement of a line, with its column.
 * @param line - its 1-based line in the file.
 */
function readStatement(state: State, statement: Cursor, line: number): void {
  skipSpace(statement);
  const rest = statement.text.slice(statement.pos);
  const keyword = KEYWORD.exec(rest)?.[0] ?? "";
  const bare = rest.length === keyword.length || SPACE.test(rest.slice(keyword.length));
  if (keyword === "end" && rest.trim() === "end") {
    state.open.pop();
  } else if (keyword === "subgraph" && bare) {
    statement.pos += keyword.length;
    readSubgraph(state, statement, line);
  } else if (keyword === "class" && bare) {
    readClassStatement(state, rest.slice(keyword.length));
  } else if (keyword === "accDescr" && rest.trimEnd().endsWith("{")) {
    state.inDescription = true;
  } else if (!((SKIPPED.has(keyword) && bare) || keyword.startsWith("acc"))) {
    readChain(state, statement, line);
  }
}

/**
 * Reads `subgraph id`, `subgraph id [title]`, `subgraph id["title"]` or
 * `subgraph title words`, whose id is then the title.
 *
 * @param state - what has been read so far; updated in place.
 * @param cursor - the statement, just after `subgraph`.
 * @param line - its 1-based line in the file.
 */
function readSubgraph(state: State, cursor: Cursor, line: number): void {
  skipSpace(cursor);
  const column = cursor.column + cursor.pos;
  const rest = cursor.text.slice(cursor.pos).trimEnd();
  const id = ID.exec(rest)?.[0];
  let named: { id: string; label?: NodeLabel } = { id: unquote(rest) };
  if (id !== undefined) {
    const after = { text: rest, pos: id.length, column };
    skipSpace(after);
    const label = readShape(after);
    if (after.pos === rest.length) {
      named = label === undefined ? { id } : { id, label };
    }
  }
  const parent = state.open.at(-1);
  state.subgraphs.push({
    ...named,
    line,
    column,
    endColumn: column + (id ?? rest).length,
    ...(parent === undefined ? {} : { parent }),
  });
  state.open.push(named.id);
}

/**
 * Reads `class a,b name`: every listed node or subgraph gets the class.
 *
 * @param state - what has been read so far; updated in place.
 * @param rest - the statement after `class`.
 */
function readClassStatement(state: State, rest: string): void {
  const [ids, name] = rest.trim().split(SPACES);
  if (ids === undefined || name === undefined) {
    return;
  }
  for (const id of ids.split(",")) {
    state.classes.set(id, [...(state.classes.get(id) ?? []), name]);
  }
}

/**
 * Reads a chain: a group of nodes, then any number of links each followed by
 * a group. Every node of a group links to every node of the next one. Reading
 * stops at the first thing it can't read; what came before still counts.
 *
 * @param state - what has been read so far; updated in place.
 * @param cursor - the statement.
 * @param line - its 1-based line in the file.
 */
function readChain(state: State, cursor: Cursor, line: number): void {
  let group = readGroup(cursor);
  record(state, group, line);
  while (group.length > 0) {
    const link = readLink(cursor);
    if (link === undefined) {
      return;
    }
    const next = readGroup(cursor);
    record(state, next, line);
    for (const from of group) {
      for (const to of next) {
        state.edges.push({ from: from.id, to: to.id, line, ...link });
      }
    }
    group = next;
  }
}

/**
 * Records the nodes a statement named, with their line and subgraph.
 *
 * @param state - what has been read so far; updated in place.
 * @param named - the nodes.
 * @param line - their 1-based line in the file.
 */
function record(state: State, named: readonly Named[], line: number): void {
  const subgraph = state.open.at(-1);
  for (const node of named) {
    state.nodes.push({ ...node, line, ...(subgraph === undefined ? {} : { subgraph }) });
  }
}

/**
 * Takes the double quotes off a subgraph title written alone.
 *
 * @param text - `"Order handling"` or `Order handling`.
 * @returns the title without quotes.
 */
function unquote(text: string): string {
  return text.length >= 2 && text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1) : text;
}
