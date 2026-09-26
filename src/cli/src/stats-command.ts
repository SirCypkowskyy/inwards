/**
 * The `inwards stats` command: finds the project, reads its run logs, and
 * prints the hypothesis numbers, each next to its chapter-2 threshold.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { exportRunLogs } from "./log-export.ts";
import { print } from "./output.ts";
import { realpath } from "./paths.ts";
import { logDirs, readRunLogs } from "./runs.ts";
import { git, projectConfigs } from "./snapshot.ts";
import { computeStats, type Stats } from "./stats.ts";

const PERCENT = 100;

/**
 * Runs `inwards stats`. The project is DIR, else `CLAUDE_PROJECT_DIR`, else
 * the git work tree around the working directory, else the folder
 * `projectRoot` finds: the hooks log at that root and `check` next to each
 * config below it. With `--export FILE`, it writes the merged log instead of
 * the numbers, with `--redact` hashing every path.
 *
 * @param format - `text` or `json`.
 * @param dir - the DIR argument, if given.
 * @param sharing - `--export` and `--redact`.
 * @param sharing.export - the file to write the merged log to.
 * @param sharing.redact - hash the paths in it.
 * @returns 0, or 2 for a bad format, `--redact` without `--export`, or a missing directory.
 */
export function statsCommand(
  format: string,
  dir: string | undefined,
  sharing: { export?: string | undefined; redact?: boolean | undefined } = {},
): number {
  if (format !== "text" && format !== "json") {
    return print("inwards stats supports --format text or json", 2);
  }
  if (sharing.redact && !sharing.export) {
    return print("--redact goes with --export FILE: it hashes the paths in the exported log.", 2);
  }
  const cwd = process.cwd();
  const root =
    dir ??
    (process.env["CLAUDE_PROJECT_DIR"] ||
      git(cwd, ["rev-parse", "--show-toplevel"])?.trim() ||
      projectRoot(cwd));
  const project = realpath(root);
  if (!project) {
    return print(`No such directory: ${root}`, 2);
  }
  const { valid, invalid } = projectConfigs(project);
  const dirs = logDirs(project, [...Object.keys(valid), ...invalid]);
  if (sharing.export) {
    const written = exportRunLogs(dirs, sharing.export, sharing.redact ? { project } : undefined);
    const how = sharing.redact ? ", paths and fingerprints hashed with .inwards/export-key" : "";
    return print(
      `Wrote ${written} log lines to ${sharing.export}${how}. Read it before you send it.`,
      0,
    );
  }
  const { lines, skipped } = readRunLogs(dirs);
  const stats = computeStats(lines, skipped);
  const pretty = process.stdout.isTTY ? 2 : undefined;
  return print(format === "json" ? JSON.stringify(stats, null, pretty) : renderStatsText(stats), 0);
}

/**
 * Renders the numbers for a person, each next to its target.
 *
 * @param stats - the computed numbers.
 * @returns the text report.
 */
function renderStatsText(stats: Stats): string {
  const retry = stats.fixedWithinOneRetry;
  const per = stats.violationsPer1000Lines;
  const lat = stats.hookLatencyMs;
  const skipped = stats.skippedLines;
  const rules = Object.entries(retry.byRule).map(
    ([rule, c]) =>
      `    ${rule}  ${c.fixed} of ${c.reported}${share(c)}${c.noRetry ? `, ${c.noRetry} without a retry` : ""}`,
  );
  return [
    `Run log: ${stats.sessions} sessions, ${stats.hookRuns} hook runs${skipped ? `, ${skipped} unreadable line${skipped === 1 ? "" : "s"} skipped` : ""}.`,
    "",
    `Fixed within one retry: ${retry.fixed} of ${retry.reported}${share(retry, retry.target)}. Target: at least ${retry.target * PERCENT}%. ${verdict(retry.met)}`,
    ...rules,
    ...(retry.noRetry
      ? [`    ${retry.noRetry} more had no later run for their file and weren't reported at Stop.`]
      : []),
    `Violations per 1,000 agent-written lines: ${per.rate ?? "n/a"} (${per.violations} in ${per.linesAdded} lines). Target: at least ${per.target}. ${verdict(per.met)}`,
    `Hook latency: p50 ${lat.p50 ?? "n/a"} ms, p95 ${lat.p95 ?? "n/a"} ms over ${lat.runs} runs. Target: p50 under ${lat.target} ms. ${verdict(lat.met)}`,
    ...(stats.rejectedSuppressions
      ? [
          `Inline suppressions the agent added and the hooks rejected: ${stats.rejectedSuppressions}.`,
        ]
      : []),
  ].join("\n");
}
/**
 * Finds the project a working directory belongs to, for a project outside
 * git: the nearest folder with `.inwards/state` (the hooks keep it at the
 * project root), else the outermost folder with a run log. The walk stops
 * below the home directory (as written or through a symlink), so a stray
 * `~/.inwards` is never taken from a project below home.
 *
 * @param start - the working directory.
 * @returns that folder, or `start` when none qualifies.
 */
function projectRoot(start: string): string {
  const homes = new Set([homedir(), realpath(homedir())]);
  let outermost: string | undefined;
  for (let dir = start; !homes.has(dir) && dirname(dir) !== dir; dir = dirname(dir)) {
    if (existsSync(join(dir, ".inwards", "state"))) {
      return dir;
    }
    if (["runs.jsonl", "runs.1.jsonl"].some((name) => existsSync(join(dir, ".inwards", name)))) {
      outermost = dir;
    }
  }
  return outermost ?? start;
}

/**
 * Formats a share as a percentage in parentheses. When whole percent would
 * read as the target while the target isn't met (79.95% as "80%"), one
 * decimal is shown, rounded down.
 *
 * @param count - fixed and reported.
 * @param count.fixed - how many were fixed.
 * @param count.reported - how many were reported.
 * @param target - the target share, if the line shows one.
 * @returns e.g. ` (83%)` or ` (79.9%)`, or empty when nothing was reported.
 */
function share(count: { fixed: number; reported: number }, target?: number): string {
  if (count.reported === 0) {
    return "";
  }
  const exact = (count.fixed / count.reported) * PERCENT;
  const whole = Math.round(exact);
  const misleading = target !== undefined && whole === target * PERCENT && exact < whole;
  return ` (${misleading ? Math.floor(exact * 10) / 10 : whole}%)`;
}
/**
 * Words a target verdict.
 *
 * @param met - whether the target is met, or null without data.
 * @returns "Met.", "Not met." or "No data yet."
 */
function verdict(met: boolean | null): string {
  if (met === null) {
    return "No data yet.";
  }
  return met ? "Met." : "Not met.";
}
