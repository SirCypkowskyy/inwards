/**
 * @file The hook's side of the daemon behind `DaemonLink` (ADR-039): the
 * running executable's identity from `stat`, reading the daemon's record,
 * one request over `node:net` (a Unix domain socket, or a named pipe on
 * Windows), and starting `inwards daemon` detached. What to send, and when
 * to fall back to a one-shot run, is decided in `daemon/client.ts`; this
 * module only moves the bytes. The daemon's own side is `daemon-host.ts`.
 */
import { spawn } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { createConnection } from "node:net";
import { basename } from "node:path";
import process from "node:process";
import type { AskResult, DaemonLink } from "../daemon/contracts.ts";
import { runtimeEnv } from "./runtime.ts";

const EXE_SUFFIX = /\.exe$/iu;

/** The event methods of a Node emitter, which the pinned TypeScript loses on `Server` and `ChildProcess`. */
export interface Emitter {
  /**
   * Adds a listener.
   *
   * @param event - the event's name.
   * @param listener - called with the event's error.
   * @returns the emitter.
   */
  on: (event: string, listener: (err: Error) => void) => unknown;
  /**
   * Adds a listener that runs at most once.
   *
   * @param event - the event's name.
   * @param listener - called with the event's error.
   * @returns the emitter.
   */
  once: (event: string, listener: (err: Error) => void) => unknown;
  /**
   * Removes a listener.
   *
   * @param event - the event's name.
   * @param listener - the listener `on` or `once` added.
   * @returns the emitter.
   */
  off: (event: string, listener: (err: Error) => void) => unknown;
}

/**
 * Tells whether a value has Node's event methods. The `@types/node` 26
 * declarations put them on an internal interface that the pinned TypeScript
 * doesn't resolve, so `Server` and `ChildProcess` type-check without them.
 *
 * @param value - a server or a child process.
 * @returns true when `on`, `once` and `off` are functions.
 */
export function isEmitter(value: object): value is Emitter {
  return (
    "on" in value &&
    typeof value.on === "function" &&
    "once" in value &&
    typeof value.once === "function" &&
    "off" in value &&
    typeof value.off === "function"
  );
}

/**
 * Builds the hook's side of the daemon on the real process.
 *
 * @param entry - the CLI's `main.ts`, for running from source.
 * @returns the link: identity, record, socket and starting a daemon.
 */
export function nodeDaemonLink(entry: string): DaemonLink {
  return {
    identity: (): string | undefined => exeIdentity(entry),
    readRecord(path: string): string | undefined {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return undefined;
      }
    },
    ask,
    start(project: string): void {
      startDaemon(entry, project);
    },
    env: (): Record<string, string> => runtimeEnv(process.env),
  };
}

/**
 * Gives the command that starts this Inwards: the binary alone, or Bun and
 * `main.ts` when running from source (as `init/launcher.ts` decides).
 *
 * @param entry - the CLI's `main.ts`.
 * @returns the executable and its leading arguments.
 */
function inwardsCommand(entry: string): [string, ...string[]] {
  const exe = process.execPath;
  return basename(exe).replace(EXE_SUFFIX, "") === "bun" ? [exe, entry] : [exe];
}

/**
 * Names the running executable by path, size and modification time, and
 * `main.ts` too when running from source.
 *
 * @param entry - the CLI's `main.ts`.
 * @returns the identity, or undefined when a file can't be examined.
 */
function exeIdentity(entry: string): string | undefined {
  const parts: string[] = [];
  for (const path of inwardsCommand(entry)) {
    const stat = statSync(path, { throwIfNoEntry: false });
    if (stat === undefined) {
      return undefined;
    }
    parts.push(`${path}\u0000${stat.size}\u0000${stat.mtimeMs}`);
  }
  return parts.join("\u0000");
}

/**
 * Starts `inwards daemon` for a project, detached, with no streams, so the
 * hook can exit at once. Best effort: if it can't start, the next hook runs
 * one-shot again.
 *
 * @param entry - the CLI's `main.ts`, for running from source.
 * @param project - the real project root, the daemon's working directory.
 */
function startDaemon(entry: string, project: string): void {
  const [command, ...args] = inwardsCommand(entry);
  try {
    const child = spawn(command, [...args, "daemon"], {
      cwd: project,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: process.env,
    });
    if (isEmitter(child)) {
      child.on("error", () => undefined);
    }
    child.unref();
  } catch {
    // best effort, see above
  }
}

/**
 * Sends one line and waits for one line back.
 *
 * @param endpoint - the socket path or named pipe.
 * @param request - the request line, newline included.
 * @param limits - how long to wait.
 * @param limits.connectMs - for the connection to open.
 * @param limits.answerMs - for the answer, once the request is sent.
 * @returns the answer, or how it failed.
 */
function ask(
  endpoint: string,
  request: string,
  limits: { connectMs: number; answerMs: number },
): Promise<AskResult> {
  return new Promise((resolve) => {
    let connected = false;
    let settled = false;
    let buffer = "";
    const socket = createConnection(endpoint);
    let timer = setTimeout(() => finish({ kind: "unreachable" }), limits.connectMs);
    /**
     * Settles once, closing the socket and the timer.
     *
     * @param result - how it ended.
     */
    function finish(result: AskResult): void {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        resolve(result);
      }
    }
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      connected = true;
      clearTimeout(timer);
      timer = setTimeout(() => finish({ kind: "lost" }), limits.answerMs);
      socket.write(request);
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const end = buffer.indexOf("\n");
      if (end >= 0) {
        finish({ kind: "answer", line: buffer.slice(0, end) });
      }
    });
    socket.on("error", () => finish({ kind: connected ? "lost" : "unreachable" }));
    socket.on("close", () => finish({ kind: connected ? "lost" : "unreachable" }));
  });
}
