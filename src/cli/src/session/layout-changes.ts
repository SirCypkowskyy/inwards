/**
 * @file Layout checks for a session: which layer prefixes stopped matching modules
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
 *
 * Pure over what it is given: the caller supplies each config's text with the
 * manifests, and start identity comes from the invocation's `StartIdentity`.
 */
import { dirname, join, relative, resolve } from "node:path";
import {
  checkLinks,
  checkMoves,
  checkPrefixes,
  checkRequired,
  type Diagnostic,
  type InwardsConfig,
  membersFrom,
  moduleNameFor,
  packagesOf,
} from "@inwards/core";
import { isInside, posix } from "../paths/lexical.ts";
import type { PathProbe } from "../platform/contracts.ts";
import { linksUnder } from "../project/links.ts";
import type { StartIdentity } from "./start-identity.ts";

/**
 * Finds the layout errors this session introduced, per config: emptied
 * prefixes, moved layer code, missing required members, and symlinks in
 * layers that hide code from the rules (`checkLinks`). A start record
 * without links (an older state file) makes every such link new: fail closed.
 *
 * @param project - the real project root.
 * @param configs - the valid configs now, and each one's pyproject.toml text for locating
 *   findings, by project-relative path (the same as at start, or the gate fails anyway).
 * @param configs.valid - the parsed configs.
 * @param configs.texts - their pyproject.toml texts.
 * @param manifests - project-relative Python path to content hash, at start and now.
 * @param manifests.before - the session-start manifest.
 * @param manifests.now - the manifest now.
 * @param links - the symlinks in layer packages, at start and now, and a real-path probe.
 * @param links.before - project-relative link path to its project-relative real target, at start.
 * @param links.now - the same, now.
 * @param links.probe - resolves each config root's real path.
 * @returns the new errors, located in each pyproject.toml, or at the link for a link.
 */
export function newLayoutErrors(
  project: string,
  {
    valid: configs,
    texts,
  }: { valid: Record<string, InwardsConfig>; texts: Readonly<Record<string, string>> },
  {
    before,
    now,
  }: { before: Readonly<Record<string, string>>; now: Readonly<Record<string, string>> },
  links: {
    before: Readonly<Record<string, string>> | undefined;
    now: Readonly<Record<string, string>>;
    probe: Pick<PathProbe, "realpath">;
  },
): Diagnostic[] {
  return Object.entries(configs).flatMap(([rel, config]) => {
    const path = join(project, rel);
    const root = resolve(dirname(path), config.root);
    const file = { path: rel, text: texts[rel] ?? "" };
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
    const shownRoot = posix(relative(project, root));
    const linked = checkLinks(
      config,
      {
        links: linksUnder(links.probe, absolute(project, links.now), root, config),
        modules: isSet,
        shownRoot,
      },
      {
        links: linksUnder(links.probe, absolute(project, links.before ?? {}), root, config),
        modules: wasSet,
        shownRoot,
      },
    );
    return [...emptied, ...checkMoves(config, was, is, file), ...missing, ...linked];
  });
}

/**
 * Turns recorded links back into absolute paths.
 *
 * @param project - the real project root.
 * @param links - project-relative link path to its project-relative real target.
 * @returns each link and target, absolute.
 */
function absolute(
  project: string,
  links: Readonly<Record<string, string>>,
): { path: string; target: string }[] {
  return Object.entries(links).map(([path, target]) => ({
    path: join(project, path),
    target: join(project, target),
  }));
}

/**
 * Tells whether a diagnostic is an INW007 finding on a file that existed at
 * session start as itself (`existedAtStart`): legacy layout, reported but
 * never blocking. A start path that is now a symlink doesn't count.
 *
 * @param identity - this invocation's start identity checks.
 * @param d - a diagnostic whose path is project-relative.
 * @param project - the real project root.
 * @param start - the session's start record.
 * @param start.manifest - SHA-256 of every Python file at session start, by project path.
 * @returns true for such a finding.
 */
export function preexistingShape(
  identity: Pick<StartIdentity, "existedAtStart">,
  d: Diagnostic,
  project: string,
  start: { manifest: Record<string, string> },
): boolean {
  return d.code === "INW007" && identity.existedAtStart(project, start, { base: project }, d.file);
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
