/**
 * @file Finds the marked PlantUML diagrams in a file (#346, ADR-045): each
 * `@startuml` ... `@enduml` of a `.puml`, `.plantuml`, `.pu` or `.iuml` file
 * or of a fenced `plantuml` or `puml` block in Markdown, that carries
 * `' inwards: layers` or `' inwards: contexts` among its opening comment
 * lines. A fenced block without `@startuml` is one diagram, as GitLab and
 * the Markdown plugins render it. Line numbers are the file's, so findings
 * land on the diagram's own line. No I/O and no PlantUML parsing;
 * `plantuml.ts` reads the body.
 */
import type { DiagramSource } from "../contracts/records.ts";
import { fencedBodies, type MarkedBlock } from "./blocks.ts";

/** A line break, either kind. */
const NEWLINE = /\r?\n/u;
/** A whole-file PlantUML diagram, by extension. */
const PLANTUML_FILE = /\.(?:puml|plantuml|pu|iuml)$/iu;
/** The info strings of a PlantUML block in Markdown. */
const PLANTUML_INFO = new Set(["plantuml", "puml"]);
/** The line that opens a diagram, with or without a name after it. */
const START = /^@startuml(?:\b.*)?$/u;
/** The line that closes one. */
const END = /^@enduml\b/u;
/** The marker comment. */
const MARKER = /^'[ \t]*inwards:[ \t]*(?<kind>layers|contexts)[ \t]*$/u;

/** A run of lines: a half-open range of 0-based indexes. */
interface Range {
  start: number;
  end: number;
}

/**
 * Lists the marked PlantUML diagrams in a file. A PlantUML file is read
 * whole; any other file is read as Markdown, and each fenced `plantuml` or
 * `puml` block is read. Unmarked diagrams are left out: they are ordinary
 * docs.
 *
 * @param source - the file's path and text.
 * @returns the marked diagrams, in file order; `lines` starts right after `@startuml`.
 */
export function markedPlantUml(source: DiagramSource): MarkedBlock[] {
  const lines = source.text.split(NEWLINE);
  const bodies = PLANTUML_FILE.test(source.path)
    ? [{ start: 0, end: lines.length }]
    : fencedBodies(lines, PLANTUML_INFO);
  return bodies
    .flatMap((body) => diagrams(lines, body))
    .flatMap((range) => {
      const block = marked(lines, range);
      return block === undefined ? [] : [block];
    });
}

/**
 * Splits a file or block into its diagrams: each `@startuml` to the next
 * `@enduml` (or the end), or the whole of it when it has no `@startuml`.
 *
 * @param lines - the file's lines.
 * @param body - the file or block.
 * @returns the body of each diagram, without the `@startuml` and `@enduml` lines.
 */
function diagrams(lines: readonly string[], body: Range): Range[] {
  const found: Range[] = [];
  let i = body.start;
  while (i < body.end) {
    if (!START.test((lines[i] ?? "").trim())) {
      i += 1;
      continue;
    }
    const start = i + 1;
    i = start;
    while (i < body.end && !END.test((lines[i] ?? "").trim())) {
      i += 1;
    }
    found.push({ start, end: i });
    i += 1;
  }
  return found.length === 0 ? [body] : found;
}

/**
 * Reads a diagram's opening lines, blank lines and `'` comments, for the
 * marker. A marker after the first statement doesn't count.
 *
 * @param lines - the file's lines.
 * @param range - the diagram's body.
 * @returns the block when it is marked, else undefined.
 */
function marked(lines: readonly string[], range: Range): MarkedBlock | undefined {
  for (let i = range.start; i < range.end; i += 1) {
    const line = (lines[i] ?? "").trim();
    const kind = MARKER.exec(line)?.groups?.["kind"];
    if (kind === "layers" || kind === "contexts") {
      return {
        kind,
        markerLine: i + 1,
        firstLine: range.start + 1,
        lines: lines.slice(range.start, range.end),
      };
    }
    if (line !== "" && !line.startsWith("'")) {
      return undefined;
    }
  }
  return undefined;
}
