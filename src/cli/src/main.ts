#!/usr/bin/env bun
import { dirname, resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { ConfigError, type Format, render, VERSION } from "@inwards/core";
import { BASELINE_FILE, writeBaseline } from "./baseline.ts";
import { hookClaudeCode } from "./hook.ts";
import { AGENTS, initCommand, isAgent } from "./init.ts";
import { print } from "./output.ts";
import { findConfig, realpath } from "./paths.ts";
import { runCheck } from "./project.ts";
import { logRun, noteRun } from "./runlog.ts";
import { statsCommand } from "./stats-command.ts";

// Exit codes follow Ruff: 0 clean (warnings allowed), 1 errors, 2 usage or config error.
const USAGE = `inwards ${VERSION}

Usage: inwards check [PATHS...] [--format text|json|sarif] [--config pyproject.toml] [--log]
       inwards baseline [--config pyproject.toml]    (accept today's violations)
       inwards init --agent claude|aider|agents-md [--dry-run]
       inwards stats [DIR] [--format text|json]   (hypothesis numbers from the run logs)
       inwards hook claude-code    (reads a Claude Code hook payload on stdin)

Checks Python imports against the layers declared in [tool.inwards].`;

/**
 * Parses the command line and runs the chosen command.
 * `--version` and `--help` print and exit; `hook claude-code` and `check`
 * do the work. Anything else prints usage with exit 2. An unknown option
 * makes parseArgs throw, which the caller at the bottom turns into exit 2.
 *
 * @param argv - arguments after the executable and script path.
 * @returns the process exit code: 0 clean or warnings only, 1 errors, 2 usage or config error.
 */
async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      format: { type: "string", default: "text" },
      config: { type: "string" },
      version: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      agent: { type: "string" },
      "dry-run": { type: "boolean" },
      log: { type: "boolean" },
    },
  });

  if (values.version) {
    return print(VERSION, 0);
  }
  const [command, ...paths] = positionals;
  if (!values.help && isSetupCommand(command)) {
    return await setupCommand(command, paths, values);
  }
  if (values.help || command !== "check") {
    return print(USAGE, command ? 2 : 0);
  }
  return await checkCommand(paths, values.format, values.config, values.log === true);
}

/** The commands besides `check`. */
type SetupCommand = "hook" | "init" | "baseline" | "stats";
const SETUP_COMMANDS: readonly string[] = ["hook", "init", "baseline", "stats"];

/**
 * Tells whether a positional names one of the commands besides `check`.
 *
 * @param command - the first positional.
 * @returns true for hook, init, baseline or stats.
 */
function isSetupCommand(command: string | undefined): command is SetupCommand {
  return command !== undefined && SETUP_COMMANDS.includes(command);
}

/**
 * Runs the commands besides `check`: the hook, `init`, `baseline` and `stats`.
 *
 * @param command - which one.
 * @param paths - the positionals after it.
 * @param values - the parsed options.
 * @param values.agent - `--agent`, for init.
 * @param values."dry-run" - `--dry-run`, for init.
 * @param values.config - `--config`, for baseline (stats refuses it).
 * @param values.format - `--format`, for stats.
 * @returns the exit code; 2 for unexpected arguments.
 */
async function setupCommand(
  command: SetupCommand,
  paths: string[],
  values: {
    agent?: string | undefined;
    "dry-run"?: boolean | undefined;
    config?: string | undefined;
    format?: string | undefined;
  },
): Promise<number> {
  if (command === "stats") {
    return paths.length <= 1 && values.config === undefined
      ? statsCommand(values.format ?? "text", paths[0])
      : print(USAGE, 2);
  }
  if (command === "hook") {
    return paths[0] === "claude-code" && paths.length === 1
      ? await hookClaudeCode(USAGE)
      : print(USAGE, 2);
  }
  if (command === "init") {
    return paths.length === 0 && isAgent(values.agent)
      ? initCommand(values.agent, values["dry-run"] === true)
      : print(`${USAGE}\n\n--agent must be one of: ${AGENTS.join(", ")}`, 2);
  }
  return paths.length === 0 ? await baselineCommand(values.config) : print(USAGE, 2);
}

const FORMATS: readonly Format[] = ["text", "json", "sarif"];

/**
 * Tells whether a `--format` value is one the reporters support.
 *
 * @param value - the raw option value.
 * @returns true for `text`, `json` or `sarif`.
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
 * @param paths - files or directories to check; empty means the config root.
 * @param format - the `--format` value, validated here.
 * @param config - the `--config` path, if given.
 * @param log - `--log`: append this run to `.inwards/runs.jsonl` even when the run log is off.
 * @returns 0 when clean or with warnings only, 1 with errors, 2 for a bad format or no config.
 */
async function checkCommand(
  paths: string[],
  format: string,
  config: string | undefined,
  log: boolean,
): Promise<number> {
  if (!isFormat(format)) {
    return print(`Unknown --format ${format}`, 2);
  }

  const configPath = config ? resolve(config) : findConfig(process.cwd());
  if (!configPath) {
    return print("No pyproject.toml with [tool.inwards] found.", 2);
  }

  const targets = paths.length > 0 ? paths.map((p) => resolve(p)) : undefined;
  const report = await runCheck(configPath, targets, process.cwd());

  // Agents and hooks read a pipe, and indentation there is wasted tokens.
  const pretty = process.stdout.isTTY === true;
  const color = process.env["FORCE_COLOR"] ? true : pretty && !process.env["NO_COLOR"];
  process.stdout.write(`${render(report, format, { pretty, color })}\n`);
  const exit = report.diagnostics.some((d) => d.severity === "error") ? 1 : 0;
  const project = realpath(dirname(configPath));
  if (project) {
    noteRun(project, targets ?? [project], report.diagnostics);
    logRun(project, { event: "check", exit, force: log });
  }
  return exit;
}

/**
 * Runs `inwards baseline`: checks the whole project without the baseline and
 * writes every error to inwards-baseline.json next to the config, replacing
 * the old one. Later checks, hooks and the Stop gate then fail only on new
 * violations.
 *
 * @param config - the `--config` path, if given.
 * @returns 0 once written, 2 without a config.
 */
async function baselineCommand(config: string | undefined): Promise<number> {
  const configPath = config ? resolve(config) : findConfig(process.cwd());
  if (!configPath) {
    return print("No pyproject.toml with [tool.inwards] found.", 2);
  }
  const report = await runCheck(configPath, undefined, process.cwd(), { baseline: false });
  const accepted = writeBaseline(configPath, report.diagnostics);
  return print(
    `Wrote ${BASELINE_FILE} with ${accepted} violation${accepted === 1 ? "" : "s"}. Commit it; new violations still fail.`,
    0,
  );
}

/**
 * Ignores a reader that has gone away: `inwards ... | head` closes the pipe
 * early, and that is no reason for a stack trace. Other stream errors still throw.
 *
 * @param err - the stream's error.
 */
function ignoreClosedPipe(err: Error & { code?: string }): void {
  if (err.code !== "EPIPE") {
    throw err;
  }
}
process.stdout.on("error", ignoreClosedPipe);
process.stderr.on("error", ignoreClosedPipe);

// exitCode, not exit(): Node-style exit() may drop writes still queued for a
// pipe, and a hook's stderr is the whole message to the agent.
main(process.argv.slice(2)).then(
  (code: number) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    process.exitCode = print(
      err instanceof ConfigError ? `config error: ${err.message}` : detail,
      2,
    );
  },
);
