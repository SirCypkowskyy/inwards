/**
 * @file Finds the marked Mermaid diagrams in a file: each fenced `mermaid`
 * block of a Markdown file, or the whole of a `.mmd` file, that is a
 * `flowchart` or `graph` and carries `%% inwards: layers` or
 * `%% inwards: contexts` among its opening comment lines (ADR-045). It keeps
 * each body line's number in the file, so findings land on the diagram's own
 * line. No I/O and no Mermaid parsing; `mermaid.ts` reads the body.
 */
import type { DiagramSource } from "../contracts/records.ts";
import type { DiagramKind } from "./model.ts";

/** A marked flowchart: its kind and its body, the lines after the header. */
export interface MarkedBlock {
  kind: DiagramKind;
  /** 1-based line of the marker. */
  markerLine: number;
  /** 1-based line of `lines[0]`. */
  firstLine: number;
  lines: string[];
}

/** A line break, either kind. */
const NEWLINE = /\r?\n/u;
/** A whole-file Mermaid diagram, by extension. */
const MERMAID_FILE = /\.(?:mmd|mermaid)$/iu;
/** The opening fence of a `mermaid` block: up to three spaces, three or more backticks or tildes. */
const OPEN_FENCE = /^ {0,3}(?<fence>`{3,}|~{3,})[ \t]*mermaid(?:[ \t].*)?$/u;
/** A closing fence, checked against the opening one's character and length. */
const CLOSE_FENCE = /^ {0,3}(?<fence>`{3,}|~{3,})[ \t]*$/u;
/** The marker comment. */
const MARKER = /^%%[ \t]*inwards:[ \t]*(?<kind>layers|contexts)[ \t]*$/u;
/** The header of a flowchart: `flowchart LR`, `graph TD`, or the keyword alone. */
const HEADER = /^(?:flowchart|graph)(?:[ \t].*)?$/u;
/** A YAML front matter delimiter at the top of a diagram. */
const FRONT_MATTER = "---";

/**
 * Lists the marked flowcharts in a file. A `.mmd` or `.mermaid` file is one
 * diagram; any other file is read as Markdown, and each fenced block whose
 * info string is `mermaid` is one. Unmarked diagrams and other diagram types
 * are left out: they are ordinary docs.
 *
 * @param source - the file's path and text.
 * @returns the marked blocks, in file order.
 */
export function markedBlocks(source: DiagramSource): MarkedBlock[] {
  const lines = source.text.split(NEWLINE);
  const bodies = MERMAID_FILE.test(source.path)
    ? [{ start: 0, end: lines.length }]
    : fencedBodies(lines);
  return bodies.flatMap(({ start, end }) => {
    const block = marked(lines, start, end);
    return block === undefined ? [] : [block];
  });
}

/**
 * Finds the bodies of the fenced `mermaid` blocks in Markdown lines. A block
 * left open runs to the end of the file, as CommonMark reads it.
 *
 * @param lines - the file's lines.
 * @returns each body as a half-open range of 0-based line indexes.
 */
function fencedBodies(lines: readonly string[]): { start: number; end: number }[] {
  const bodies: { start: number; end: number }[] = [];
  let i = 0;
  while (i < lines.length) {
    const fence = OPEN_FENCE.exec(lines[i] ?? "")?.groups?.["fence"];
    i += 1;
    if (fence === undefined) {
      continue;
    }
    const start = i;
    while (i < lines.length && !closes(lines[i] ?? "", fence)) {
      i += 1;
    }
    bodies.push({ start, end: i });
    i += 1;
  }
  return bodies;
}

/**
 * Tells whether a line closes a fence: the same character, at least as long.
 *
 * @param line - a Markdown line.
 * @param fence - the opening fence, e.g. three backticks.
 * @returns true when the line ends the block.
 */
function closes(line: string, fence: string): boolean {
  const found = CLOSE_FENCE.exec(line)?.groups?.["fence"];
  return found !== undefined && found[0] === fence[0] && found.length >= fence.length;
}

/**
 * Reads a diagram's opening lines: front matter, then blank and `%%` comment
 * lines around the `flowchart` or `graph` header. The marker counts anywhere
 * in that run, before or right after the header, never later in the body.
 *
 * @param lines - the file's lines.
 * @param start - the diagram's first line index.
 * @param end - the index after its last line.
 * @returns the block when it is a marked flowchart, else undefined.
 */
function marked(lines: readonly string[], start: number, end: number): MarkedBlock | undefined {
  let i = skipFrontMatter(lines, start, end);
  let kind: DiagramKind | undefined;
  let markerLine = 0;
  let header: number | undefined;
  for (; i < end; i += 1) {
    const line = (lines[i] ?? "").trim();
    const mark = MARKER.exec(line)?.groups?.["kind"];
    if (mark === "layers" || mark === "contexts") {
      kind = mark;
      markerLine = i + 1;
    } else if (header === undefined && HEADER.test(line)) {
      header = i;
    } else if (line !== "" && !line.startsWith("%%")) {
      break;
    }
  }
  if (kind === undefined || header === undefined) {
    return undefined;
  }
  return { kind, markerLine, firstLine: header + 2, lines: lines.slice(header + 1, end) };
}

/**
 * Skips a YAML front matter block (`---` to `---`) at the top of a diagram.
 *
 * @param lines - the file's lines.
 * @param start - the diagram's first line index.
 * @param end - the index after its last line.
 * @returns the index of the first line after the front matter, or `start` when there is none.
 */
function skipFrontMatter(lines: readonly string[], start: number, end: number): number {
  if ((lines[start] ?? "").trim() !== FRONT_MATTER) {
    return start;
  }
  for (let i = start + 1; i < end; i += 1) {
    if ((lines[i] ?? "").trim() === FRONT_MATTER) {
      return i + 1;
    }
  }
  return start;
}
