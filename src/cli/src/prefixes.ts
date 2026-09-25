/**
 * INW006 prefix checks for a session: which layer prefixes stopped matching
 * modules between SessionStart and now. `git mv shop/domain shop/core` takes
 * every domain module out of the check, so an emptied prefix is an error.
 * Findings that already held at session start never block, so a legacy
 * config with an empty layer doesn't stop every turn.
 */
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { checkPrefixes, type Diagnostic, type InwardsConfig, moduleNameFor } from "@inwards/core";
import { isInside, posix } from "./paths.ts";

/**
 * Finds the prefix errors this session introduced, per config.
 *
 * @param project - the real project root.
 * @param configs - the valid configs now, by project-relative path (the same as at start, or the gate fails anyway).
 * @param before - project-relative Python paths at session start.
 * @param now - project-relative Python paths now.
 * @returns the new errors, located in each pyproject.toml.
 */
export function newPrefixErrors(
  project: string,
  configs: Record<string, InwardsConfig>,
  before: readonly string[],
  now: readonly string[],
): Diagnostic[] {
  return Object.entries(configs).flatMap(([rel, config]) => {
    const path = join(project, rel);
    const root = resolve(dirname(path), config.root);
    const file = { path: rel, text: readFileSync(path, "utf8") };
    const was = modulesUnder(project, root, before);
    const atStart = new Set(checkPrefixes(config, was, file).map((d) => d.message));
    return checkPrefixes(config, modulesUnder(project, root, now), file, was).filter(
      (d) => d.severity === "error" && !atStart.has(d.message),
    );
  });
}

/**
 * Names the modules among project files that lie under a config root.
 *
 * @param project - the real project root.
 * @param root - the config root.
 * @param paths - project-relative Python paths.
 * @returns their dotted module names.
 */
function modulesUnder(project: string, root: string, paths: readonly string[]): Set<string> {
  const modules = new Set<string>();
  for (const path of paths) {
    const abs = join(project, path);
    if (isInside(root, abs)) {
      modules.add(moduleNameFor(posix(relative(root, abs))).module);
    }
  }
  return modules;
}
