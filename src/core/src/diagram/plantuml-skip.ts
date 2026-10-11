/**
 * @file Which lines of a PlantUML diagram name nothing (#346): comments
 * (`'` and `/' ... '/`), preprocessor lines (`!include`), styling
 * (`skinparam`, `<style>`, `hide`), layout (`left to right direction`),
 * titles, notes, legends and interfaces. It keeps track of the statements
 * that run over several lines, so `plantuml.ts` sees only the lines that may
 * name a component, a group or an arrow. Pure string reading.
 */

/** The word a statement starts with. */
export const KEYWORD: RegExp = /^[A-Za-z]+/u;
/** The end of a block comment. */
const COMMENT_END = /'\//u;
/** The end of a `<style>` block. */
const STYLE_END = /<\/style>/u;
/** Keywords whose statement is one line and names nothing. */
const SKIPPED = new Set([
  "skinparam",
  "hide",
  "show",
  "remove",
  "left",
  "top",
  "title",
  "scale",
  "caption",
  "allowmixing",
  "sprite",
  "interface",
  "set",
  "header",
  "footer",
  "note",
]);
/** Statements that run over several lines, by keyword, with the line that ends them. */
const BLOCKS: Readonly<Record<string, RegExp>> = {
  note: /^end ?note$/u,
  legend: /^end ?legend$/u,
  header: /^end ?header$/u,
  footer: /^end ?footer$/u,
  title: /^end ?title$/u,
};

/** Where the reader is among the statements that run over several lines. */
export interface SkipState {
  /** How deep the reader is in braces that aren't a group (`skinparam x {`). */
  skipDepth: number;
  /** The line that ends a statement of several lines, while inside one. */
  until: RegExp | undefined;
}

/**
 * Tells whether a line names nothing, and keeps track of the statements that
 * run over several lines.
 *
 * @param state - where the reader is; updated in place.
 * @param trimmed - the line without its indentation.
 * @returns true when the line is to be skipped.
 */
export function skipped(state: SkipState, trimmed: string): boolean {
  if (state.until !== undefined) {
    if (state.until.test(trimmed)) {
      state.until = undefined;
    }
    return true;
  }
  if (state.skipDepth > 0) {
    state.skipDepth += braces(trimmed);
    return true;
  }
  if (trimmed === "" || trimmed.startsWith("'") || trimmed.startsWith("!")) {
    return true;
  }
  state.until = opened(trimmed);
  if (state.until !== undefined) {
    return true;
  }
  const keyword = KEYWORD.exec(trimmed)?.[0] ?? "";
  if (keyword === "skinparam" || keyword === "style") {
    state.skipDepth = Math.max(0, braces(trimmed));
    return true;
  }
  return SKIPPED.has(keyword) || trimmed.startsWith("/'") || trimmed.startsWith("(");
}

/**
 * Finds the line that ends the statement this line opens, when it runs over
 * several lines: a block comment or `<style>` not closed on the line, a note
 * without `:` text, or a legend, header, footer or title with nothing after
 * the keyword.
 *
 * @param trimmed - the line without its indentation.
 * @returns the pattern of the ending line, or undefined for a one-line statement.
 */
function opened(trimmed: string): RegExp | undefined {
  if (trimmed.startsWith("/'")) {
    return trimmed.includes("'/", 2) ? undefined : COMMENT_END;
  }
  if (trimmed.startsWith("<style>")) {
    return trimmed.includes("</style>") ? undefined : STYLE_END;
  }
  const keyword = KEYWORD.exec(trimmed)?.[0] ?? "";
  const end = BLOCKS[keyword];
  if (end === undefined) {
    return undefined;
  }
  const several =
    keyword === "note" ? !trimmed.includes(":") : keyword === "legend" || trimmed === keyword;
  return several ? end : undefined;
}

/**
 * Counts how many braces a line opens, less how many it closes.
 *
 * @param text - a line.
 * @returns the balance; 0 for `skinparam x { a b }` on one line.
 */
function braces(text: string): number {
  let depth = 0;
  for (const c of text) {
    if (c === "{") {
      depth += 1;
    } else if (c === "}") {
      depth -= 1;
    }
  }
  return depth;
}
