/**
 * Layout checks for a session: which layer prefixes stopped matching modules
 * between SessionStart and now, whether layer code moved out of every layer
 * (INW006), and which required package members went missing (INW008).
 * `git mv shop/domain shop/core` takes every domain module out of the check,
 * whether or not an empty file keeps the old prefix alive. Findings that
 * already held at session start never block, so a legacy config with an
 * empty layer, or a package that never had its `service.py`, doesn't stop
 * every turn.
 *
 * `[tool.inwards.rules]` doesn't apply to the prefix and move checks: they
 * catch a layer moved away, a dodge, not a rule to phase in (ADR-027). It
 * does apply to INW008.
 */
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  checkMoves,
  checkPrefixes,
  checkRequired,
  type Diagnostic,
  type InwardsConfig,
  membersFrom,
  moduleNameFor,
  packagesOf,
} from "@inwards/core";
import { isInside, posix } from "./paths.ts";

/**
 * Finds the layout errors this session introduced, per config: emptied
 * prefixes, moved layer code, and missing required members.
 *
 * @param project - the real project root.
 * @param configs - the valid configs now, by project-relative path (the same as at start, or the gate fails anyway).
 * @param before - the session-start manifest: project-relative Python path to content hash.
 * @param now - the manifest now.
 * @returns the new errors, located in each pyproject.toml.
 */
export function newLayoutErrors(
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
    const [wasPaths, isPaths] = [pathsUnder(project, root, before), pathsUnder(project, root, now)];
    const hadMissing = new Set(
      checkRequired(config, packagesOf(wasPaths), membersFrom(wasPaths)).map((d) => d.message),
    );
    const missing = checkRequired(
      config,
      packagesOf(isPaths),
      membersFrom(isPaths),
      posix(relative(project, root)),
    ).filter((d) => !hadMissing.has(d.message));
    const [wasSet, isSet] = [new Set(was.keys()), new Set(is.keys())];
    // The start set as `before` too, so the table doesn't hide a finding here that `emptied` keeps.
    const atStart = new Set(checkPrefixes(config, wasSet, file, wasSet).map((d) => d.message));
    const emptied = checkPrefixes(config, isSet, file, wasSet).filter(
      (d) => d.severity === "error" && !atStart.has(d.message),
    );
    return [...emptied, ...checkMoves(config, was, is, file), ...missing];
  });
}

/**
 * Tells whether a diagnostic is an INW007 finding on a file that existed at
 * session start: legacy layout, reported but never blocking.
 *
 * @param d - a diagnostic whose path is project-relative.
 * @param manifest - the session-start manifest.
 * @returns true for such a finding.
 */
export function preexistingShape(
  d: Diagnostic,
  manifest: Readonly<Record<string, string>>,
): boolean {
  return d.code === "INW007" && manifest[d.file] !== undefined;
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

/**
 * Lists the project files that lie under a config root.
 *
 * @param project - the real project root.
 * @param root - the config root.
 * @param manifest - project-relative Python path to content hash.
 * @returns forward-slash paths relative to the config root.
 */
function pathsUnder(
  project: string,
  root: string,
  manifest: Readonly<Record<string, string>>,
): string[] {
  return Object.keys(manifest)
    .map((path) => join(project, path))
    .filter((abs) => isInside(root, abs))
    .map((abs) => posix(relative(root, abs)));
}
