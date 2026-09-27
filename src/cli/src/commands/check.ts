/**
 * @file `inwards check`: checks the Python files under the given paths (or the
 * whole config root) against `[tool.inwards]` and writes the report to
 * stdout in the chosen format. Exit codes follow Ruff: 0 clean (warnings
 * allowed), 1 errors, 2 usage or config error.
 */
import { dirname, resolve } from "node:path";
import { type Format, render } from "@inwards/core";
import { shownReport } from "../paths/display.ts";
import { print } from "../platform/print.ts";
import { findConfig } from "../project/config-discovery.ts";
import type { AppDeps } from "./deps.ts";

const FORMATS: readonly Format[] = ["text", "concise", "json", "sarif"];
const WHOLE_NUMBER = /^\d+$/u;

/** The options `inwards check` reads. */
export interface CheckOptions {
  format?: string | undefined;
  config?: string | undefined;
  "max-diagnostics"?: string | undefined;
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
 * @param log - `--log`: append this run to `.inwards/runs.jsonl` even when the run log is off.
 * @returns 0 when clean or with warnings only, 1 with errors, 2 for a bad option or no config.
 * @throws {ConfigError} when the config or the baseline is invalid.
 */
export async function checkCommand(
  deps: AppDeps,
  paths: string[],
  { format = "text", config, "max-diagnostics": max }: CheckOptions,
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
  const configPath = config ? resolve(cwd, config) : findConfig(io, cwd);
  if (!configPath) {
    return print(io.streams, "No pyproject.toml with [tool.inwards] found.", 2);
  }

  const targets = paths.length > 0 ? paths.map((p) => resolve(cwd, p)) : undefined;
  const report = await deps.check(configPath, targets, cwd, {});

  // Agents and hooks read a pipe, and indentation there is wasted tokens.
  const pretty = io.runtime.stdoutIsTTY;
  const color = io.runtime.forceColor ? true : pretty && !io.runtime.noColor;
  const maxDiagnostics = max === undefined ? undefined : Number(max);
  const project = io.probe.realpath(dirname(configPath));
  // Paths from the project even when --config spells it through a link (macOS /var).
  const shown = project ? shownReport(io.probe, project, cwd, report) : report;
  io.streams.out(`${render(shown, format, { pretty, color, maxDiagnostics })}\n`);
  const exit = report.diagnostics.some((d) => d.severity === "error") ? 1 : 0;
  if (project) {
    deps.runlog.noteRun(project, targets ?? [project], report.diagnostics);
    deps.runlog.noteSuppressions(report, []);
    deps.runlog.logRun(project, { event: "check", exit, force: log });
  }
  return exit;
}
