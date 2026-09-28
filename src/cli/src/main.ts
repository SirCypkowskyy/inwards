#!/usr/bin/env bun
/**
 * @file The `inwards` command line: the composition root. It reads the process
 * environment once, has `adapters/compose.ts` build one invocation's
 * `AppDeps` from the real adapters, parses argv, and hands off to a command
 * (`commands/`). Nothing below it imports a concrete adapter; everything
 * receives what it needs as parameters.
 */
import process from "node:process";
import { parseArgs } from "node:util";
import { ConfigError, VERSION } from "@inwards/core";
import { compose } from "./adapters/compose.ts";
import { processStreams } from "./adapters/stdio.ts";
import { baselineCommand } from "./commands/baseline.ts";
import { checkCommand } from "./commands/check.ts";
import { contextCommand } from "./commands/context.ts";
import type { AppDeps } from "./commands/deps.ts";
import { hookClaudeCode } from "./commands/hook.ts";
import { importConfigCommand } from "./commands/import-config.ts";
import { statsCommand } from "./commands/stats.ts";
import type { InitFlags } from "./init/contracts.ts";
import { initMain } from "./init/style.ts";
import { print } from "./platform/print.ts";

// Exit codes follow Ruff: 0 clean (warnings allowed), 1 errors, 2 usage or config error.
const USAGE = `inwards ${VERSION}

Usage: inwards check [PATHS...] [--format text|concise|json|sarif] [--max-diagnostics N]
                     [--config pyproject.toml] [--log] [--no-cache]
                     (PATHS: those files only; whole-project checks such as dead layer
                     prefixes, import cycles and symlinks in layers run without PATHS)
       inwards baseline [--config pyproject.toml] [--no-cache]    (accept today's violations)
       inwards init --style layered|clean|hexagonal [--scaffold] [--agent ...] [--dry-run]
       inwards init --agent claude|opencode|aider|agents-md [--launcher "uv run"] [--dry-run]
                    (--list-styles: the presets; --brief: also the architecture brief in AGENTS.md)
       inwards context [--config pyproject.toml] [--write]   (the architecture brief; --write: into AGENTS.md)
       inwards import-config [FILE] [--write]   (import-linter contracts as [tool.inwards]; --write: into pyproject.toml)
       inwards stats [DIR] [--format text|json] [--export FILE [--redact]]   (hypothesis numbers from the run logs)
       inwards hook claude-code    (reads a Claude Code hook payload on stdin)

Checks Python imports against the layers declared in [tool.inwards].`;

/**
 * Parses the command line and runs the chosen command.
 * `--version` and `--help` print and exit; `hook claude-code` and `check`
 * do the work. Anything else prints usage with exit 2. An unknown option
 * makes parseArgs throw, which the caller at the bottom turns into exit 2.
 *
 * @param deps - this invocation's dependencies, built by `compose`.
 * @param argv - arguments after the executable and script path.
 * @returns the process exit code: 0 clean or warnings only, 1 errors, 2 usage or config error.
 */
async function main(deps: AppDeps, argv: string[]): Promise<number> {
  const { streams } = deps.io;
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
      "max-diagnostics": { type: "string" },
      "no-cache": { type: "boolean" },
      export: { type: "string" },
      redact: { type: "boolean" },
      style: { type: "string" },
      scaffold: { type: "boolean" },
      package: { type: "string" },
      "list-styles": { type: "boolean" },
      launcher: { type: "string" },
      brief: { type: "boolean" },
      write: { type: "boolean" },
    },
  });

  if (values.version) {
    return print(streams, VERSION, 0);
  }
  const [command, ...paths] = positionals;
  if (!values.help && isSetupCommand(command)) {
    return await setupCommand(deps, command, paths, values);
  }
  if (values.help || command !== "check") {
    return print(streams, USAGE, command ? 2 : 0);
  }
  return await checkCommand(deps, paths, values, values.log === true);
}

/** The commands besides `check`. */
type SetupCommand = "hook" | "init" | "baseline" | "stats" | "context" | "import-config";
const SETUP_COMMANDS: readonly string[] = [
  "hook",
  "init",
  "baseline",
  "stats",
  "context",
  "import-config",
];

/**
 * Tells whether a positional names one of the commands besides `check`.
 *
 * @param command - the first positional.
 * @returns true for hook, init, baseline, stats, context or import-config.
 */
function isSetupCommand(command: string | undefined): command is SetupCommand {
  return command !== undefined && SETUP_COMMANDS.includes(command);
}

/**
 * Runs the commands besides `check`: the hook, `init`, `baseline`, `stats`, `context`
 * and `import-config`.
 *
 * @param deps - this invocation's dependencies.
 * @param command - which one.
 * @param paths - the positionals after it.
 * @param values - the parsed options.
 * @param values.agent - `--agent`, for init (so are the other InitFlags).
 * @param values."dry-run" - `--dry-run`, for init.
 * @param values.config - `--config`, for baseline and context (stats refuses it).
 * @param values."no-cache" - `--no-cache`, for baseline.
 * @param values.format - `--format`, for stats.
 * @param values.export - `--export FILE`, for stats.
 * @param values.redact - `--redact`, for stats.
 * @param values.write - `--write`, for context and import-config.
 * @returns the exit code; 2 for unexpected arguments.
 */
async function setupCommand(
  deps: AppDeps,
  command: SetupCommand,
  paths: string[],
  values: InitFlags & {
    config?: string | undefined;
    "no-cache"?: boolean | undefined;
    format?: string | undefined;
    export?: string | undefined;
    redact?: boolean | undefined;
    write?: boolean | undefined;
  },
): Promise<number> {
  const { streams } = deps.io;
  if (command === "stats") {
    return statsMain(deps, paths, values);
  }
  if (command === "hook") {
    return paths[0] === "claude-code" && paths.length === 1
      ? await hookClaudeCode(deps, USAGE)
      : print(streams, USAGE, 2);
  }
  if (command === "context") {
    return paths.length === 0
      ? contextCommand(deps, values.config, values.write === true)
      : print(streams, USAGE, 2);
  }
  if (command === "import-config") {
    return importConfigCommand(deps, paths, values, USAGE);
  }
  if (command === "init") {
    return await initMain(deps, paths, values, USAGE);
  }
  return paths.length === 0
    ? await baselineCommand(deps, values.config, values["no-cache"] === true)
    : print(streams, USAGE, 2);
}

/**
 * Runs `inwards stats [DIR]`, which refuses `--config`: it reads every run log in a project.
 *
 * @param deps - this invocation's dependencies.
 * @param paths - the positionals after `stats`: at most the project directory.
 * @param values - the parsed options.
 * @param values.config - `--config`, refused.
 * @param values.format - `--format`: text or json.
 * @param values.export - `--export FILE`.
 * @param values.redact - `--redact`, for the export.
 * @returns the exit code; 2 for unexpected arguments.
 */
function statsMain(
  deps: AppDeps,
  paths: string[],
  values: {
    config?: string | undefined;
    format?: string | undefined;
    export?: string | undefined;
    redact?: boolean | undefined;
  },
): number {
  const { streams } = deps.io;
  if (values.config !== undefined) {
    return print(
      streams,
      "inwards stats reads every run log in a project: pass the project directory, not --config.",
      2,
    );
  }
  return paths.length <= 1
    ? statsCommand(deps, values.format ?? "text", paths[0], values)
    : print(streams, USAGE, 2);
}

/**
 * Ignores a reader that has gone away: `inwards ... | head` closes the pipe
 * early, and that is no reason for a stack trace. Other stream errors still throw.
 *
 * @param err - the stream's error.
 * @throws {Error} the same error, when it isn't a closed pipe.
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
main(compose(), process.argv.slice(2)).then(
  (code: number) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    process.exitCode = print(
      processStreams,
      err instanceof ConfigError ? `config error: ${err.message}` : detail,
      2,
    );
  },
);
