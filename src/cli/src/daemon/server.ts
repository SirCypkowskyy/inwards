/**
 * @file The daemon's side of a request (ADR-039): read the line, answer
 * `stale` when the hook comes from another build or the daemon's own
 * executable has changed on disk, refuse anything but a PostToolUse payload
 * for `hook claude-code`, and run that through the caller's hook runner,
 * one request at a time. It owns the request count `inwards daemon status`
 * shows, and says which requests skip the queue (`status` and `stop`, #277);
 * the socket, the lock and the idle timer are the adapter's (`DaemonHost`).
 * No I/O of its own.
 */
import type { LineHandler } from "./contracts.ts";
import {
  type DaemonAnswer,
  type DaemonStatus,
  type HookRequest,
  isHookArgv,
  PROTOCOL,
  parseRequest,
  toLine,
} from "./protocol.ts";

/**
 * The longest line, in characters, that may be a `status` or `stop` request;
 * anything longer is a hook run, and isn't parsed twice.
 */
const CONTROL_MAX_LENGTH = 4096;

/** What one hook run produced. */
export interface HookOutcome {
  exit: number;
  stdout: string;
  stderr: string;
}

/** What the handler knows about the daemon it runs in. */
export interface ServerSelf {
  /** This build's Inwards version. */
  version: string;
  /** The executable's identity when the daemon started. */
  identity: string;
  /**
   * The executable's identity now, checked on every request so an upgrade
   * that replaced the binary in place retires the daemon.
   *
   * @returns the identity, or undefined when the executable is gone.
   */
  currentIdentity: () => string | undefined;
  /**
   * What `inwards daemon status` shows, besides the request count.
   *
   * @returns the daemon's pid, project, endpoint, version, start time and idle limit.
   */
  status: () => Omit<DaemonStatus, "requests">;
}

/**
 * Builds the handler for one daemon's lifetime.
 *
 * @param self - the daemon's version, identity and status.
 * @param run - runs one hook request with its own runtime and buffered streams.
 * @returns the line handler the adapter calls for each request.
 */
export function createHandler(
  self: ServerSelf,
  run: (request: HookRequest) => Promise<HookOutcome>,
): LineHandler {
  let requests = 0;
  return {
    tooLarge: toLine({ protocol: PROTOCOL, error: "too-large" }),
    urgent(text: string): boolean {
      if (text.length > CONTROL_MAX_LENGTH) {
        return false;
      }
      const request = parseRequest(text, self);
      return request !== "stale" && request !== "protocol" && request.op !== "hook";
    },
    async handle(text: string): Promise<{ answer: string; stop: boolean }> {
      const request = parseRequest(text, self);
      if (request === "stale" || self.currentIdentity() !== self.identity) {
        return answer({ protocol: PROTOCOL, error: "stale" }, true);
      }
      if (request === "protocol") {
        return answer({ protocol: PROTOCOL, error: "protocol" });
      }
      if (request.op === "stop") {
        return answer({ protocol: PROTOCOL, stopped: true }, true);
      }
      if (request.op === "status") {
        return answer({ protocol: PROTOCOL, status: { ...self.status(), requests } });
      }
      if (request.op !== "hook" || !(isHookArgv(request.argv) && isPostToolUse(request.stdin))) {
        // SessionStart, PreToolUse and Stop always run in the hook's own process.
        return answer({ protocol: PROTOCOL, error: "protocol" });
      }
      requests += 1;
      return answer({ protocol: PROTOCOL, ...(await run(request)) });
    },
  };
}

/**
 * Wraps an answer for the adapter.
 *
 * @param value - what to send back.
 * @param stop - true to stop the daemon once it is sent.
 * @returns the answer line and the stop flag.
 */
function answer(value: DaemonAnswer, stop = false): { answer: string; stop: boolean } {
  return { answer: toLine(value), stop };
}

/**
 * Tells whether a payload is a PostToolUse event, the only one the daemon runs.
 *
 * @param stdin - the hook payload as the hook read it.
 * @returns true when it is a JSON object whose `hook_event_name` is PostToolUse.
 */
function isPostToolUse(stdin: string): boolean {
  try {
    const value: unknown = JSON.parse(stdin);
    return (
      typeof value === "object" &&
      value !== null &&
      "hook_event_name" in value &&
      value.hook_event_name === "PostToolUse"
    );
  } catch {
    return false;
  }
}
