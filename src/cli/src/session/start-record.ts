/**
 * @file The start record's file side (#88): reading `<id>.start.json`, and the
 * witness, a copy of it that SessionStart keeps outside the project in
 * `<state home>/inwards/sessions/<project hash>/`. Readers prefer the witness,
 * since the project's copy is where the agent's Bash deletes and forges, and
 * say how the two compare. The witness is only as safe as the user's state
 * directory, which the same Bash can reach; `session/record.ts` says what that
 * leaves open. All I/O goes through the platform contracts.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";
import { isRecord } from "../json/guards.ts";
import type { Platform, Runtime } from "../platform/contracts.ts";
import type { SessionStart } from "./contracts.ts";

/** Hex digits of the project path's SHA-256 that name its witness directory. */
const KEY_LENGTH = 32;

/**
 * How the project's start record compares with the witness outside the
 * project: `kept` when they agree, `unwitnessed` when there is no witness (a
 * session started before #88, or a witness deleted), `replaced` when the
 * record differs from the witness, and `deleted` when only the witness is
 * left. In the last two, the witness is the start.
 */
export type StartRecord = "kept" | "unwitnessed" | "replaced" | "deleted";

/**
 * Names the directory outside the project that holds its sessions' start
 * witnesses: one per project, keyed by a hash of its real path.
 *
 * @param runtime - the user's state directory.
 * @param project - the real project root.
 * @returns `<state home>/inwards/sessions/<first 32 hex digits of the path's SHA-256>`.
 */
function witnessDir(runtime: Pick<Runtime, "stateHome">, project: string): string {
  const key = createHash("sha256").update(project).digest("hex").slice(0, KEY_LENGTH);
  return join(runtime.stateHome, "inwards", "sessions", key);
}

/**
 * Names a session's start witness.
 *
 * @param runtime - the user's state directory.
 * @param project - the real project root.
 * @param id - a session id that passed `isSessionId`.
 * @returns the witness file's path.
 */
export function witnessPath(
  runtime: Pick<Runtime, "stateHome">,
  project: string,
  id: string,
): string {
  return join(witnessDir(runtime, project), `${id}.start.json`);
}

/**
 * Writes a session's witness, and prunes witnesses older than a week. Never
 * by count: the agent can start as many made-up sessions through the hook as
 * it likes, and a count cap would let that flood evict the real session's
 * witness before a replay (#88 review). A flood only adds small files, which
 * age out.
 *
 * @param io - creates the directory outside the project and writes to it.
 * @param project - the real project root.
 * @param id - a session id that passed `isSessionId`.
 * @param text - the start record, exactly as written to the project.
 * @throws when the directory can't be created or the file written.
 */
export function writeWitness(
  io: Pick<Platform, "state" | "runtime">,
  project: string,
  id: string,
  text: string,
): void {
  const dir = io.state.outsideDir(witnessDir(io.runtime, project));
  io.state.prune(dir, id, false);
  io.state.publish(dir, `${id}.start.json`, text);
}

/**
 * Marks a session's witness as in use, so the age-based pruning never drops
 * the witness of a session that is still running. Called on resume, compact
 * and every Stop; best effort, since a session without a witness falls back
 * to the committed config anyway.
 *
 * @param io - touches the witness.
 * @param project - the real project root.
 * @param id - a session id that passed `isSessionId`.
 */
export function touchWitness(
  io: Pick<Platform, "state" | "runtime">,
  project: string,
  id: string,
): void {
  try {
    io.state.touch(witnessPath(io.runtime, project, id));
  } catch {
    // no witness, or one that can't be touched: nothing to keep
  }
}

/**
 * Picks the start to trust: the witness outside the project when there is
 * one, since the project's copy is where the agent's Bash deletes and forges,
 * else the project's copy.
 *
 * @param io - reads the state and the witness.
 * @param project - the real project root.
 * @param id - a session id that passed `isSessionId`.
 * @returns the start and how the project's record compares with the witness,
 *   or undefined when neither can be read.
 */
export function trustedStart(
  io: Pick<Platform, "read" | "state" | "runtime">,
  project: string,
  id: string,
): { start: SessionStart; record: StartRecord } | undefined {
  const own = readStart(io, join(io.state.statePath(project), `${id}.start.json`));
  const witness = readStart(io, witnessPath(io.runtime, project, id));
  if (witness === undefined) {
    return own === undefined ? undefined : { start: own, record: "unwitnessed" };
  }
  if (own === undefined) {
    return { start: witness, record: "deleted" };
  }
  const same = JSON.stringify(own) === JSON.stringify(witness);
  return { start: witness, record: same ? "kept" : "replaced" };
}

/**
 * Reads and shape-checks a start file.
 *
 * @param io - reads the file.
 * @param path - the `<id>.start.json` path.
 * @returns the start record, or undefined when missing or malformed.
 */
export function readStart(io: Pick<Platform, "read">, path: string): SessionStart | undefined {
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
