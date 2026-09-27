/**
 * @file The filesystem side of the extraction cache (#56): making and
 * checking its directories, reading an entry without following a link or
 * blocking on a FIFO, publishing one through a temporary file and a rename,
 * and pruning a shard. Nothing here throws: every failure reads as a miss or
 * a skipped write, so the check falls back to parsing.
 *
 * The directories are checked with `lstat`, not held open, so a process that
 * swaps one for a link between the check and the use can redirect a write.
 * Such a process can already write the project and run commands as the user;
 * the checks keep a planted link from being followed by accident, and pruning
 * checks the whole chain again and deletes only names this cache writes.
 */
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

/** An entry bigger than this is neither written nor read. */
export const MAX_ENTRY_BYTES = 262_144;
/** A shard (one of 256 directories) is pruned to this many bytes, oldest entries first. */
export const MAX_SHARD_BYTES = 524_288;
/** Entries older than this are pruned, whether used or not. */
export const MAX_AGE_MS = 2_592_000_000;
/** A temporary file older than this belongs to no live writer. */
const STALE_TEMP_MS = 3_600_000;
/** An entry's file name: its key, 64 lowercase hex digits, and `.json`. */
const ENTRY_NAME = /^[0-9a-f]{64}\.json$/u;
/** A temporary file's name: `.`, the key, the run's nonce, a counter, `.tmp`. */
const TEMP_NAME: RegExp = /^\.[0-9a-f]{64}\.[0-9a-f]{12}\.\d+\.tmp$/u;
/** Opening an entry never follows a link (where the platform can refuse one) nor waits on a FIFO. */
const READ_FLAGS: number =
  // biome-ignore lint/suspicious/noBitwiseOperators: open(2) flags are a bit set.
  constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

/**
 * Makes sure each directory of a chain is a real directory, creating the
 * missing ones, and refuses the chain when any level is a symlink or a file.
 * An existing directory is only looked at, never created again.
 *
 * @param base - an existing directory to start from.
 * @param parts - the directories below it, outermost first.
 * @returns the innermost directory, or undefined when the chain can't be used.
 */
export function safeDirs(base: string, parts: readonly string[]): string | undefined {
  let dir = base;
  for (const part of parts) {
    dir = join(dir, part);
    if (!realDirectory(dir)) {
      return undefined;
    }
  }
  return dir;
}

/**
 * Tells whether every directory of a chain is still a real directory, making none.
 *
 * @param base - the directory the chain starts from.
 * @param parts - the directories below it, outermost first.
 * @returns true when none is missing, a file or a link.
 */
export function chainIntact(base: string, parts: readonly string[]): boolean {
  let dir = base;
  for (const part of parts) {
    dir = join(dir, part);
    if (!isRealDirectory(dir)) {
      return false;
    }
  }
  return true;
}

/**
 * Tells whether a path is a real directory, not a link or a file.
 *
 * @param dir - the path.
 * @returns false for anything else, including nothing.
 */
export function isRealDirectory(dir: string): boolean {
  try {
    return lstatSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Makes a directory unless something is there, then tells whether what is
 * there is a real directory (not a symlink, not a file).
 *
 * @param dir - a path inside the cache, one level below a checked directory.
 * @returns true for a real directory.
 */
function realDirectory(dir: string): boolean {
  if (isRealDirectory(dir)) {
    return true;
  }
  try {
    mkdirSync(dir, { mode: 0o700 });
  } catch {
    // made by a concurrent run, or can't be made: the check below decides
  }
  return isRealDirectory(dir);
}

/**
 * Reads a regular file of at most `MAX_ENTRY_BYTES`, through one descriptor:
 * a link, a FIFO, a directory, a bigger file or one that grows while it is
 * read reads as nothing.
 *
 * @param path - the entry file.
 * @returns its text, or undefined.
 */
export function readBounded(path: string): string | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(path, READ_FLAGS);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_ENTRY_BYTES) {
      return undefined;
    }
    // One byte more than it claims, so a file that grew since fstat reads as too long.
    const buffer = Buffer.allocUnsafe(stat.size + 1);
    let length = 0;
    for (let n = 1; n > 0 && length < buffer.length; length += n) {
      n = readSync(fd, buffer, length, buffer.length - length, null);
    }
    return length > stat.size ? undefined : buffer.toString("utf8", 0, length);
  } catch {
    return undefined; // missing or unreadable: a miss
  } finally {
    if (fd !== undefined) {
      closeSync(fd);
    }
  }
}

/**
 * Publishes a file: its text goes to a new temporary file, which is renamed
 * over the target. A failure leaves neither behind, as far as it can.
 *
 * @param temp - a temporary path that must not exist yet.
 * @param path - the file to publish.
 * @param text - its content.
 * @returns true once published.
 */
export function publish(temp: string, path: string, text: string): boolean {
  try {
    writeFileSync(temp, text, { flag: "wx", mode: 0o600 });
    renameSync(temp, path);
    return true;
  } catch {
    removeQuietly(temp);
    return false;
  }
}

/**
 * Removes a file, ignoring every failure.
 *
 * @param path - the file.
 */
function removeQuietly(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // a file that can't be removed is left to a later prune
  }
}

/**
 * Keeps a shard small: stale temporary files and old entries go, then the
 * oldest entries until the shard is under its byte limit. Only regular files
 * named as this cache names them are touched, and every failure is ignored.
 *
 * @param shard - one shard directory, checked by the caller just before.
 * @param now - the current time, in milliseconds since the epoch.
 * @returns the bytes of entries left in the shard.
 */
export function prune(shard: string, now: number): number {
  let total = 0;
  try {
    const entries: { path: string; size: number; mtime: number }[] = [];
    for (const name of readdirSync(shard)) {
      const path = join(shard, name);
      const stat = lstatSync(path);
      if (!stat.isFile()) {
        continue;
      }
      if (TEMP_NAME.test(name) && now - stat.mtimeMs > STALE_TEMP_MS) {
        removeQuietly(path);
      } else if (ENTRY_NAME.test(name)) {
        entries.push({ path, size: stat.size, mtime: stat.mtimeMs });
      }
    }
    entries.sort((a, b) => a.mtime - b.mtime);
    total = entries.reduce((sum, e) => sum + e.size, 0);
    for (const e of entries) {
      if (now - e.mtime <= MAX_AGE_MS && total <= MAX_SHARD_BYTES) {
        break;
      }
      removeQuietly(e.path);
      total -= e.size;
    }
  } catch {
    // pruning is best effort
  }
  return total;
}
