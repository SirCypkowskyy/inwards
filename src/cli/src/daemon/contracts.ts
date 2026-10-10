/**
 * @file What the daemon feature needs from outside the process: a local socket
 * (or a named pipe) to listen on and to ask through, the daemon's record and
 * lock files, the running executable's identity, and a way to start
 * `inwards daemon` in the background. `adapters/daemon-link.ts` and
 * `adapters/daemon-host.ts` implement them; `main.ts` wires them in. Types only.
 */
import type { DaemonPlace } from "./protocol.ts";

/** How asking a daemon ended. */
export type AskResult =
  /** The daemon answered with one line. */
  | { kind: "answer"; line: string }
  /** Nothing listened, or the connection didn't open in time: nothing was sent. */
  | { kind: "unreachable" }
  /** The request went out, but the connection closed or timed out without an answer. */
  | { kind: "lost" };

/** The hook's side: finding a daemon, asking it, and starting one. */
export interface DaemonLink {
  /**
   * Names the running executable, so a daemon built from another binary is
   * found stale: its path, size and modification time (and `main.ts`'s when
   * running from source).
   *
   * @returns the identity, or undefined when the executable can't be examined.
   */
  identity: () => string | undefined;
  /**
   * Reads a daemon record.
   *
   * @param path - the record (`DaemonPlace.record`).
   * @returns its text, or undefined when there is none or it can't be read.
   */
  readRecord: (path: string) => string | undefined;
  /**
   * Sends one line to a daemon and waits for one line back.
   *
   * @param endpoint - the socket path or named pipe.
   * @param request - the request line, newline included.
   * @param limits - how long to wait.
   * @param limits.connectMs - for the connection to open.
   * @param limits.answerMs - for the answer, once the request is sent.
   * @returns the answer, or how it failed.
   */
  ask: (
    endpoint: string,
    request: string,
    limits: { connectMs: number; answerMs: number },
  ) => Promise<AskResult>;
  /**
   * Starts `inwards daemon` for a project in the background, detached from the
   * hook, and returns at once. Best effort: a failure to start is ignored.
   *
   * @param project - the real project root, its working directory.
   */
  start: (project: string) => void;
  /**
   * The environment variables `Runtime` reads, as this process has them.
   *
   * @returns the set ones.
   */
  env: () => Record<string, string>;
}

/** How serving ended. */
export type ServeResult =
  /** It served until it was stopped, went idle or was replaced. */
  | { kind: "served" }
  /** Another live daemon holds the project's lock. */
  | { kind: "running"; pid: number }
  /** It couldn't listen: no private directory for the socket, or the listen failed. */
  | { kind: "failed"; why: string };

/** What a daemon's lock file names. */
export interface LockHolder {
  /** The pid that took the lock; the OS may have given it to another process since. */
  pid: number;
  /** The random token the daemon took it with, which its status answer repeats; empty in a lock without one. */
  token: string;
}

/** How `DaemonHost.serve` behaves. */
export interface ServeOptions {
  /** How long to wait for a request before exiting. */
  idleMs: number;
  /**
   * Builds the record's text once the endpoint is known.
   *
   * @param endpoint - the socket path or named pipe it listens on.
   * @param token - the token in the lock it holds, for its status answer.
   * @returns the record's text.
   */
  record: (endpoint: string, token: string) => string;
  /**
   * Asks the project's daemon whether it holds a lock that a live process
   * still names, so a pid the OS gave to another process doesn't keep a dead
   * daemon's lock (#276).
   *
   * @param holder - the pid and token in the lock.
   * @returns true only when a daemon answers with that pid and token.
   */
  holds: (holder: LockHolder) => Promise<boolean>;
}

/** What the daemon does with each request line. */
export interface LineHandler {
  /**
   * Answers one request.
   *
   * @param request - the line, without its newline.
   * @returns the answer line (newline included) and whether to stop after sending it.
   */
  handle: (request: string) => Promise<{ answer: string; stop: boolean }>;
  /**
   * Tells whether a request is answered at once instead of waiting its turn:
   * `status` and `stop`, so a daemon busy with a slow hook run can still be
   * asked and stopped (#277).
   *
   * @param request - the line, without its newline.
   * @returns true for a `status` or `stop` request of this build.
   */
  urgent: (request: string) => boolean;
  /** The answer to a request line longer than `MAX_REQUEST_BYTES`, newline included. */
  tooLarge: string;
}

/** The daemon's side: holding the project's lock, listening and publishing the record. */
export interface DaemonHost {
  /**
   * Serves a project until stopped. Takes the lock (exclusively, with a fresh
   * random token; a lock whose holder is gone, or whose live pid doesn't
   * prove it holds it, is removed and taken again, once), listens on a fresh
   * endpoint, publishes the record, then hands each request line to the
   * handler, one at a time in arrival order (an urgent one at once, see
   * `LineHandler.urgent`). Once stopping, it drops the requests still
   * waiting, whose hooks then run in their own process. It stops when the handler says
   * so, after `idleMs` without a request, or on SIGINT or SIGTERM, and then
   * removes the endpoint, the record and the lock if they are still its own.
   *
   * @param place - the project, the key and the record and lock paths.
   * @param handler - answers request lines.
   * @param options - the idle limit, the record and the lock check.
   * @returns how serving ended.
   */
  serve: (place: DaemonPlace, handler: LineHandler, options: ServeOptions) => Promise<ServeResult>;
}
