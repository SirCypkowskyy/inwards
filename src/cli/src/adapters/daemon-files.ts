/**
 * @file The daemon's two files under the user's state directory (ADR-039):
 * the lock a running daemon holds, created exclusively with its pid and a
 * random token in it, and the record that tells hooks where it listens,
 * written atomically. Both are owner-only. Used by `daemon-host.ts`; what
 * they contain is decided in `daemon/protocol.ts`, and whether a live
 * process really holds a lock is asked over the socket by the caller.
 */
import { linkSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import process from "node:process";
import type { LockHolder } from "../daemon/contracts.ts";

/** Owner-only file mode for the record and the lock. */
const OWNER_ONLY = 0o600;
/**
 * How long a lock counts as held without proof: a daemon takes its lock
 * before it listens, so one that is still starting can't answer yet.
 */
const START_GRACE_MS = 10_000;
const LOCK_TEXT = /^(?<pid>\d+)(?: (?<token>[0-9a-f]+))?$/u;

/**
 * Takes the project's lock: a file holding this pid and `token`, written to
 * a private temporary file and then hard-linked into place, which fails when
 * a lock is already there. A lock is never seen empty, so a daemon starting
 * at the same moment can't take a fresh lock for a stale one.
 *
 * A lock already there is stale, and is removed and taken again once, when
 * its pid is gone, when its pid is this process's own (the OS gave a dead
 * daemon's pid to this one), or when it is older than `START_GRACE_MS` and
 * `holds` says no daemon proves it holds it. A pid alone can't say: the OS
 * may have given a dead daemon's pid to any other process (#276).
 *
 * @param path - the lock file.
 * @param token - this daemon's random token, which its status answer repeats.
 * @param holds - asks the project's daemon whether it is the lock's holder.
 * @returns undefined when taken, else the pid of the daemon that holds it.
 */
export async function takeLock(
  path: string,
  token: string,
  holds: (holder: LockHolder) => Promise<boolean>,
): Promise<number | undefined> {
  if (link(path, token)) {
    return undefined;
  }
  const holder = lockHolder(path);
  if (holder !== undefined && (await live(path, holder, holds))) {
    return holder.pid;
  }
  // Remove only the lock that was checked: another daemon may have replaced
  // it while the check waited for an answer.
  const now = lockHolder(path);
  if (now?.pid === holder?.pid && now?.token === holder?.token) {
    rmSync(path, { force: true });
  }
  return link(path, token) ? undefined : (lockHolder(path)?.pid ?? 0);
}

/**
 * Writes this pid and token to a private temporary file and hard-links it
 * into place as the lock.
 *
 * @param path - the lock file.
 * @param token - this daemon's token.
 * @returns true when the lock is now this daemon's, false when one was already there.
 */
function link(path: string, token: string): boolean {
  const temp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, `${process.pid} ${token}`, { mode: OWNER_ONLY });
    linkSync(temp, path);
    return true;
  } catch {
    return false;
  } finally {
    rmSync(temp, { force: true });
  }
}

/**
 * Tells whether a lock's holder is a daemon that is running: its pid is
 * another live process, and either the lock is young enough that the daemon
 * may still be starting, or the daemon answers with the lock's token.
 *
 * @param path - the lock file, for its age.
 * @param holder - what the lock names.
 * @param holds - asks the project's daemon whether it is the holder.
 * @returns true when the lock must be left alone.
 */
async function live(
  path: string,
  holder: LockHolder,
  holds: (holder: LockHolder) => Promise<boolean>,
): Promise<boolean> {
  if (holder.pid === process.pid || !alive(holder.pid)) {
    return false;
  }
  const written = statSync(path, { throwIfNoEntry: false })?.mtimeMs;
  if (written !== undefined && Math.abs(Date.now() - written) < START_GRACE_MS) {
    return true;
  }
  return await holds(holder);
}

/**
 * Reads the pid and token in a lock file. A lock with only a pid, as builds
 * before #276 wrote, has an empty token, which no daemon answers with.
 *
 * @param path - the lock file.
 * @returns the holder, or undefined when the file is missing or holds something else.
 */
function lockHolder(path: string): LockHolder | undefined {
  try {
    const groups = LOCK_TEXT.exec(readFileSync(path, "utf8").trim())?.groups;
    const pid = Number(groups?.["pid"]);
    return Number.isSafeInteger(pid) && pid > 0
      ? { pid, token: groups?.["token"] ?? "" }
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Tells whether a process is running.
 *
 * @param pid - the process id.
 * @returns false only when no such process exists.
 */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err instanceof Error && "code" in err && err.code === "EPERM";
  }
}

/**
 * Removes the lock if this process holds it: its pid and token are this daemon's.
 *
 * @param path - the lock file.
 * @param token - this daemon's token.
 */
export function releaseLock(path: string, token: string): void {
  const holder = lockHolder(path);
  if (holder?.pid === process.pid && holder.token === token) {
    rmSync(path, { force: true });
  }
}

/**
 * Writes the record atomically and owner-only: a temporary file, then a rename.
 *
 * @param path - the record file.
 * @param text - its content.
 */
export function publishRecord(path: string, text: string): void {
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  writeFileSync(temp, text, { mode: OWNER_ONLY });
  renameSync(temp, path);
}

/**
 * Removes the record if it still names this process; a daemon that replaced
 * this one keeps its own.
 *
 * @param path - the record file.
 */
export function removeIfOwn(path: string): void {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (
      typeof value === "object" &&
      value !== null &&
      "pid" in value &&
      value.pid === process.pid
    ) {
      rmSync(path, { force: true });
    }
  } catch {
    // gone or replaced
  }
}
