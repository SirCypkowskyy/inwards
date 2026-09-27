/**
 * @file Source encoding declarations (PEP 263), read as CPython reads them.
 *
 * Adapters read files as UTF-8. That is exact for UTF-8 and safe for any
 * ASCII-compatible single-byte encoding, because import statements are ASCII
 * and a stray high byte can't turn into a line break. Other codecs change what
 * the bytes mean: under `# coding: unicode_escape` the text `#\u000aimport x`
 * is a comment to us and a real import to CPython. This module only names
 * such an encoding; INW000 (a file) and INW011 (bytes passed to `exec`)
 * decide what to report.
 */

// The `s` flag matters: without it `.` stops at \r, U+2028 and U+2029, which
// CPython treats as ordinary characters inside a comment.
/** The declaration CPython's tokenizer looks for on line 1 or 2. */
const CODING = /^[ \t\f]*#.*?coding[:=][ \t]*(?<name>[-\w.]+)/su;

/** Line 1 must be blank or a comment for line 2 to count. */
const BLANK_OR_COMMENT = /^[ \t\f]*(?:#.*)?\r?$/su;

/** A line break as CPython counts it after normalisation: \n or \r\n. */
const LINE_BREAK = /\r?\n/u;

/** ASCII-compatible codecs whose bytes read as UTF-8 can't hide an import. */
const SAFE =
  /^(?:utf-?8(?:-.*)?|ascii|us-ascii|latin-?1|iso-latin-1|iso-?8859-\d+|cp125\d|windows-125\d)$/u;

/**
 * Reads the encoding a Python file declares, the way CPython's tokenizer does.
 * Only line 1, or line 2 when line 1 is blank or a comment, can declare it.
 *
 * @param text - normalised file text.
 * @returns the declared codec name, lower-cased with `_` as `-`, or null if none.
 */
function declaredEncoding(text: string): string | null {
  const [first = "", second = ""] = text.split(LINE_BREAK, 2);
  const declared =
    CODING.exec(first) ?? (BLANK_OR_COMMENT.test(first) ? CODING.exec(second) : null);
  const name = declared?.groups?.["name"];
  return name ? name.toLowerCase().replaceAll("_", "-") : null;
}

/**
 * Names the declared encoding of some Python source when Inwards can't read it.
 * Used for files, and for bytes passed to `exec` or `compile`, which CPython
 * decodes by the same PEP 263 rules (a `str` source ignores the declaration).
 *
 * @param text - normalised source text.
 * @returns the declared codec when it can hide imports, or null when it is safe or undeclared.
 */
export function unreadableEncoding(text: string): string | null {
  const encoding = declaredEncoding(text);
  return encoding === null || SAFE.test(encoding) ? null : encoding;
}
