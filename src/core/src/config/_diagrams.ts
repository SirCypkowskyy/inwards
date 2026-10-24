/**
 * @file `diagrams` in `[tool.inwards]`: the Markdown and Mermaid files whose
 * marked diagrams the diagram rules check against the config and the code
 * (INW017, ADR-045). Each entry is a path relative to the config file, with
 * `*`, `?` and `[seq]` inside a segment and `**` for any number of
 * directories. Leading `..` segments climb out of the config's directory, as
 * far as the project root (a uv workspace member reaching the repository's
 * docs, #413). The config stays the only source of truth: a diagram is
 * checked, never read as config.
 *
 * This module validates the key and matches paths against it. It reads no
 * file and finds no root: the adapter says how far up the project root is
 * (`checkDiagramsRoot`), walks from `diagramBase` and keeps the paths
 * `diagramMatches` accepts.
 */
import { globMatches, isGlob } from "./_glob.ts";
import { ConfigError } from "./_toml.ts";

/** A segment that stands for any number of directories. */
const ANY_DEPTH = "**";
/** The segment that climbs to the parent directory. */
const UP = "..";
/** A segment with a wildcard in it. */
const WILDCARD = /[*?[]/u;
/** A Windows drive, which makes a path absolute. */
const DRIVE = /^[A-Za-z]:/u;
/** What the config error says an entry looks like. */
const HINT =
  'a list of paths relative to the config file, such as "docs/architecture.md" or "docs/**/*.md"';

/**
 * Validates `diagrams`: non-empty relative paths with forward slashes, `..`
 * only as leading segments and followed by a name, and well-formed globs.
 * How far the leading `..` may climb depends on where the config sits, which
 * its text doesn't say: `checkDiagramsRoot` checks that once the adapter
 * knows the project root.
 *
 * @param value - the raw `diagrams` value, if any.
 * @returns `{ diagrams }` when it is set and non-empty, else nothing.
 * @throws {ConfigError} naming the first bad entry.
 */
export function parseDiagrams(value: unknown): { diagrams?: string[] } {
  if (value === undefined) {
    return {};
  }
  if (!Array.isArray(value)) {
    throw new ConfigError(`tool.inwards.diagrams must be ${HINT}.`);
  }
  const entries: string[] = [];
  for (const [i, entry] of value.entries()) {
    const problem = entryProblem(entry);
    if (problem !== undefined) {
      throw new ConfigError(`tool.inwards.diagrams[${i}] ${problem}; use ${HINT}.`);
    }
    if (typeof entry === "string") {
      entries.push(entry);
    }
  }
  return entries.length === 0 ? {} : { diagrams: entries };
}

/**
 * Says what is wrong with one `diagrams` entry.
 *
 * @param entry - the raw entry.
 * @returns the problem, or undefined when the entry is fine.
 */
function entryProblem(entry: unknown): string | undefined {
  if (typeof entry !== "string" || entry.trim() === "") {
    return "must be a non-empty string";
  }
  if (entry.includes("\\")) {
    return `("${entry}") must use forward slashes`;
  }
  if (entry.startsWith("/") || DRIVE.test(entry)) {
    return `("${entry}") must be relative to the config file`;
  }
  const segments = entry.split("/");
  const up = climb(segments);
  if (segments.slice(up).includes(UP)) {
    return `("${entry}") may use .. only at the start, to climb out of the config file's directory`;
  }
  if (up === segments.length) {
    return `("${entry}") must name a file after its .. segments`;
  }
  if (segments.some((segment) => segment === "" || !isGlob(segment))) {
    return `("${entry}") has an empty segment or an unclosed [`;
  }
  return undefined;
}

/**
 * Counts the leading `..` segments of a path.
 *
 * @param segments - the path split at `/`.
 * @returns how many directories it climbs before naming anything.
 */
function climb(segments: readonly string[]): number {
  const first = segments.findIndex((segment) => segment !== UP);
  return first === -1 ? segments.length : first;
}

/** How far up a config's `diagrams` may climb with `..`, as the adapter found it. */
export interface DiagramsRoot {
  /** How many directories the project root sits above the config's directory. */
  up: number;
  /** The root as a config error names it, e.g. `the uv workspace root ("../..")`. */
  name: string;
}

/**
 * Checks that every `diagrams` entry stays inside the project root: its
 * leading `..` segments climb no higher than the root. The check is on the
 * path text (a symlink on the way isn't followed), and the root is looked
 * for only when an entry climbs at all, so a config without `..` costs the
 * adapter nothing. Without a root (no git repository and no uv workspace
 * around the config) no entry may climb, as before #413.
 *
 * @param diagrams - the parsed entries, in the config's order.
 * @param findRoot - finds the project root; called at most once.
 * @throws {ConfigError} naming the first entry that leaves the root.
 */
export function checkDiagramsRoot(
  diagrams: readonly string[] | undefined,
  findRoot: () => DiagramsRoot | undefined,
): void {
  let root: DiagramsRoot | undefined;
  let looked = false;
  for (const [i, entry] of (diagrams ?? []).entries()) {
    const up = climb(entry.split("/"));
    if (up === 0) {
      continue;
    }
    if (!looked) {
      root = findRoot();
      looked = true;
    }
    if (root === undefined) {
      throw new ConfigError(
        `tool.inwards.diagrams[${i}] ("${entry}") must not leave the config file's directory with .. outside a git repository or uv workspace; use ${HINT}.`,
      );
    }
    if (up > root.up) {
      throw new ConfigError(
        `tool.inwards.diagrams[${i}] ("${entry}") must stay inside the project root, ${root.name}; use ${HINT}.`,
      );
    }
  }
}

/**
 * Finds the directory to walk for an entry: its segments before the first
 * one with a wildcard, leading `..` included. A plain path has no wildcard,
 * so the walk is skipped and the file is read directly.
 *
 * @param entry - a `diagrams` entry.
 * @returns the directory, relative to the config file (`""` for the config's
 *   own directory), or undefined for a plain path.
 */
export function diagramBase(entry: string): string | undefined {
  const segments = entry.split("/");
  const first = segments.findIndex((segment) => WILDCARD.test(segment));
  return first === -1 ? undefined : segments.slice(0, first).join("/");
}

/**
 * Tells whether a path matches a `diagrams` entry, segment by segment: a
 * wildcard never crosses a `/`, and `**` matches any number of whole segments,
 * none included. The entry's leading `..` segments match exactly as many
 * leading `..` in the path, and no `..` after them, so a `*` or `**` never
 * reaches out of the directory the entry starts in.
 *
 * @param entry - a `diagrams` entry.
 * @param path - a file path relative to the config file, with forward slashes.
 * @returns true when the entry names the file.
 */
export function diagramMatches(entry: string, path: string): boolean {
  const globs = entry.split("/");
  const parts = path.split("/");
  const up = climb(globs);
  return (
    climb(parts) === up &&
    !parts.slice(up).includes(UP) &&
    segmentsMatch(globs.slice(up), parts.slice(up))
  );
}

/**
 * Matches path segments against glob segments, `**` included.
 *
 * @param globs - the entry's segments.
 * @param parts - the path's segments.
 * @returns true when every segment is accounted for.
 */
function segmentsMatch(globs: readonly string[], parts: readonly string[]): boolean {
  const [glob, ...restGlobs] = globs;
  if (glob === undefined) {
    return parts.length === 0;
  }
  if (glob === ANY_DEPTH) {
    return (
      parts.some((_, i) => segmentsMatch(restGlobs, parts.slice(i))) || segmentsMatch(restGlobs, [])
    );
  }
  const [part, ...restParts] = parts;
  return part !== undefined && globMatches(glob, part) && segmentsMatch(restGlobs, restParts);
}
