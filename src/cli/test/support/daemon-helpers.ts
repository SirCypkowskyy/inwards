/**
 * @file Fixtures for the daemon's policy tests: a daemon stamp, a hook
 * request, a published record, and a fake `DaemonLink` that plays any socket
 * outcome. Nothing here starts a process or opens a socket.
 */
import type { AskResult, DaemonLink } from "../../src/daemon/contracts.ts";
import {
  type DaemonAnswer,
  daemonPlace,
  type HookRequest,
  PROTOCOL,
  toLine,
} from "../../src/daemon/protocol.ts";

/** The daemon's version and executable identity. */
export const SELF: { version: string; identity: string } = {
  version: "1.2.3",
  identity: "/bin/inwards\u000010\u00001",
};
/** Where the test project's daemon files are. */
export const PLACE: ReturnType<typeof daemonPlace> = daemonPlace(
  { stateHome: "/state" },
  "/project",
);
/** A PostToolUse payload. */
export const POST: string = JSON.stringify({
  hook_event_name: "PostToolUse",
  tool_input: { file_path: "a.py" },
});
/** A record for a daemon of this build. */
export const RECORD: string = toLine({
  protocol: PROTOCOL,
  ...SELF,
  pid: 42,
  endpoint: "/run/inwards/abc",
  project: "/project",
  started: "2026-10-10T00:00:00.000Z",
});

/**
 * Builds a hook request with the daemon's own stamp.
 *
 * @param patch - fields to replace.
 * @returns a `hook claude-code` request for a PostToolUse payload in `/project`.
 */
export function request(patch: Partial<HookRequest> = {}): HookRequest {
  return {
    protocol: PROTOCOL,
    ...SELF,
    op: "hook",
    argv: ["hook", "claude-code"],
    cwd: "/project",
    env: { HOME: "/home/u" },
    tty: false,
    elapsed: 12.5,
    stdin: POST,
    ...patch,
  };
}

/**
 * Wraps an answer as the line the daemon sends.
 *
 * @param answer - what the daemon says.
 * @returns a successful ask result carrying it.
 */
export function answered(answer: DaemonAnswer): AskResult {
  return { kind: "answer", line: toLine(answer).trimEnd() };
}

/**
 * Builds a fake link that answers every request with one result.
 *
 * @param result - what `ask` returns.
 * @param record - the record text, if any.
 * @param files - the daemon files by path, read before `record`; tests add
 *   the note of a failed start here.
 * @returns the link, the lines it was asked to send and the projects it was told to start.
 */
export function fakeLink(
  result: AskResult,
  record: string | undefined = RECORD,
  files: Map<string, string> = new Map(),
): { link: DaemonLink; sent: string[]; started: string[] } {
  const sent: string[] = [];
  const started: string[] = [];
  const link: DaemonLink = {
    identity: (): string => SELF.identity,
    readRecord(path: string): string | undefined {
      if (files.has(path)) {
        return files.get(path);
      }
      return path === PLACE.failed ? undefined : record;
    },
    ask: (_endpoint: string, line: string): Promise<AskResult> => {
      sent.push(line);
      return Promise.resolve(result);
    },
    start: (project: string): void => {
      started.push(project);
    },
    env: (): Record<string, string> => ({ HOME: "/home/u" }),
  };
  return { link, sent, started };
}
