/**
 * Per-session state for the agent hooks: what the session started from, which
 * files it edited, and which violations it has seen. The Stop gate (#20) and
 * escalation (#22) read it; it is always on, unlike the opt-in run log.
 *
 * Two files per session in `.inwards/state/`:
 *
 * - `<id>.start.json`: HEAD, every `[tool.inwards]` table in the project and a
 *   content-hash manifest. Written once, at startup or /clear, to a temporary
 *   file that is then renamed, so a reader never sees half of it.
 * - `<id>.jsonl`: one small event per line (edits, resumes). Hooks run in
 *   parallel, so nothing rewrites it; each hook appends one short line.
 *
 * A session without its start file is unknown, and callers fail closed. A
 * resume or compact never writes a start, so deleting `.inwards/` mid-session
 * can't be undone by the next SessionStart.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";
import { type Diagnostic, declaresInwards, type InwardsConfig, parseConfig } from "@inwards/core";
import { collectFiles, collectPythonFiles } from "./files.ts";
import { isInside, posix, realpath } from "./paths.ts";

/** Session ids come from the agent's payload, so only a safe file name is accepted. */
const SESSION_ID = /^[\w-]{1,128}$/u;
/** Session files older than a week (in ms) are pruned when a new session starts. */
const MAX_AGE_MS = 604_800_000;
/** Hex digits kept from a fingerprint's SHA-256: 64 bits is plenty for one session. */
const FINGERPRINT_LENGTH = 16;
/** At most this many sessions are kept. */
const MAX_SESSIONS = 50;
/** SessionStart sources that begin a session; `resume` and `compact` continue one. */
const NEW_SESSION = new Set(["startup", "clear"]);
/** The two files a session owns: `<id>.start.json` and `<id>.jsonl`. */
const SESSION_FILE = /\.(?:start\.json|jsonl)$/u;
/** O_NOFOLLOW where the OS has it (not on Windows), so a planted symlink isn't followed. */
const NO_FOLLOW: number = constants.O_NOFOLLOW ?? 0;

/** What a session started from. */
interface SessionStart {
  at: string;
  /** `git rev-parse HEAD` at session start, or null outside a git repo. */
  head: string | null;
  /** Every `[tool.inwards]` table in the project, by project-relative pyproject.toml path. */
  configs: Record<string, InwardsConfig>;
  /** Project-relative path of every Python file in the project, to its SHA-256. */
  manifest: Record<string, string>;
}

/** One line of the session log. */
type SessionEvent =
  | { t: "edit"; at: string; file: string; fingerprints: string[] }
  | { t: "resume"; at: string; source: string };

/** The session as the Stop gate and escalation see it. */
export interface SessionState {
  start: SessionStart;
  /** Project-relative paths of the files the agent edited, in order, without repeats. */
  edited: string[];
  /** Fingerprint of every violation reported in this session, to how often it was seen. */
  seen: Map<string, number>;
}

/**
 * Tells whether a payload's session id can be used as a file name.
 *
 * @param id - the payload's `session_id`.
 * @returns true for 1-128 characters of letters, digits, `_` and `-`.
 */
export function isSessionId(id: unknown): id is string {
  return typeof id === "string" && SESSION_ID.test(id);
}

/**
 * Identifies a violation across hook runs: same rule, same module, same message
 * (which names the offending import target).
 *
 * @param d - a diagnostic.
 * @returns a short stable hash.
 */
function fingerprint(d: Diagnostic): string {
  return createHash("sha256")
    .update(`${d.code}\u0000${d.module}\u0000${d.message}`)
    .digest("hex")
    .slice(0, FINGERPRINT_LENGTH);
}

/**
 * Handles SessionStart. A new session (startup, /clear) records its start and
 * prunes old sessions; a resume or compact only logs that it happened.
 * Projects without any `[tool.inwards]` get no state at all.
 *
 * @param project - the real project root.
 * @param id - a session id that passed `isSessionId`.
 * @param source - the payload's `source`: startup, resume, clear or compact.
 */
export function recordStart(project: string, id: string, source: string): void {
  if (!NEW_SESSION.has(source)) {
    append(project, id, { t: "resume", at: new Date().toISOString(), source });
    return;
  }
  const configs: Record<string, InwardsConfig> = {};
  for (const path of collectFiles([project], (name) => name === "pyproject.toml")) {
    const text = readFileSync(path, "utf8");
    if (declaresInwards(text)) {
      configs[projectPath(project, path)] = parseConfig(text);
    }
  }
  if (Object.keys(configs).length === 0) {
    return;
  }
  const manifest: Record<string, string> = {};
  for (const file of collectPythonFiles([project])) {
    manifest[projectPath(project, file)] = createHash("sha256")
      .update(readFileSync(file))
      .digest("hex");
  }
  const git = spawnSync("git", ["rev-parse", "HEAD"], { cwd: project, encoding: "utf8" });
  const head = git.status === 0 ? git.stdout.trim() : null;
  const dir = stateDir(project);
  prune(dir, id);
  const start: SessionStart = { at: new Date().toISOString(), head, configs, manifest };
  const temp = join(dir, `.${id}.${process.pid}.tmp`);
  writeFileSync(temp, JSON.stringify(start), { flag: "wx" });
  renameSync(temp, join(dir, `${id}.start.json`)); // rename replaces a planted symlink, never follows it
}

/**
 * Records one edit and the violations the hook reported for it.
 *
 * @param project - the real project root.
 * @param id - a session id that passed `isSessionId`.
 * @param file - the edited file, absolute.
 * @param diagnostics - what the check of that file reported (empty when clean).
 */
export function recordEdit(
  project: string,
  id: string,
  file: string,
  diagnostics: readonly Diagnostic[],
): void {
  append(project, id, {
    t: "edit",
    at: new Date().toISOString(),
    file: projectPath(project, file),
    fingerprints: diagnostics.map(fingerprint),
  });
}

/**
 * Reads a session's state.
 * Returns undefined when the start file is missing or unreadable, so callers
 * can fail closed: a session whose history is gone can't prove it is clean.
 * Torn or foreign log lines are skipped.
 *
 * @param project - the real project root.
 * @param id - a session id that passed `isSessionId`.
 * @returns the session state, or undefined without a recorded start.
 */
export function readSession(project: string, id: string): SessionState | undefined {
  const start = readStart(join(statePath(project), `${id}.start.json`));
  if (start === undefined) {
    return undefined;
  }
  let log = "";
  try {
    log = readFileSync(join(statePath(project), `${id}.jsonl`), "utf8");
  } catch {
    // no edits yet
  }
  const edited: string[] = [];
  const seen = new Map<string, number>();
  for (const line of log.split("\n")) {
    const event = parseEvent(line);
    if (event?.t !== "edit") {
      continue;
    }
    if (!edited.includes(event.file)) {
      edited.push(event.file);
    }
    for (const print of event.fingerprints) {
      seen.set(print, (seen.get(print) ?? 0) + 1);
    }
  }
  return { start, edited, seen };
}

/**
 * Reads and shape-checks a start file.
 *
 * @param path - the `<id>.start.json` path.
 * @returns the start record, or undefined when missing or malformed.
 */
function readStart(path: string): SessionStart | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (
      isRecord(value) &&
      isRecord(value["configs"]) &&
      isRecord(value["manifest"]) &&
      (typeof value["head"] === "string" || value["head"] === null)
    ) {
      // biome-ignore lint/nursery/noUnsafeTypeAssertion: configs, manifest and head checked above; only recordStart writes this file.
      return value as unknown as SessionStart;
    }
  } catch {
    // missing or unreadable: unknown session
  }
  return undefined;
}

/**
 * Parses one log line, accepting only the event shapes this module writes.
 *
 * @param line - one line of the session log.
 * @returns the event, or undefined for a blank, torn or foreign line.
 */
function parseEvent(line: string): SessionEvent | undefined {
  if (line.trim() === "") {
    return undefined;
  }
  try {
    const value: unknown = JSON.parse(line);
    if (
      isRecord(value) &&
      value["t"] === "edit" &&
      typeof value["file"] === "string" &&
      Array.isArray(value["fingerprints"]) &&
      value["fingerprints"].every((f) => typeof f === "string")
    ) {
      // biome-ignore lint/nursery/noUnsafeTypeAssertion: every field of an edit event is checked above.
      return value as unknown as SessionEvent;
    }
  } catch {
    // torn line from a crashed writer
  }
  return undefined;
}

/**
 * Tells whether a parsed JSON value is a plain object.
 *
 * @param value - any parsed JSON value.
 * @returns true for a non-null, non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Appends one event as one line, with O_APPEND so concurrent hooks interleave
 * whole lines. A symlink planted at the log's path is refused, not followed.
 *
 * @param project - the real project root.
 * @param id - a session id that passed `isSessionId`.
 * @param event - the event to record.
 */
function append(project: string, id: string, event: SessionEvent): void {
  const path = logFile(project, id);
  if (existsAsNonFile(path)) {
    throw new Error(`${path} is not a regular file`);
  }
  const fd = openSync(
    path,
    // biome-ignore lint/suspicious/noBitwiseOperators: open(2) flags are a bit set.
    constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | NO_FOLLOW,
  );
  try {
    writeSync(fd, `${JSON.stringify(event)}\n`);
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
    const id = name.replace(SESSION_FILE, "");
    const stat = lstatSync(join(dir, name));
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
  const real = realpath(dir);
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
 * Names the state directory without creating it, for readers.
 *
 * @param project - the real project root.
 * @returns `<project>/.inwards/state`.
 */
function statePath(project: string): string {
  return join(project, ".inwards", "state");
}

/**
 * Locates one session's event log, creating and checking the directory.
 *
 * @param project - the real project root.
 * @param id - a session id that passed `isSessionId`.
 * @returns `<project>/.inwards/state/<id>.jsonl`.
 */
function logFile(project: string, id: string): string {
  return join(stateDir(project), `${id}.jsonl`);
}

/**
 * Names a path relative to the project with forward slashes, on real paths.
 * On macOS the project is /private/var/... while a payload may say /var/...;
 * mixing the two spellings would give ../../var paths.
 *
 * @param project - the real project root.
 * @param path - an absolute path inside the project.
 * @returns the project-relative path.
 */
function projectPath(project: string, path: string): string {
  return posix(relative(project, realpath(path) ?? path));
}
