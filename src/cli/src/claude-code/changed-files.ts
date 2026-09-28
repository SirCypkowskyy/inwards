/**
 * @file What a session changed, for the Stop gate: which Python files differ from
 * the session start, and a check of those files, each against the config it
 * falls under at session start. A config set to `stop-gate = "project"` gets
 * a whole-project check instead. Violations a changed file already had at
 * session start and suppressions the agent added are sorted out here, with
 * the invocation's start lookups. A config the agent changed checks with its
 * session-start version.
 *
 * A top-level package that appeared during the session can turn an old
 * import, such as `import requests` in a layer, into first-party code
 * (#86). The files that mention its name are checked too, and their
 * session-start check doesn't see the package, so what it changed is new.
 */
import { dirname, join, relative, resolve } from "node:path";
import type { Diagnostic, InwardsConfig, Report } from "@inwards/core";
import { CONFIG_DEFAULTS } from "@inwards/core";
import { isInside, posix } from "../paths/lexical.ts";
import type { Platform } from "../platform/contracts.ts";
import { findConfig } from "../project/config-discovery.ts";
import { projectPath } from "../project/snapshot.ts";
import { agentSuppressions } from "../session/agent-suppressions.ts";
import type { StartLookups } from "../session/lookups.ts";
import { oldErrors } from "../session/old-errors.ts";
import type { SessionState } from "../session/record.ts";

const PYTHON_FILE = /\.pyi?$/u;
/** A config root and the top-level module names that appeared under it this session. */
interface Fresh {
  root: string;
  names: string[];
}
/** Text outside printable ASCII, which Python NFKC-normalises in identifiers. */
const NON_ASCII = /[^ -~\t\n\r\f]/u;

/**
 * Collects the Python files this session changed: the edits the hook saw,
 * the manifest diff since SessionStart, and the start files whose path lost
 * its start identity to a symlink, even with the same bytes (`relinked`).
 *
 * @param io - tells what each path is.
 * @param lookups - this invocation's start lookups, for `relinked`.
 * @param state - the session state.
 * @param manifest - the content hashes now, from `projectManifest`.
 * @returns absolute paths of changed Python files that still exist as regular files.
 */
export function changedFiles(
  io: Pick<Platform, "probe">,
  lookups: StartLookups,
  state: SessionState,
  manifest: Record<string, string>,
): string[] {
  const { project } = lookups;
  const changed = new Set([
    ...state.edited,
    ...lookups.identity.relinked(project, state.start.manifest),
  ]);
  for (const [path, hash] of Object.entries(manifest)) {
    if (state.start.manifest[path] !== hash) {
      changed.add(path);
    }
  }
  return [...changed]
    .filter((path) => PYTHON_FILE.test(path))
    .map((path) => join(project, path))
    .filter((path) => io.probe.kind(path) === "file");
}

/**
 * Names the top-level modules and packages that appeared under each
 * config's root during the session: the first segment of a Python file's
 * path under the root, without `.py` or `.pyi`, that no start file had.
 *
 * @param project - the real project root.
 * @param configs - the valid configs now, by project-relative path.
 * @param manifests - project-relative Python path to content hash, at start and now.
 * @param manifests.before - the session-start manifest.
 * @param manifests.now - the manifest now.
 * @returns each config root and its new top-level names, by project-relative
 *   config path; configs without any are left out.
 */
export function newTopLevel(
  project: string,
  configs: Record<string, InwardsConfig>,
  { before, now }: { before: Record<string, string>; now: Record<string, string> },
): Record<string, Fresh> {
  const fresh: Record<string, Fresh> = {};
  for (const [rel, config] of Object.entries(configs)) {
    const root = resolve(dirname(join(project, rel)), config.root);
    const was = topLevel(project, root, before);
    const names = [...topLevel(project, root, now)].filter((name) => !was.has(name));
    if (names.length > 0) {
      fresh[rel] = { root, names };
    }
  }
  return fresh;
}

/**
 * Lists the top-level module names of the manifest's files under a root.
 *
 * @param project - the real project root.
 * @param root - the config root.
 * @param manifest - project-relative Python path to content hash.
 * @returns each first path segment under the root, without a Python suffix.
 */
function topLevel(project: string, root: string, manifest: Record<string, string>): Set<string> {
  const names = new Set<string>();
  for (const path of Object.keys(manifest)) {
    const abs = join(project, path);
    if (isInside(root, abs)) {
      const first = posix(relative(root, abs)).split("/")[0] ?? "";
      names.add(first.replace(PYTHON_FILE, ""));
    }
  }
  return names;
}

/**
 * Finds the files that may import a top-level name new this session: every
 * Python file under that config's root whose text, NFKC-normalised when it
 * isn't ASCII, mentions the name. A file that can't be read is included, so
 * the check reports on it. It reads every file under such a root, but only
 * in a session that added a top-level package.
 *
 * @param io - reads the files.
 * @param project - the real project root.
 * @param fresh - each config's root and new top-level names, from `newTopLevel`.
 * @param manifest - the content hashes now.
 * @returns absolute paths of the files that mention a new name.
 */
export function freshImporters(
  io: Pick<Platform, "read">,
  project: string,
  fresh: Record<string, Fresh>,
  manifest: Record<string, string>,
): string[] {
  const found: string[] = [];
  for (const { root, names } of Object.values(fresh)) {
    for (const path of Object.keys(manifest)) {
      const abs = join(project, path);
      if (isInside(root, abs) && mentionsAny(io, abs, names)) {
        found.push(abs);
      }
    }
  }
  return found;
}

/**
 * Tells whether a file's text mentions any of some names.
 *
 * @param io - reads the file.
 * @param file - the absolute file.
 * @param names - the words to look for.
 * @returns true when a name appears, or the file can't be read.
 */
function mentionsAny(io: Pick<Platform, "read">, file: string, names: readonly string[]): boolean {
  let text: string;
  try {
    text = io.read.text(file);
  } catch {
    return true; // unreadable: let the check say why
  }
  const plain = NON_ASCII.test(text) ? text.normalize("NFKC") : text;
  return names.some((name) => plain.includes(name));
}

/**
 * Checks changed files, each against its own config. A file whose config
 * didn't exist at session start is not checked with it: a new nested
 * pyproject.toml with a permissive table would otherwise waive the layers.
 * A file under a config that was already invalid is skipped, since that
 * config governs nothing, and so is one under a config that is invalid now
 * (the config comparison reports that). A config set to `stop-gate =
 * "project"` at session start gets a whole-project check instead, changed
 * files or not, from every path it was found at, but only while the
 * baselines can be trusted: otherwise it would report every legacy violation.
 * A config that changed during the session checks with its session-start
 * version, so the report shows what the change would hide, such as a
 * violation of a rule it now ignores (#164); the change itself fails the
 * gate in `stop-gate.ts`. A top-level package new this session is hidden
 * from the session-start check of old errors, as it wasn't there then.
 *
 * @param lookups - this invocation's start lookups, with the project and the check runner.
 * @param files - absolute changed files.
 * @param configs - the session start, with its valid and invalid configs, and the valid configs now.
 * @param configs.start - the session start.
 * @param configs.now - the valid configs now.
 * @param configs.found - where each valid config was found now.
 * @param configs.fresh - the top-level names new this session by config, from `newTopLevel`.
 * @param baseline - false to report violations the baselines accept.
 * @returns the merged report without the errors the changed files already had
 *   at session start, those errors (never in a whole-project check), the
 *   findings whose inline suppression was rejected (`agent-suppressions`), each file
 *   governed by an unknown config with that config, and the project-relative
 *   configs the checked files fall under.
 */
export async function checkChanged(
  lookups: StartLookups,
  files: string[],
  {
    start,
    now,
    found,
    fresh = {},
  }: {
    start: SessionState["start"];
    now: Record<string, InwardsConfig>;
    found: Record<string, string[]>;
    fresh?: Record<string, Fresh>;
  },
  baseline: boolean,
): Promise<{
  report: Report;
  old: Diagnostic[];
  rejected: Diagnostic[];
  strangers: [string, string][];
  governing: string[];
}> {
  const { project } = lookups;
  // Targets by config path; undefined checks the whole project.
  const byConfig = new Map<string, string[] | undefined>();
  const strangers: [string, string][] = [];
  for (const file of files) {
    const config = findConfig(lookups, dirname(file), project);
    if (config === undefined) {
      continue;
    }
    const rel = projectPath(lookups.probe, project, config);
    if (start.invalid?.includes(rel)) {
      continue;
    }
    if (start.configs[rel] === undefined) {
      strangers.push([projectPath(lookups.probe, project, file), rel]);
    } else if (now[rel] !== undefined) {
      byConfig.set(config, [...(byConfig.get(config) ?? []), file]);
    }
  }
  for (const path of baseline ? wholeProject(start.configs, now, found) : []) {
    byConfig.set(path, undefined);
  }
  const reports = await Promise.all(
    [...byConfig].map(async ([config, group]) => {
      const rel = projectPath(lookups.probe, project, config);
      const check = {
        configPath: config,
        base: project,
        baseline,
        config: startIfChanged(start.configs, now, rel),
        absent: fresh[rel]?.names,
      };
      const { report, rejected } = await agentSuppressions(
        lookups,
        start,
        check,
        await lookups.check(config, group, project, { baseline, config: check.config }),
      );
      const old = group ? await oldErrors(lookups, start, check, report.diagnostics) : [];
      const diagnostics = report.diagnostics.filter((d) => !old.includes(d));
      return { ...report, diagnostics, old, rejected };
    }),
  );
  return {
    old: reports.flatMap((r) => r.old),
    rejected: reports.flatMap((r) => r.rejected),
    report: {
      diagnostics: reports.flatMap((r) => r.diagnostics),
      suppressed: reports.flatMap((r) => r.suppressed ?? []),
      filesChecked: reports.reduce((n, r) => n + r.filesChecked, 0),
      durationMs: Math.max(0, ...reports.map((r) => r.durationMs)),
    },
    strangers,
    governing: [...byConfig.keys()].map((config) => projectPath(lookups.probe, project, config)),
  };
}

/**
 * Picks the session-start version of a config the agent changed, so the check
 * shows what the change would hide (#164).
 *
 * @param start - the configs at session start, by project-relative path.
 * @param now - the valid configs now.
 * @param rel - the project-relative pyproject.toml.
 * @returns the start config when it differs from the one now, else undefined
 *   (check with the config on disk, as for an unchanged one).
 */
function startIfChanged(
  start: Record<string, InwardsConfig>,
  now: Record<string, InwardsConfig>,
  rel: string,
): InwardsConfig | undefined {
  return JSON.stringify(start[rel]) === JSON.stringify(now[rel]) ? undefined : start[rel];
}

/**
 * Lists the configs the Stop gate checks in full: `stop-gate = "project"` at
 * session start, still valid now, at every path each was found at.
 *
 * @param start - the configs at session start, by project-relative path.
 * @param now - the valid configs now.
 * @param found - where each valid config was found now.
 * @returns absolute pyproject.toml paths.
 */
function wholeProject(
  start: Record<string, InwardsConfig>,
  now: Record<string, InwardsConfig>,
  found: Record<string, string[]>,
): string[] {
  return Object.entries(start)
    .filter(
      ([rel, config]) =>
        (config.stopGate ?? CONFIG_DEFAULTS.stopGate) === "project" && now[rel] !== undefined,
    )
    .flatMap(([rel]) => found[rel] ?? []);
}
