/**
 * @file How FastAPI paths overlap (#224): a route path read as segments, and
 * the test for whether one path matches every request another does. It follows
 * Starlette's rules for `{name}`, `{name:int}` and `{name:path}`, and treats
 * any segment it can't compare, such as a custom converter or text around a
 * parameter, as matching only an identical one. It reads no files and reports
 * nothing.
 */

/** One piece of a path between slashes. */
export type Segment =
  | { readonly kind: "literal"; readonly text: string }
  | { readonly kind: "param"; readonly converter: string }
  /** Text around a parameter (`{name}.json`), compared as written. */
  | { readonly kind: "mixed"; readonly text: string };

/** `{name}` or `{name:converter}` filling a whole segment. */
const PARAM = /^\{[^{}:]+(?::(?<converter>[^{}]+))?\}$/u;
/** Any `{name}` or `{name:converter}` inside a segment. */
const BRACES = /\{[^{}:]*(?::(?<converter>[^{}]*))?\}/gu;
/** What Starlette's `int` converter matches. */
const DIGITS = /^[0-9]+$/u;

/**
 * Reads a segment between slashes.
 *
 * @param text - the segment as written.
 * @returns a literal, a parameter that fills it, or mixed text with the
 *   parameter names removed so `{a}.json` equals `{b}.json`.
 */
function segmentOf(text: string): Segment {
  const param = PARAM.exec(text);
  if (param) {
    return { kind: "param", converter: param.groups?.["converter"] ?? "str" };
  }
  if (!(text.includes("{") || text.includes("}"))) {
    return { kind: "literal", text };
  }
  return {
    kind: "mixed",
    text: text.replace(BRACES, (_all, converter?: string) => `{:${converter ?? "str"}}`),
  };
}

/**
 * Reads a full path as segments.
 *
 * @param path - the path, starting with a slash.
 * @returns the segments, or null when the path doesn't start with a slash.
 */
export function segmentsOf(path: string): Segment[] | null {
  return path.startsWith("/") ? path.slice(1).split("/").map(segmentOf) : null;
}

/**
 * Tells whether every request a segment of `later` matches also matches a
 * segment of `first` at the same place.
 *
 * @param first - the earlier route's segment.
 * @param later - the later route's segment.
 * @returns true when `first` matches whatever `later` does.
 */
function segmentCovers(first: Segment, later: Segment): boolean {
  if (first.kind !== "param") {
    return later.kind !== "param" && later.kind === first.kind && later.text === first.text;
  }
  if (later.kind === "mixed") {
    return first.converter === "str" && !later.text.includes(":path}");
  }
  if (first.converter === "str") {
    return later.kind === "literal" ? later.text !== "" : later.converter !== "path";
  }
  if (first.converter === "int") {
    return later.kind === "literal" ? DIGITS.test(later.text) : later.converter === "int";
  }
  return false;
}

/**
 * Tells whether the earlier path matches every request the later one does.
 * A `{name:path}` at the end of the earlier path matches whatever follows.
 *
 * @param first - the earlier route's segments.
 * @param later - the later route's segments.
 * @returns true when nothing is left for the later route to answer.
 */
export function covers(first: readonly Segment[], later: readonly Segment[]): boolean {
  for (const [i, segment] of first.entries()) {
    const other = later[i];
    if (other === undefined) {
      return false;
    }
    if (segment.kind === "param" && segment.converter === "path" && i === first.length - 1) {
      return true;
    }
    if (!segmentCovers(segment, other)) {
      return false;
    }
  }
  return first.length === later.length;
}
