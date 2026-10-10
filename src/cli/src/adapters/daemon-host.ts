/**
 * @file The daemon's side behind `DaemonHost` (ADR-039): the project's lock,
 * a `node:net` server on a fresh endpoint, the record that names it, and the
 * loop that hands request lines to the handler one at a time. What a request
 * means is decided in `daemon/server.ts`; this module only moves lines and
 * files.
 *
 * The socket directory is `$XDG_RUNTIME_DIR/inwards`, else
 * `$TMPDIR/inwards-<uid>`, else `/tmp/inwards-<uid>`, each used only when it is
 * a real directory (not a link) that the user owns with mode 0700, and only
 * when the socket path fits the OS limit (104 bytes on macOS). On Windows the
 * endpoint is a named pipe. Names end in 8 random hex digits, so two daemons
 * never contend for one path, and on Windows, where pipe names are shared by
 * every user, nobody can take the name first. The record and the lock are
 * owner-only files under the user's state directory; the lock holds the pid
 * and a random token, which the daemon's status answer repeats, so a pid
 * the OS reused can't keep a dead daemon's lock (#276).
 */
import { randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import process from "node:process";
import type { DaemonHost, LineHandler, ServeOptions, ServeResult } from "../daemon/contracts.ts";
import type { DaemonPlace } from "../daemon/protocol.ts";
import { publishRecord, releaseLock, removeIfOwn, takeLock } from "./daemon-files.ts";
import { isEmitter } from "./daemon-link.ts";
import { RequestLoop } from "./daemon-loop.ts";

/** Owner-only directory mode for the socket directory. */
const PRIVATE_DIR = 0o700;
/** The permission bits of a mode. */
const PERMISSIONS = 0o777;
/** The longest socket path every supported OS takes: macOS's sun_path is 104 bytes, NUL included. */
const MAX_SOCKET_PATH = 103;
/** Random bytes in an endpoint's name: 8 hex digits. */
const RANDOM_BYTES = 4;
/** Random bytes in the lock's token: 32 hex digits. */
const TOKEN_BYTES = 16;

/**
 * Builds the daemon's side on the real process.
 *
 * @returns the host, whose `serve` listens on a socket or named pipe.
 */
export function nodeDaemonHost(): DaemonHost {
  return { serve };
}

/**
 * Serves a project until stopped (see `DaemonHost.serve`).
 *
 * @param place - the project, the key and the record and lock paths.
 * @param handler - answers request lines.
 * @param options - the idle limit, how to write the record and how to check a lock's holder.
 * @returns how serving ended.
 */
async function serve(
  place: DaemonPlace,
  handler: LineHandler,
  options: ServeOptions,
): Promise<ServeResult> {
  mkdirSync(dirname(place.record), { recursive: true, mode: PRIVATE_DIR });
  // Every request brings its own working directory. Leaving the project's
  // keeps it free: Windows can't delete or rename a process's current directory.
  process.chdir(dirname(place.record));
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  const holder = await takeLock(place.lock, token, options.holds);
  if (holder !== undefined) {
    return { kind: "running", pid: holder };
  }
  const endpoint = pickEndpoint(place.key);
  if (endpoint === undefined) {
    releaseLock(place.lock, token);
    return { kind: "failed", why: "no private directory for the socket" };
  }
  const loop = new RequestLoop(handler, options.idleMs);
  const server = createServer(loop.accept);
  try {
    await listen(server, endpoint);
  } catch (err) {
    releaseLock(place.lock, token);
    return { kind: "failed", why: err instanceof Error ? err.message : String(err) };
  }
  publishRecord(place.record, options.record(endpoint, token));
  await loop.run(server);
  if (process.platform !== "win32") {
    rmSync(endpoint, { force: true });
  }
  removeIfOwn(place.record);
  releaseLock(place.lock, token);
  return { kind: "served" };
}

/**
 * Starts listening.
 *
 * @param server - a server that hasn't listened yet.
 * @param endpoint - the socket path or named pipe.
 * @returns once it listens.
 * @throws {Error} when the listen fails.
 */
function listen(server: Server, endpoint: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (isEmitter(server)) {
      server.once("error", reject);
    }
    server.listen(endpoint, () => {
      if (isEmitter(server)) {
        server.off("error", reject);
      }
      resolve();
    });
  });
}

/**
 * Picks a fresh endpoint: a named pipe on Windows, else a socket in the first
 * usable private directory.
 *
 * @param key - the project's key.
 * @returns the endpoint, or undefined when no directory is private and short enough.
 */
function pickEndpoint(key: string): string | undefined {
  const name = `${key}-${randomBytes(RANDOM_BYTES).toString("hex")}`;
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\inwards-${name}`;
  }
  for (const dir of socketDirs()) {
    const path = join(dir, name);
    if (Buffer.byteLength(path) <= MAX_SOCKET_PATH && privateDir(dir)) {
      return path;
    }
  }
  return undefined;
}

/**
 * Lists the socket directory candidates, in order.
 *
 * @returns `$XDG_RUNTIME_DIR/inwards`, `$TMPDIR/inwards-<uid>` and `/tmp/inwards-<uid>`, those that apply.
 */
function socketDirs(): string[] {
  const uid = process.getuid?.() ?? 0;
  const runtime = process.env["XDG_RUNTIME_DIR"] ?? "";
  const tmp = process.env["TMPDIR"] ? tmpdir() : "";
  return [
    ...(isAbsolute(runtime) ? [join(runtime, "inwards")] : []),
    ...(isAbsolute(tmp) ? [join(tmp, `inwards-${uid}`)] : []),
    join("/tmp", `inwards-${uid}`),
  ];
}

/**
 * Creates a directory with mode 0700 if it is missing, and tells whether it
 * is safe for a socket: a real directory, owned by the user, mode 0700.
 *
 * @param dir - the directory.
 * @returns true when it can hold the socket.
 */
function privateDir(dir: string): boolean {
  try {
    mkdirSync(dir, { mode: PRIVATE_DIR });
  } catch {
    // already there, or can't be made: the checks below decide
  }
  try {
    const stat = lstatSync(dir);
    return (
      stat.isDirectory() &&
      // biome-ignore lint/suspicious/noBitwiseOperators: a mode is a bit set.
      (stat.mode & PERMISSIONS) === PRIVATE_DIR &&
      stat.uid === (process.getuid?.() ?? stat.uid)
    );
  } catch {
    return false;
  }
}
