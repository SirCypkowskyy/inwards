import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Only names that can never hold first-party code. `build/` or `dist/` inside a
// package is still Python the agent can import, so those are walked.
const SKIP = new Set(["node_modules", "__pycache__"]);

/** Python files under each path. Hidden directories and virtualenvs (pyvenv.cfg) are skipped. */
export function collectPythonFiles(paths: string[]): string[] {
  const out = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!existsSync(join(full, "pyvenv.cfg"))) walk(full);
      } else if (entry.name.endsWith(".py") || entry.name.endsWith(".pyi")) out.add(full);
    }
  };
  for (const p of paths) {
    if (statSync(p).isDirectory()) walk(p);
    else out.add(p);
  }
  return [...out].sort();
}
