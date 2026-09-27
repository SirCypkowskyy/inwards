/**
 * @file What a session changed, for the Stop gate: which Python files differ from
 * the session start, and a check of those files, each against the config it
 * falls under at session start. A config set to `stop-gate = "project"` gets
 * a whole-project check instead. Violations a changed file already had at
 * session start and suppressions the agent added are sorted out here, with
 * the invocation's start lookups.
 */
import { dirname, join } from "node:path";
import type { Diagnostic, InwardsConfig, Report } from "@inwards/core";
import { CONFIG_DEFAULTS } from "@inwards/core";
import type { Platform } from "../platform/contracts.ts";
import { findConfig } from "../project/config-discovery.ts";
import { projectPath } from "../project/snapshot.ts";
import { agentSuppressions } from "../session/agent-suppressions.ts";
import type { StartLookups } from "../session/lookups.ts";
import { oldErrors } from "../session/old-errors.ts";
import type { SessionState } from "../session/record.ts";

const PYTHON_FILE = /\.pyi?$/u;

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
 * Checks changed files, each against its own config. A file whose config
 * didn't exist at session start is not checked with it: a new nested
 * pyproject.toml with a permissive table would otherwise waive the layers.
 * A file under a config that was already invalid is skipped, since that
 * config governs nothing, and so is one under a config that is invalid now
 * (the config comparison reports that). A config set to `stop-gate =
 * "project"` at session start gets a whole-project check instead, changed
 * files or not, from every path it was found at, but only while the
 * baselines can be trusted: otherwise it would report every legacy violation.
 *
 * @param lookups - this invocation's start lookups, with the project and the check runner.
 * @param files - absolute changed files.
 * @param configs - the session start, with its valid and invalid configs, and the valid configs now.
 * @param configs.start - the session start.
 * @param configs.now - the valid configs now.
 * @param configs.found - where each valid config was found now.
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
  }: {
    start: SessionState["start"];
    now: Record<string, InwardsConfig>;
    found: Record<string, string[]>;
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
      const check = { configPath: config, base: project, baseline };
      const { report, rejected } = await agentSuppressions(
        lookups,
        start,
        check,
        await lookups.check(config, group, project, { baseline }),
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
