import { type Dirent, existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

// Only names that can never hold first-party code. `build/` or `dist/` inside a
// package is still Python the agent can import, so those are walked.
const SKIP = new Set(["node_modules", "__pycache__"]);

/**
 * Lists the Python files under each path.
 * A path that is a file is kept as is, whatever its extension. Directories
 * are walked; hidden entries, node_modules, __pycache__ and virtualenvs
 * (any directory holding pyvenv.cfg) are skipped.
 *
 * Symlinks are followed, because Python imports through them, but only when
 * their target stays inside the directory the walk started from: a link to
 * `/` or `$HOME` is not part of the project. A file reachable under two
 * names (a symlinked alias of a package) is listed under both, since Python
 * can import it as either. Only a real cycle stops the walk, detected on the
 * chain of directories above the current one; unreadable directories are
 * skipped.
 *
 * @param paths - files or directories.
 * @returns unique paths, sorted.
 */
export function collectPythonFiles(paths: string[]): string[] {
  return collectFiles(paths, isPythonFile);
}

/**
 * Lists the files under each path whose name matches, with the same walking
 * rules as `collectPythonFiles` (skips, symlinks, cycles).
 *
 * @param paths - files or directories; a file is kept as is.
 * @param match - tells whether a file name is wanted.
 * @returns unique paths, sorted.
 */
export function collectFiles(paths: string[], match: (name: string) => boolean): string[] {
  const out = new Set<string>();
  for (const p of paths) {
    const top = statSync(p).isDirectory() ? realOrUndefined(p) : undefined;
    if (top === undefined) {
      out.add(p);
    } else {
      walk(p, out, { top, chain: new Set<string>(), match });
    }
  }
  return [...out].sort();
}

/** What a walk carries down the tree. */
interface WalkScope {
  top: string;
  chain: Set<string>;
  match: (name: string) => boolean;
}

/**
 * Adds every matching file below a directory to `out`, recursively.
 *
 * @param dir - the directory to walk, as reached (possibly through a symlink).
 * @param out - the collected paths, written in place.
 * @param scope - the real start directory, the real paths of the directories
 *   above this one (a cycle guard, updated in place), and the file-name filter.
 */
function walk(dir: string, out: Set<string>, scope: WalkScope): void {
  const real = realOrUndefined(dir);
  if (real === undefined || scope.chain.has(real) || !isWithin(scope.top, real)) {
    return;
  }
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // unreadable: nothing Python could import from here either
  }
  scope.chain.add(real);
  for (const entry of entries) {
    if (entry.name.startsWith(".") || SKIP.has(entry.name)) {
      continue;
    }
    const full = join(dir, entry.name);
    const kind = entryKind(entry, full);
    if (kind === "file" && scope.match(entry.name) && isWithin(scope.top, realOrUndefined(full))) {
      out.add(full);
    } else if (kind === "dir" && !existsSync(join(full, "pyvenv.cfg"))) {
      walk(full, out, scope);
    }
  }
  scope.chain.delete(real);
}

/**
 * Tells whether a real path is the start directory or below it.
 *
 * @param top - the real start directory.
 * @param real - a real path, or undefined for a dangling one.
 * @returns true when `real` is `top` or inside it.
 */
function isWithin(top: string, real: string | undefined): boolean {
  if (real === undefined) {
    return false;
  }
  const rel = relative(top, real);
  return rel === "" || (rel.split(sep)[0] !== ".." && !isAbsolute(rel));
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
