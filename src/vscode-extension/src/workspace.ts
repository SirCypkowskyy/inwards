/**
 * The language server's workspace pass: INW007 and INW008 for every Python
 * file under the config root, from a directory listing alone. Nothing is
 * read or parsed, so the pass reaches files the user hasn't opened, and the
 * `__init__.py` of a package that just lost a required member.
 */
import { type Dirent, readdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import {
  checkRequired,
  checkShape,
  type Diagnostic,
  type InwardsConfig,
  membersFrom,
  moduleNameFor,
  packagesOf,
} from "@inwards/core";

const PYTHON = /\.pyi?$/u;
/** Directories that never hold first-party code. */
const SKIP = new Set(["node_modules", "__pycache__"]);

/**
 * Checks the shape of every Python file under the config root.
 *
 * @param config - the project's config.
 * @param root - the config root, absolute.
 * @returns the findings by absolute file path; empty when the config has no shapes or names.
 */
export function workspaceDiagnostics(
  config: InwardsConfig,
  root: string,
): Map<string, Diagnostic[]> {
  const found = new Map<string, Diagnostic[]>();
  if (config.shape === undefined && config.names === undefined) {
    return found;
  }
  const paths = pythonFiles(root, "");
  const diagnostics = [
    ...paths.flatMap((path) => checkShape({ path, text: "", ...moduleNameFor(path) }, config)),
    ...checkRequired(config, packagesOf(paths), membersFrom(paths)),
  ];
  for (const d of diagnostics) {
    const abs = join(root, d.file);
    found.set(abs, [...(found.get(abs) ?? []), d]);
  }
  return found;
}

/**
 * Lists the Python files below a directory, skipping hidden entries,
 * node_modules, __pycache__ and virtualenvs (a directory holding pyvenv.cfg).
 * Symlinks are followed as Python follows them, but only to targets inside
 * the root, and a directory already on the way down (a cycle) is not entered
 * again: the same rules as the CLI's file walk.
 *
 * @param root - the config root.
 * @param rel - the directory to list, relative to the root with forward slashes.
 * @param chain - the real paths of the directories above this one, updated in place.
 * @returns forward-slash paths relative to the root.
 */
function pythonFiles(root: string, rel: string, chain = new Set<string>()): string[] {
  const top = realOrUndefined(root);
  const real = realOrUndefined(join(root, rel));
  let entries: Dirent[];
  try {
    if (top === undefined || !within(top, real) || chain.has(real ?? "")) {
      return [];
    }
    entries = readdirSync(join(root, rel), { withFileTypes: true });
  } catch {
    return []; // deleted or unreadable while listing
  }
  if (rel !== "" && entries.some((e) => e.name === "pyvenv.cfg")) {
    return [];
  }
  chain.add(real ?? "");
  const found = entries.flatMap((entry) => {
    const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.name.startsWith(".") || SKIP.has(entry.name)) {
      return [];
    }
    const stat = statSync(join(root, path), { throwIfNoEntry: false });
    if (stat?.isDirectory()) {
      return pythonFiles(root, path, chain);
    }
    const inside = !entry.isSymbolicLink() || within(top, realOrUndefined(join(root, path)));
    return stat?.isFile() && inside && PYTHON.test(entry.name) ? [path] : [];
  });
  chain.delete(real ?? "");
  return found;
}

/**
 * Tells whether a real path is a directory or inside it.
 *
 * @param top - a real directory.
 * @param real - a real path, or undefined for a dangling one.
 * @returns true when `real` is `top` or below it.
 */
function within(top: string, real: string | undefined): boolean {
  if (real === undefined) {
    return false;
  }
  const rel = relative(top, real);
  return rel === "" || (rel.split(sep)[0] !== ".." && !isAbsolute(rel));
}

/**
 * Resolves a path to its real location.
 *
 * @param path - any path.
 * @returns the canonical path, or undefined when it doesn't exist.
 */
function realOrUndefined(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}
