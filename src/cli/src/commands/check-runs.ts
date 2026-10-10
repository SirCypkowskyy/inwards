/**
 * @file Running `inwards check` over several configs, as a uv workspace root or
 * paths from several members ask for (#57), and folding the reports into
 * one: findings side by side, counts summed, exit code the worst of them. It
 * also notes each run in the run log. Planning which config checks what is
 * `project/routing.ts`; rendering is the engine's.
 */
import { dirname, relative } from "node:path";
import { ConfigError, type Report } from "@inwards/core";
import { shownReport } from "../paths/display.ts";
import { posix } from "../paths/lexical.ts";
import type { CheckPlan, CheckUnit } from "../project/routing.ts";
import { threadLimit } from "../project/threads.ts";
import type { AppDeps } from "./deps.ts";

/** One config's check, with what it was asked to check. */
interface Run extends CheckUnit {
  /** The report; empty when the config itself was invalid. */
  report: Report;
  /** True when the config was invalid, so nothing was checked. */
  invalid: boolean;
}

/** What a run over a plan produced, ready to render. */
export interface Outcome {
  /** One report for all configs, with paths relative to the working directory. */
  merged: Report;
  /** One line per config, e.g. `packages/api/pyproject.toml: 2 files, ...`; empty for a single config. */
  lines: string[];
  /** The worst exit code among the configs: 0 clean, 1 errors, 2 config or usage error. */
  exit: number;
}

/**
 * Runs every check of a plan, notes each in the run log, and merges the reports.
 *
 * @param deps - the check runner, the platform and the run log; without a run
 *   log nothing is noted (`inwards mcp`, which checks for an agent mid-task).
 * @param plan - which config checks what, and what no config covers.
 * @param options - how to run.
 * @param options.cache - whether the extraction cache on disk may be used.
 * @param options.log - `--log`: log the run even when the run log is off.
 * @param options.texts - Python source to check instead of the disk's, by absolute path.
 * @returns the merged report, the per-config lines and the exit code.
 * @throws {ConfigError} when the only config, or its baseline, is invalid.
 */
export async function runPlan(
  deps: Pick<AppDeps, "io" | "check"> & { runlog?: AppDeps["runlog"] | undefined },
  plan: CheckPlan,
  {
    cache,
    log,
    texts,
  }: { cache: boolean; log: boolean; texts?: ReadonlyMap<string, string> | undefined },
): Promise<Outcome> {
  const { io } = deps;
  const { cwd } = io.runtime;
  const several = plan.units.length > 1;
  const runs: Run[] = [];
  for (const unit of plan.units) {
    // biome-ignore lint/performance/noAwaitInLoops: one config at a time, so each run's duration is its own; the reads are synchronous, so nothing would overlap anyway.
    const report = await checkUnit(deps, unit, { cache, several, texts });
    const empty = { diagnostics: [], filesChecked: 0, durationMs: 0 };
    runs.push({ ...unit, report: report ?? empty, invalid: report === undefined });
  }
  const covered = coveredPaths(cwd, runs);
  const shown: Report[] = [];
  let exit = 0;
  for (const run of runs) {
    const report = withoutCovered(run.report, covered, run);
    // Nothing checked is judged once, on the merged report: another config may have checked files.
    const code = run.invalid ? 2 : (several ? errorCode : exitCode)(report);
    exit = Math.max(exit, code);
    // Paths from the project even when --config spells it through a link (macOS /var).
    const project = io.probe.realpath(dirname(run.config));
    if (project && !run.invalid && deps.runlog !== undefined) {
      deps.runlog.noteRun(project, run.targets ?? [project], report.diagnostics);
      deps.runlog.noteSuppressions(report, []);
      deps.runlog.logRun(project, {
        event: "check",
        exit: code,
        force: log,
        durationMs: report.durationMs,
      });
    }
    shown.push(project ? shownReport(io.probe, project, cwd, report) : report);
  }
  const merged = mergeReports(shown, notesOf(cwd, plan));
  return {
    merged,
    lines: several ? runs.map((run, i) => configLine(cwd, run, shown[i] ?? run.report)) : [],
    exit: Math.max(exit, exitCode(merged)),
  };
}

/**
 * Runs one config's check. In a run over several configs an invalid one is
 * reported on stderr and the others still run; alone, its error escapes to
 * `main`, which prints it as a config error.
 *
 * @param deps - the check runner and the streams.
 * @param unit - the config and what it checks.
 * @param options - how to run it.
 * @param options.cache - whether the extraction cache on disk may be used.
 * @param options.several - true when other configs run too.
 * @param options.texts - Python source to check instead of the disk's, by absolute path.
 * @returns the report, or undefined for an invalid config in a run over several.
 * @throws {ConfigError} when the config or its baseline is invalid and it runs alone.
 */
async function checkUnit(
  deps: Pick<AppDeps, "io" | "check">,
  unit: CheckUnit,
  {
    cache,
    several,
    texts,
  }: { cache: boolean; several: boolean; texts?: ReadonlyMap<string, string> | undefined },
): Promise<Report | undefined> {
  const { cwd } = deps.io.runtime;
  const threads = threadLimit(deps.io.runtime);
  try {
    return await deps.check(unit.config, unit.targets, cwd, {
      cache,
      exclude: unit.exclude,
      threads,
      ...(texts === undefined ? {} : { texts }),
    });
  } catch (err) {
    if (!(several && err instanceof ConfigError)) {
      throw err;
    }
    deps.io.streams.err(`config error in ${shownPath(cwd, unit.config)}: ${err.message}\n`);
    return undefined;
  }
}

/**
 * Picks the exit code for a check's report. Named paths that all gave no
 * file to check are a usage error, so "0 files" never passes as clean (#200).
 *
 * @param report - the report, before its paths are respelled for display.
 * @returns 2 when nothing named was checked, else 1 with errors and 0 without.
 */
function exitCode(report: Report): number {
  if (report.filesChecked === 0 && (report.notChecked?.length ?? 0) > 0) {
    return 2;
  }
  return errorCode(report);
}

/**
 * Picks the exit code for a report's findings alone.
 *
 * @param report - one config's report.
 * @returns 1 with errors, 0 without.
 */
function errorCode(report: Report): number {
  return report.diagnostics.some((d) => d.severity === "error") ? 1 : 0;
}

/**
 * Spells a path for a message, relative to the working directory.
 *
 * @param cwd - the working directory.
 * @param path - an absolute path.
 * @returns the relative path with forward slashes, or `.` for `cwd` itself.
 */
function shownPath(cwd: string, path: string): string {
  return posix(relative(cwd, path)) || ".";
}

/**
 * Words what the plan left out: members without a config, and named paths
 * no config is above.
 *
 * @param cwd - the working directory.
 * @param plan - the plan, with its skipped members and unrouted paths.
 * @returns `notChecked` entries.
 */
function notesOf(cwd: string, plan: CheckPlan): { path: string; message: string }[] {
  const skipped = plan.skipped.map((dir) => ({
    dir,
    why: "has no [tool.inwards] table, so it was not checked",
  }));
  const unrouted = plan.unrouted.map((dir) => ({
    dir,
    why: "has no pyproject.toml with [tool.inwards] above it and was not checked",
  }));
  return [...skipped, ...unrouted].map(({ dir, why }) => {
    const path = shownPath(cwd, dir);
    return { path, message: `${path} ${why}.` };
  });
}

/**
 * Lists what the configs that checked some file were asked to check, as
 * shown paths; a whole run stands for the config's directory.
 *
 * @param cwd - the working directory.
 * @param runs - the checks.
 * @returns the shown paths, with the run each came from.
 */
function coveredPaths(cwd: string, runs: readonly Run[]): { path: string; run: Run }[] {
  return runs
    .filter((run) => run.report.filesChecked > 0)
    .flatMap((run) =>
      (run.targets ?? [dirname(run.config)]).map((target) => ({
        path: shownPath(cwd, target),
        run,
      })),
    );
}

/**
 * Tells whether a shown path lies at or under a shown directory.
 *
 * @param dir - a shown directory; `.` is the working directory.
 * @param path - a shown path.
 * @returns true when `path` is `dir` or below it.
 */
function under(dir: string, path: string): boolean {
  return dir === "." ? !path.startsWith("..") : path === dir || path.startsWith(`${dir}/`);
}

/**
 * Drops the named paths one config didn't check that another config checked
 * files under, as a workspace root's config does for the members it leaves
 * to their own configs.
 *
 * @param report - one config's report.
 * @param covered - what the configs that checked files were asked to check.
 * @param run - the run the report came from, whose own paths don't count.
 * @returns the report, with those paths left out of `notChecked`.
 */
function withoutCovered(
  report: Report,
  covered: readonly { path: string; run: Run }[],
  run: Run,
): Report {
  const { notChecked, ...rest } = report;
  const left = notChecked?.filter(
    (n) => !covered.some((c) => c.run !== run && under(n.path, c.path)),
  );
  return left === undefined || left.length === 0 ? rest : { ...rest, notChecked: left };
}

/**
 * Counts a noun, e.g. `1 file` or `2 files`.
 *
 * @param n - how many.
 * @param noun - the singular noun.
 * @returns the number and the noun, plural unless `n` is 1.
 */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * Sums one config's part of a run over several configs into a line, e.g.
 * `packages/api/pyproject.toml: 2 files, 1 violation, 0 warnings`.
 *
 * @param cwd - the working directory the paths are shown from.
 * @param run - the config's check, which says whether the config was invalid.
 * @param report - its report, paths as shown.
 * @returns the config's path, then its file, violation and warning counts, or `config error`.
 */
function configLine(cwd: string, run: Run, report: Report): string {
  const shown = shownPath(cwd, run.config);
  if (run.invalid) {
    return `${shown}: config error`;
  }
  const errors = report.diagnostics.filter((d) => d.severity === "error").length;
  const warnings = report.diagnostics.length - errors;
  return `${shown}: ${count(report.filesChecked, "file")}, ${count(errors, "violation")}, ${count(warnings, "warning")}`;
}

/**
 * Adds up an optional count over reports.
 *
 * @param reports - one report per config.
 * @param pick - reads the count from one report.
 * @returns the sum, or undefined when no report has the count.
 */
function sum(
  reports: readonly Report[],
  pick: (r: Report) => number | undefined,
): number | undefined {
  const values = reports.map(pick).filter((n) => n !== undefined);
  return values.length === 0 ? undefined : values.reduce((a, b) => a + b, 0);
}

/**
 * Merges the reports of several configs into one, for a single rendering:
 * findings and suppressions side by side, counts and durations summed. A
 * single report with nothing to add is returned as it is.
 *
 * @param reports - one report per config, paths already relative to the working directory.
 * @param notes - what no config covered, as `notChecked` entries.
 * @returns the merged report.
 */
function mergeReports(
  reports: readonly Report[],
  notes: readonly { path: string; message: string }[],
): Report {
  const [only] = reports;
  if (reports.length === 1 && notes.length === 0 && only !== undefined) {
    return only;
  }
  const baselined = sum(reports, (r) => r.baselined);
  const resolved = sum(reports, (r) => r.resolved);
  const notChecked = [...reports.flatMap((r) => r.notChecked ?? []), ...notes];
  return {
    diagnostics: reports.flatMap((r) => r.diagnostics),
    suppressed: reports.flatMap((r) => r.suppressed ?? []),
    filesChecked: sum(reports, (r) => r.filesChecked) ?? 0,
    durationMs: sum(reports, (r) => r.durationMs) ?? 0,
    ...(baselined === undefined ? {} : { baselined }),
    ...(resolved === undefined ? {} : { resolved }),
    ...(notChecked.length === 0 ? {} : { notChecked }),
  };
}
