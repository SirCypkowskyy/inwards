/**
 * @file `inwards check`: checks the Python files under the given paths (or the
 * whole config root, or every uv workspace member's) against `[tool.inwards]`
 * and writes the report to stdout in the chosen format. Exit codes follow Ruff: 0 clean (warnings
 * allowed), 1 errors, 2 usage or config error, which includes a named path
 * that doesn't exist and paths that gave no file to check at all.
 */
import { posix as posixPath, relative, resolve } from "node:path";
import { type Format, type Report, render } from "@inwards/core";
import { isInside, posix } from "../paths/lexical.ts";
import type { PathProbe } from "../platform/contracts.ts";
import { print } from "../platform/print.ts";
import { diskCacheWanted } from "../project/check.ts";
import { commandConfig, NO_CONFIG } from "../project/config-discovery.ts";
import { type CheckPlan, planCheck } from "../project/routing.ts";
import { runPlan } from "./check-runs.ts";
import type { AppDeps } from "./deps.ts";

const FORMATS: readonly Format[] = ["text", "concise", "json", "sarif", "github"];
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
 * @returns true for `text`, `concise`, `json`, `sarif` or `github`.
 */
function isFormat(value: string): value is Format {
  return FORMATS.some((format) => format === value);
}

/**
 * Works out which config checks which paths: `--config` checks them all,
 * else `planCheck` routes them. A missing config is reported before a
 * missing path, as before routing existed.
 *
 * @param deps - probes paths, reads configs and parses TOML.
 * @param paths - the named paths as given, relative to the working directory.
 * @param config - the `--config` path, if given.
 * @returns the plan, or the usage error to print.
 * @throws when a pyproject.toml on the way can't be read.
 */
function planOf(deps: AppDeps, paths: string[], config: string | undefined): CheckPlan | string {
  const { io } = deps;
  const { cwd } = io.runtime;
  const flagged = config === undefined ? undefined : commandConfig(io, config);
  if (flagged !== undefined && "problem" in flagged) {
    return flagged.problem; // #212: a --config that isn't a file
  }
  const missing = paths.find((p) => io.probe.kind(resolve(cwd, p)) === undefined);
  const targets = paths.length > 0 ? paths.map((p) => resolve(cwd, p)) : undefined;
  const plan: CheckPlan = flagged
    ? { units: [{ config: flagged.path, targets, exclude: [] }], skipped: [], unrouted: [] }
    : planCheck({ ...io, toml: deps.toml }, cwd, missing === undefined ? targets : undefined);
  if (plan.units.length === 0 && plan.unrouted.length === 0) {
    return NO_CONFIG;
  }
  return missing === undefined ? plan : `${missing} is not a file or directory.`;
}

/**
 * Makes the report's file paths relative to the GitHub Actions checkout, as
 * workflow command annotations need: a check run in `packages/api` reports
 * `domain/x.py`, and the annotation must say `packages/api/domain/x.py`.
 * Outside Actions, or from a directory outside the checkout, the paths stay
 * relative to the working directory. Both directories are compared with
 * symlinks resolved, since the working directory always comes resolved.
 *
 * @param probe - resolves symlinks.
 * @param report - the merged report, paths relative to `cwd`.
 * @param cwd - the working directory.
 * @param workspace - `GITHUB_WORKSPACE`, if set.
 * @returns the report with its diagnostics' paths rebased.
 */
function fromWorkspace(
  probe: PathProbe,
  report: Report,
  cwd: string,
  workspace: string | undefined,
): Report {
  const root = workspace === undefined ? undefined : probe.realpath(workspace);
  const here = probe.realpath(cwd) ?? cwd;
  if (root === undefined || !isInside(root, here)) {
    return report;
  }
  const prefix = posix(relative(root, here));
  const diagnostics = report.diagnostics.map((d) => ({
    ...d,
    file: posixPath.join(prefix, d.file),
  }));
  return { ...report, diagnostics };
}

/**
 * Runs `inwards check` and writes the report to stdout.
 * Without `--config`, the configs come from `planCheck`: the nearest
 * pyproject.toml with `[tool.inwards]` above the working directory, or at a
 * uv workspace root each member's own, and each named path goes to its
 * nearest config (#57). Without paths, each config's whole root is checked.
 * Several configs give one merged report, followed in text and concise
 * output by a line per config.
 *
 * Output is indented only on a TTY, since agents and hooks read a pipe.
 * `github` output names files from the Actions checkout (`GITHUB_WORKSPACE`).
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
 * @throws {ConfigError} when the config or the baseline is invalid, and it is the only one.
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

  const plan = planOf(deps, paths, config);
  if (typeof plan === "string") {
    return print(io.streams, plan, 2);
  }
  const cache = diskCacheWanted(io.runtime, noCache);
  const { merged, lines, exit } = await runPlan(deps, plan, { cache, log });

  // Agents and hooks read a pipe, and indentation there is wasted tokens.
  const pretty = io.runtime.stdoutIsTTY;
  const color = io.runtime.forceColor ? true : pretty && !io.runtime.noColor;
  const maxDiagnostics = max === undefined ? undefined : Number(max);
  const report =
    format === "github"
      ? fromWorkspace(io.probe, merged, io.runtime.cwd, io.runtime.githubWorkspace)
      : merged;
  io.streams.out(`${render(report, format, { pretty, color, maxDiagnostics })}\n`);
  if (lines.length > 0 && format !== "json" && format !== "sarif") {
    io.streams.out(`${lines.join("\n")}\n`);
  }
  return exit;
}
