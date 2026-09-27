/**
 * @file Per-session state for the agent hooks: what the session started from, which
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
import { join } from "node:path";
import type { Diagnostic, InwardsConfig } from "@inwards/core";
import { isRecord } from "../json/guards.ts";
import type { Platform } from "../platform/contracts.ts";
import { baselineHashes } from "../project/baseline.ts";
import { projectConfigs, projectManifest, projectPath } from "../project/snapshot.ts";
import { fingerprint } from "./fingerprint.ts";

/** What recording and reading a session touches. */
export type SessionIo = Pick<Platform, "probe" | "read" | "walk" | "git" | "clock" | "state">;

/** Session ids come from the agent's payload, so only a safe file name is accepted. */
const SESSION_ID = /^[\w-]{1,128}$/u;
/** SessionStart sources that begin a session; `resume` and `compact` continue one. */
const NEW_SESSION = new Set(["startup", "clear"]);

/** What a session started from. */
export interface SessionStart {
  at: string;
  /** `git rev-parse HEAD` at session start, or null outside a git repo. */
  head: string | null;
  /** Every `[tool.inwards]` table in the project, by project-relative pyproject.toml path. */
  configs: Record<string, InwardsConfig>;
  /** pyproject.toml files whose `[tool.inwards]` was already invalid (absent in older state files). */
  invalid?: string[];
  /** Project-relative path of every Python file in the project, to its SHA-256. */
  manifest: Record<string, string>;
  /** Each config's inwards-baseline.json SHA-256, by config path (absent in older state files). */
  baselines?: Record<string, string>;
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
 * Handles SessionStart. A new session (startup, /clear) records its start and
 * prunes old sessions; a resume or compact only logs that it happened.
 * Projects without any `[tool.inwards]` get no state at all.
 *
 * @param io - reads the project, runs git, tells the time and writes the state.
 * @param project - the real project root.
 * @param id - a session id that passed `isSessionId`.
 * @param source - the payload's `source`: startup, resume, clear or compact.
 * @throws when the state can't be written or the project can't be read.
 */
export function recordStart(io: SessionIo, project: string, id: string, source: string): void {
  const startFile = join(io.state.statePath(project), `${id}.start.json`);
  if (!NEW_SESSION.has(source)) {
    // Only a session that already has state is continued. This never creates
    // .inwards/ in a project without Inwards, nor a start for a lost session.
    if (io.probe.exists(io.state.statePath(project))) {
      append(io, project, id, { t: "resume", at: io.clock.now(), source });
    }
    return;
  }
  if (io.probe.exists(startFile)) {
    return; // a start is written once; a repeated startup can't reset the baseline
  }
  const { valid: configs, invalid } = projectConfigs(io, project);
  if (Object.keys(configs).length === 0) {
    return;
  }
  const manifest = projectManifest(io, project, configs);
  const head = io.git.run(project, ["rev-parse", "HEAD"])?.trim() ?? null;
  const dir = io.state.stateDir(project);
  io.state.prune(dir, id);
  const baselines = baselineHashes(io, project, Object.keys(configs));
  const start: SessionStart = {
    at: io.clock.now(),
    head,
    configs,
    invalid,
    manifest,
    baselines,
  };
  io.state.publish(dir, `${id}.start.json`, JSON.stringify(start));
}

/**
 * Records one edit and the violations the hook reported for it.
 *
 * @param io - resolves the file's real path, tells the time and appends to the log.
 * @param session - the real project root and a session id that passed `isSessionId`.
 * @param session.project - the real project root.
 * @param session.id - a session id that passed `isSessionId`.
 * @param file - the edited file, absolute.
 * @param diagnostics - what the check of that file reported (empty when clean).
 * @throws when the log can't be written.
 */
export function recordEdit(
  io: Pick<SessionIo, "probe" | "clock" | "state">,
  { project, id }: { project: string; id: string },
  file: string,
  diagnostics: readonly Diagnostic[],
): void {
  append(io, project, id, {
    t: "edit",
    at: io.clock.now(),
    file: projectPath(io.probe, project, file),
    // Once per edit: the same import twice in a file is one attempt, not two.
    fingerprints: [...new Set(diagnostics.map(fingerprint))],
  });
}

/**
 * Records that the Stop gate blocked the turn.
 *
 * @param io - tells the time and appends to the log.
 * @param project - the real project root.
 * @param id - a session id that passed `isSessionId`.
 * @param fresh - true for the turn's first block (`stop_hook_active` was false),
 *   which restarts the count.
 * @throws when the log can't be written.
 */
export function recordStop(
  io: Pick<SessionIo, "clock" | "state">,
  project: string,
  id: string,
  fresh: boolean,
): void {
  append(io, project, id, { t: "stop", at: io.clock.now(), fresh });
}

/**
 * Records that the Stop gate passed clean, which ends a streak of blocks.
 *
 * @param io - tells the time and appends to the log.
 * @param project - the real project root.
 * @param id - a session id that passed `isSessionId`.
 * @throws when the log can't be written.
 */
export function recordPass(
  io: Pick<SessionIo, "clock" | "state">,
  project: string,
  id: string,
): void {
  append(io, project, id, { t: "pass", at: io.clock.now() });
}

/**
 * Reads only a session's start record, which is cheaper than the whole log.
 *
 * @param io - reads the state.
 * @param project - the real project root.
 * @param id - a session id that passed `isSessionId`.
 * @returns the start record, or undefined when missing or unreadable.
 */
export function readSessionStart(
  io: Pick<SessionIo, "read" | "state">,
  project: string,
  id: string,
): SessionStart | undefined {
  return readStart(io, join(io.state.statePath(project), `${id}.start.json`));
}

/**
 * Reads a session's state.
 * Returns undefined when the start file is missing or unreadable, so callers
 * can fail closed: a session whose history is gone can't prove it is clean.
 * Torn or foreign log lines are skipped.
 *
 * @param io - reads the state.
 * @param project - the real project root.
 * @param id - a session id that passed `isSessionId`.
 * @returns the session state, or undefined without a recorded start.
 */
export function readSession(
  io: Pick<SessionIo, "read" | "state">,
  project: string,
  id: string,
): SessionState | undefined {
  const start = readStart(io, join(io.state.statePath(project), `${id}.start.json`));
  if (start === undefined) {
    return undefined;
  }
  let log = "";
  try {
    log = io.read.text(join(io.state.statePath(project), `${id}.jsonl`));
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
 * @param io - reads the file.
 * @param path - the `<id>.start.json` path.
 * @returns the start record, or undefined when missing or malformed.
 */
function readStart(io: Pick<SessionIo, "read">, path: string): SessionStart | undefined {
  try {
    const value: unknown = JSON.parse(io.read.text(path));
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
 * Appends one event to a session's log as one line.
 *
 * @param io - writes the state.
 * @param project - the real project root.
 * @param id - a session id that passed `isSessionId`.
 * @param event - the event to record.
 * @throws when the log can't be written.
 */
function append(
  io: Pick<SessionIo, "state">,
  project: string,
  id: string,
  event: SessionEvent,
): void {
  io.state.appendLine(
    join(io.state.stateDir(project), `${id}.jsonl`),
    `${JSON.stringify(event)}\n`,
  );
}
