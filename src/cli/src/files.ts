import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SKIP = new Set(["node_modules", "__pycache__", "site", "dist", "build"]);

/** Python files under each path. Hidden directories and virtualenvs are skipped. */
export function collectPythonFiles(paths: string[]): string[] {
  const out = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".py") || entry.name.endsWith(".pyi")) out.add(full);
    }
  };
  for (const p of paths) {
    if (statSync(p).isDirectory()) walk(p);
    else out.add(p);
  }
  return [...out].sort();
}
