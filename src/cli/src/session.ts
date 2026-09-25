/**
 * Per-session state for the agent hooks: what the session started from, which
 * files it edited, and which violations it has seen. The Stop gate (#20) and
 * escalation (#22) read it; it is always on, unlike the opt-in run log.
 *
 * Storage is one append-only JSON Lines file per session,
 * `.inwards/state/<session_id>.jsonl`. Hooks run in parallel, so nothing ever
 * rewrites the file: each hook appends one line with O_APPEND, and readers
 * fold the lines. A lost update is impossible by construction.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { type Diagnostic, type InwardsConfig, parseConfig } from "@inwards/core";
import { collectPythonFiles } from "./files.ts";
import { posix } from "./paths.ts";

/** Session ids come from the agent's payload, so only a safe file name is accepted. */
const SESSION_ID = /^[\w-]{1,128}$/u;
/** Session files older than a week (in ms) are pruned when a new session starts. */
const MAX_AGE_MS = 604_800_000;
/** Hex digits kept from a fingerprint's SHA-256: 64 bits is plenty for one session. */
const FINGERPRINT_LENGTH = 16;
/** At most this many session files are kept. */
const MAX_SESSIONS = 50;

/** One line of the session log. */
type SessionEvent =
  | {
      t: "start";
      at: string;
      /** `git rev-parse HEAD` at session start, or null outside a git repo. */
      head: string | null;
      /** The parsed `[tool.inwards]` table the session started with. */
      config: InwardsConfig;
      /** Project-relative path of every Python file under the root, to its SHA-256. */
      manifest: Record<string, string>;
    }
  | { t: "edit"; at: string; file: string; fingerprints: string[] };

/** The session as the Stop gate and escalation see it. */
export interface SessionState {
  start: Extract<SessionEvent, { t: "start" }>;
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
 * Records the start of a session and prunes old session files.
 * Called from SessionStart, once per session, so this one large line is never
 * written concurrently with another.
 *
 * @param project - the real project root.
 * @param id - a session id that passed `isSessionId`.
 * @param configPath - the project's pyproject.toml with `[tool.inwards]`.
 */
export function recordStart(project: string, id: string, configPath: string): void {
  const config = parseConfig(readFileSync(configPath, "utf8"));
  const root = resolve(dirname(configPath), config.root);
  const manifest: Record<string, string> = {};
  for (const file of collectPythonFiles([root])) {
    const hash = createHash("sha256").update(readFileSync(file)).digest("hex");
    manifest[posix(relative(project, file))] = hash;
  }
  const git = spawnSync("git", ["rev-parse", "HEAD"], { cwd: project, encoding: "utf8" });
  const head = git.status === 0 ? git.stdout.trim() : null;
  prune(stateDir(project));
  append(project, id, { t: "start", at: new Date().toISOString(), head, config, manifest });
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
    file: posix(relative(project, file)),
    fingerprints: diagnostics.map(fingerprint),
  });
}

/**
 * Folds a session's log into its current state.
 * Returns undefined when the log or its start line is missing, so callers can
 * fail closed: a session whose history is gone can't prove it is clean.
 * A torn or foreign line is skipped; a second start line is ignored.
 *
 * @param project - the real project root.
 * @param id - a session id that passed `isSessionId`.
 * @returns the session state, or undefined without a recorded start.
 */
export function readSession(project: string, id: string): SessionState | undefined {
  let text: string;
  try {
    text = readFileSync(sessionFile(project, id), "utf8");
  } catch {
    return undefined;
  }
  let start: SessionState["start"] | undefined;
  const edited: string[] = [];
  const seen = new Map<string, number>();
  for (const line of text.split("\n")) {
    const event = parseEvent(line);
    if (event?.t === "start") {
      start ??= event;
    } else if (event?.t === "edit") {
      if (!edited.includes(event.file)) {
        edited.push(event.file);
      }
      for (const print of event.fingerprints) {
        seen.set(print, (seen.get(print) ?? 0) + 1);
      }
    }
  }
  return start && { start, edited, seen };
}

/**
 * Parses one log line, accepting only the two event shapes this module writes.
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
    if (typeof value !== "object" || value === null || !("t" in value)) {
      return undefined;
    }
    if (value.t === "edit" && "file" in value && "fingerprints" in value) {
      // biome-ignore lint/nursery/noUnsafeTypeAssertion: t, file and fingerprints checked above; this module is the only writer.
      return value as SessionEvent;
    }
    if (value.t === "start" && "config" in value && "manifest" in value) {
      // biome-ignore lint/nursery/noUnsafeTypeAssertion: t, config and manifest checked above; this module is the only writer.
      return value as SessionEvent;
    }
  } catch {
    // torn line from a crashed writer
  }
  return undefined;
}

/**
 * Appends one event as one line. O_APPEND makes each small write atomic, so
 * concurrent hooks interleave whole lines, never halves.
 *
 * @param project - the real project root.
 * @param id - a session id that passed `isSessionId`.
 * @param event - the event to record.
 */
function append(project: string, id: string, event: SessionEvent): void {
  mkdirSync(stateDir(project), { recursive: true });
  appendFileSync(sessionFile(project, id), `${JSON.stringify(event)}\n`);
}

/**
 * Deletes session files past the age cap, then all but the newest MAX_SESSIONS.
 *
 * @param dir - the state directory.
 */
function prune(dir: string): void {
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
  } catch {
    return; // no state yet
  }
  const now = Date.now();
  const files = names
    .map((name) => ({ path: join(dir, name), mtime: statSync(join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  files.forEach((file, i) => {
    if (i >= MAX_SESSIONS || now - file.mtime > MAX_AGE_MS) {
      rmSync(file.path, { force: true });
    }
  });
}

/**
 * Locates the state directory of a project.
 *
 * @param project - the real project root.
 * @returns `<project>/.inwards/state`.
 */
function stateDir(project: string): string {
  return join(project, ".inwards", "state");
}

/**
 * Locates one session's log.
 *
 * @param project - the real project root.
 * @param id - a session id that passed `isSessionId`.
 * @returns `<project>/.inwards/state/<id>.jsonl`.
 */
function sessionFile(project: string, id: string): string {
  return join(stateDir(project), `${id}.jsonl`);
}
