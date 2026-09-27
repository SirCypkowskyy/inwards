/**
 * Path handling the CLI and the hook share: real paths, containment, the
 * physical meaning of `..`, and config discovery (ADR-013).
 */
import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { type Diagnostic, declaresInwards, type Report } from "@inwards/core";

export const PATH_SEPARATORS = /[\\/]/u;

/**
 * Resolves a path the way the OS does when it opens it.
 * `path.resolve` (and Bun's realpath) fold `dlink/..` away as text, but the
 * OS follows `dlink` first, so `dlink/../x.py` can be a different file. Each
 * `..` is applied to the real path of what comes before it.
 *
 * @param base - directory a relative `file` is resolved against.
 * @param file - the path as given, absolute or relative.
 * @returns the real path, or undefined when it does not exist.
 */
export function physicalRealpath(base: string, file: string): string | undefined {
  const root = isAbsolute(file) ? parse(file).root : "";
  let current = root === "" ? base : root;
  for (const segment of PATH_SEPARATORS[Symbol.split](file.slice(root.length))) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      const resolved = realpath(current);
      if (resolved === undefined) {
        return undefined;
      }
      current = dirname(resolved);
    } else {
      current = join(current, segment);
    }
  }
  return realpath(current);
}

/**
 * Resolves symlinks and `..` in a path that may not exist.
 *
 * @param path - any path.
 * @returns the canonical path, or undefined when it does not exist.
 */
export function realpath(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

/**
 * Tells whether a path lies strictly below a directory.
 * The directory itself does not count. On Windows a path on another drive
 * gives an absolute relative path, which also does not count.
 *
 * @param dir - the containing directory.
 * @param file - the path to test.
 * @returns true when `file` is inside `dir`.
 */
export function isInside(dir: string, file: string): boolean {
  const rel = relative(dir, file);
  return rel !== "" && rel.split(sep)[0] !== ".." && !isAbsolute(rel);
}

/**
 * Finds the nearest pyproject.toml that configures Inwards.
 * Walks up from `dir` to the file system root. Whether a file configures
 * Inwards is decided on the parsed TOML (`declaresInwards`), so any valid
 * spelling of the table counts. With `within`, a candidate whose real path is
 * outside that directory is ignored, so a hook never reads a config (or its
 * text, via an error message) from outside the project.
 *
 * @param dir - the directory to start from.
 * @param within - optional real directory every accepted config must be inside.
 * @param accept - optional filter on a candidate's real path; a rejected one is passed over.
 * @returns the config path, or undefined when no ancestor has one.
 */
export function findConfig(
  dir: string,
  within?: string,
  accept?: (real: string) => boolean,
): string | undefined {
  for (let d = dir; ; d = dirname(d)) {
    const candidate = resolve(d, "pyproject.toml");
    const real = realpath(candidate);
    const allowed =
      real !== undefined &&
      (within === undefined || isInside(within, real)) &&
      (accept === undefined || accept(real));
    if (allowed && declaresInwards(readFileSync(real, "utf8"))) {
      return candidate;
    }
    if (dirname(d) === d) {
      return undefined;
    }
  }
}

/**
 * Converts a native path to forward slashes.
 * Diagnostics and SARIF use forward slashes on every OS, so output is identical everywhere.
 *
 * @param path - a path with the platform separator.
 * @returns the same path with `/` separators.
 */
export function posix(path: string): string {
  return path.split(sep).join("/");
}

/** The `../` segments a forward-slash path starts with. */
const CLIMB = /^(?:\.\.\/)*/u;

/**
 * Shows a report path from the project, whichever way the base and the file
 * spell the project root. On macOS `/var` is a link to `/private/var`: the
 * hook's base is the payload's cwd as written (`/var/...`), a file checked
 * under its real module name is real (`/private/var/...`), and the path
 * between them climbs to `/` (`../../private/var/...`). The part of each
 * side up to the project root is respelled as the real root; below the root
 * both stay as written, so an alias directory keeps its name.
 *
 * Display only: the hooks' start identity (`legacy.ts`) reads the report's
 * own paths against its own base, and must never see these. A path that
 * doesn't climb, or that climbs no less when respelled, is left as it is.
 *
 * @param project - the real project root.
 * @param base - the directory the report's paths are relative to.
 * @param file - a report path, with forward slashes.
 * @returns the path to show, with forward slashes.
 */
function shownPath(project: string, base: string, file: string): string {
  if (!file.startsWith("../")) {
    return file;
  }
  const shown = posix(relative(underRoot(project, base), underRoot(project, resolve(base, file))));
  return climb(shown) < climb(file) ? shown : file;
}

/**
 * Measures how far a path climbs before it goes down.
 *
 * @param path - a relative path, with forward slashes.
 * @returns the length of its leading `../` run.
 */
function climb(path: string): number {
  return CLIMB.exec(path)?.[0].length ?? 0;
}

/**
 * Respells a path's way into the project as the real project root: the
 * outermost directory on it (itself included) whose real path is the root
 * is replaced by the root, and the rest is kept as written.
 *
 * @param project - the real project root.
 * @param path - an absolute path.
 * @returns the path under the real root, or unchanged when it isn't in the project.
 */
function underRoot(project: string, path: string): string {
  const chain: string[] = [];
  for (let dir = path; chain.at(-1) !== dir; dir = dirname(dir)) {
    chain.push(dir);
  }
  const root = chain.reverse().find((dir) => realpath(dir) === project);
  return root === undefined ? path : join(project, relative(root, path));
}

/**
 * Copies findings with their paths as `shownPath` shows them, for output.
 *
 * @param project - the real project root.
 * @param base - the directory their paths are relative to.
 * @param diagnostics - the findings, whose own paths stay untouched.
 * @returns new findings with the paths to show.
 */
export function shownDiagnostics(
  project: string,
  base: string,
  diagnostics: readonly Diagnostic[],
): Diagnostic[] {
  return diagnostics.map((d) => ({ ...d, file: shownPath(project, base, d.file) }));
}

/**
 * Copies a report with every path as `shownPath` shows it, for output: the
 * findings and the suppressed ones SARIF lists.
 *
 * @param project - the real project root.
 * @param base - the directory its paths are relative to.
 * @param report - the report, whose own paths stay untouched.
 * @returns a new report with the paths to show.
 */
export function shownReport(project: string, base: string, report: Report): Report {
  const suppressed = report.suppressed?.map((s) => ({
    ...s,
    diagnostic: { ...s.diagnostic, file: shownPath(project, base, s.diagnostic.file) },
  }));
  return {
    ...report,
    diagnostics: shownDiagnostics(project, base, report.diagnostics),
    ...(suppressed === undefined ? {} : { suppressed }),
  };
}
