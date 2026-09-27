/**
 * Observations of the real filesystem that policy code asks for by name
 * instead of calling `node:fs` itself: whether a path is a directory, and
 * similar yes/no questions. Each one answers "no" when the path can't be
 * looked at, so callers never handle filesystem errors.
 */
import { statSync } from "node:fs";
/**
 * Tells whether a path is a directory.
 *
 * @param path - any path.
 * @returns true for an existing directory.
 */
export function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
