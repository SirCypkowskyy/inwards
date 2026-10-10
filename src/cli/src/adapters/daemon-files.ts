/**
 * @file The daemon's two files under the user's state directory (ADR-039):
 * the lock a running daemon holds, created exclusively with its pid in it,
 * and the record that tells hooks where it listens, written atomically. Both
 * are owner-only. Used by `daemon-host.ts`; what they contain is decided in
 * `daemon/protocol.ts`.
 */
import {
  closeSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import process from "node:process";

/** Owner-only file mode for the record and the lock. */
const OWNER_ONLY = 0o600;

/**
 * Takes the project's lock: a file created exclusively, holding this pid. A
 * lock whose process is gone is removed and taken again, once.
 *
 * @param path - the lock file.
 * @returns undefined when taken, else the pid of the daemon that holds it.
 */
export function takeLock(path: string): number | undefined {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(path, "wx", OWNER_ONLY);
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return undefined;
    } catch {
      const holder = lockHolder(path);
      if (holder !== undefined && alive(holder)) {
        return holder;
      }
      rmSync(path, { force: true });
    }
  }
  return lockHolder(path) ?? 0;
}

/**
 * Reads the pid in a lock file.
 *
 * @param path - the lock file.
 * @returns the pid, or undefined when the file is missing or holds something else.
 */
function lockHolder(path: string): number | undefined {
  try {
    const pid = Number(readFileSync(path, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
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
 * Removes the lock if this process holds it.
 *
 * @param path - the lock file.
 */
export function releaseLock(path: string): void {
  if (lockHolder(path) === process.pid) {
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
