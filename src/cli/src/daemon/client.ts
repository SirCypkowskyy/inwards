/**
 * @file The hook's side of the daemon (ADR-039): send a PostToolUse payload to
 * the project's `inwards daemon` and write back what it answered, or say
 * that the hook must run in its own process and whether to start a daemon
 * afterwards. Also the requests behind `inwards daemon status` and `stop`,
 * and the one a starting daemon sends to learn whether a lock is really held.
 * After a daemon couldn't listen, hooks start no other one for
 * `BACKOFF_MS` (#275). The socket, the record file and starting a process are behind
 * `DaemonLink`; this module decides what to send and what an answer means.
 * It never decides a hook's result itself: either the daemon ran the same
 * handler, or the caller runs it here.
 */
import type { Clock, PathProbe, Runtime, StateFiles, Streams } from "../platform/contracts.ts";
import { parseTime } from "../platform/time.ts";
import type { DaemonLink, LockHolder } from "./contracts.ts";
import {
  type DaemonAnswer,
  type DaemonFailure,
  type DaemonPlace,
  type DaemonRecord,
  daemonEnabled,
  hookArgv,
  MAX_PAYLOAD_BYTES,
  PROTOCOL,
  parseAnswer,
  parseFailure,
  parseRecord,
  toLine,
} from "./protocol.ts";

/** How long a hook waits for the daemon's socket to accept it. */
const CONNECT_MS = 100;
/**
 * How long a hook waits for the answer once the request is sent: under Claude
 * Code's default hook timeout (60 s), so the one-shot retry still has time.
 * Running the hook again while the daemon may still be working would record
 * the edit twice; the edit's `tool_use_id` makes that harmless (#60).
 */
const ANSWER_MS = 45_000;
/** How long `inwards daemon status` and `stop` wait for the connection. */
const COMMAND_MS = 5000;
/**
 * How long `inwards daemon status` and `stop` wait for the answer. They skip
 * the queue, but can't be read while a hook run holds the daemon's thread,
 * which its git budget (5 s) bounds (#277).
 */
const COMMAND_ANSWER_MS = 15_000;
/**
 * How long after a daemon couldn't listen hooks start no other one: 5
 * minutes. Without it, every edit would start a process that exits at once
 * (#275). A daemon that does listen removes the note.
 */
export const BACKOFF_MS: number = 300_000;

/** What came of trying the daemon. */
export type Forwarded =
  /** The daemon ran the hook; its output is written and this is its exit code. */
  | { kind: "answered"; exit: number }
  /** Run the hook here; then start a daemon when `start` says so. */
  | { kind: "fallback"; start: boolean };

/** What forwarding reads besides the link. */
interface ClientIo {
  runtime: Pick<Runtime, "daemon" | "ci" | "cwd" | "stdoutIsTTY" | "stateHome">;
  streams: Pick<Streams, "out" | "err">;
  probe: Pick<PathProbe, "kind">;
  state: Pick<StateFiles, "statePath">;
  clock: Pick<Clock, "elapsed" | "now">;
}

/**
 * Sends a PostToolUse payload to the project's daemon. Without one, or when
 * it is stale, unreachable or dies before answering, the caller runs the hook
 * itself, so the hook answers no later than it would have without a daemon
 * (ADR-039). A new daemon is started only for a project that has Inwards
 * session state: a hook installed for every project shouldn't leave a
 * process behind in a project that doesn't use Inwards, nor within
 * `BACKOFF_MS` of a daemon that couldn't listen.
 *
 * @param link - the socket, the record and the executable's identity.
 * @param io - the environment, the streams, the clock and the project's state directory.
 * @param hook - what to send.
 * @param hook.place - the project's daemon files.
 * @param hook.stdin - the hook payload as read.
 * @param hook.version - this build's Inwards version.
 * @returns the daemon's exit code after writing its output, or a fallback.
 */
export async function viaDaemon(
  link: DaemonLink,
  io: ClientIo,
  { place, stdin, version }: { place: DaemonPlace; stdin: string; version: string },
): Promise<Forwarded> {
  if (!daemonEnabled(io.runtime) || new TextEncoder().encode(stdin).length > MAX_PAYLOAD_BYTES) {
    return { kind: "fallback", start: false };
  }
  const identity = link.identity();
  if (identity === undefined) {
    return { kind: "fallback", start: false };
  }
  const record = parseRecord(link.readRecord(place.record));
  if (record === undefined) {
    return { kind: "fallback", start: mayStart(link, io, place) };
  }
  const request = toLine({
    protocol: PROTOCOL,
    version,
    identity,
    op: "hook",
    argv: hookArgv(),
    cwd: io.runtime.cwd,
    env: link.env(),
    tty: io.runtime.stdoutIsTTY,
    elapsed: io.clock.elapsed(),
    stdin,
  });
  const result = await link.ask(record.endpoint, request, {
    connectMs: CONNECT_MS,
    answerMs: ANSWER_MS,
  });
  const answer = result.kind === "answer" ? parseAnswer(result.line) : undefined;
  if (answer !== undefined && "exit" in answer) {
    io.streams.out(answer.stdout);
    io.streams.err(answer.stderr);
    return { kind: "answered", exit: answer.exit };
  }
  // A stale daemon has exited; an unreachable or lost one is gone or stuck.
  // A protocol error or an answer we can't read starts nothing: another would answer the same.
  const replace =
    result.kind !== "answer" ||
    (answer !== undefined && "error" in answer && answer.error === "stale");
  return { kind: "fallback", start: replace && mayStart(link, io, place) };
}

/**
 * Tells whether a hook may start a daemon for the project: it has Inwards
 * session state, and no daemon failed to listen within `BACKOFF_MS`.
 *
 * @param link - reads the note of a failed start.
 * @param io - the clock and the project's state directory.
 * @param place - the project's daemon files.
 * @returns true when starting one is worth a process.
 */
function mayStart(link: DaemonLink, io: ClientIo, place: DaemonPlace): boolean {
  if (io.probe.kind(io.state.statePath(place.project)) !== "dir") {
    return false;
  }
  const failure = parseFailure(link.readRecord(place.failed));
  return failure === undefined || !backingOff(failure, io.clock.now());
}

/**
 * Tells whether a failed start is recent enough to wait out. A note whose
 * time can't be read, or lies more than `BACKOFF_MS` away on either side
 * (the clock was set back), doesn't hold hooks back.
 *
 * @param failure - the note of the failed start.
 * @param now - the current time, ISO 8601.
 * @returns true while hooks should start no daemon.
 */
export function backingOff(failure: DaemonFailure, now: string): boolean {
  const since = parseTime(now) - parseTime(failure.at);
  return Number.isFinite(since) && Math.abs(since) < BACKOFF_MS;
}

/**
 * Asks the project's daemon for its status or to stop, for `inwards daemon status|stop`.
 *
 * @param link - the socket, the record and the executable's identity.
 * @param place - the project's daemon files.
 * @param op - which question.
 * @param version - this build's Inwards version.
 * @returns the record and the answer; no record when none is published, no
 *   answer when the daemon didn't give one. Without a record, the note of
 *   the last failed start, if there is one.
 */
export async function askDaemon(
  link: DaemonLink,
  place: DaemonPlace,
  op: "status" | "stop",
  version: string,
): Promise<{
  record: DaemonRecord | undefined;
  answer: DaemonAnswer | undefined;
  failure?: DaemonFailure;
}> {
  const record = parseRecord(link.readRecord(place.record));
  if (record === undefined) {
    const failure = parseFailure(link.readRecord(place.failed));
    return failure === undefined
      ? { record, answer: undefined }
      : { record, answer: undefined, failure };
  }
  const request = toLine({ protocol: PROTOCOL, version, identity: link.identity() ?? "", op });
  const result = await link.ask(record.endpoint, request, {
    connectMs: COMMAND_MS,
    answerMs: COMMAND_ANSWER_MS,
  });
  return { record, answer: result.kind === "answer" ? parseAnswer(result.line) : undefined };
}

/**
 * Asks the project's daemon whether it holds a lock, for a daemon that is
 * starting and finds the lock naming a live pid. Only an answer that repeats
 * the lock's pid and token counts: the OS may have given a dead daemon's pid
 * to any other process, which can't answer at the record's endpoint (#276).
 * The answer may wait behind a hook run, so it gets the hook's own limit.
 *
 * @param link - the socket, the record and the executable's identity.
 * @param place - the project's daemon files.
 * @param holder - the pid and token in the lock.
 * @param version - this build's Inwards version.
 * @returns true only when the daemon at the record's endpoint is the lock's holder.
 */
export async function holdsLock(
  link: DaemonLink,
  place: DaemonPlace,
  holder: LockHolder,
  version: string,
): Promise<boolean> {
  const record = parseRecord(link.readRecord(place.record));
  if (record === undefined || holder.token === "") {
    return false;
  }
  const request = toLine({
    protocol: PROTOCOL,
    version,
    identity: link.identity() ?? "",
    op: "status",
  });
  const result = await link.ask(record.endpoint, request, {
    connectMs: COMMAND_MS,
    answerMs: ANSWER_MS,
  });
  const answer = result.kind === "answer" ? parseAnswer(result.line) : undefined;
  return (
    answer !== undefined &&
    "status" in answer &&
    answer.status.pid === holder.pid &&
    answer.status.token === holder.token
  );
}
