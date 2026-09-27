/**
 * @file Everything the hooks need to compare a check with the session start, built
 * once per invocation: start identity and start content (each with its own
 * cache), a bound check runner, and the probe and reader for the rest. A
 * hook creates one `StartLookups` and hands it to both the suppression and
 * the old-error checks, so they share the cache; two invocations never do.
 */
import type { FileReader, Git, PathProbe } from "../platform/contracts.ts";
import type { CheckRunner } from "./contracts.ts";
import { createStartContent, type StartContent } from "./start-content.ts";
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
 * @param project - the real project root.
 * @returns fresh lookups with empty caches.
 */
export function createStartLookups(
  io: {
    probe: Pick<PathProbe, "realpath" | "isLink" | "exists">;
    read: Pick<FileReader, "text" | "bytes">;
    git: Git;
    check: CheckRunner;
  },
  project: string,
): StartLookups {
  return {
    project,
    identity: createStartIdentity(io.probe),
    content: createStartContent(io),
    check: io.check,
    probe: io.probe,
    read: io.read,
  };
}
