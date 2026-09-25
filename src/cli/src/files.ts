import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Only names that can never hold first-party code. `build/` or `dist/` inside a
// package is still Python the agent can import, so those are walked.
const SKIP = new Set(["node_modules", "__pycache__"]);

/**
 * Lists the Python files under each path.
 * A path that is a file is kept as is, whatever its extension. Directories
 * are walked; hidden entries, node_modules, __pycache__ and virtualenvs
 * (any directory holding pyvenv.cfg) are skipped.
 *
 * @param paths - files or directories.
 * @returns unique paths, sorted.
 */
export function collectPythonFiles(paths: string[]): string[] {
  const out = new Set<string>();
  for (const p of paths) {
    if (statSync(p).isDirectory()) {
      walk(p, out);
    } else {
      out.add(p);
    }
  }
  return [...out].sort();
}

/**
 * Adds every Python file below a directory to `out`, recursively.
 *
 * @param dir - the directory to walk.
 * @param out - the collected paths, written in place.
 */
function walk(dir: string, out: Set<string>): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP.has(entry.name)) {
      continue;
    }
    const full = join(dir, entry.name);
    if (!entry.isDirectory()) {
      if (isPythonFile(entry.name)) {
        out.add(full);
      }
    } else if (!existsSync(join(full, "pyvenv.cfg"))) {
      walk(full, out);
    }
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
