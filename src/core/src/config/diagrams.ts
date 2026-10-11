/**
 * @file `diagrams` in `[tool.inwards]`: the Markdown and Mermaid files whose
 * marked diagrams the diagram rules check against the config and the code
 * (INW017, ADR-045). Each entry is a path relative to the config file, with
 * `*`, `?` and `[seq]` inside a segment and `**` for any number of
 * directories. The config stays the only source of truth: a diagram is
 * checked, never read as config.
 *
 * This module validates the key and matches paths against it. It reads no
 * file: the adapter walks from `diagramBase` and keeps the paths
 * `diagramMatches` accepts.
 */
import { globMatches, isGlob } from "./glob.ts";
import { ConfigError } from "./toml.ts";

/** A segment that stands for any number of directories. */
const ANY_DEPTH = "**";
/** A segment with a wildcard in it. */
const WILDCARD = /[*?[]/u;
/** A Windows drive, which makes a path absolute. */
const DRIVE = /^[A-Za-z]:/u;
/** What the config error says an entry looks like. */
const HINT =
  'a list of paths relative to the config file, such as "docs/architecture.md" or "docs/**/*.md"';

/**
 * Validates `diagrams`: non-empty relative paths with forward slashes, no
 * `..` segment (the files stay under the config's directory) and well-formed
 * globs.
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
  if (segments.includes("..")) {
    return `("${entry}") must not leave the config file's directory with ..`;
  }
  if (segments.some((segment) => segment === "" || !isGlob(segment))) {
    return `("${entry}") has an empty segment or an unclosed [`;
  }
  return undefined;
}

/**
 * Finds the directory to walk for an entry: its segments before the first
 * one with a wildcard. A plain path has no wildcard, so the walk is skipped
 * and the file is read directly.
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
 * none included.
 *
 * @param entry - a `diagrams` entry.
 * @param path - a file path relative to the config file, with forward slashes.
 * @returns true when the entry names the file.
 */
export function diagramMatches(entry: string, path: string): boolean {
  return segmentsMatch(entry.split("/"), path.split("/"));
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
