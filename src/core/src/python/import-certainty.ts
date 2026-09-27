/**
 * @file When the import skeleton is certain to match the full parse. The
 * prescan copies every line that starts like an import and blanks the rest,
 * so it can read an import where Python has none: a line inside a
 * multi-line string, or inside brackets a malformed file never closes. This
 * module scans the text once, tracking strings, comments and bracket depth,
 * and says whether any import-looking line starts outside a statement. When
 * none does, the skeleton's imports are the file's imports; otherwise only
 * the full parse can say. The scan stops after the last import-looking line:
 * nothing below it changes what the skeleton read.
 */

/** A line that starts like an import, as the prescan reads it. */
const STARTS_IMPORT = /^[ \t]*(?:import[ \t]|from[ \t][^#\n]*[ \t]import\b)/u;
/** What opens a nested expression. */
const OPENERS = "([{";
/** What closes one. */
const CLOSERS = ")]}";
/** The only characters that can change the scan's state; everything between them is skipped. */
const SIGNIFICANT = /["'#\\()[\]{}\n]/gu;
/** Quotes in a row that open a string which may span lines. */
const TRIPLE = 3;

/** Where the scan is: inside a string, and how deep in brackets. */
interface ScanState {
  /** The open string's quote (`'`, `"`, `'''` or `"""`), if any. */
  quote: string | undefined;
  depth: number;
}

/**
 * Tells whether the prescan's imports are exactly the file's imports: no
 * import-looking line up to the last one the skeleton read starts inside a
 * string, inside brackets or after a backslash continuation.
 *
 * @param text - the file's normalised text (lines end with `\n`).
 * @param lastLine - the 1-based line where the skeleton's last import ends; 0 for none.
 * @returns true when the skeleton can't have read an import that isn't one.
 */
export function skeletonIsCertain(text: string, lastLine: number): boolean {
  let stop = 0;
  for (let line = 0; line < lastLine && stop !== -1; line += 1) {
    stop = text.indexOf("\n", stop === 0 && line === 0 ? 0 : stop + 1);
  }
  const end = stop === -1 ? text.length : stop;
  const state: ScanState = { quote: undefined, depth: 0 };
  for (let i = 0; i < end; ) {
    SIGNIFICANT.lastIndex = i;
    const at = SIGNIFICANT.exec(text)?.index ?? end;
    if (at >= end) {
      break;
    }
    const next = step(text, at, state);
    if (next === undefined) {
      return false;
    }
    i = next;
  }
  return true;
}

/**
 * Takes one step of the scan from a position.
 *
 * @param text - the file's text.
 * @param i - where the step starts.
 * @param state - the open string and bracket depth, updated in place.
 * @returns where the next step starts, or undefined when the skeleton can't be trusted.
 */
function step(text: string, i: number, state: ScanState): number | undefined {
  if (state.quote !== undefined) {
    return inString(text, i, state);
  }
  const ch = text[i] ?? "";
  if (ch === "#") {
    const end = text.indexOf("\n", i);
    return end === -1 ? text.length : end;
  }
  if (ch === '"' || ch === "'") {
    const triple = ch.repeat(TRIPLE);
    state.quote = text.startsWith(triple, i) ? triple : ch;
    return i + state.quote.length;
  }
  if (ch === "\\") {
    // A continued line joins the next one to this statement: an import there isn't a statement.
    return text[i + 1] === "\n" && startsImport(text, i + 2) ? undefined : i + 2;
  }
  return inCode(text, i, state);
}

/**
 * Takes one step over code outside strings and comments: brackets change the
 * depth, and a line that starts inside brackets can't be an import.
 *
 * @param text - the file's text.
 * @param i - where the step starts.
 * @param state - the bracket depth, updated in place.
 * @returns where the next step starts, or undefined when the skeleton can't be trusted.
 */
function inCode(text: string, i: number, state: ScanState): number | undefined {
  const ch = text[i] ?? "";
  if (OPENERS.includes(ch)) {
    state.depth += 1;
  } else if (CLOSERS.includes(ch)) {
    state.depth -= 1;
    if (state.depth < 0) {
      return undefined; // more closers than openers: malformed
    }
  } else if (ch === "\n" && state.depth > 0 && startsImport(text, i + 1)) {
    return undefined;
  }
  return i + 1;
}

/**
 * Takes one step inside a string.
 *
 * @param text - the file's text.
 * @param i - a position inside the string.
 * @param state - the open string, closed in place when it ends.
 * @returns where the next step starts, or undefined when the skeleton can't be trusted.
 */
function inString(text: string, i: number, state: ScanState): number | undefined {
  const quote = state.quote ?? "";
  if (text.startsWith(quote, i)) {
    state.quote = undefined;
    return i + quote.length;
  }
  const ch = text[i];
  if (ch === "\\") {
    // A backslash before a newline carries the string onto the next line.
    return text[i + 1] === "\n" && startsImport(text, i + 2) ? undefined : i + 2;
  }
  if (ch === "\n") {
    // A one-quote string can't span lines; a triple-quoted one can hide an import line.
    return quote.length === 1 || startsImport(text, i + 1) ? undefined : i + 1;
  }
  return i + 1;
}

/**
 * Tells whether the line at a position starts like an import.
 *
 * @param text - the file's text.
 * @param start - the first character of a line.
 * @returns true when the prescan would copy that line as an import.
 */
function startsImport(text: string, start: number): boolean {
  const end = text.indexOf("\n", start);
  return STARTS_IMPORT.test(text.slice(start, end === -1 ? text.length : end));
}
