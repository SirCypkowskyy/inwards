/**
 * @file Where a `[tool.inwards]` value sits in pyproject.toml, so a config
 * finding (INW006 dead prefixes, INW007 unmatched selectors, options for a
 * rule that is off) can point at the line that caused it. It searches the text; it doesn't parse TOML.
 */
import type { Span } from "../contracts/records.ts";

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
  return firstSpan(text, [`"${prefix}"`, `'${prefix}'`]);
}

/**
 * Locates a rule's options table, `[tool.inwards.rules.<name>]`, in
 * pyproject.toml: the first `rules.<name>` after the `[tool.inwards]` header,
 * else the first bare `<name>` (a key inside `[tool.inwards.rules]`).
 *
 * @param text - the pyproject.toml text.
 * @param name - the rule's kebab-case name.
 * @returns the span of the name as written, or line 1 column 1 when it isn't found.
 */
export function spanOfRuleTable(text: string, name: string): Span {
  const span = firstSpan(text, [`rules.${name}`]);
  return span.endColumn > 1 ? span : firstSpan(text, [name]);
}

/**
 * Finds the earliest of several spellings after the `[tool.inwards]` header.
 *
 * @param text - the pyproject.toml text.
 * @param spellings - the texts to look for.
 * @returns the span of the earliest one found, or line 1 column 1 (an empty span) when none is.
 */
function firstSpan(text: string, spellings: readonly string[]): Span {
  const from = TABLE_HEADER.exec(text)?.index ?? 0;
  const [found] = spellings
    .map((spelling) => ({ spelling, at: text.indexOf(spelling, from) }))
    .filter(({ at }) => at !== -1)
    .sort((a, b) => a.at - b.at);
  if (found === undefined) {
    return { line: 1, column: 1, endLine: 1, endColumn: 1 };
  }
  const before = text.slice(0, found.at).split("\n");
  const line = before.length;
  const column = (before.at(-1)?.length ?? 0) + 1;
  return { line, column, endLine: line, endColumn: column + found.spelling.length };
}

/** A layer entry a template expanded: the module entry as written, and the role added to it. */
export interface TemplateRole {
  /** The entry of the layer that carries the template, e.g. `src.*`. */
  base: string;
  /** The role, e.g. `utils` or `api.v1`. */
  role: string;
}

/**
 * Tells whether a layer entry came from a template's roles: it isn't spelled
 * in the text, but a shorter entry it extends is.
 * ponytail: text search for the longest quoted prefix; carry the origin on LayerSpec if two templates ever share a base.
 *
 * @param text - the pyproject.toml text.
 * @param entry - a layer entry, e.g. `src.*.utils`.
 * @returns the base entry and the role, or undefined when the entry is written out or nothing matches.
 */
export function templateRole(text: string, entry: string): TemplateRole | undefined {
  if (quoted(text, entry)) {
    return undefined;
  }
  const segments = entry.split(".");
  for (let k = segments.length - 1; k > 0; k -= 1) {
    const base = segments.slice(0, k).join(".");
    if (quoted(text, base)) {
      return { base, role: segments.slice(k).join(".") };
    }
  }
  return undefined;
}

/**
 * Locates a layer entry for a diagnostic span: its own text, or, for an entry
 * a template expanded, the entry that carries the template.
 *
 * @param text - the pyproject.toml text.
 * @param entry - a layer entry.
 * @returns the span of the entry, or of the template's base entry.
 */
export function entrySpan(text: string, entry: string): Span {
  return spanOf(text, templateRole(text, entry)?.base ?? entry);
}

/**
 * Tells whether a value is written in the text as a quoted TOML string.
 *
 * @param text - the pyproject.toml text.
 * @param value - the string to look for.
 * @returns true when `"value"` or `'value'` occurs.
 */
function quoted(text: string, value: string): boolean {
  return text.includes(`"${value}"`) || text.includes(`'${value}'`);
}
