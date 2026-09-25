/**
 * INW006 layout checks for a session: which layer prefixes stopped matching
 * modules between SessionStart and now, and whether layer code moved out of
 * every layer. `git mv shop/domain shop/core` takes every domain module out of
 * the check, whether or not an empty file keeps the old prefix alive.
 * Findings that already held at session start never block, so a legacy
 * config with an empty layer doesn't stop every turn.
 */
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  checkMoves,
  checkPrefixes,
  type Diagnostic,
  type InwardsConfig,
  moduleNameFor,
} from "@inwards/core";
import { isInside, posix } from "./paths.ts";

/**
 * Finds the layout errors this session introduced, per config.
 *
 * @param project - the real project root.
 * @param configs - the valid configs now, by project-relative path (the same as at start, or the gate fails anyway).
 * @param before - the session-start manifest: project-relative Python path to content hash.
 * @param now - the manifest now.
 * @returns the new errors, located in each pyproject.toml.
 */
export function newPrefixErrors(
  project: string,
  configs: Record<string, InwardsConfig>,
  before: Readonly<Record<string, string>>,
  now: Readonly<Record<string, string>>,
): Diagnostic[] {
  return Object.entries(configs).flatMap(([rel, config]) => {
    const path = join(project, rel);
    const root = resolve(dirname(path), config.root);
    const file = { path: rel, text: readFileSync(path, "utf8") };
    const was = modulesUnder(project, root, before);
    const is = modulesUnder(project, root, now);
    const [wasSet, isSet] = [new Set(was.keys()), new Set(is.keys())];
    const atStart = new Set(checkPrefixes(config, wasSet, file).map((d) => d.message));
    const emptied = checkPrefixes(config, isSet, file, wasSet).filter(
      (d) => d.severity === "error" && !atStart.has(d.message),
    );
    return [...emptied, ...checkMoves(config, was, is, file)];
  });
}

/**
 * Names the modules among project files that lie under a config root.
 *
 * @param project - the real project root.
 * @param root - the config root.
 * @param manifest - project-relative Python path to content hash.
 * @returns dotted module name to content hash.
 */
function modulesUnder(
  project: string,
  root: string,
  manifest: Readonly<Record<string, string>>,
): Map<string, string> {
  const modules = new Map<string, string>();
  for (const [path, hash] of Object.entries(manifest)) {
    const abs = join(project, path);
    if (isInside(root, abs)) {
      modules.set(moduleNameFor(posix(relative(root, abs))).module, hash);
    }
  }
  return modules;
}
