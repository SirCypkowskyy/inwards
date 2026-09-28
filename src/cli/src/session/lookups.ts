/**
 * @file Everything the hooks need to compare a check with the session start, built
 * once per invocation: start identity and start content (each with its own
 * cache), a bound check runner, and the probe and reader for the rest. A
 * hook creates one `StartLookups` and hands it to both the suppression and
 * the old-error checks, so they share the cache; two invocations never do.
 * SessionStart's copies of dirty files are read at most once, on the first
 * start content the git blob can't prove.
 */
import type { FileReader, Git, PathProbe, StateFiles } from "../platform/contracts.ts";
import type { CheckRunner } from "./contracts.ts";
import { createStartContent, type StartContent } from "./start-content.ts";
import { readStartCopies } from "./start-copies.ts";
import { createStartIdentity, type StartIdentity } from "./start-identity.ts";

/** One invocation's view of the session start. */
export interface StartLookups {
  /** The real project root. */
  project: string;
  identity: StartIdentity;
  content: StartContent;
  /** Runs a check, for a file as it was at session start. */
  check: CheckRunner;
  probe: Pick<PathProbe, "realpath">;
  read: Pick<FileReader, "text">;
}

/**
 * Builds the lookups for one hook invocation.
 *
 * @param io - the filesystem, git and a bound check runner.
 * @param io.probe - resolves real paths and tells symlinks and existence.
 * @param io.read - reads file text and bytes.
 * @param io.git - runs hardened git plumbing.
 * @param io.check - runs a check with its I/O bound.
 * @param io.state - names the state directory, for SessionStart's copies.
 * @param session - the real project root and the session id.
 * @param session.project - the real project root.
 * @param session.id - a session id that passed `isSessionId`; without one there are no copies.
 * @returns fresh lookups with empty caches.
 */
export function createStartLookups(
  io: {
    probe: Pick<PathProbe, "realpath" | "isLink" | "exists">;
    read: Pick<FileReader, "text" | "bytes">;
    git: Git;
    check: CheckRunner;
    state: Pick<StateFiles, "statePath">;
  },
  { project, id }: { project: string; id: string | undefined },
): StartLookups {
  let copies: ReadonlyMap<string, string> | undefined;
  return {
    project,
    identity: createStartIdentity(io.probe),
    content: createStartContent({
      git: io.git,
      read: io.read,
      copies: (): ReadonlyMap<string, string> => {
        copies ??= id === undefined ? new Map() : readStartCopies(io, project, id);
        return copies;
      },
    }),
    check: io.check,
    probe: io.probe,
    read: io.read,
  };
}
