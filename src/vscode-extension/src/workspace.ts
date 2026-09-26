/**
 * The language server's view of the project on disk: the workspace pass
 * (INW007 and INW008 for every Python file under the config root, from a
 * directory listing alone) and the files behind the engine's module index.
 * The pass reads and parses nothing, so it reaches files the user hasn't
 * opened, and the `__init__.py` of a package that just lost a required member.
 */
import { type Dirent, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import {
  checkRequired,
  checkShape,
  type Diagnostic,
  type InwardsConfig,
  membersFrom,
  moduleNameFor,
  type PathKind,
  type ProjectFiles,
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
 * Gives the engine the files under the config root, for its module index.
 * Nothing is touched until the engine asks; the listing is the workspace
 * pass's, and a file that vanished reads as empty.
 *
 * @param root - the config root, absolute.
 * @returns the probe, listing and reader, with root-relative forward-slash paths.
 */
export function projectFiles(root: string): ProjectFiles {
  return {
    kind: (rel: string): ReturnType<PathKind> => pathKind(root, rel),
    list: (): string[] => pythonFiles(root, ""),
    read: (rel: string): string => {
      try {
        return readFileSync(join(root, rel), "utf8");
      } catch {
        return ""; // deleted since the listing
      }
    },
  };
}

/**
 * Tells what is at a path under the config root, for the module probe.
 *
 * @param root - the config root.
 * @param rel - a forward-slash path relative to it.
 * @returns "file", "dir", or undefined when nothing is there.
 */
function pathKind(root: string, rel: string): ReturnType<PathKind> {
  const stat = statSync(join(root, rel), { throwIfNoEntry: false });
  if (stat?.isDirectory()) {
    return "dir";
  }
  return stat?.isFile() ? "file" : undefined;
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
  return real === top || (real?.startsWith(top.endsWith(sep) ? top : `${top}${sep}`) ?? false);
}

/**
 * Resolves a path to its real location.
 *
 * @param path - any path.
 * @returns the canonical path, or undefined when it (or a link's target) doesn't exist.
 */
function realOrUndefined(path: string): string | undefined {
  let real: string | undefined;
  try {
    real = realpathSync(path);
  } catch {
    // dangling, or deleted while the pass ran
  }
  return real;
}
