/**
 * @file `inwards check`: checks the Python files under the given paths (or the
 * whole config root) against `[tool.inwards]` and writes the report to
 * stdout in the chosen format. Exit codes follow Ruff: 0 clean (warnings
 * allowed), 1 errors, 2 usage or config error, which includes a named path
 * that doesn't exist and paths that gave no file to check at all.
 */
import { dirname, resolve } from "node:path";
import { type Format, type Report, render } from "@inwards/core";
import { shownReport } from "../paths/display.ts";
import { print } from "../platform/print.ts";
import { diskCacheWanted } from "../project/check.ts";
import { commandConfig } from "../project/config-discovery.ts";
import type { AppDeps } from "./deps.ts";

const FORMATS: readonly Format[] = ["text", "concise", "json", "sarif"];
const WHOLE_NUMBER = /^\d+$/u;

/** The options `inwards check` reads. */
export interface CheckOptions {
  format?: string | undefined;
  config?: string | undefined;
  "max-diagnostics"?: string | undefined;
  "no-cache"?: boolean | undefined;
}

/**
 * Tells whether a `--format` value is one the reporters support.
 *
 * @param value - the raw option value.
 * @returns true for `text`, `concise`, `json` or `sarif`.
 */
function isFormat(value: string): value is Format {
  return FORMATS.some((format) => format === value);
}

/**
 * Runs `inwards check` and writes the report to stdout.
 * Without `--config`, the nearest pyproject.toml with `[tool.inwards]` above
 * the working directory is used. Without paths, the whole config root is checked.
 *
 * Output is indented only on a TTY, since agents and hooks read a pipe.
 * Colour follows FORCE_COLOR first, then NO_COLOR, then the TTY check.
 *
 * @param deps - the platform, the run log and the check runner.
 * @param paths - files or directories to check; empty means the config root.
 * @param options - the parsed options.
 * @param options.format - the `--format` value, validated here.
 * @param options.config - the `--config` path, if given.
 * @param options."max-diagnostics" - `--max-diagnostics`: a whole number, and not with SARIF,
 *   whose readers (code scanning) should see every finding.
 * @param options."no-cache" - `--no-cache`: parse every file, reading and writing no
 *   `.inwards/cache` (as `INWARDS_NO_CACHE=1` does).
 * @param log - `--log`: append this run to `.inwards/runs.jsonl` even when the run log is off.
 * @returns 0 when clean or with warnings only, 1 with errors, 2 for a bad option, no
 *   config, a path that doesn't exist, or named paths none of which gave a file to check.
 * @throws {ConfigError} when the config or the baseline is invalid.
 */
export async function checkCommand(
  deps: AppDeps,
  paths: string[],
  { format = "text", config, "max-diagnostics": max, "no-cache": noCache }: CheckOptions,
  log: boolean,
): Promise<number> {
  const { io } = deps;
  if (!isFormat(format)) {
    return print(io.streams, `Unknown --format ${format}`, 2);
  }
  if (max !== undefined && format === "sarif") {
    return print(
      io.streams,
      "--max-diagnostics does not apply to sarif: code scanning gets every finding.",
      2,
    );
  }
  if (max !== undefined && !WHOLE_NUMBER.test(max)) {
    return print(io.streams, "--max-diagnostics takes a whole number, e.g. 20.", 2);
  }

  const { cwd } = io.runtime;
  const found = commandConfig(io, config);
  if ("problem" in found) {
    return print(io.streams, found.problem, 2);
  }
  const configPath = found.path;

  const missing = paths.find((p) => io.probe.kind(resolve(cwd, p)) === undefined);
  if (missing !== undefined) {
    return print(io.streams, `${missing} is not a file or directory.`, 2);
  }
  const targets = paths.length > 0 ? paths.map((p) => resolve(cwd, p)) : undefined;
  const cache = diskCacheWanted(io.runtime, noCache);
  const report = await deps.check(configPath, targets, cwd, { cache });

  // Agents and hooks read a pipe, and indentation there is wasted tokens.
  const pretty = io.runtime.stdoutIsTTY;
  const color = io.runtime.forceColor ? true : pretty && !io.runtime.noColor;
  const maxDiagnostics = max === undefined ? undefined : Number(max);
  const project = io.probe.realpath(dirname(configPath));
  // Paths from the project even when --config spells it through a link (macOS /var).
  const shown = project ? shownReport(io.probe, project, cwd, report) : report;
  io.streams.out(`${render(shown, format, { pretty, color, maxDiagnostics })}\n`);
  const exit = exitCode(report);
  if (project) {
    deps.runlog.noteRun(project, targets ?? [project], report.diagnostics);
    deps.runlog.noteSuppressions(report, []);
    deps.runlog.logRun(project, { event: "check", exit, force: log });
  }
  return exit;
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
  return report.diagnostics.some((d) => d.severity === "error") ? 1 : 0;
}
