/**
 * @file Module selectors: a literal module prefix (`shop.domain`) or a
 * selector with wildcard segments (`shop.*.domain`, `shop.**`), in the
 * grammar of ADR-018 (ADR-034), extended with fnmatch globs inside one
 * segment (`app.*._*_store`, #411). Layer `modules`, the rule options' module
 * lists and shape `packages` share the segment grammar defined here. It
 * validates selectors and matches an entry against a module name, reporting
 * the depths precedence needs. It knows nothing about layers or precedence
 * itself; that lives in `rules/shared/layer-ownership.ts`.
 *
 * Matching is dynamic programming over segments, O(entry × module) per call,
 * not the recursive `matchSegments` of shapes, since it runs per import.
 */
import { globLiterals, globMatches } from "./_glob.ts";

/** One segment of a selector: a Python identifier. */
const IDENTIFIER = /^[\p{XID_Start}_]\p{XID_Continue}*$/u;
/** One character a Python identifier may hold after its first. */
const IDENTIFIER_CHAR = /^\p{XID_Continue}$/u;
/** The characters that make an entry a selector and a segment a glob: `*`, `?` and `[`. */
const WILDCARD = /[*?[]/u;
/** The two segments that stand for whole segments: one, or one or more. */
const WHOLE_SEGMENT: ReadonlySet<string> = new Set(["*", "**"]);

/**
 * How an entry matches a module. A selector may match a module's prefixes in
 * several ways; this is the one precedence ranks highest.
 */
export interface EntryMatch {
  /** Module segments the match consumes, not counting descendants inherited by prefix. */
  depth: number;
  /**
   * How many module segments reach up to and including the entry's last
   * named segment, a literal or a glob such as `_*_store`, e.g. 3 for
   * `shop.*.domain` on `shop.orders.domain.x` and 1 for `shop.**`. For a
   * literal entry it equals `depth`.
   */
  lastLiteral: number;
  /** How many of the entry's segments are literal; a glob segment isn't. */
  literals: number;
}

/** Where a path of module segments stands against an entry. */
export type EntryReach = "match" | "descend" | "prune";

/**
 * Tells whether a layer entry is a selector: it has a `*`, `?` or `[`
 * anywhere. Every other entry is a literal prefix, validated as leniently as
 * before (ADR-034).
 *
 * @param entry - one string from `layers[].modules`.
 * @returns true when the entry contains a wildcard character.
 */
export function isSelector(entry: string): boolean {
  return WILDCARD.test(entry);
}

/**
 * Tells whether a selector segment is a glob inside one segment, such as
 * `_*_store` or `test_?`: it holds a wildcard and is neither `*` nor `**`.
 *
 * @param segment - one dot-separated segment of a selector.
 * @returns true for a glob segment.
 */
export function isGlobSegment(segment: string): boolean {
  return !WHOLE_SEGMENT.has(segment) && WILDCARD.test(segment);
}

/**
 * Tells whether a selector segment names its module segment by itself: a
 * literal, neither `*`, `**` nor a glob.
 *
 * @param segment - one segment of a selector.
 * @returns true for a literal segment.
 */
function isLiteralSegment(segment: string): boolean {
  return !(WHOLE_SEGMENT.has(segment) || isGlobSegment(segment));
}

/**
 * Matches one selector segment other than `**` against one module segment:
 * `*` takes any, a glob segment matches as `fnmatch.fnmatchcase` would, and a
 * literal must be equal.
 *
 * @param want - a selector segment, `*`, a glob or a literal.
 * @param segment - one segment of a module name.
 * @returns true when `want` matches `segment`.
 */
export function segmentMatches(want: string, segment: string): boolean {
  if (want === "*") {
    return true;
  }
  return isGlobSegment(want) ? globMatches(want, segment) : want === segment;
}

/**
 * Says what is wrong with one selector segment, or nothing. A segment is an
 * identifier, `*` (one segment), `**` (one or more), or an fnmatch glob that
 * matches inside one segment (`_*_store`, `test_?`, `[!_]*`), whose literal
 * characters are ones an identifier may hold. Shape `packages` use it too,
 * where the first segment may be a wildcard.
 *
 * @param segment - one dot-separated segment.
 * @returns the reason it is invalid, or undefined when it is valid.
 */
export function segmentProblem(segment: string): string | undefined {
  if (segment === "") {
    return "it has an empty segment";
  }
  if (WHOLE_SEGMENT.has(segment) || IDENTIFIER.test(segment)) {
    return undefined;
  }
  if (!WILDCARD.test(segment)) {
    return `segment "${segment}" is neither an identifier, *, ** nor a glob such as _*_store`;
  }
  if (segment.includes("**")) {
    return `segment "${segment}" puts ** inside a segment; ** stands alone for one or more segments, and * is the wildcard inside one`;
  }
  const literals = globLiterals(segment);
  if (literals === undefined) {
    return `segment "${segment}" is not a valid glob: a [ is never closed or a range is reversed, such as [z-a]`;
  }
  const odd = literals.find((c) => !IDENTIFIER_CHAR.test(c));
  return odd === undefined
    ? undefined
    : `segment "${segment}" holds "${odd}", which no package name can`;
}

/**
 * Says what is wrong with a selector, or nothing. Its segments are valid
 * (see `segmentProblem`), and the first is an identifier, the top-level
 * package that anchors the directory walk.
 *
 * @param entry - a selector (see `isSelector`).
 * @returns the reason it is invalid, or undefined when it is valid.
 */
export function selectorProblem(entry: string): string | undefined {
  const segments = entry.split(".");
  for (const segment of segments) {
    const problem = segmentProblem(segment);
    if (problem !== undefined) {
      return problem;
    }
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
 * prefix of the module exactly, `*` taking one segment, `**` one or more,
 * and a glob segment one segment it matches; the module is then that prefix
 * or a descendant of it.
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
  const literals = pattern.filter(isLiteralSegment).length;
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
      if (want === "**" || (want !== undefined && segmentMatches(want, seg))) {
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
 * module, the deepest position of the pattern's last literal or glob
 * segment over all ways the pattern matches that prefix exactly, `**` taking
 * one or more segments.
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
    row = nextRow(seg, row, name);
  }
  return row;
}

/**
 * One step of `lastLiterals`: the row after the pattern takes one more
 * segment, `**` carrying the deepest position forward, `*` keeping it, and a
 * literal or glob segment moving it to the module segment it matches.
 *
 * @param seg - the pattern segment taken.
 * @param row - the row before it (see `lastLiterals`).
 * @param name - the module split on dots.
 * @returns the row after it.
 */
function nextRow(seg: string, row: readonly number[], name: readonly string[]): number[] {
  const next = row.map(() => -1);
  for (let j = 1; j < row.length; j += 1) {
    const from = row[j - 1] ?? -1;
    if (seg === "**") {
      next[j] = Math.max(from, next[j - 1] ?? -1);
    } else if (seg === "*") {
      next[j] = from;
    } else if (from >= 0 && segmentMatches(seg, name[j - 1] ?? "")) {
      next[j] = j;
    }
  }
  return next;
}

/**
 * Fills a selector's wildcards from a module, keeping its literal tail: the
 * module `src.*.service` stands for next to `src.posts.router` is
 * `src.posts.service`. The part up to the last wildcard or glob segment must
 * match a prefix of the module exactly; with `**`, which can match prefixes of several
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
  while (cut > 0 && isLiteralSegment(pattern[cut - 1] ?? "*")) {
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
