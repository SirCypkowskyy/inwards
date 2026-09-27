/**
 * @file Where a `[tool.inwards]` value sits in pyproject.toml, so a config
 * finding (INW006 dead prefixes, INW007 unmatched selectors) can point at the
 * line that caused it. It searches the text; it doesn't parse TOML.
 */
import type { Span } from "./types.ts";

/** The `[tool.inwards]` header line, however it is spaced. */
const TABLE_HEADER = /^[ \t]*\[[ \t]*tool[ \t]*\.[ \t]*inwards[ \t]*\]/mu;

/** The pyproject.toml the layers came from, so config findings can point into it. */
export interface ConfigFile {
  /** Path as the user should see it. */
  path: string;
  text: string;
}

/**
 * Locates a prefix's quoted string in pyproject.toml, for the diagnostic span.
 * The search starts at the `[tool.inwards]` header, so `"shop"` doesn't land
 * on `name = "shop"` in `[project]`.
 * ponytail: first quoted occurrence after the header; parse positions from TOML if this ever points wrong.
 *
 * @param text - the pyproject.toml text.
 * @param prefix - the prefix to find.
 * @returns the span of the string, or line 1 column 1 when it isn't spelled plainly.
 */
export function spanOf(text: string, prefix: string): Span {
  const from = TABLE_HEADER.exec(text)?.index ?? 0;
  const [at] = [`"${prefix}"`, `'${prefix}'`]
    .map((quoted) => text.indexOf(quoted, from))
    .filter((i) => i !== -1)
    .sort((a, b) => a - b);
  if (at === undefined) {
    return { line: 1, column: 1, endLine: 1, endColumn: 1 };
  }
  const before = text.slice(0, at).split("\n");
  const line = before.length;
  const column = (before.at(-1)?.length ?? 0) + 1;
  return { line, column, endLine: line, endColumn: column + prefix.length + 2 };
}
