#!/usr/bin/env bun
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import {
  ConfigError,
  Engine,
  type Format,
  moduleNameFor,
  parseConfig,
  type Report,
  render,
  type SourceFile,
  VERSION,
} from "@inwards/core";
import { collectPythonFiles } from "./files.ts";
import { loadGrammars } from "./grammars.ts";

// Exit codes follow Ruff: 0 clean, 1 violations, 2 usage or config error.
const USAGE = `inwards ${VERSION}

Usage: inwards check [PATHS...] [--format text|json|sarif] [--config pyproject.toml]
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
    },
  });

  if (values.version) {
    return print(VERSION, 0);
  }
  const [command, ...paths] = positionals;
  if (command === "hook" && !values.help) {
    return paths[0] === "claude-code" && paths.length === 1
      ? await hookClaudeCode()
      : print(USAGE, 2);
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

/**
 * Loads the config and engine, then checks the Python files under the targets.
 * Files outside the config root are dropped: they have no module name in the
 * project. The duration covers config, grammar loading, reading and checking.
 *
 * @param configPath - absolute path of the pyproject.toml to use.
 * @param targets - absolute files or directories; undefined means the config root.
 * @param base - directory that report paths are made relative to.
 * @returns the report, with forward-slash paths on every OS.
 * @throws {ConfigError} when the config is invalid.
 */
async function runCheck(
  configPath: string,
  targets: string[] | undefined,
  base: string,
): Promise<Report> {
  const started = performance.now();
  const config = parseConfig(readFileSync(configPath, "utf8"));
  const lexicalRoot = resolve(dirname(configPath), config.root);
  // Module names come from real paths on both sides, so a symlinked root or
  // file can neither hide a module nor rename it.
  const root = realpath(lexicalRoot) ?? lexicalRoot;
  const engine = await Engine.create(await loadGrammars(), config);
  const files = collectPythonFiles(targets ?? [lexicalRoot])
    .map((abs) => ({ abs, real: realpath(abs) ?? abs }))
    .filter(({ real }) => isInside(root, real))
    .map(
      ({ abs, real }): SourceFile => ({
        path: posix(relative(base, abs)),
        text: readFileSync(abs, "utf8"),
        ...moduleNameFor(relative(root, real)),
      }),
    );
  const diagnostics = engine.checkFiles(files);
  return { diagnostics, filesChecked: files.length, durationMs: performance.now() - started };
}

const PYTHON_FILE = /\.pyi?$/u;

/**
 * Runs the Claude Code PostToolUse hook on the file the agent just wrote.
 * Exit 2 puts stderr in front of the model, so violations and config errors go
 * there. Exit 1 reaches only the user: a bad payload or a bug in Inwards is not
 * the model's to fix. Anything else passes silently with exit 0.
 *
 * Silent exit 0 also covers: other hook events, non-Python files, files
 * outside the project, and projects without `[tool.inwards]` (the hook may be
 * installed user-wide). Usage goes to stderr with exit 2 when stdin is a TTY.
 *
 * @returns the exit code for Claude Code: 0, 1 or 2 as above.
 */
async function hookClaudeCode(): Promise<number> {
  if (process.stdin.isTTY) {
    return print(USAGE, 2);
  }
  const input = readHookPayload();
  if (input === null) {
    return print("inwards hook: stdin is not a Claude Code hook payload.", 1);
  }
  const toolInput = input["tool_input"];
  const file = isRecord(toolInput) ? toolInput["file_path"] : undefined;
  if (input["hook_event_name"] !== "PostToolUse" || typeof file !== "string") {
    return 0;
  }
  if (!PYTHON_FILE.exec(file)) {
    return 0;
  }
  const target = hookTarget(input["cwd"], file);
  if (!target) {
    return 0;
  }

  // The nearest config above the file, so each package in a monorepo uses its own.
  // No config at all means this project doesn't use Inwards (the hook may be user-wide).
  const configPath = findConfig(dirname(target.file));
  if (!configPath) {
    return 0;
  }
  try {
    const report = await runCheck(configPath, [target.file], target.cwd);
    if (report.diagnostics.length === 0) {
      return 0;
    }
    process.stderr.write(`${render(report, "json", { pretty: false })}\n`);
    return 2;
  } catch (err) {
    if (err instanceof ConfigError) {
      return print(`inwards: config error: ${err.message}`, 2);
    }
    return print(`inwards hook: ${err instanceof Error ? err.message : String(err)}`, 1);
  }
}

/**
 * Reads the hook payload from stdin and checks that it is a JSON object.
 *
 * @returns the payload fields, or null when stdin is not a JSON object.
 */
function readHookPayload(): Record<string, unknown> | null {
  try {
    // Sync on purpose: awaiting Bun.stdin in the Windows binary let the process
    // exit before main() settled, i.e. exit 0 and the violation lost.
    const parsed: unknown = JSON.parse(readFileSync(0, "utf8"));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Resolves the file named in a hook payload and checks it may be linted.
 * The payload is agent-controlled, so both the file and the project boundary
 * go through realpath: `..` and symlinks cannot reach outside the project.
 * The boundary is CLAUDE_PROJECT_DIR when set, else the payload's cwd.
 *
 * @param payloadCwd - the payload's `cwd` field; the process cwd if not a string.
 * @param file - the payload's `tool_input.file_path`, absolute or relative to cwd.
 * @returns the real file path and cwd, or undefined when the file is outside
 *   the project, missing, or not a regular file.
 */
function hookTarget(payloadCwd: unknown, file: string): { file: string; cwd: string } | undefined {
  // The payload is agent-controlled. Compare real paths, so `..` and symlinks
  // can't reach a file outside the project, and check regular files only.
  const cwd = realpath(typeof payloadCwd === "string" ? payloadCwd : process.cwd());
  if (!cwd) {
    return undefined;
  }
  // The boundary comes from the host (Claude Code sets CLAUDE_PROJECT_DIR and
  // runs hooks in the project), never from the payload's own `cwd`.
  const project = realpath(process.env["CLAUDE_PROJECT_DIR"] || process.cwd());
  const abs = realpath(resolve(cwd, file));
  if (abs && project && isInside(project, abs) && statSync(abs).isFile()) {
    return { file: abs, cwd };
  }
  return undefined;
}

/**
 * Tells whether a parsed JSON value is an object whose fields can be read.
 *
 * @param value - any parsed JSON value.
 * @returns true when the value is a non-null object (arrays included).
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Resolves symlinks and `..` in a path that may not exist.
 *
 * @param path - any path.
 * @returns the canonical path, or undefined when it does not exist.
 */
function realpath(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

/**
 * Tells whether a path lies strictly below a directory.
 * The directory itself does not count. On Windows a path on another drive
 * gives an absolute relative path, which also does not count.
 *
 * @param dir - the containing directory.
 * @param file - the path to test.
 * @returns true when `file` is inside `dir`.
 */
function isInside(dir: string, file: string): boolean {
  const rel = relative(dir, file);
  return rel !== "" && rel.split(sep)[0] !== ".." && !isAbsolute(rel);
}

/**
 * Finds the nearest pyproject.toml with a `[tool.inwards]` table.
 * Walks up from `dir` to the file system root. The table test is a substring
 * match on `[tool.inwards`, so `[tool.inwards.x]` counts too.
 *
 * @param dir - the directory to start from.
 * @returns the config path, or undefined when no ancestor has one.
 */
function findConfig(dir: string): string | undefined {
  for (let d = dir; ; d = dirname(d)) {
    const candidate = resolve(d, "pyproject.toml");
    if (existsSync(candidate) && readFileSync(candidate, "utf8").includes("[tool.inwards")) {
      return candidate;
    }
    if (dirname(d) === d) {
      return undefined;
    }
  }
}

/**
 * Converts a native path to forward slashes.
 * Diagnostics and SARIF use forward slashes on every OS, so output is identical everywhere.
 *
 * @param path - a path with the platform separator.
 * @returns the same path with `/` separators.
 */
function posix(path: string): string {
  return path.split(sep).join("/");
}

/**
 * Writes a message line: stdout for exit 0, stderr otherwise.
 * Not console.*: with FORCE_COLOR set, Bun paints console.error red, and the
 * JSON an agent parses would arrive wrapped in ANSI codes.
 *
 * @param message - the text to print, without a trailing newline.
 * @param code - the exit code the caller will return.
 * @returns `code`, so callers can `return print(...)`.
 */
function print(message: string, code: number): number {
  (code === 0 ? process.stdout : process.stderr).write(`${message}\n`);
  return code;
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
