import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Only names that can never hold first-party code. `build/` or `dist/` inside a
// package is still Python the agent can import, so those are walked.
const SKIP = new Set(["node_modules", "__pycache__"]);

/** Python files under each path. Hidden directories and virtualenvs (pyvenv.cfg) are skipped. */
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

function isPythonFile(name: string): boolean {
  return name.endsWith(".py") || name.endsWith(".pyi");
}
