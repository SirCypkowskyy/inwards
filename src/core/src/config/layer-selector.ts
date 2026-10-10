/**
 * @file Layer entries in `layers[].modules`: a literal module prefix
 * (`shop.domain`) or a selector with wildcard segments (`shop.*.domain`,
 * `shop.**`), in the grammar of ADR-018 (ADR-034). It validates selectors and
 * matches an entry against a module name, reporting the depths precedence
 * needs. It knows nothing about layers or precedence itself; that lives in
 * `rules/shared/layer-ownership.ts`.
 *
 * Matching is dynamic programming over segments, O(entry × module) per call,
 * not the recursive `matchSegments` of shapes, since it runs per import.
 */

/** One segment of a selector: a Python identifier. */
const IDENTIFIER = /^[\p{XID_Start}_]\p{XID_Continue}*$/u;

/**
 * How an entry matches a module. A selector may match a module's prefixes in
 * several ways; this is the one precedence ranks highest.
 */
export interface EntryMatch {
  /** Module segments the match consumes, not counting descendants inherited by prefix. */
  depth: number;
  /**
   * How many module segments reach up to and including the entry's last
   * literal segment, e.g. 3 for `shop.*.domain` on `shop.orders.domain.x`
   * and 1 for `shop.**`. For a literal entry it equals `depth`.
   */
  lastLiteral: number;
  /** How many of the entry's segments are literal. */
  literals: number;
}

/** Where a path of module segments stands against an entry. */
export type EntryReach = "match" | "descend" | "prune";

/**
 * Tells whether a layer entry is a selector: it has a `*` anywhere. Every
 * other entry is a literal prefix, validated as leniently as before (ADR-034).
 *
 * @param entry - one string from `layers[].modules`.
 * @returns true when the entry contains `*`.
 */
export function isSelector(entry: string): boolean {
  return entry.includes("*");
}

/**
 * Says what is wrong with a selector, or nothing. Its segments are `*` (one
 * segment), `**` (one or more) or identifiers, and the first is an
 * identifier, the top-level package that anchors the directory walk.
 *
 * @param entry - a selector (see `isSelector`).
 * @returns the reason it is invalid, or undefined when it is valid.
 */
export function selectorProblem(entry: string): string | undefined {
  const segments = entry.split(".");
  const bad = segments.find((seg) => seg !== "*" && seg !== "**" && !IDENTIFIER.test(seg));
  if (bad !== undefined) {
    return bad === ""
      ? "it has an empty segment"
      : `segment "${bad}" is neither an identifier, * nor **`;
  }
  return IDENTIFIER.test(segments[0] ?? "")
    ? undefined
    : "it must start with a package name, such as shop.*.domain";
}

/**
 * Names the top-level package an entry lives in: its first segment, which
 * for a selector is always a literal. The directory walks open that package.
 *
 * @param entry - one string from `layers[].modules`.
 * @returns e.g. `shop` for `shop.*.domain`.
 */
export function topPackageOf(entry: string): string {
  return entry.split(".")[0] ?? entry;
}

/**
 * Matches an entry against a module. A literal entry matches the module
 * itself and its descendants. A selector matches when it matches some
 * prefix of the module exactly, `*` taking one segment and `**` one or
 * more; the module is then that prefix or a descendant of it.
 *
 * @param entry - a literal prefix or a selector.
 * @param module - a dotted module name.
 * @returns how it matches, or undefined when it doesn't.
 */
export function matchEntry(entry: string, module: string): EntryMatch | undefined {
  if (!isSelector(entry)) {
    if (module !== entry && !module.startsWith(`${entry}.`)) {
      return undefined;
    }
    const depth = entry.split(".").length;
    return { depth, lastLiteral: depth, literals: depth };
  }
  const pattern = entry.split(".");
  const last = lastLiterals(pattern, module.split("."));
  let best: EntryMatch | undefined;
  const literals = pattern.filter((seg) => seg !== "*" && seg !== "**").length;
  last.forEach((lastLiteral, depth) => {
    const better =
      best === undefined ||
      lastLiteral > best.lastLiteral ||
      (lastLiteral === best.lastLiteral && depth > best.depth);
    if (lastLiteral > 0 && better) {
      best = { depth, lastLiteral, literals };
    }
  });
  return best;
}

/**
 * Finds the deepest complete match of an entry against a module's prefixes,
 * whatever its last literal: what decides whether a package holds a match.
 *
 * @param entry - a literal prefix or a selector.
 * @param module - a dotted module name.
 * @returns module segments consumed, or 0 when the entry doesn't match.
 */
export function deepestMatch(entry: string, module: string): number {
  if (!isSelector(entry)) {
    return matchEntry(entry, module)?.depth ?? 0;
  }
  const last = lastLiterals(entry.split("."), module.split("."));
  return last.reduce((deepest, lastLiteral, depth) => (lastLiteral > 0 ? depth : deepest), 0);
}

/**
 * Tells where a path stands against an entry: the entry matches it exactly,
 * could still match a longer path below it, or can't match anything there.
 * A pruned search of the tree walks only the directories that descend.
 *
 * @param entry - a literal prefix or a selector.
 * @param segments - a module path, split on dots.
 * @returns "match", "descend" or "prune".
 */
export function entryReach(entry: string, segments: readonly string[]): EntryReach {
  const pattern = entry.split(".");
  // states: how many pattern segments can have matched `segments` exactly.
  let states = new Set([0]);
  for (const seg of segments) {
    const next = new Set<number>();
    for (const i of states) {
      const want = pattern[i];
      if (i > 0 && pattern[i - 1] === "**") {
        next.add(i); // `**` takes one more segment
      }
      if (want === "*" || want === "**" || want === seg) {
        next.add(i + 1);
      }
    }
    states = next;
  }
  if (states.has(pattern.length)) {
    return "match";
  }
  return [...states].some((i) => i < pattern.length) ? "descend" : "prune";
}

/**
 * The dynamic program behind `matchEntry`: for every prefix length of the
 * module, the deepest position of the pattern's last literal segment over all
 * ways the pattern matches that prefix exactly, `**` taking one or more
 * segments.
 *
 * @param pattern - the entry split on dots.
 * @param name - the module split on dots.
 * @returns index `j` holds that position for `name[0..j)`, or -1 when the pattern doesn't match it.
 */
function lastLiterals(pattern: readonly string[], name: readonly string[]): number[] {
  let row = name.map(() => -1);
  row.push(-1);
  row[0] = 0;
  for (const seg of pattern) {
    const next = row.map(() => -1);
    for (let j = 1; j < row.length; j += 1) {
      const from = row[j - 1] ?? -1;
      if (seg === "**") {
        next[j] = Math.max(from, next[j - 1] ?? -1);
      } else if (seg === "*") {
        next[j] = from;
      } else if (from >= 0 && name[j - 1] === seg) {
        next[j] = j;
      }
    }
    row = next;
  }
  return row;
}

/**
 * Fills a selector's wildcards from a module, keeping its literal tail: the
 * module `src.*.service` stands for next to `src.posts.router` is
 * `src.posts.service`. The part up to the last wildcard must match a prefix
 * of the module exactly; with `**`, which can match prefixes of several
 * lengths, the longest one short of the module itself wins, so the result is
 * a sibling in the module's own package.
 *
 * @param entry - a layer entry or `delegate-to` target.
 * @param module - the dotted module whose segments fill the wildcards.
 * @returns the concrete module, or undefined when the entry is literal, ends in a wildcard, or doesn't fit the module.
 */
export function filledFrom(entry: string, module: string): string | undefined {
  const pattern = entry.split(".");
  let cut = pattern.length;
  while (cut > 0 && pattern[cut - 1] !== "*" && pattern[cut - 1] !== "**") {
    cut -= 1;
  }
  if (cut === 0 || cut === pattern.length) {
    return undefined;
  }
  const head = pattern.slice(0, cut).join(".");
  const segments = module.split(".");
  const lengths = [
    ...Array.from({ length: segments.length - 1 }, (_, k) => segments.length - 1 - k),
    segments.length,
  ];
  const fits = lengths.find((n) => entryReach(head, segments.slice(0, n)) === "match");
  return fits === undefined
    ? undefined
    : [...segments.slice(0, fits), ...pattern.slice(cut)].join(".");
}
