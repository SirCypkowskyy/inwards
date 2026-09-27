/**
 * @file Path operations that work on the text of a path alone: containment,
 * separators, forward-slash spelling. Pure: nothing here asks the filesystem,
 * so any feature may use it. For the physical meaning of a path (symlinks,
 * `..` through a link) see `physical.ts`; for how paths are shown, `display.ts`.
 */
import { isAbsolute, relative, sep } from "node:path";

/** Both path separators, so a Windows-style path splits the same everywhere. */
export const PATH_SEPARATORS: RegExp = /[\\/]/u;

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
 * Converts a native path to forward slashes.
 * Diagnostics and SARIF use forward slashes on every OS, so output is identical everywhere.
 *
 * @param path - a path with the platform separator.
 * @returns the same path with `/` separators.
 */
export function posix(path: string): string {
  return path.split(sep).join("/");
}
