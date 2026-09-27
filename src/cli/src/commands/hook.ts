/**
 * `inwards hook claude-code`: the Claude Code hook command. It reads the hook
 * payload from stdin, hands it to the event dispatcher, and logs the run.
 */
import { readFileSync } from "node:fs";
import process from "node:process";
import { print } from "../adapters/stdio.ts";
import { dispatch } from "../claude-code/dispatch.ts";
import { realpath } from "../paths/lexical.ts";
import { logRun } from "../runlog/record.ts";

/**
 * Runs the Claude Code hook for one event: SessionStart records the session,
 * PreToolUse denies edits to the rules (see `guard.ts`), PostToolUse checks
 * the file the agent just wrote, and Stop runs the gate over everything the
 * session changed (see `stop.ts`).
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
  const event = input["hook_event_name"];
  const exit = await dispatch(event, input);
  const project = realpath(process.env["CLAUDE_PROJECT_DIR"] || process.cwd());
  if (project && typeof event === "string") {
    logRun(project, { event, input, exit });
  }
  return exit;
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
 * Tells whether a parsed JSON value is an object whose fields can be read.
 *
 * @param value - any parsed JSON value.
 * @returns true when the value is a non-null object (arrays included).
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
