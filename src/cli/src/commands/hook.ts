/**
 * @file `inwards hook claude-code`: the Claude Code hook command. It reads the hook
 * payload from stdin, hands it to the event dispatcher (`claude-code/`), and
 * logs the run, or hands a PostToolUse payload to the project's daemon
 * (`daemon/client.ts`). Everything it touches comes in as `HookDeps` from `main.ts`.
 */
import { VERSION } from "@inwards/core";
import { dispatch } from "../claude-code/dispatch.ts";
import { type HookDeps, hookProject } from "../claude-code/protocol.ts";
import { viaDaemon } from "../daemon/client.ts";
import { daemonPlace } from "../daemon/protocol.ts";
import type { Streams } from "../platform/contracts.ts";
import { print } from "../platform/print.ts";
import type { DaemonDeps } from "./deps.ts";

/**
 * Runs the Claude Code hook for one event: SessionStart records the session,
 * PreToolUse denies edits to the rules (`config-guard.ts`) and new files the
 * package shape forbids (`shape-guard.ts`), PostToolUse checks the file the
 * agent just wrote, and Stop runs the gate over everything the
 * session changed (`stop-gate.ts`).
 * Exit 2 puts stderr in front of the model, so violations and config errors go
 * there. Exit 1 reaches only the user: a bad payload or a bug in Inwards is not
 * the model's to fix. Anything else passes silently with exit 0.
 *
 * PostToolUse goes to the project's `inwards daemon` when there is one
 * (ADR-039), which runs this same function warm; without one, or when it
 * fails, the hook runs here and then starts one. The other events always run
 * here: the Stop gate never depends on the daemon.
 *
 * Silent exit 0 also covers: other hook events, non-Python files, files
 * outside the project, and projects without `[tool.inwards]` (the hook may be
 * installed user-wide). Usage goes to stderr with exit 2 when stdin is a TTY.
 *
 * @param deps - the platform, this invocation's run log and the check runner,
 *   and the daemon link when this process may forward (never inside the daemon).
 * @param usage - the CLI usage text, printed when stdin is a terminal.
 * @returns the exit code for Claude Code: 0, 1 or 2 as above.
 */
export async function hookClaudeCode(
  deps: HookDeps & { daemon?: Pick<DaemonDeps, "link"> },
  usage: string,
): Promise<number> {
  const { io } = deps;
  if (io.runtime.stdinIsTTY) {
    return print(io.streams, usage, 2);
  }
  const stdin = readStdin(io.streams);
  const input = stdin === undefined ? null : parsePayload(stdin);
  if (stdin === undefined || input === null) {
    return print(io.streams, "inwards hook: stdin is not a Claude Code hook payload.", 1);
  }
  const event = input["hook_event_name"];
  const project = event === "PostToolUse" ? hookProject(io) : undefined;
  if (deps.daemon === undefined || project === undefined) {
    return await runHere(deps, event, input);
  }
  const place = daemonPlace(io.runtime, project);
  const forwarded = await viaDaemon(deps.daemon.link, io, { place, stdin, version: VERSION });
  if (forwarded.kind === "answered") {
    return forwarded.exit;
  }
  const exit = await runHere(deps, event, input);
  if (forwarded.start) {
    deps.daemon.link.start(project);
  }
  return exit;
}

/**
 * Runs the hook in this process and logs the run.
 *
 * @param deps - the platform, this invocation's run log and the check runner.
 * @param event - the payload's `hook_event_name`.
 * @param input - the hook payload.
 * @returns the handler's exit code.
 */
async function runHere(
  deps: HookDeps,
  event: unknown,
  input: Record<string, unknown>,
): Promise<number> {
  const { io } = deps;
  const exit = await dispatch(deps, event, input);
  const project = hookProject(io);
  if (project && typeof event === "string") {
    deps.runlog.logRun(project, { event, input, exit });
  }
  return exit;
}

/**
 * Reads the hook payload from stdin.
 *
 * @param streams - reads stdin.
 * @returns the text, or undefined when stdin can't be read.
 */
function readStdin(streams: Pick<Streams, "readIn">): string | undefined {
  try {
    return streams.readIn();
  } catch {
    return undefined;
  }
}

/**
 * Checks that the hook payload is a JSON object.
 *
 * @param text - stdin as read.
 * @returns the payload fields, or null when stdin is not a JSON object.
 */
function parsePayload(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
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
