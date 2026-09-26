/**
 * The language server's workspace pass: INW007 and INW008 for every Python
 * file under the config root, from a directory listing alone. Nothing is
 * read or parsed, so the pass reaches files the user hasn't opened, and the
 * `__init__.py` of a package that just lost a required member.
 */
import { type Dirent, readdirSync } from "node:fs";
import { join } from "node:path";
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
 *
 * @param root - the config root.
 * @param rel - the directory to list, relative to the root with forward slashes.
 * @returns forward-slash paths relative to the root.
 */
function pythonFiles(root: string, rel: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(join(root, rel), { withFileTypes: true });
  } catch {
    return []; // deleted or unreadable while listing
  }
  if (rel !== "" && entries.some((e) => e.name === "pyvenv.cfg")) {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.name.startsWith(".") || SKIP.has(entry.name)) {
      return [];
    }
    if (entry.isDirectory()) {
      return pythonFiles(root, path);
    }
    return entry.isFile() && PYTHON.test(entry.name) ? [path] : [];
  });
}
