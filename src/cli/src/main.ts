#!/usr/bin/env bun
/**
 * @file The `inwards` command line: the composition root. It reads the process
 * environment once, has `adapters/compose.ts` build one invocation's
 * `AppDeps` from the real adapters, parses argv, and hands off to a command
 * (`commands/`). Nothing below it imports a concrete adapter; everything
 * receives what it needs as parameters. Run as a worker thread (a large
 * check's extraction pool, #61), it serves extraction jobs instead.
 */
import process from "node:process";
import { parseArgs } from "node:util";
import { isMainThread } from "node:worker_threads";
import { ConfigError, VERSION } from "@inwards/core";
import { compose } from "./adapters/compose.ts";
import { serveExtractions } from "./adapters/extraction-worker.ts";
import { processStreams } from "./adapters/stdio.ts";
import { baselineCommand } from "./commands/baseline.ts";
import { checkCommand } from "./commands/check.ts";
import { contextCommand } from "./commands/context.ts";
import { daemonCommand } from "./commands/daemon.ts";
import type { AppDeps } from "./commands/deps.ts";
import { hookClaudeCode } from "./commands/hook.ts";
import { importConfigCommand } from "./commands/import-config.ts";
import { mcpCommand } from "./commands/mcp.ts";
import { ruleCommand, rulesCommand } from "./commands/rules.ts";
import { serverCommand } from "./commands/server.ts";
import { statsCommand } from "./commands/stats.ts";
import { type Command, commandUsage, isCommand, overview } from "./commands/usage.ts";
import type { InitFlags } from "./init/contracts.ts";
import { initMain } from "./init/style.ts";
import { print } from "./platform/print.ts";

// Exit codes follow Ruff: 0 clean (warnings allowed), 1 errors, 2 usage or config error.
const OPTIONS = {
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
  shared: { type: "boolean" },
  brief: { type: "boolean" },
  write: { type: "boolean" },
  idle: { type: "string" },
  json: { type: "boolean" },
  full: { type: "boolean" },
  // LSP's conventional server arguments (#63): stdio is the only transport,
  // and vscode-languageserver reads --clientProcessId from argv itself.
  stdio: { type: "boolean" },
  clientProcessId: { type: "string" },
} as const;

/** The parsed command line: every option above, typed, and the positionals. */
type CommandLine = ReturnType<
  typeof parseArgs<{ args: string[]; allowPositionals: true; options: typeof OPTIONS }>
>;

/**
 * Parses the command line and runs the chosen command.
 * `--version` prints the version; `--help` prints the overview, or with a
 * command that command's usage, to stdout with exit 0. An unknown command
 * or option, or a bad option value, is one line on stderr with exit 2.
 *
 * @param deps - this invocation's dependencies, built by `compose`.
 * @param argv - arguments after the executable and script path.
 * @returns the process exit code: 0 clean or warnings only, 1 errors, 2 usage or config error.
 */
async function main(deps: AppDeps, argv: string[]): Promise<number> {
  const { streams } = deps.io;
  const parsed = parseCommandLine(argv);
  if (typeof parsed === "string") {
    return print(streams, parsed, 2);
  }
  const { values, positionals } = parsed;
  if (values.version) {
    return print(streams, VERSION, 0);
  }
  const [command, ...paths] = positionals;
  if (command === undefined) {
    return print(streams, overview(), 0);
  }
  if (!isCommand(command)) {
    return print(
      streams,
      `inwards: unknown command "${command}". Run inwards --help for the commands.`,
      2,
    );
  }
  if (values.help) {
    return print(streams, commandUsage(command), 0);
  }
  if (command === "check") {
    return await checkCommand(deps, paths, values, values.log === true);
  }
  return await setupCommand(deps, command, paths, values);
}

/**
 * Parses argv strictly, and words a parse error as one line instead of a
 * stack trace (#335).
 *
 * @param argv - arguments after the executable and script path.
 * @returns the parsed options and positionals, or the error line to print.
 * @throws whatever parseArgs throws besides its own `ERR_PARSE_ARGS_*` errors.
 */
function parseCommandLine(argv: string[]): CommandLine | string {
  try {
    return parseArgs({ args: argv, allowPositionals: true, options: OPTIONS });
  } catch (err) {
    if (!(err instanceof Error && "code" in err && typeof err.code === "string")) {
      throw err;
    }
    if (!err.code.startsWith("ERR_PARSE_ARGS_")) {
      throw err;
    }
    return argumentError(argv, err.code, err.message);
  }
}

/**
 * Words a parse error: the unknown option by name, or the first line of
 * parseArgs' own message for a bad value, then where to read the options.
 *
 * Node and Bun word an unknown short option in a group (`-hx`) differently,
 * so the name comes from a lenient second parse: with `strict: false` and
 * `tokens: true`, every option becomes a token with its `rawName`, known or
 * not (https://nodejs.org/api/util.html#parseargs-tokens).
 *
 * @param argv - the arguments that failed to parse.
 * @param code - parseArgs' error code, e.g. `ERR_PARSE_ARGS_UNKNOWN_OPTION`.
 * @param message - parseArgs' error message.
 * @returns e.g. `inwards check: unknown option --bogus. Run inwards check --help for its options.`
 */
function argumentError(argv: string[], code: string, message: string): string {
  const { tokens, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    tokens: true,
    options: OPTIONS,
  });
  const command = isCommand(positionals[0]) ? positionals[0] : undefined;
  const who = command === undefined ? "inwards" : `inwards ${command}`;
  const help =
    command === undefined
      ? "Run inwards --help for the options."
      : `Run inwards ${command} --help for its options.`;
  const unknown = tokens.find(
    (token) => token.kind === "option" && !Object.hasOwn(OPTIONS, token.name),
  );
  if (code === "ERR_PARSE_ARGS_UNKNOWN_OPTION" && unknown?.kind === "option") {
    return `${who}: unknown option ${unknown.rawName}. ${help}`;
  }
  const [first = message] = message.split("\n");
  return `${who}: ${first.endsWith(".") ? first : `${first}.`} ${help}`;
}

/**
 * Runs the commands besides `check`: the hook, `daemon`, `server`, `mcp`, `init`, `baseline`, `stats`,
 * and through `readCommand` `context`, `import-config`, `rules` and `rule`.
 *
 * @param deps - this invocation's dependencies.
 * @param command - which one.
 * @param paths - the positionals after it.
 * @param values - the parsed options.
 * @param values.agent - `--agent`, for init (so are the other InitFlags).
 * @param values."dry-run" - `--dry-run`, for init.
 * @param values.config - `--config`, for baseline, context and rules (stats refuses it).
 * @param values."no-cache" - `--no-cache`, for baseline.
 * @param values.format - `--format`, for stats.
 * @param values.export - `--export FILE`, for stats.
 * @param values.redact - `--redact`, for stats.
 * @param values.write - `--write`, for context and import-config.
 * @param values.idle - `--idle SECONDS`, for daemon.
 * @param values.json - `--json`, for rules and rule.
 * @param values.full - `--full`, for rule.
 * @returns the exit code; 2 for unexpected arguments.
 */
async function setupCommand(
  deps: AppDeps,
  command: Exclude<Command, "check">,
  paths: string[],
  values: InitFlags & {
    config?: string | undefined;
    "no-cache"?: boolean | undefined;
    format?: string | undefined;
    export?: string | undefined;
    redact?: boolean | undefined;
    write?: boolean | undefined;
    idle?: string | undefined;
    json?: boolean | undefined;
    full?: boolean | undefined;
  },
): Promise<number> {
  const { streams } = deps.io;
  const usage = commandUsage(command);
  if (command === "stats") {
    return statsMain(deps, paths, values, usage);
  }
  if (command === "hook") {
    return paths[0] === "claude-code" && paths.length === 1
      ? await hookClaudeCode(deps, usage)
      : print(streams, usage, 2);
  }
  if (command === "daemon") {
    return await daemonCommand(deps, paths, values.idle, usage);
  }
  if (command === "server") {
    return await serverCommand(deps, paths, usage);
  }
  if (command === "mcp") {
    return await mcpCommand(deps, paths, usage);
  }
  if (isReadCommand(command)) {
    return await readCommand(deps, command, paths, values);
  }
  if (command === "init") {
    return await initMain(deps, paths, values, usage);
  }
  return paths.length === 0
    ? await baselineCommand(deps, values.config, values["no-cache"] === true)
    : print(streams, usage, 2);
}

/** The commands that read the project or the docs and print: `readCommand` runs them. */
const READ_COMMANDS = ["context", "import-config", "rules", "rule"] as const;

/**
 * Tells whether a command is one `readCommand` runs.
 *
 * @param command - a command besides `check`.
 * @returns true for `context`, `import-config`, `rules` and `rule`.
 */
function isReadCommand(command: Command): command is (typeof READ_COMMANDS)[number] {
  return READ_COMMANDS.some((name) => name === command);
}

/**
 * Runs `context`, `import-config`, `rules` and `rule`: the commands that
 * read the config, import-linter's contracts or the rule pages and print.
 *
 * @param deps - this invocation's dependencies.
 * @param command - which one.
 * @param paths - the positionals after it.
 * @param values - the parsed options.
 * @param values.config - `--config`, for context and rules.
 * @param values.write - `--write`, for context and import-config.
 * @param values.json - `--json`, for rules and rule.
 * @param values.full - `--full`, for rule.
 * @returns the exit code; 2 for unexpected arguments.
 */
async function readCommand(
  deps: AppDeps,
  command: (typeof READ_COMMANDS)[number],
  paths: string[],
  values: {
    config?: string | undefined;
    write?: boolean | undefined;
    json?: boolean | undefined;
    full?: boolean | undefined;
  },
): Promise<number> {
  const usage = commandUsage(command);
  if (command === "context") {
    return paths.length === 0
      ? contextCommand(deps, values.config, values.write === true)
      : print(deps.io.streams, usage, 2);
  }
  if (command === "rules") {
    return rulesCommand(deps, paths, values, usage);
  }
  if (command === "rule") {
    return await ruleCommand(deps, paths, values, usage);
  }
  return importConfigCommand(deps, paths, values, usage);
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
 * @param usage - `inwards stats`'s usage, for unexpected arguments.
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
  usage: string,
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
    : print(streams, usage, 2);
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
if (isMainThread) {
  process.stdout.on("error", ignoreClosedPipe);
  process.stderr.on("error", ignoreClosedPipe);

  // exitCode, not exit(): Node-style exit() may drop writes still queued for a
  // pipe, and a hook's stderr is the whole message to the agent.
  main(compose(import.meta.url), process.argv.slice(2)).then(
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
} else {
  serveExtractions();
}
