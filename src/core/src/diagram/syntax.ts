/**
 * @file The pieces of a Mermaid flowchart statement (ADR-045): node ids,
 * bracket and `@{ }` shapes with their labels, `:::class`, `&` groups, and
 * links of every kind with their text and edge ids. `mermaid.ts` reads
 * statements with them. Pure string reading over a cursor; syntax per
 * https://mermaid.js.org/syntax/flowchart.html.
 */
import type { DiagramEdge, NodeLabel } from "./model.ts";

/** A node or subgraph id: letters, digits and `_`, with single inner hyphens (`order-api`). */
export const ID: RegExp = /^[\p{L}\p{N}_]+(?:-[\p{L}\p{N}_]+)*/u;
/** `:::name` after a node. */
const CLASS_SUFFIX = /^:::(?<name>[\p{L}\p{N}_-]+)/u;
/** A link written in one piece: `-->`, `---`, `-.->`, `==>`, `~~~`, `<-->`, `--o`, `x--x`. */
const LINK = /^(?<left>[<ox])?(?<body>-{2,}|={2,}|-\.+-|~{3,})(?<right>[>ox])?/u;
/** The first half of a link with text in the middle: `-- text -->`, `== text ==>`, `-. text .->`. */
const LINK_OPEN = /^(?<left>[<ox])?(?<body>--|==|-\.)(?=\s)/u;
/** The second half of each kind of link with text, by its first half. */
const LINK_CLOSE: Readonly<Record<string, RegExp>> = {
  "--": /-{2,}[>ox]|-{3,}/u,
  "==": /[=]{2,}[>ox]|={3,}/u,
  "-.": /\.+-[>ox]?/u,
};
/** Link text after the link: `-->|text|`. */
const PIPE_TEXT = /^\s*\|[^|]*\|/u;
/** An edge id before a link: `e1@-->`. */
const EDGE_ID = /^[\p{L}\p{N}_]+@(?=[-=~<ox])/u;
/** `&` between nodes. */
const AMPERSAND = /^\s*&\s*/u;
/** A label inside `@{ ... }`. */
const SHAPE_LABEL = /\blabel\s*:\s*(?:"(?<quoted>[^"]*)"|(?<plain>[^,}]*))/u;
/** Node shapes, longest opener first, with the closers each may end with. */
const SHAPES: readonly (readonly [string, readonly string[]])[] = [
  ["(((", [")))"]],
  ["([", ["])"]],
  ["[[", ["]]"]],
  ["[(", [")]"]],
  ["((", ["))"]],
  ["{{", ["}}"]],
  ["[/", ["/]", "\\]"]],
  ["[\\", ["\\]", "/]"]],
  ["(", [")"]],
  ["[", ["]"]],
  ["{", ["}"]],
  [">", ["]"]],
];

/** A string being read from left to right, with the column its first character has. */
export interface Cursor {
  text: string;
  pos: number;
  /** 1-based column of `text[0]` on its line. */
  column: number;
}

/** A node as a statement names it, before the line and subgraph are known. */
export interface Named {
  id: string;
  label?: NodeLabel;
  column: number;
  endColumn: number;
  classes: string[];
}

/**
 * Reads nodes joined by `&`.
 *
 * @param cursor - the statement, at the first node.
 * @returns the nodes; empty when no node starts here.
 */
export function readGroup(cursor: Cursor): Named[] {
  const group: Named[] = [];
  for (;;) {
    skipSpace(cursor);
    const node = readNode(cursor);
    if (node === undefined) {
      return group;
    }
    group.push(node);
    const amp = AMPERSAND.exec(cursor.text.slice(cursor.pos));
    if (amp === null) {
      return group;
    }
    cursor.pos += amp[0].length;
  }
}

/**
 * Reads one node: its id, then a shape or `@{ ... }`, then `:::class`.
 *
 * @param cursor - the statement, at the id.
 * @returns the node, or undefined when no id starts here.
 */
function readNode(cursor: Cursor): Named | undefined {
  const rest = cursor.text.slice(cursor.pos);
  const id = ID.exec(rest)?.[0];
  if (id === undefined) {
    return undefined;
  }
  const column = cursor.column + cursor.pos;
  cursor.pos += id.length;
  const label = cursor.text.startsWith("@{", cursor.pos) ? readAtShape(cursor) : readShape(cursor);
  const classes: string[] = [];
  for (;;) {
    const cls = CLASS_SUFFIX.exec(cursor.text.slice(cursor.pos));
    if (cls === null) {
      break;
    }
    classes.push(cls.groups?.["name"] ?? "");
    cursor.pos += cls[0].length;
  }
  return { id, column, endColumn: column + id.length, classes, ...(label ? { label } : {}) };
}

/**
 * Reads a bracket shape such as `["text"]`, `(text)` or `[(text)]`, if one
 * starts here. Text in double quotes is quoted (a module prefix); text in
 * backticks inside the quotes is a Markdown string, and so not quoted.
 *
 * @param cursor - the statement, right after the id.
 * @returns the label, or undefined when no shape starts here or it never closes.
 */
export function readShape(cursor: Cursor): NodeLabel | undefined {
  const rest = cursor.text.slice(cursor.pos);
  const shape = SHAPES.find(([start]) => rest.startsWith(start));
  if (shape === undefined) {
    return undefined;
  }
  const [opener, closers] = shape;
  let from = opener.length;
  let quotedText: string | undefined;
  if (rest[from] === '"') {
    const endQuote = rest.indexOf('"', from + 1);
    if (endQuote === -1) {
      return undefined;
    }
    quotedText = rest.slice(from + 1, endQuote);
    from = endQuote + 1;
  }
  let close: { closer: string; at: number } | undefined;
  for (const closer of closers) {
    const at = rest.indexOf(closer, from);
    if (at !== -1 && (close === undefined || at < close.at)) {
      close = { closer, at };
    }
  }
  if (close === undefined) {
    return undefined;
  }
  cursor.pos += close.at + close.closer.length;
  if (quotedText !== undefined && rest.slice(from, close.at).trim() === "") {
    return { text: quotedText, quoted: !quotedText.startsWith("`") };
  }
  return { text: rest.slice(opener.length, close.at).trim(), quoted: false };
}

/**
 * Reads the `@{ shape: ..., label: "..." }` form of a node.
 *
 * @param cursor - the statement, at `@{`.
 * @returns its label, or undefined when it has none or never closes.
 */
function readAtShape(cursor: Cursor): NodeLabel | undefined {
  const end = cursor.text.indexOf("}", cursor.pos);
  if (end === -1) {
    return undefined;
  }
  const body = cursor.text.slice(cursor.pos + 2, end);
  cursor.pos = end + 1;
  const groups = SHAPE_LABEL.exec(body)?.groups;
  const quoted = groups?.["quoted"];
  if (quoted !== undefined) {
    return { text: quoted, quoted: !quoted.startsWith("`") };
  }
  const plain = groups?.["plain"]?.trim();
  return plain === undefined || plain === "" ? undefined : { text: plain, quoted: false };
}

/**
 * Reads a link, with an edge id before it and text in it or after it.
 *
 * @param cursor - the statement, after a group of nodes.
 * @returns the link as written and whether it means "may import", or undefined when none starts here.
 */
export function readLink(cursor: Cursor): Pick<DiagramEdge, "link" | "mayImport"> | undefined {
  skipSpace(cursor);
  const edgeId = EDGE_ID.exec(cursor.text.slice(cursor.pos));
  const start = cursor.pos + (edgeId?.[0].length ?? 0);
  const found = linkAt(cursor.text.slice(start));
  if (found === undefined) {
    return undefined;
  }
  cursor.pos = start + found.link.length;
  const pipe = PIPE_TEXT.exec(cursor.text.slice(cursor.pos));
  cursor.pos += pipe?.[0].length ?? 0;
  const { link, left, right } = found;
  const solid = !(link.includes(".") || link.includes("~"));
  return { link, mayImport: solid && right === ">" && left === undefined };
}

/**
 * Matches the link a text starts with: in one piece, or in two halves around
 * its text.
 *
 * @param rest - the statement from where the link should start.
 * @returns the link as written and its two heads, or undefined when none starts here.
 */
function linkAt(rest: string): { link: string; left?: string; right?: string } | undefined {
  const whole = LINK.exec(rest);
  const open = LINK_OPEN.exec(rest);
  if (open !== null && (whole === null || whole[0] === open[0])) {
    const [first] = open;
    const close = LINK_CLOSE[open.groups?.["body"] ?? ""]?.exec(rest.slice(first.length));
    if (close === null || close === undefined) {
      return undefined;
    }
    const [second] = close;
    return heads(rest.slice(0, first.length + close.index + second.length), {
      left: open.groups?.["left"],
      right: second.at(-1),
    });
  }
  return whole === null
    ? undefined
    : heads(whole[0], { left: whole.groups?.["left"], right: whole.groups?.["right"] });
}

/**
 * Builds a link record, leaving out the heads it doesn't have.
 *
 * @param link - the link as written.
 * @param ends - its heads.
 * @param ends.left - the head on the left (`<`, `o` or `x`), if any.
 * @param ends.right - the head on the right (`>`, `o` or `x`), if any.
 * @returns the record.
 */
function heads(
  link: string,
  { left, right }: { left: string | undefined; right: string | undefined },
): { link: string; left?: string; right?: string } {
  return {
    link,
    ...(left === undefined ? {} : { left }),
    ...(right === undefined ? {} : { right }),
  };
}

/**
 * Moves a cursor past spaces and tabs.
 *
 * @param cursor - the cursor; updated in place.
 */
export function skipSpace(cursor: Cursor): void {
  while (cursor.text[cursor.pos] === " " || cursor.text[cursor.pos] === "\t") {
    cursor.pos += 1;
  }
}
