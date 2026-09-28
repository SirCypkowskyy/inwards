/**
 * @file What a file contained when the session started, proven against the start
 * manifest's SHA-256. The content comes from git: the raw blob at the commit
 * the session started on, or that blob with CRLF line endings (what
 * `core.autocrlf` checks out), whichever matches the hash. Never `cat-file
 * --filters` or `git show --textconv`: they run filter drivers from
 * .gitattributes and .git/config, which the agent can write, so they would run
 * the agent's commands outside its permissions. For the same reason the read
 * never fetches a missing object (`--no-lazy-fetch`; git before 2.44 rejects
 * the flag, so there only SessionStart's copy can give the start content).
 * A file that was uncommitted, untracked or outside git at session start
 * falls back to the copy SessionStart kept of it (`start-copies.ts`, #157),
 * trusted only when it hashes to the manifest too. A file with neither has
 * no known start content: when in doubt, the gate blocks.
 *
 * Every lookup, failed ones included, is cached per `StartContent`, which a
 * hook creates once per invocation; suppression handling and the old-error
 * check share it. Git and file reads come in through the contracts.
 */
import { createHash } from "node:crypto";
import type { FileReader, Git } from "../platform/contracts.ts";
import type { Start } from "./contracts.ts";

/** Start content questions, answered with a per-invocation cache. */
export interface StartContent {
  /**
   * Reads a file as it was at session start, if SessionStart's copy of it or
   * git still has exactly that.
   *
   * @param project - the real project root.
   * @param start - the session's start record.
   * @param rel - the file's start identity (`StartIdentity.startPath`).
   * @returns the start content, or undefined when it can't be proven.
   */
  startText: (
    project: string,
    start: Pick<Start, "head" | "manifest">,
    rel: string,
  ) => string | undefined;
  /**
   * Finds the files that are byte for byte what they were at session start.
   * The same bytes mean the same suppressions, committed or not. Each file is
   * read and hashed once, however many findings it has.
   *
   * @param start - the session's start manifest.
   * @param files - each finding's file: its start identity and its absolute path; repeats allowed.
   * @returns the project paths whose hash now is their start hash.
   */
  unchangedFiles: (
    start: Pick<Start, "manifest">,
    files: readonly (readonly [rel: string, abs: string])[],
  ) => Set<string>;
}

/**
 * Creates the start content lookups for one invocation.
 *
 * @param io - runs git for blobs, reads current file bytes and SessionStart's copies.
 * @param io.git - runs hardened git plumbing.
 * @param io.read - reads a file's bytes.
 * @param io.copies - SessionStart's copies by manifest path, unverified; none when left out.
 * @returns the lookups, sharing one cache.
 */
export function createStartContent(io: {
  git: Git;
  read: Pick<FileReader, "bytes">;
  copies?: () => ReadonlyMap<string, string>;
}): StartContent {
  /**
   * Start contents already looked up, by commit, project path and start
   * hash; null for a lookup that failed. The key names the exact content, so
   * an entry can't go stale.
   */
  const startTexts = new Map<string, string | null>();
  return {
    startText(
      project: string,
      start: Pick<Start, "head" | "manifest">,
      rel: string,
    ): string | undefined {
      const hash = start.manifest[rel];
      if (hash === undefined) {
        return undefined;
      }
      const key = `${start.head}\u0000${rel}\u0000${hash}`;
      if (!startTexts.has(key)) {
        // The copy first: it costs no git process, and only one text can have the hash.
        const copy = io.copies?.().get(rel);
        const text =
          copy !== undefined && sha256(copy) === hash
            ? copy
            : fromGit(io.git, project, { head: start.head, rel, hash });
        startTexts.set(key, text ?? null);
      }
      return startTexts.get(key) ?? undefined;
    },
    unchangedFiles(
      start: Pick<Start, "manifest">,
      files: readonly (readonly [rel: string, abs: string])[],
    ): Set<string> {
      const byPath = new Map(files);
      return new Set(
        [...byPath].flatMap(([rel, abs]) => {
          const hash = start.manifest[rel];
          try {
            const same = hash !== undefined && sha256(io.read.bytes(abs)) === hash;
            return same ? [rel] : [];
          } catch {
            return []; // gone or unreadable: not provably unchanged
          }
        }),
      );
    },
  };
}

/**
 * Reads a file's start content from git: the raw blob at the start commit, or
 * that blob with CRLF line endings (what `core.autocrlf` checks out),
 * whichever hashes to the manifest.
 *
 * @param git - runs hardened git plumbing.
 * @param project - the real project root, where git runs.
 * @param file - the start commit, the file's start identity and its start hash.
 * @param file.head - the start commit, or null outside git.
 * @param file.rel - the file's start identity.
 * @param file.hash - its SHA-256 in the start manifest.
 * @returns the start content, or undefined when git doesn't have it.
 */
function fromGit(
  git: Git,
  project: string,
  { head, rel, hash }: { head: string | null; rel: string; hash: string },
): string | undefined {
  if (head === null) {
    return undefined;
  }
  // `./` makes the path relative to the project, which may sit below the repo root.
  const raw = git.run(project, ["--no-lazy-fetch", "cat-file", "blob", `${head}:./${rel}`]);
  const crlf = raw?.replace(/\r?\n/gu, "\r\n");
  return [raw, crlf].find((t) => t !== undefined && sha256(t) === hash);
}

/**
 * Hashes text (as UTF-8) or bytes with SHA-256.
 *
 * @param data - the content.
 * @returns the hex digest, as the start manifest records it.
 */
function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}
