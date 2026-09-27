/**
 * @file `inwards hook claude-code`: the Claude Code hook command. It reads the hook
 * payload from stdin, hands it to the event dispatcher (`claude-code/`), and
 * logs the run. Everything it touches comes in as `HookDeps` from `main.ts`.
 */
import { dispatch } from "../claude-code/dispatch.ts";
import { type HookDeps, hookProject } from "../claude-code/protocol.ts";
import type { Streams } from "../platform/contracts.ts";
import { print } from "../platform/print.ts";

/**
 * Runs the Claude Code hook for one event: SessionStart records the session,
 * PreToolUse denies edits to the rules (`config-guard.ts`), PostToolUse checks
 * the file the agent just wrote, and Stop runs the gate over everything the
 * session changed (`stop-gate.ts`).
 * Exit 2 puts stderr in front of the model, so violations and config errors go
 * there. Exit 1 reaches only the user: a bad payload or a bug in Inwards is not
 * the model's to fix. Anything else passes silently with exit 0.
 *
 * Silent exit 0 also covers: other hook events, non-Python files, files
 * outside the project, and projects without `[tool.inwards]` (the hook may be
 * installed user-wide). Usage goes to stderr with exit 2 when stdin is a TTY.
 *
 * @param deps - the platform, this invocation's run log and the check runner.
 * @param usage - the CLI usage text, printed when stdin is a terminal.
 * @returns the exit code for Claude Code: 0, 1 or 2 as above.
 */
export async function hookClaudeCode(deps: HookDeps, usage: string): Promise<number> {
  const { io } = deps;
  if (io.runtime.stdinIsTTY) {
    return print(io.streams, usage, 2);
  }
  const input = readHookPayload(io.streams);
  if (input === null) {
    return print(io.streams, "inwards hook: stdin is not a Claude Code hook payload.", 1);
  }
  const event = input["hook_event_name"];
  const exit = await dispatch(deps, event, input);
  const project = hookProject(io);
  if (project && typeof event === "string") {
    deps.runlog.logRun(project, { event, input, exit });
  }
  return exit;
}

/**
 * Reads the hook payload from stdin and checks that it is a JSON object.
 *
 * @param streams - reads stdin.
 * @returns the payload fields, or null when stdin is not a JSON object.
 */
function readHookPayload(streams: Pick<Streams, "readIn">): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(streams.readIn());
    return isPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Tells whether a parsed payload is an object whose fields can be read.
 * Arrays pass, as before: a hook payload is never one, and its fields read as missing.
 *
 * @param value - any parsed JSON value.
 * @returns true when the value is a non-null object (arrays included).
 */
function isPayload(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
