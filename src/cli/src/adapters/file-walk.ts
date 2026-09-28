/**
 * @file Walking a project tree for its files, behind the `FileWalker` contract.
 * The rules (skips, symlinks, cycles, layer packages walked in full) are
 * described on `collectPythonFiles`; `collectLinks` lists the symlinks in a
 * layer package, following only those that stay in the root, for INW006 (#83, #84).
 */
import { type Dirent, existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import type { FileWalker } from "../platform/contracts.ts";

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
 * Inside a layer's package (`open`), and on the way down to one, nothing but
 * hidden entries is skipped: Python imports `shop.domain.node_modules.x` or a
 * package that holds a pyvenv.cfg just fine, so neither may hide code from
 * its layer. A directory counts as inside by the path it was reached through
 * as well as its real path, since Python names a module after the former.
 *
 * @param paths - files or directories.
 * @param open - directories walked without the skip rules (layer packages, as written and real).
 * @returns unique paths, sorted.
 */
export function collectPythonFiles(paths: string[], open: readonly string[] = []): string[] {
  return collectFiles(paths, isPythonFile, open);
}

/**
 * Lists the files under each path whose name matches, with the same walking
 * rules as `collectPythonFiles` (skips, symlinks, cycles).
 *
 * @param paths - files or directories; a file is kept as is.
 * @param match - tells whether a file name is wanted.
 * @param open - directories walked without the skip rules.
 * @returns unique paths, sorted.
 */
function collectFiles(
  paths: string[],
  match: (name: string) => boolean,
  open: readonly string[] = [],
): string[] {
  const out = new Set<string>();
  for (const p of paths) {
    const top = statSync(p).isDirectory() ? realOrUndefined(p) : undefined;
    if (top === undefined) {
      out.add(p);
    } else {
      walk(p, out, { top, chain: new Set<string>(), match, open });
    }
  }
  return [...out].sort();
}

/** What a walk carries down the tree. */
interface WalkScope {
  top: string;
  chain: Set<string>;
  match: (name: string) => boolean;
  open: readonly string[];
}

/**
 * Adds every matching file below a directory to `out`, recursively.
 *
 * @param dir - the directory to walk, as reached (possibly through a symlink).
 * @param out - the collected paths, written in place.
 * @param scope - the real start directory, the real paths of the directories
 *   above this one (a cycle guard, updated in place), the file-name filter and
 *   the directories walked without skips.
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
    if (entry.name.startsWith(".")) {
      continue;
    }
    const full = join(dir, entry.name);
    const kind = entryKind(entry, full);
    if (kind === "file" && scope.match(entry.name) && isWithin(scope.top, realOrUndefined(full))) {
      out.add(full);
    } else if (kind === "dir" && (isOpen(full, scope.open) || !skipped(entry.name, full))) {
      walk(full, out, scope);
    }
  }
  scope.chain.delete(real);
}

/**
 * Tells whether a directory is skipped outside layer packages: node_modules,
 * __pycache__ and virtualenvs (any directory holding pyvenv.cfg).
 *
 * @param name - the directory's name.
 * @param full - its path.
 * @returns true when the walk should not enter it.
 */
function skipped(name: string, full: string): boolean {
  return SKIP.has(name) || existsSync(join(full, "pyvenv.cfg"));
}

/**
 * Tells whether a directory is in a layer package or above one, where nothing is skipped.
 *
 * @param dir - a directory path, as reached.
 * @param open - layer package directories, as written and real.
 * @returns true when the path as reached, or its real path, is inside or above one of them.
 */
function isOpen(dir: string, open: readonly string[]): boolean {
  if (open.length === 0) {
    return false;
  }
  const spellings = [dir, realOrUndefined(dir)];
  return open.some((top) =>
    spellings.some((path) => isWithin(top, path) || (path !== undefined && isWithin(path, top))),
  );
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
 * @returns "dir" or "file", or undefined for a dangling symlink or anything
 *   else (a FIFO named x.py would hang the read).
 */
function entryKind(entry: Dirent, full: string): "dir" | "file" | undefined {
  if (entry.isSymbolicLink()) {
    return linkTargetKind(full);
  }
  if (entry.isDirectory()) {
    return "dir";
  }
  return entry.isFile() ? "file" : undefined;
}

/**
 * Tells what a symlink points at.
 *
 * @param link - path of the symlink.
 * @returns "dir" or "file", or undefined for a dangling link or a special file.
 */
function linkTargetKind(link: string): "dir" | "file" | undefined {
  try {
    const stat = statSync(link);
    if (stat.isDirectory()) {
      return "dir";
    }
    return stat.isFile() ? "file" : undefined;
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

/**
 * Lists the symlinks below a directory that Python could import through: to
 * a directory, or to a `.py` or `.pyi` file. Each is listed by the path it is
 * reached through, since Python names the code behind it that way.
 *
 * A link to a directory inside `top` (the real config root) is followed as
 * well, so a chain such as `shop/domain/a -> ../misc` plus
 * `shop/misc/y -> ../infrastructure` shows up as `shop/domain/a/y`. A link
 * out of `top` is listed and never followed, so a link to `/` costs one entry
 * and no walk. Only a real cycle stops the walk, detected on the chain of
 * real directories above the current one. Only hidden entries are skipped:
 * the directories are layer packages, where a `node_modules` or virtualenv
 * name hides nothing.
 *
 * @param dir - the directory to walk; unreadable ones give nothing.
 * @param top - the real directory whose links are followed.
 * @param chain - the real paths of the directories above, a cycle guard updated in place.
 * @param out - the links found so far, written in place.
 * @returns `out`, each link as reached with its real target; dangling links are left out.
 */
function collectLinks(
  dir: string,
  top: string,
  chain: Set<string> = new Set<string>(),
  out: { path: string; target: string }[] = [],
): { path: string; target: string }[] {
  const real = realOrUndefined(dir);
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // unreadable, or not a directory
  }
  if (real === undefined || chain.has(real)) {
    return out;
  }
  chain.add(real);
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.name.startsWith(".")) {
      continue;
    }
    if (entry.isSymbolicLink()) {
      linkEntry(full, top, chain, out);
    } else if (entry.isDirectory()) {
      collectLinks(full, top, chain, out);
    }
  }
  chain.delete(real);
  return out;
}

/**
 * Records one symlink if Python could import through it, and walks on
 * through a link to a directory that stays inside `top`.
 *
 * @param link - the symlink, as reached.
 * @param top - the real directory whose links are followed.
 * @param chain - the real paths of the directories above, a cycle guard.
 * @param out - the links found so far, written in place.
 */
function linkEntry(
  link: string,
  top: string,
  chain: Set<string>,
  out: { path: string; target: string }[],
): void {
  const kind = linkTargetKind(link);
  const target = realOrUndefined(link);
  if (target === undefined || !(kind === "dir" || (kind === "file" && isPythonFile(link)))) {
    return; // dangling, or nothing Python imports
  }
  out.push({ path: link, target });
  if (kind === "dir" && isWithin(top, target)) {
    collectLinks(link, top, chain, out);
  }
}

/** The walk behind the `FileWalker` contract. */
export const nodeFileWalker: FileWalker = {
  pythonFiles: collectPythonFiles,
  files: collectFiles,
  links: (dir: string, top: string) => collectLinks(dir, top),
};
