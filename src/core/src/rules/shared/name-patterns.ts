/**
 * @file Qualified-name patterns with fnmatch's wildcards, as the opt-in
 * rules' options write them (`psycopg*.*`, `sqlalchemy.orm.Session`): INW012's
 * call, type and decorator lists and INW013's blocking calls and types. It
 * only compiles and matches strings; the options parser has already checked
 * each pattern's shape.
 */

/** The characters a regular expression would read as syntax, escaped when a pattern holds them. */
const REGEX_SYNTAX = /[.\\^$+()[\]{}|]/u;

/** Tells whether a qualified name matches one of a list of patterns. */
export type NameMatch = (qualified: string) => boolean;

/**
 * Turns one fnmatch pattern into a regular expression: `*` is any run of
 * characters (dots included, as in fnmatch), `?` any one character.
 *
 * @param pattern - a qualified name with wildcards, e.g. `psycopg*.*`.
 * @returns an anchored regular expression.
 */
function patternRegExp(pattern: string): RegExp {
  const source = [...pattern]
    .map((c) => {
      if (c === "*") {
        return ".*";
      }
      return c === "?" ? "." : c.replace(REGEX_SYNTAX, "\\$&");
    })
    .join("");
  return new RegExp(`^${source}$`, "u");
}

/**
 * Builds a matcher for a list of name patterns.
 *
 * @param patterns - qualified names with fnmatch wildcards.
 * @returns a function that tells whether a qualified name matches any of them.
 */
export function nameMatcher(patterns: readonly string[]): NameMatch {
  const compiled = patterns.map(patternRegExp);
  return (qualified: string): boolean => compiled.some((re) => re.test(qualified));
}
