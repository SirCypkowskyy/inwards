/**
 * Path handling the CLI and the hook share: real paths, containment, the
 * physical meaning of `..`, and config discovery (ADR-013).
 */
import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { declaresInwards } from "@inwards/core";

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
