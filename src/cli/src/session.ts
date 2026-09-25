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
 * resume or compact never writes a start, and a start is never overwritten,
 * so deleting `.inwards/` mid-session can't be undone by the next SessionStart.
 *
 * Limits: the symlink checks happen before each open, and Node has no openat,
 * so a process of the same user that swaps `.inwards` in between can still
 * redirect writes, and so can a hard link to a session file. That crosses no
 * privilege boundary, since such a process could write those files itself.
 * The PreToolUse guard (#23) keeps the agent's own tools away from `.inwards/`.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import type { Diagnostic, InwardsConfig } from "@inwards/core";
import { git, projectConfigs, projectManifest, projectPath } from "./snapshot.ts";
import { appendLine, prune, stateDir, statePath } from "./state-files.ts";

/** Session ids come from the agent's payload, so only a safe file name is accepted. */
const SESSION_ID = /^[\w-]{1,128}$/u;
/** Hex digits kept from a fingerprint's SHA-256: 64 bits is plenty for one session. */
const FINGERPRINT_LENGTH = 16;
/** SessionStart sources that begin a session; `resume` and `compact` continue one. */
const NEW_SESSION = new Set(["startup", "clear"]);

/** What a session started from. */
interface SessionStart {
  at: string;
  /** `git rev-parse HEAD` at session start, or null outside a git repo. */
  head: string | null;
  /** Every `[tool.inwards]` table in the project, by project-relative pyproject.toml path. */
  configs: Record<string, InwardsConfig>;
  /** pyproject.toml files whose `[tool.inwards]` was already invalid (absent in older state files). */
  invalid?: string[];
  /** Project-relative path of every Python file in the project, to its SHA-256. */
  manifest: Record<string, string>;
}

/** One line of the session log. */
type SessionEvent =
  | { t: "edit"; at: string; file: string; fingerprints: string[] }
  | { t: "resume"; at: string; source: string }
  | { t: "stop"; at: string; fresh: boolean }
  | { t: "pass"; at: string };

/** The session as the Stop gate and escalation see it. */
export interface SessionState {
  start: SessionStart;
  /** Project-relative paths of the files the agent edited, in order, without repeats. */
  edited: string[];
  /** Fingerprint of every violation reported in this session, to how often it was seen. */
  seen: Map<string, number>;
  /** How many times in a row the Stop gate has blocked, since the last turn start or clean pass. */
  stops: number;
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
export function fingerprint(d: Diagnostic): string {
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
  const startFile = join(statePath(project), `${id}.start.json`);
  if (!NEW_SESSION.has(source)) {
    // Only a session that already has state is continued. This never creates
    // .inwards/ in a project without Inwards, nor a start for a lost session.
    if (existsSync(statePath(project))) {
      append(project, id, { t: "resume", at: new Date().toISOString(), source });
    }
    return;
  }
  if (existsSync(startFile)) {
    return; // a start is written once; a repeated startup can't reset the baseline
  }
  const { valid: configs, invalid } = projectConfigs(project);
  if (Object.keys(configs).length === 0) {
    return;
  }
  const manifest = projectManifest(project, configs);
  const head = git(project, ["rev-parse", "HEAD"])?.trim() ?? null;
  const dir = stateDir(project);
  prune(dir, id);
  const start: SessionStart = { at: new Date().toISOString(), head, configs, invalid, manifest };
  const temp = join(dir, `.${id}.${process.pid}.tmp`);
  writeFileSync(temp, JSON.stringify(start), { flag: "wx" });
  renameSync(temp, startFile); // rename replaces a planted symlink, never follows it
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
 * Records that the Stop gate blocked the turn.
 *
 * @param project - the real project root.
 * @param id - a session id that passed `isSessionId`.
 * @param fresh - true for the turn's first block (`stop_hook_active` was false),
 *   which restarts the count.
 */
export function recordStop(project: string, id: string, fresh: boolean): void {
  append(project, id, { t: "stop", at: new Date().toISOString(), fresh });
}

/**
 * Records that the Stop gate passed clean, which ends a streak of blocks.
 *
 * @param project - the real project root.
 * @param id - a session id that passed `isSessionId`.
 */
export function recordPass(project: string, id: string): void {
  append(project, id, { t: "pass", at: new Date().toISOString() });
}

/**
 * Reads only a session's start record, which is cheaper than the whole log.
 *
 * @param project - the real project root.
 * @param id - a session id that passed `isSessionId`.
 * @returns the start record, or undefined when missing or unreadable.
 */
export function readSessionStart(project: string, id: string): SessionStart | undefined {
  return readStart(join(statePath(project), `${id}.start.json`));
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
  const state: SessionState = { start, edited: [], seen: new Map(), stops: 0 };
  for (const line of log.split("\n")) {
    const event = parseEvent(line);
    if (event !== undefined) {
      tally(state, event);
    }
  }
  return state;
}

/**
 * Folds one log event into the session state.
 *
 * @param state - the state so far, updated in place.
 * @param event - one parsed log line.
 */
function tally(state: SessionState, event: SessionEvent): void {
  if (event.t === "stop") {
    state.stops = event.fresh ? 1 : state.stops + 1;
  } else if (event.t === "pass") {
    state.stops = 0;
  } else if (event.t === "edit") {
    if (!state.edited.includes(event.file)) {
      state.edited.push(event.file);
    }
    for (const print of event.fingerprints) {
      state.seen.set(print, (state.seen.get(print) ?? 0) + 1);
    }
  }
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
    if (isRecord(value) && value["t"] === "stop") {
      return { t: "stop", at: String(value["at"]), fresh: value["fresh"] === true };
    }
    if (isRecord(value) && value["t"] === "pass") {
      return { t: "pass", at: String(value["at"]) };
    }
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
 * Appends one event to a session's log as one line.
 *
 * @param project - the real project root.
 * @param id - a session id that passed `isSessionId`.
 * @param event - the event to record.
 */
function append(project: string, id: string, event: SessionEvent): void {
  appendLine(logFile(project, id), `${JSON.stringify(event)}\n`);
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
