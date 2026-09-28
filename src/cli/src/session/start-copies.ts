/**
 * @file Copies of the Python files whose start content git can't give back: files
 * that were modified, untracked or outside git when the session started, or
 * every file when git is too old to read a blob safely (#157). SessionStart
 * keeps them in `<id>.content.json` next to the start record, so the Stop
 * gate and PostToolUse can still tell a file's old violations from new ones.
 *
 * The copy is only a candidate: `start-content.ts` trusts it only when its
 * SHA-256 is the start manifest's, so a copy edited through Bash is ignored.
 * Only files that are their own start identity (`start-identity.ts`) are
 * copied, so a symlink alias never gets a copy to borrow. Sizes are capped;
 * a file past a cap keeps the old behaviour: no known start content. No I/O
 * of its own: git, the probe and the state files come in as parameters.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";
import { isRecord } from "../json/guards.ts";
import type { FileReader, Git, PathProbe, StateFiles } from "../platform/contracts.ts";
import { createStartIdentity } from "./start-identity.ts";

/** The largest file copied, in bytes (512 KiB). */
export const MAX_COPY_BYTES = 524_288;
/** The most bytes copied for one session (4 MiB); files past it aren't copied. */
export const MAX_COPIES_BYTES = 4_194_304;

/** One `ls-tree -z` entry for a blob: `<mode> blob <oid>\t<path>`. */
const TREE_BLOB = /^\d+ blob (?<oid>[0-9a-f]+)\t(?<path>.+)$/su;
/** Hex digits in a SHA-256 object id; a SHA-1 one has 40. */
const SHA256_OID_LENGTH = 64;

/** Decodes a copy strictly, keeping a BOM, so the text hashes back to the same bytes. */
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** Collects copies while the start manifest is hashed. */
export interface StartCopier {
  /**
   * Considers one file of the manifest for a copy.
   *
   * @param rel - the file's manifest path.
   * @param file - the file, absolute, as walked.
   * @param bytes - its content at session start.
   */
  add: (rel: string, file: string, bytes: Uint8Array) => void;
  /** The copies so far, by manifest path. */
  copies: Record<string, string>;
}

/**
 * Names a session's copies file in the state directory.
 *
 * @param id - a session id that passed `isSessionId`.
 * @returns `<id>.content.json`.
 */
export function copiesName(id: string): string {
  return `${id}.content.json`;
}

/**
 * Creates the collector for one SessionStart. It lists the blobs of the start
 * commit once; a file whose bytes are one of them (or are it with CRLF line
 * endings) needs no copy, since `start-content.ts` reads it from git.
 *
 * @param io - runs git and resolves paths for the start identity.
 * @param io.git - runs hardened git plumbing.
 * @param io.probe - resolves real paths and tells symlinks.
 * @param project - the real project root.
 * @param head - the start commit, or null outside git.
 * @returns an empty collector.
 */
export function startCopier(
  io: { git: Git; probe: Pick<PathProbe, "realpath" | "isLink" | "exists"> },
  project: string,
  head: string | null,
): StartCopier {
  const blobs = head === null ? new Map<string, string>() : treeBlobs(io.git, project, head);
  const identity = createStartIdentity(io.probe);
  const copies: Record<string, string> = {};
  let total = 0;
  return {
    copies,
    add(rel: string, file: string, bytes: Uint8Array): void {
      const oid = blobs.get(rel);
      if (
        bytes.length > MAX_COPY_BYTES ||
        total + bytes.length > MAX_COPIES_BYTES ||
        (oid !== undefined && blobId(oid, bytes) === oid)
      ) {
        return;
      }
      const text = decode(bytes);
      const lf = text?.replaceAll("\r\n", "\n");
      if (
        text === undefined ||
        (oid !== undefined && lf !== text && blobId(oid, new TextEncoder().encode(lf)) === oid) ||
        identity.startPath(project, file) !== rel
      ) {
        return;
      }
      copies[rel] = text;
      total += bytes.length;
    },
  };
}

/**
 * Reads a session's copies. They are unverified: `start-content.ts` checks
 * each against the start manifest before using it.
 *
 * @param io - reads the state.
 * @param io.read - reads file text.
 * @param io.state - names the state directory.
 * @param project - the real project root.
 * @param id - a session id that passed `isSessionId`.
 * @returns the copies by manifest path; empty when there are none or the file is unreadable.
 */
export function readStartCopies(
  io: { read: Pick<FileReader, "text">; state: Pick<StateFiles, "statePath"> },
  project: string,
  id: string,
): Map<string, string> {
  try {
    const value: unknown = JSON.parse(
      io.read.text(join(io.state.statePath(project), copiesName(id))),
    );
    if (isRecord(value)) {
      return new Map(
        Object.entries(value).flatMap(([rel, text]) =>
          typeof text === "string" ? [[rel, text] as const] : [],
        ),
      );
    }
  } catch {
    // no copies, or a torn or foreign file: no start content from here
  }
  return new Map();
}

/**
 * Lists the blobs of a commit below the project, by project-relative path.
 * `ls-tree` runs no filters; `--no-lazy-fetch` keeps a partial clone from
 * fetching anything. When git fails (before 2.44 it rejects the flag, and
 * `cat-file` then can't read start content either) the list is empty, so
 * every file is a candidate for a copy.
 *
 * @param git - runs hardened git plumbing.
 * @param project - the real project root, where git runs.
 * @param head - the start commit.
 * @returns object ids by path relative to the project.
 */
function treeBlobs(git: Git, project: string, head: string): Map<string, string> {
  const out = git.run(project, ["--no-lazy-fetch", "ls-tree", "-r", "-z", head]) ?? "";
  const blobs = new Map<string, string>();
  for (const entry of out.split("\0")) {
    // Paths are relative to the working directory, the project.
    const { oid, path } = TREE_BLOB.exec(entry)?.groups ?? {};
    if (oid !== undefined && path !== undefined) {
      blobs.set(path, oid);
    }
  }
  return blobs;
}

/**
 * Computes git's object id for some bytes as a blob, in the hash the id uses.
 *
 * @param like - an object id of the repository: 40 hex digits for SHA-1, 64 for SHA-256.
 * @param bytes - the content.
 * @returns the blob's object id.
 */
function blobId(like: string, bytes: Uint8Array): string {
  return createHash(like.length === SHA256_OID_LENGTH ? "sha256" : "sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
}

/**
 * Decodes bytes as UTF-8, exactly.
 *
 * @param bytes - a file's content.
 * @returns the text, or undefined when the bytes aren't valid UTF-8 (such a
 *   copy could never hash back to the manifest).
 */
function decode(bytes: Uint8Array): string | undefined {
  try {
    return UTF8.decode(bytes);
  } catch {
    return undefined;
  }
}
