/**
 * `inwards hook claude-code`: the Claude Code hook entry point.
 */
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { ConfigError, render } from "@inwards/core";
import { print } from "./output.ts";
import { findConfig, isInside, PATH_SEPARATORS, physicalRealpath, realpath } from "./paths.ts";
import { runCheck } from "./project.ts";

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
 * @param usage - the CLI usage text, printed when stdin is a terminal.
 * @returns the exit code for Claude Code: 0, 1 or 2 as above.
 */
export async function hookClaudeCode(usage: string): Promise<number> {
  if (process.stdin.isTTY) {
    return print(usage, 2);
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

  // The nearest config above the file, so each package in a monorepo uses its own,
  // and only one that really lives inside the project. No config at all means this
  // project doesn't use Inwards (the hook may be user-wide).
  const configPath = findConfig(dirname(target.file), target.project);
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
 * The payload is agent-controlled, so containment is decided on real paths:
 * `..` and symlinks cannot reach outside the project. The boundary is
 * CLAUDE_PROJECT_DIR, else the process cwd (Claude Code runs hooks in the
 * project), never the payload's own `cwd`.
 *
 * @param payloadCwd - the payload's `cwd` field; the process cwd if not a string.
 * @param file - the payload's `tool_input.file_path`, absolute or relative to cwd.
 * @returns the file and cwd as written (Python names modules after that
 *   path) and the real project root; undefined when the file is outside the
 *   project, missing, or not a regular file.
 */
function hookTarget(
  payloadCwd: unknown,
  file: string,
): { file: string; cwd: string; project: string } | undefined {
  const lexicalCwd = typeof payloadCwd === "string" ? payloadCwd : process.cwd();
  const cwd = realpath(lexicalCwd);
  const project = realpath(process.env["CLAUDE_PROJECT_DIR"] || process.cwd());
  if (!(cwd && project)) {
    return undefined;
  }
  const real = physicalRealpath(lexicalCwd, file);
  // With `..` in the path, the name as written is not where the file is.
  const lexical = PATH_SEPARATORS[Symbol.split](file).includes("..")
    ? real
    : resolve(lexicalCwd, file);
  if (real && lexical && isInside(project, real) && statSync(real).isFile()) {
    // Report paths against the cwd as written: on macOS /var is a link to
    // /private/var, and mixing the two spellings gives ../../var/... paths.
    return { file: lexical, cwd: resolve(lexicalCwd), project };
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
