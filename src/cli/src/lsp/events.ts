/**
 * @file Which file events make the language server check the project again.
 * Every pass reads the config, the baseline, the listing and the files afresh
 * (ADR-041), so an event only decides when a pass runs, never what it may
 * keep. Anything that can change what `inwards check` says counts: a module
 * file or a directory created, changed or deleted, a pyproject.toml, or a
 * baseline. Hidden directories (`.git`, `.venv`, `.inwards`) and compiled
 * caches don't. Pure path text; nothing is read.
 */
import { relative } from "node:path";
import { isInside } from "../paths/lexical.ts";
import { BASELINE_FILE } from "../project/baseline.ts";
import type { FileChange } from "./contracts.ts";

/** Files Python can import a module from. */
const MODULE_FILE = /\.(?:py|pyi|so|pyd|pyx|pyc)$/u;
/** Either separator, since a path from a URI on Windows may hold both. */
const SEPARATOR = /[\\/]/u;

/**
 * Tells whether one event under the workspace can change a finding: a
 * module file, a name without a dot (a directory, since a deleted path can't
 * be looked at), the config or the baseline, outside hidden directories and
 * `__pycache__`.
 *
 * @param folders - the workspace folders, absolute.
 * @param path - the event's absolute path.
 * @returns false for an event the server can ignore.
 */
function matters(folders: readonly string[], path: string): boolean {
  const folder = folders.find((dir) => isInside(dir, path));
  if (folder === undefined) {
    return false; // editors watch inside the workspace only
  }
  const parts = relative(folder, path).split(SEPARATOR);
  const name = parts.at(-1) ?? "";
  if (parts.some((part) => part.startsWith(".") || part === "__pycache__")) {
    return false;
  }
  return (
    name === "pyproject.toml" ||
    name === BASELINE_FILE ||
    !name.includes(".") ||
    MODULE_FILE.test(name)
  );
}

/**
 * Tells whether a batch of events needs a new pass.
 *
 * @param folders - the workspace folders, absolute.
 * @param events - each event's kind and absolute path.
 * @returns true when any of them matters.
 */
export function needsPass(
  folders: readonly string[],
  events: readonly { kind: FileChange; path: string }[],
): boolean {
  return events.some(({ path }) => matters(folders, path));
}
