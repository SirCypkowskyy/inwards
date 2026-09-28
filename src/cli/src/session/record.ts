/**
 * @file Per-session state for the agent hooks: what the session started from, which
 * files it edited, and which violations it has seen. The Stop gate (#20) and
 * escalation (#22) read it; it is always on, unlike the opt-in run log.
 *
 * Two files per session in `.inwards/state/`:
 *
 * - `<id>.start.json`: HEAD, every `[tool.inwards]` table in the project, a
 *   content-hash manifest and the symlinks in layer packages. Written once,
 *   at startup or /clear, to a temporary file that is then renamed, so a
 *   reader never sees half of it.
 * - `<id>.jsonl`: one small event per line (edits, resumes). Hooks run in
 *   parallel, so nothing rewrites it; each hook appends one short line.
 * - `<id>.content.json`: copies of the Python files git can't give back as
 *   they were at start (`start-copies.ts`, #157), written like the start
 *   file, before it, and pruned with it. Absent when there are none.
 *
 * A session without its start file is unknown, and callers fail closed. A
 * resume or compact never writes a start, and a start is never overwritten,
 * so deleting `.inwards/` mid-session can't be undone by the next SessionStart.
 *
 * The start witness (#88): a copy of `<id>.start.json` kept outside the
 * project, in `<state home>/inwards/sessions/<project hash>/`. Bash can delete
 * `.inwards/state` and pipe a made-up SessionStart into the hook, which would
 * record a new start from the loosened project. A SessionStart for a session
 * that already has a witness is a replay: it puts the witnessed start back
 * and logs the replay, and the readers prefer the witness over the project's
 * copy and say when the two disagree. The witness lives where the agent's
 * Bash can still write, so it catches a replay, not an agent that also
 * deletes or forges the witness; chapter 4 of the docs says what is left.
 *
 * Limits: the symlink checks happen before each open, and Node has no openat,
 * so a process of the same user that swaps `.inwards` in between can still
 * redirect writes, and so can a hard link to a session file. That crosses no
 * privilege boundary, since such a process could write those files itself.
 * The PreToolUse guard (#23) keeps the agent's own tools away from `.inwards/`.
 */
import { join } from "node:path";
import type { Diagnostic } from "@inwards/core";
import { isRecord } from "../json/guards.ts";
import type { Platform } from "../platform/contracts.ts";
import { baselineHashes } from "../project/baseline.ts";
import { projectConfigs, projectLinks, projectManifest, projectPath } from "../project/snapshot.ts";
import type { SessionStart } from "./contracts.ts";
import { fingerprint } from "./fingerprint.ts";
import { copiesName, startCopier } from "./start-copies.ts";
import {
  readStart,
  type StartRecord,
  touchWitness,
  trustedStart,
  witnessPath,
  writeWitness,
} from "./start-record.ts";

/** What recording and reading a session touches. */
export type SessionIo = Pick<
  Platform,
  "probe" | "read" | "walk" | "git" | "clock" | "state" | "runtime"
>;

/** Session ids come from the agent's payload, so only a safe file name is accepted. */
const SESSION_ID = /^[\w-]{1,128}$/u;
/** SessionStart sources that begin a session; `resume` and `compact` continue one. */
const NEW_SESSION = new Set(["startup", "clear"]);

/** One line of the session log. */
type SessionEvent =
  | { t: "edit"; at: string; file: string; fingerprints: string[] }
  | { t: "resume"; at: string; source: string }
  | { t: "stop"; at: string; fresh: boolean }
  | { t: "pass"; at: string }
  | { t: "replay"; at: string; source: string };

/** The session as the Stop gate and escalation see it. */
export interface SessionState {
  start: SessionStart;
  /** Project-relative paths of the files the agent edited, in order, without repeats. */
  edited: string[];
  /** Fingerprint of every violation reported in this session, to how often it was seen. */
  seen: Map<string, number>;
  /** How many times in a row the Stop gate has blocked, since the last turn start or clean pass. */
  stops: number;
  /** How the start record compares with its witness outside the project. */
  record: StartRecord;
  /** A SessionStart for a new session came after the session had started, e.g. piped in through Bash. */
  replayed: boolean;
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
 * Handles SessionStart. A new session (startup, /clear) records its start,
 * with copies of the files git can't give back, and a witness of it outside
 * the project, and prunes old sessions; a resume or compact only logs that it
 * happened. A new-session start for a session that already has a witness is
 * a replay: the witnessed start is put back and the replay logged.
 * Projects without any `[tool.inwards]` get no state at all. The witness is
 * best effort: a state directory that can't be written (a read-only home in
 * a container or sandbox) leaves the session without one, and the Stop gate
 * then falls back to the committed config.
 *
 * @param io - reads the project, runs git, tells the time and writes the state.
 * @param project - the real project root.
 * @param id - a session id that passed `isSessionId`.
 * @param source - the payload's `source`: startup, resume, clear or compact.
 * @returns a note for the user when the witness couldn't be written, else undefined.
 * @throws when the project's state can't be written or the project can't be read.
 */
export function recordStart(
  io: SessionIo,
  project: string,
  id: string,
  source: string,
): string | undefined {
  const startFile = join(io.state.statePath(project), `${id}.start.json`);
  if (!NEW_SESSION.has(source)) {
    // Only a session that already has state is continued. This never creates
    // .inwards/ in a project without Inwards, nor a start for a lost session.
    if (io.probe.exists(io.state.statePath(project))) {
      append(io, project, id, { t: "resume", at: io.clock.now(), source });
    }
    touchWitness(io, project, id);
    return undefined;
  }
  if (io.probe.exists(startFile)) {
    return undefined; // a start is written once; a repeated startup can't reset the baseline
  }
  const witnessed = readStart(io, witnessPath(io.runtime, project, id));
  if (witnessed !== undefined) {
    // The session started before, so its start file was deleted: keep the original.
    io.state.publish(io.state.stateDir(project), `${id}.start.json`, JSON.stringify(witnessed));
    append(io, project, id, { t: "replay", at: io.clock.now(), source });
    return undefined;
  }
  const { valid: configs, invalid } = projectConfigs(io, project);
  if (Object.keys(configs).length === 0) {
    return undefined;
  }
  const head = io.git.run(project, ["rev-parse", "HEAD"])?.trim() ?? null;
  const copier = startCopier(io, project, head);
  const manifest = projectManifest(io, project, configs, copier.add);
  const dir = io.state.stateDir(project);
  io.state.prune(dir, id);
  if (Object.keys(copier.copies).length > 0) {
    io.state.publish(dir, copiesName(id), JSON.stringify(copier.copies));
  }
  const baselines = baselineHashes(io, project, Object.keys(configs));
  const start: SessionStart = {
    at: io.clock.now(),
    head,
    configs,
    invalid,
    manifest,
    baselines,
    links: projectLinks(io, project, configs),
  };
  const text = JSON.stringify(start);
  io.state.publish(dir, `${id}.start.json`, text);
  try {
    writeWitness(io, project, id, text);
    return undefined;
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return `Inwards couldn't keep a copy of this session's start outside the project (${why}), so the Stop gate trusts .inwards/state only while [tool.inwards] is the committed one. Set XDG_STATE_HOME to a writable directory to keep the copy.`;
  }
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
 * @param io - reads the state and the witness.
 * @param project - the real project root.
 * @param id - a session id that passed `isSessionId`.
 * @returns the start record (the witness when there is one), or undefined
 *   when both are missing or unreadable.
 */
export function readSessionStart(
  io: Pick<SessionIo, "read" | "state" | "runtime">,
  project: string,
  id: string,
): SessionStart | undefined {
  return trustedStart(io, project, id)?.start;
}

/**
 * Reads a session's state, with the witness as its start when there is one.
 * Returns undefined when the start file and the witness are both missing or
 * unreadable, so callers can fail closed: a session whose history is gone
 * can't prove it is clean. Torn or foreign log lines are skipped.
 *
 * @param io - reads the state and the witness.
 * @param project - the real project root.
 * @param id - a session id that passed `isSessionId`.
 * @returns the session state, or undefined without a recorded start.
 */
export function readSession(
  io: Pick<SessionIo, "read" | "state" | "runtime">,
  project: string,
  id: string,
): SessionState | undefined {
  const trusted = trustedStart(io, project, id);
  if (trusted === undefined) {
    return undefined;
  }
  const { start, record } = trusted;
  let log = "";
  try {
    log = io.read.text(join(io.state.statePath(project), `${id}.jsonl`));
  } catch {
    // no edits yet
  }
  const state: SessionState = {
    start,
    edited: [],
    seen: new Map(),
    stops: 0,
    record,
    replayed: false,
  };
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
  } else if (event.t === "replay") {
    state.replayed = true;
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
    if (isRecord(value) && value["t"] === "replay") {
      return { t: "replay", at: String(value["at"]), source: String(value["source"]) };
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
