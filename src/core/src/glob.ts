/**
 * fnmatch globs without regular expressions: `*`, `?`, `[seq]` and `[!seq]`,
 * matched as Python's `fnmatch.fnmatchcase` matches them, one code point per
 * character. Used for shape member patterns (INW007, INW008) and `generated`
 * (INW010).
 *
 * Matching is the iterative two-pointer wildcard match: on a mismatch it goes
 * back only to the last `*`, so it costs O(pattern × text) at worst. A
 * translation to a regular expression (`.*` per star) backtracks
 * polynomially in the number of stars, and the text is a file or module name
 * an agent writes: `*_*_*_*_pb2` against 240 underscores took over 300 ms.
 */

/** One character's worth of a glob: a star, `?`, a bracket set, or a literal. */
type Token =
  | { kind: "star" }
  | { kind: "any" }
  | { kind: "set"; negated: boolean; ranges: [string, string][] }
  | { kind: "char"; char: string };

/** The wildcards outside a bracket set. */
const SPECIAL: ReadonlyMap<string, Token> = new Map<string, Token>([
  ["*", { kind: "star" }],
  ["?", { kind: "any" }],
]);
/** How many characters a range such as `a-z` takes. */
const RANGE_LENGTH = 3;

/**
 * Parses a glob. Inside a bracket set, `*`, `?` and every other character are
 * literal; `-` between two characters is a range, and a `]` right after `[`
 * or `[!` is a member.
 *
 * @param glob - e.g. `test_*` or `[!_]*_pb2`.
 * @returns the tokens, or undefined for a `[` that is never closed or a reversed range such as `[z-a]`.
 */
function parse(glob: string): Token[] | undefined {
  const chars = Array.from(glob);
  const tokens: Token[] = [];
  let i = 0;
  while (i < chars.length) {
    const c = chars[i] ?? "";
    if (c === "[") {
      const set = parseSet(chars, i);
      if (set === undefined) {
        return undefined;
      }
      tokens.push(set.token);
      i = set.end + 1;
      continue;
    }
    tokens.push(SPECIAL.get(c) ?? { kind: "char", char: c });
    i += 1;
  }
  return tokens;
}

/**
 * Parses the bracket set that opens at `start`, as `fnmatch.translate` scans it.
 *
 * @param chars - the glob's code points.
 * @param start - the index of its `[`.
 * @returns the set and the index of its closing `]`, or undefined when unclosed or a range is reversed.
 */
function parseSet(
  chars: readonly string[],
  start: number,
): { token: Token; end: number } | undefined {
  let end = start + 1;
  const negated = chars[end] === "!";
  if (negated) {
    end += 1;
  }
  if (chars[end] === "]") {
    end += 1;
  }
  while (end < chars.length && chars[end] !== "]") {
    end += 1;
  }
  if (end >= chars.length) {
    return undefined;
  }
  const body = chars.slice(start + 1 + (negated ? 1 : 0), end);
  const ranges: [string, string][] = [];
  let k = 0;
  while (k < body.length) {
    const lo = body[k] ?? "";
    const hi = body[k + 2];
    if (body[k + 1] === "-" && hi !== undefined) {
      if (compare(lo, hi) > 0) {
        return undefined;
      }
      ranges.push([lo, hi]);
      k += RANGE_LENGTH;
    } else {
      ranges.push([lo, lo]);
      k += 1;
    }
  }
  return { token: { kind: "set", negated, ranges }, end };
}

/**
 * Orders two characters by code point, as a bracket range does.
 *
 * @param a - one character.
 * @param b - another.
 * @returns negative, zero or positive.
 */
function compare(a: string, b: string): number {
  return (a.codePointAt(0) ?? 0) - (b.codePointAt(0) ?? 0);
}

/**
 * Tells whether a single-character token matches one character.
 *
 * @param token - `?`, a set or a literal (never a star).
 * @param c - one code point of the text.
 * @returns true on a match.
 */
function matchesOne(token: Token, c: string): boolean {
  switch (token.kind) {
    case "any":
      return true;
    case "char":
      return token.char === c;
    case "set":
      return (
        token.ranges.some(([lo, hi]) => compare(lo, c) <= 0 && compare(c, hi) <= 0) !==
        token.negated
      );
    default:
      return false;
  }
}

/**
 * Tells whether a glob is well formed (see `parse`).
 *
 * @param glob - the glob.
 * @returns false for an unclosed `[` or a reversed range.
 */
export function isGlob(glob: string): boolean {
  return parse(glob) !== undefined;
}

/**
 * Matches a whole text against a glob, like `fnmatch.fnmatchcase`, in
 * O(glob × text) time: after a mismatch the match resumes one character
 * further past the last star, never further back.
 *
 * @param glob - the glob; a malformed one matches nothing.
 * @param text - e.g. a member name's stem or one module-name segment.
 * @returns true when the glob matches all of the text.
 */
export function globMatches(glob: string, text: string): boolean {
  const tokens = parse(glob);
  if (tokens === undefined) {
    return false;
  }
  const chars = Array.from(text);
  let p = 0;
  let t = 0;
  let star = -1;
  let resume = 0;
  while (t < chars.length) {
    const token = tokens[p];
    if (token?.kind === "star") {
      star = p;
      resume = t;
      p += 1;
    } else if (token !== undefined && matchesOne(token, chars[t] ?? "")) {
      p += 1;
      t += 1;
    } else if (star === -1) {
      return false;
    } else {
      p = star + 1;
      resume += 1;
      t = resume;
    }
  }
  return tokens.slice(p).every((token) => token.kind === "star");
}
