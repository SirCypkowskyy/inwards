/**
 * @file The wire format between `inwards hook claude-code` and `inwards daemon`
 * (ADR-039): one connection per request and one line of JSON each way, tagged
 * `inwards-daemon/1`. It names the daemon's files (the record and the lock
 * under the user's state directory) and builds and validates every value that
 * crosses the socket or the record. Pure: no I/O; the adapter
 * (`adapters/daemon.ts`) moves the lines and the files.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";
import { isRecord } from "../json/guards.ts";
import type { Runtime } from "../platform/contracts.ts";

/** The protocol tag on every request, answer and record. */
export const PROTOCOL: string = "inwards-daemon/1";
/** The largest hook payload sent to the daemon; a larger one runs in the hook's own process. */
export const MAX_PAYLOAD_BYTES: number = 16_777_216;
/** Room in a request line for everything besides the payload: the environment, the paths and JSON escapes. */
const REQUEST_ROOM = 1_048_576;
/** The largest request line the daemon reads. */
export const MAX_REQUEST_BYTES: number = MAX_PAYLOAD_BYTES + REQUEST_ROOM;
/** The only command the daemon serves. */
const HOOK_ARGV = ["hook", "claude-code"];
/** How many hex digits of the project path's SHA-256 name its record and socket. */
const KEY_LENGTH = 16;

/** What both ends compare before anything else: a difference makes the daemon stale. */
interface Stamp {
  protocol: string;
  /** The Inwards version. */
  version: string;
  /** The executable's path, size and modification time (`DaemonLink.identity`). */
  identity: string;
}

/** A hook run for the daemon: the payload and the environment it would have run in. */
export interface HookRequest extends Stamp {
  op: "hook";
  /** The command line after the executable; only `hook claude-code` is served. */
  argv: string[];
  /** The hook's working directory. */
  cwd: string;
  /** The variables `Runtime` reads, as the hook saw them. */
  env: Record<string, string>;
  /** The hook's standard output is a terminal. */
  tty: boolean;
  /** Milliseconds the hook had run before it sent this, so the run log times the whole call. */
  elapsed: number;
  /** The hook payload, as read from standard input. */
  stdin: string;
}

/** Any request: a hook run, or `inwards daemon status` and `stop`. */
export type DaemonRequest = HookRequest | (Stamp & { op: "status" | "stop" });

/** What `inwards daemon status` shows. */
export interface DaemonStatus {
  pid: number;
  project: string;
  endpoint: string;
  version: string;
  /** When it started, ISO 8601. */
  started: string;
  /** Hook runs served so far. */
  requests: number;
  /** How long it waits without a request before it exits, in milliseconds. */
  idleMs: number;
}

/** What the daemon sends back: a hook run's output, an error, its status, or that it stopped. */
export type DaemonAnswer =
  | { protocol: string; exit: number; stdout: string; stderr: string }
  | { protocol: string; error: "stale" | "protocol" | "too-large" }
  | { protocol: string; status: DaemonStatus }
  | { protocol: string; stopped: true };

/** The record a listening daemon publishes, so a hook can find it. */
export interface DaemonRecord extends Stamp {
  pid: number;
  /** The socket path, or the named pipe on Windows. */
  endpoint: string;
  /** The real project root it serves. */
  project: string;
  /** When it started, ISO 8601. */
  started: string;
}

/** Where a project's daemon keeps its files. */
export interface DaemonPlace {
  /** The real project root. */
  project: string;
  /** 16 hex digits of the project path's SHA-256, for the socket's name. */
  key: string;
  /** `<state home>/inwards/daemons/<key>.json`. */
  record: string;
  /** `<state home>/inwards/daemons/<key>.lock`, held by the running daemon. */
  lock: string;
}

/**
 * Names a project's daemon files under the user's state directory.
 *
 * @param runtime - the user's state directory.
 * @param project - the real project root.
 * @returns the key, the record and the lock.
 */
export function daemonPlace(runtime: Pick<Runtime, "stateHome">, project: string): DaemonPlace {
  const key = createHash("sha256").update(project).digest("hex").slice(0, KEY_LENGTH);
  const dir = join(runtime.stateHome, "inwards", "daemons");
  return { project, key, record: join(dir, `${key}.json`), lock: join(dir, `${key}.lock`) };
}

/**
 * Tells whether PostToolUse may go through the daemon.
 *
 * @param runtime - `INWARDS_DAEMON` and `CI`.
 * @returns true unless `INWARDS_DAEMON=0`, or `CI` is set without `INWARDS_DAEMON=1`.
 */
export function daemonEnabled(runtime: Pick<Runtime, "daemon" | "ci">): boolean {
  return runtime.daemon === "on" || (runtime.daemon === "auto" && !runtime.ci);
}

/**
 * Tells whether the hook command line is the one the daemon serves.
 *
 * @param argv - the request's `argv`.
 * @returns true for exactly `hook claude-code`.
 */
export function isHookArgv(argv: readonly string[]): boolean {
  return argv.length === HOOK_ARGV.length && argv.every((word, i) => word === HOOK_ARGV[i]);
}

/**
 * Gives the hook command line, for a request.
 *
 * @returns a fresh copy of `hook claude-code`.
 */
export function hookArgv(): string[] {
  return [...HOOK_ARGV];
}

/**
 * Reads one request line. A request whose protocol, version or executable
 * identity isn't the daemon's is stale, whatever else it holds; one with
 * the right stamp but a missing or mistyped field is a protocol error.
 *
 * @param text - the line, without its newline.
 * @param self - the daemon's own version and identity.
 * @param self.version - the Inwards version.
 * @param self.identity - the executable's identity.
 * @returns the request, or the error to answer.
 */
export function parseRequest(
  text: string,
  self: { version: string; identity: string },
): DaemonRequest | "stale" | "protocol" {
  const value = parseJson(text);
  if (!isRecord(value)) {
    return "protocol";
  }
  if (
    value["protocol"] !== PROTOCOL ||
    value["version"] !== self.version ||
    value["identity"] !== self.identity
  ) {
    return "stale";
  }
  const stamp = { protocol: PROTOCOL, version: self.version, identity: self.identity };
  const op = value["op"];
  if (op === "status" || op === "stop") {
    return { ...stamp, op };
  }
  const { argv, cwd, env, tty, elapsed, stdin } = value;
  if (
    op === "hook" &&
    isStrings(argv) &&
    typeof cwd === "string" &&
    isRecord(env) &&
    Object.values(env).every((v) => typeof v === "string") &&
    typeof tty === "boolean" &&
    typeof elapsed === "number" &&
    Number.isFinite(elapsed) &&
    typeof stdin === "string"
  ) {
    // biome-ignore lint/nursery/noUnsafeTypeAssertion: every value in env was checked to be a string above.
    return { ...stamp, op, argv, cwd, env: env as Record<string, string>, tty, elapsed, stdin };
  }
  return "protocol";
}

/**
 * Reads the daemon's answer.
 *
 * @param text - the line, without its newline.
 * @returns the answer, or undefined when it isn't one this protocol knows.
 */
export function parseAnswer(text: string): DaemonAnswer | undefined {
  const value = parseJson(text);
  if (!isRecord(value) || value["protocol"] !== PROTOCOL) {
    return undefined;
  }
  const { exit, stdout, stderr, error, status, stopped } = value;
  if (typeof exit === "number" && typeof stdout === "string" && typeof stderr === "string") {
    return { protocol: PROTOCOL, exit, stdout, stderr };
  }
  if (error === "stale" || error === "protocol" || error === "too-large") {
    return { protocol: PROTOCOL, error };
  }
  if (stopped === true) {
    return { protocol: PROTOCOL, stopped };
  }
  const shown = parseStatus(status);
  return shown === undefined ? undefined : { protocol: PROTOCOL, status: shown };
}

/**
 * Reads the status inside an answer.
 *
 * @param value - the answer's `status` field.
 * @returns the status, or undefined when a field is missing or mistyped.
 */
function parseStatus(value: unknown): DaemonStatus | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { pid, project, endpoint, version, started, requests, idleMs } = value;
  if (
    typeof pid === "number" &&
    typeof project === "string" &&
    typeof endpoint === "string" &&
    typeof version === "string" &&
    typeof started === "string" &&
    typeof requests === "number" &&
    typeof idleMs === "number"
  ) {
    return { pid, project, endpoint, version, started, requests, idleMs };
  }
  return undefined;
}

/**
 * Reads a daemon record.
 *
 * @param text - the record file's text, or undefined when there is none.
 * @returns the record, or undefined when missing, torn or of another protocol.
 */
export function parseRecord(text: string | undefined): DaemonRecord | undefined {
  const value = text === undefined ? undefined : parseJson(text);
  if (!isRecord(value) || value["protocol"] !== PROTOCOL) {
    return undefined;
  }
  const { version, identity, pid, endpoint, project, started } = value;
  if (
    typeof version === "string" &&
    typeof identity === "string" &&
    typeof pid === "number" &&
    typeof endpoint === "string" &&
    endpoint !== "" &&
    typeof project === "string" &&
    typeof started === "string"
  ) {
    return { protocol: PROTOCOL, version, identity, pid, endpoint, project, started };
  }
  return undefined;
}

/**
 * Writes one value as one line of JSON, newline included.
 *
 * @param value - a request, an answer or a record.
 * @returns the JSON text and a newline.
 */
export function toLine(value: DaemonRequest | DaemonAnswer | DaemonRecord): string {
  return `${JSON.stringify(value)}\n`;
}

/**
 * Parses JSON without throwing.
 *
 * @param text - any text.
 * @returns the value, or undefined when the text isn't JSON.
 */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Tells whether a value is an array of strings.
 *
 * @param value - any parsed value.
 * @returns true for an array whose every item is a string.
 */
function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
