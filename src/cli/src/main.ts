#!/usr/bin/env bun
import { resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { ConfigError, type Format, render, VERSION } from "@inwards/core";
import { hookClaudeCode } from "./hook.ts";
import { AGENTS, initCommand, isAgent } from "./init.ts";
import { print } from "./output.ts";
import { findConfig } from "./paths.ts";
import { runCheck } from "./project.ts";

// Exit codes follow Ruff: 0 clean, 1 violations, 2 usage or config error.
const USAGE = `inwards ${VERSION}

Usage: inwards check [PATHS...] [--format text|json|sarif] [--config pyproject.toml]
       inwards init --agent claude|aider|agents-md [--dry-run]
       inwards hook claude-code    (reads a Claude Code hook payload on stdin)

Checks Python imports against the layers declared in [tool.inwards].`;

/**
 * Parses the command line and runs the chosen command.
 * `--version` and `--help` print and exit; `hook claude-code` and `check`
 * do the work. Anything else prints usage with exit 2. An unknown option
 * makes parseArgs throw, which the caller at the bottom turns into exit 2.
 *
 * @param argv - arguments after the executable and script path.
 * @returns the process exit code: 0 clean, 1 violations, 2 usage or config error.
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
    },
  });

  if (values.version) {
    return print(VERSION, 0);
  }
  const [command, ...paths] = positionals;
  if (command === "hook" && !values.help) {
    return paths[0] === "claude-code" && paths.length === 1
      ? await hookClaudeCode(USAGE)
      : print(USAGE, 2);
  }
  if (command === "init" && !values.help) {
    return paths.length === 0 && isAgent(values.agent)
      ? initCommand(values.agent, values["dry-run"] === true)
      : print(`${USAGE}\n\n--agent must be one of: ${AGENTS.join(", ")}`, 2);
  }
  if (values.help || command !== "check") {
    return print(USAGE, command ? 2 : 0);
  }
  return await checkCommand(paths, values.format, values.config);
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
 * @returns 0 when clean, 1 with violations, 2 for a bad format or no config.
 */
async function checkCommand(
  paths: string[],
  format: string,
  config: string | undefined,
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
  return report.diagnostics.length > 0 ? 1 : 0;
}

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
