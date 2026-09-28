/**
 * @file The filesystem side of session state, kept apart from what the state means.
 * Every write goes to `<project>/.inwards/state` after checking that neither
 * level is a symlink and that the directory really lives in the project; log
 * files are opened with O_NOFOLLOW where the OS has it; pruning removes only
 * regular files. See `session/record.ts` for the limits of these checks.
 * Implements the `StateFiles` contract (`nodeStateFiles`).
 */
import {
  closeSync,
  constants,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { isInside } from "../paths/lexical.ts";
import type { StateFiles } from "../platform/contracts.ts";
import { nodePathProbe } from "./filesystem.ts";

/** Session files older than a week (in ms) are pruned when a new session starts. */
const MAX_AGE_MS = 604_800_000;
/** At most this many sessions are kept. */
const MAX_SESSIONS = 50;
/** The files a session owns: `<id>.start.json`, `<id>.jsonl`, `<id>.content.json` and `<id>.unresolved.json`. */
const SESSION_FILE = /\.(?:start\.json|jsonl|content\.json|unresolved\.json)$/u;
/** O_NOFOLLOW where the OS has it (not on Windows), so a planted symlink isn't followed. */
const NO_FOLLOW: number = constants.O_NOFOLLOW ?? 0;
/** Mode for new state files: readable by the user only, since they name files and sessions. */
const OWNER_ONLY = 0o600;

/**
 * Appends one event as one line, with O_APPEND so concurrent hooks interleave
 * whole lines. A symlink planted at the log's path is refused, not followed.
 *
 * @param path - the log file.
 * @param line - one line of text, ending in a newline.
 * @throws {Error} when something other than a regular file sits at the path,
 *   or the file can't be opened or written.
 */
function appendLine(path: string, line: string): void {
  if (existsAsNonFile(path)) {
    throw new Error(`${path} is not a regular file`);
  }
  const fd = openSync(
    path,
    // biome-ignore lint/suspicious/noBitwiseOperators: open(2) flags are a bit set.
    constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | NO_FOLLOW,
    OWNER_ONLY,
  );
  try {
    writeSync(fd, line);
  } finally {
    closeSync(fd);
  }
}

/**
 * Tells whether something other than a regular file sits at a path.
 *
 * @param path - any path.
 * @returns true for a symlink, directory or other non-file; false when absent.
 */
function existsAsNonFile(path: string): boolean {
  try {
    return !lstatSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Deletes other sessions' files past the age cap, then all but the newest
 * MAX_SESSIONS sessions. Only regular files are touched, and never those of
 * the current session.
 *
 * @param dir - the state directory, already checked to be inside the project.
 * @param current - the id of the session that is starting.
 */
function prune(dir: string, current: string): void {
  const now = Date.now();
  const sessions = new Map<string, { paths: string[]; mtime: number }>();
  for (const name of readdirSync(dir)) {
    const stat = lstatSync(join(dir, name));
    if (name.endsWith(".tmp") && stat.isFile()) {
      rmSync(join(dir, name), { force: true }); // left by a crashed writer; ours comes later
      continue;
    }
    const id = name.replace(SESSION_FILE, "");
    if (id === name || id === current || !stat.isFile()) {
      continue;
    }
    const entry = sessions.get(id) ?? { paths: [], mtime: 0 };
    entry.paths.push(join(dir, name));
    entry.mtime = Math.max(entry.mtime, stat.mtimeMs);
    sessions.set(id, entry);
  }
  // The current session counts towards the cap, so keep one fewer of the others.
  const byAge = [...sessions.values()].sort((a, b) => b.mtime - a.mtime);
  byAge.forEach((session, i) => {
    if (i >= MAX_SESSIONS - 1 || now - session.mtime > MAX_AGE_MS) {
      for (const path of session.paths) {
        rmSync(path, { force: true });
      }
    }
  });
}

/**
 * Creates the state directory and checks it really lives inside the project.
 * A symlinked `.inwards` or `state` could otherwise send writes, and prune's
 * deletes, anywhere the hook's user can reach.
 *
 * @param project - the real project root.
 * @returns the state directory.
 * @throws when the directory resolves to somewhere outside the project.
 */
function stateDir(project: string): string {
  // One level at a time, refusing symlinks before anything is created, so not
  // even an empty directory appears at a link's target.
  let dir = project;
  for (const part of [".inwards", "state"]) {
    dir = join(dir, part);
    if (existsAsNonDirectory(dir)) {
      throw new Error(`${dir} is a symlink or not a directory`);
    }
    try {
      mkdirSync(dir, { mode: 0o700 });
    } catch {
      // already there: checked above that it is a real directory
    }
  }
  const real = nodePathProbe.realpath(dir);
  if (real === undefined || !isInside(project, real)) {
    throw new Error(`${dir} resolves outside the project`);
  }
  return dir;
}

/**
 * Tells whether something other than a real directory sits at a path.
 *
 * @param path - any path.
 * @returns true for a symlink (even to a directory) or a file; false when absent or a directory.
 */
function existsAsNonDirectory(path: string): boolean {
  try {
    return !lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Finds the state directory for a reader that also deletes, without creating
 * it: only when `.inwards` and `state` are real directories inside the project.
 *
 * @param project - the real project root.
 * @returns the state directory, or undefined when it is missing or not safe to use.
 */
function existingStateDir(project: string): string | undefined {
  let dir = project;
  for (const part of [".inwards", "state"]) {
    dir = join(dir, part);
    try {
      if (!lstatSync(dir).isDirectory()) {
        return undefined;
      }
    } catch {
      return undefined;
    }
  }
  const real = nodePathProbe.realpath(dir);
  return real !== undefined && isInside(project, real) ? dir : undefined;
}

/**
 * Names the state directory without creating it, for readers.
 *
 * @param project - the real project root.
 * @returns `<project>/.inwards/state`.
 */
function statePath(project: string): string {
  return join(project, ".inwards", "state");
}

/**
 * Writes a new file atomically: a temporary file named with the process id,
 * created exclusively, then a rename over the final name.
 *
 * @param dir - a state directory that `stateDir` returned.
 * @param name - the final file name.
 * @param text - the content.
 * @throws when the temporary file exists or the rename fails.
 */
function publish(dir: string, name: string, text: string): void {
  const temp = join(dir, `.${name}.${process.pid}.tmp`);
  writeFileSync(temp, text, { flag: "wx" });
  renameSync(temp, join(dir, name)); // rename replaces a planted symlink, never follows it
}

/** Session and run-log state on the real filesystem. */
export const nodeStateFiles: StateFiles = {
  statePath,
  stateDir,
  existingStateDir,
  appendLine,
  publish,
  remove(path: string): void {
    rmSync(path, { force: true });
  },
  rotate(path: string, maxBytes: number, rotated: string): void {
    const size = statSync(path, { throwIfNoEntry: false })?.size ?? 0;
    if (size >= maxBytes) {
      renameSync(path, rotated);
    }
  },
  prune,
};
