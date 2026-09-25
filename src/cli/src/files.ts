import { type Dirent, existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";

// Only names that can never hold first-party code. `build/` or `dist/` inside a
// package is still Python the agent can import, so those are walked.
const SKIP = new Set(["node_modules", "__pycache__"]);

/**
 * Lists the Python files under each path.
 * A path that is a file is kept as is, whatever its extension. Directories
 * are walked; hidden entries, node_modules, __pycache__ and virtualenvs
 * (any directory holding pyvenv.cfg) are skipped. Symlinks are followed,
 * because Python imports through them: a package that is a symlinked
 * directory is still a package. Each real directory is walked once, so a
 * link cycle ends. Paths keep the spelling they were found under.
 *
 * @param paths - files or directories.
 * @returns unique paths, sorted.
 */
export function collectPythonFiles(paths: string[]): string[] {
  const out = new Set<string>();
  const seen = new Set<string>();
  for (const p of paths) {
    if (statSync(p).isDirectory()) {
      walk(p, out, seen);
    } else {
      out.add(p);
    }
  }
  return [...out].sort();
}

/**
 * Adds every Python file below a directory to `out`, recursively.
 *
 * @param dir - the directory to walk, as reached (possibly through a symlink).
 * @param out - the collected paths, written in place.
 * @param seen - real paths of directories already walked, written in place.
 */
function walk(dir: string, out: Set<string>, seen: Set<string>): void {
  const real = realOrUndefined(dir);
  if (real === undefined || seen.has(real)) {
    return;
  }
  seen.add(real);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP.has(entry.name)) {
      continue;
    }
    const full = join(dir, entry.name);
    const kind = entryKind(entry, full);
    if (kind === "file" && isPythonFile(entry.name)) {
      out.add(full);
    } else if (kind === "dir" && !existsSync(join(full, "pyvenv.cfg"))) {
      walk(full, out, seen);
    }
  }
}

/**
 * Tells whether a directory entry is a directory or a file, looking through symlinks.
 *
 * @param entry - the entry as `readdirSync` returned it.
 * @param full - its full path, used to follow a symlink.
 * @returns "dir" or "file", or undefined for a dangling symlink.
 */
function entryKind(entry: Dirent, full: string): "dir" | "file" | undefined {
  if (entry.isSymbolicLink()) {
    return linkTargetKind(full);
  }
  return entry.isDirectory() ? "dir" : "file";
}

/**
 * Tells what a symlink points at.
 *
 * @param link - path of the symlink.
 * @returns "dir" or "file", or undefined for a dangling link.
 */
function linkTargetKind(link: string): "dir" | "file" | undefined {
  try {
    return statSync(link).isDirectory() ? "dir" : "file";
  } catch {
    return undefined;
  }
}

/**
 * Resolves a path to its real location.
 *
 * @param path - any path.
 * @returns the canonical path, or undefined when it does not exist.
 */
function realOrUndefined(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

/**
 * Tells whether a file name is Python source or a stub.
 *
 * @param name - a file name.
 * @returns true for `.py` and `.pyi`.
 */
function isPythonFile(name: string): boolean {
  return name.endsWith(".py") || name.endsWith(".pyi");
}
