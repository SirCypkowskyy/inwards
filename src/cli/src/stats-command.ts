/**
 * The `inwards stats` command: finds the project, reads its run logs, and
 * prints the hypothesis numbers, each next to its chapter-2 threshold.
 */
import process from "node:process";
import { print } from "./output.ts";
import { realpath } from "./paths.ts";
import { logDirs, readRunLogs } from "./runs.ts";
import { git, projectConfigs } from "./snapshot.ts";
import { computeStats, type Stats } from "./stats.ts";

const PERCENT = 100;

/**
 * Runs `inwards stats`. The project is DIR, else `CLAUDE_PROJECT_DIR`, else
 * the git work tree around the working directory, else the working directory:
 * the hooks log at that root and `check` next to each config below it.
 *
 * @param format - `text` or `json`.
 * @param dir - the DIR argument, if given.
 * @returns 0, or 2 for a bad format or a missing directory.
 */
export function statsCommand(format: string, dir: string | undefined): number {
  if (format !== "text" && format !== "json") {
    return print("inwards stats supports --format text or json", 2);
  }
  const cwd = process.cwd();
  const root =
    dir ??
    (process.env["CLAUDE_PROJECT_DIR"] ||
      git(cwd, ["rev-parse", "--show-toplevel"])?.trim() ||
      cwd);
  const project = realpath(root);
  if (!project) {
    return print(`No such directory: ${root}`, 2);
  }
  const { valid, invalid } = projectConfigs(project);
  const { lines, skipped } = readRunLogs(logDirs(project, [...Object.keys(valid), ...invalid]));
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
      `    ${rule}  ${c.fixed} of ${c.reported}${share(c.rate)}${c.noRetry ? `, ${c.noRetry} without a retry` : ""}`,
  );
  return [
    `Run log: ${stats.sessions} sessions, ${stats.hookRuns} hook runs${skipped ? `, ${skipped} unreadable line${skipped === 1 ? "" : "s"} skipped` : ""}.`,
    "",
    `Fixed within one retry: ${retry.fixed} of ${retry.reported}${share(retry.rate)}. Target: at least ${retry.target * PERCENT}%. ${verdict(retry.met)}`,
    ...rules,
    ...(retry.noRetry
      ? [`    ${retry.noRetry} more had no later run for their file and weren't reported at Stop.`]
      : []),
    `Violations per 1,000 agent-written lines: ${per.rate ?? "n/a"} (${per.violations} in ${per.linesAdded} lines). Target: at least ${per.target}. ${verdict(per.met)}`,
    `Hook latency: p50 ${lat.p50 ?? "n/a"} ms, p95 ${lat.p95 ?? "n/a"} ms over ${lat.runs} runs. Target: p50 under ${lat.target} ms. ${verdict(lat.met)}`,
  ].join("\n");
}
/**
 * Formats a rate as a percentage in parentheses.
 *
 * @param rate - a fraction, or null.
 * @returns e.g. ` (83%)`, or empty for null.
 */
function share(rate: number | null): string {
  return rate === null ? "" : ` (${Math.round(rate * PERCENT)}%)`;
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
