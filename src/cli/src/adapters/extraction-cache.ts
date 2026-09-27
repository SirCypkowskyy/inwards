/**
 * @file The engine's extraction cache on disk, for `inwards check` and
 * `inwards baseline` (#56): what a file's text yields (the import skeleton,
 * the full parse's static imports, the suppression comments) under
 * `.inwards/cache/`, keyed by a SHA-256 of everything the extraction depends
 * on. It is local acceleration, never trusted for enforcement: the Claude Code
 * hooks never get one (see `adapters/compose.ts`).
 *
 * Reads treat anything odd as a miss: a symlink at any level, a non-regular or
 * oversized file, malformed JSON, a mismatched identity or shape. Writes go
 * through a uniquely named temporary file and a rename, so concurrent runs
 * never see half an entry; two runs may overwrite each other's additions,
 * which only costs a recomputation. Every failure falls back to no cache.
 */
import { createHash, randomBytes } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import process from "node:process";
import type {
  CachedExtraction,
  ExtractionCache,
  ExtractionIdentity,
  GrammarBinaries,
} from "@inwards/core";
import { type Entry, isEntry } from "./extraction-entry.ts";

/** The on-disk format; bump it when the entry layout changes. */
const FORMAT = "1";
/** An entry bigger than this is neither written nor read. */
export const MAX_ENTRY_BYTES = 262_144;
/** A shard (one of 256 directories) is pruned to this many bytes, oldest entries first. */
export const MAX_SHARD_BYTES = 524_288;
/** Entries older than this are pruned, whether used or not. */
export const MAX_AGE_MS = 2_592_000_000;
/** A temporary file older than this belongs to no live writer. */
const STALE_TEMP_MS = 3_600_000;
/** An entry's file name: its key, 64 lowercase hex digits, and `.json`. */
const ENTRY_NAME = /^[0-9a-f]{64}\.json$/u;
/** Random bytes in a temporary file's name, on top of the process id. */
const TEMP_NONCE_BYTES = 8;
/** Characters of a key that name its shard directory. */
const SHARD_LENGTH = 2;
/** Characters of the grammar hash in the namespace's name. */
const GRAMMAR_ID_LENGTH = 16;

/**
 * Opens the cache for a project, or nothing when its directories can't be
 * used safely (a symlink or a file where a directory should be).
 *
 * @param project - the real project root, where `.inwards` lives.
 * @param wasm - the grammars the engine loads, whose hash names the namespace.
 * @returns the cache, or undefined when it can't be used.
 */
export function fileExtractionCache(
  project: string,
  wasm: GrammarBinaries,
): ExtractionCache | undefined {
  const grammar = createHash("sha256").update(wasm.runtime).update(wasm.python).digest("hex");
  const namespace = safeDirs(project, [
    ".inwards",
    "cache",
    `extraction-${FORMAT}-${grammar.slice(0, GRAMMAR_ID_LENGTH)}`,
  ]);
  if (namespace === undefined) {
    return undefined;
  }
  const run: Run = { namespace, shards: new Map(), pruned: new Set() };
  return {
    get: (identity: ExtractionIdentity): CachedExtraction | undefined => readEntry(run, identity),
    set(identity: ExtractionIdentity, value: CachedExtraction): void {
      writeEntry(run, identity, value);
    },
  };
}

/** What one run of the cache remembers about its directories. */
interface Run {
  /** The cache's namespace directory, checked when the cache was opened. */
  namespace: string;
  /** Shards already looked at in this run: true for a real directory, false for anything else. */
  shards: Map<string, boolean>;
  /** Shards already pruned in this run. */
  pruned: Set<string>;
}

/** Where an identity's entry lives, and the text hash it must record. */
interface Located {
  key: string;
  textHash: string;
  shard: string;
  path: string;
}

/**
 * Names an identity's entry: a SHA-256 over the revision, module, package flag
 * and the text's own SHA-256, so the text is hashed once per lookup.
 *
 * @param namespace - the cache's namespace directory.
 * @param identity - the file and the extraction revision.
 * @returns the key, the text hash, the shard and the entry's path.
 */
function locate(namespace: string, identity: ExtractionIdentity): Located {
  const textHash = sha256(identity.text);
  const key = sha256(
    JSON.stringify([identity.revision, identity.module, identity.isPackage, textHash]),
  );
  const shard = join(namespace, key.slice(0, SHARD_LENGTH));
  return { key, textHash, shard, path: join(shard, `${key}.json`) };
}

/**
 * Tells whether a shard is a real directory, looking once per run. With
 * `create`, a missing shard is made first.
 *
 * @param run - this run's memory of its directories.
 * @param shard - the shard directory.
 * @param create - true to create the shard when it is missing.
 * @returns true when the shard can be read or written.
 */
function shardReady(run: Run, shard: string, create: boolean): boolean {
  const known = run.shards.get(shard);
  if (known !== undefined) {
    return known;
  }
  if (create) {
    const ok = safeDirs(run.namespace, [shard.slice(run.namespace.length + 1)]) !== undefined;
    run.shards.set(shard, ok);
    return ok;
  }
  try {
    const ok = lstatSync(shard).isDirectory(); // a symlinked shard could serve entries from anywhere
    run.shards.set(shard, ok);
    return ok;
  } catch {
    return false; // missing for now: a later write may create it
  }
}

/**
 * Hashes text.
 *
 * @param text - any text.
 * @returns its SHA-256, 64 hex digits.
 */
function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Reads an entry, treating anything unexpected as a miss.
 *
 * @param run - this run's memory of its directories.
 * @param identity - what is looked up.
 * @returns the entry's components, or undefined.
 */
function readEntry(run: Run, identity: ExtractionIdentity): CachedExtraction | undefined {
  const at = locate(run.namespace, identity);
  if (!shardReady(run, at.shard, false)) {
    return undefined;
  }
  try {
    const stat = lstatSync(at.path);
    if (!stat.isFile() || stat.size > MAX_ENTRY_BYTES) {
      return undefined;
    }
    const entry: unknown = JSON.parse(readFileSync(at.path, "utf8"));
    return isEntry(entry) && matches(entry, identity, at.textHash) ? entry.value : undefined;
  } catch {
    return undefined; // missing, unreadable or malformed: a miss
  }
}

/**
 * Writes an entry through a temporary file and a rename, and prunes its
 * shard once per run. Failures are ignored: the check goes on without it.
 *
 * @param run - this run's memory of its directories.
 * @param identity - what the entry is for.
 * @param value - the components to store.
 */
function writeEntry(run: Run, identity: ExtractionIdentity, value: CachedExtraction): void {
  const at = locate(run.namespace, identity);
  const entry: Entry = {
    format: FORMAT,
    revision: identity.revision,
    module: identity.module,
    isPackage: identity.isPackage,
    textHash: at.textHash,
    value,
  };
  const text = JSON.stringify(entry);
  if (Buffer.byteLength(text) > MAX_ENTRY_BYTES || !shardReady(run, at.shard, true)) {
    return; // too big to cache, or nowhere safe to put it: the file is simply parsed each time
  }
  const temp = join(
    at.shard,
    `.${at.key}.${process.pid}.${randomBytes(TEMP_NONCE_BYTES).toString("hex")}.tmp`,
  );
  try {
    writeFileSync(temp, text, { flag: "wx" });
    renameSync(temp, at.path);
  } catch {
    rmSync(temp, { force: true }); // a failed write leaves nothing behind
  }
  if (!run.pruned.has(at.shard)) {
    run.pruned.add(at.shard);
    prune(at.shard);
  }
}

/**
 * Keeps a shard small: stale temporary files and old entries go, then the
 * oldest entries until the shard is under its byte limit. Only regular files
 * with the expected names are touched, and every failure is ignored.
 *
 * @param shard - one shard directory.
 */
function prune(shard: string): void {
  try {
    const now = Date.now();
    const entries: { path: string; size: number; mtime: number }[] = [];
    for (const name of readdirSync(shard)) {
      const path = join(shard, name);
      const stat = lstatSync(path);
      if (!stat.isFile()) {
        continue;
      }
      if (name.endsWith(".tmp")) {
        if (now - stat.mtimeMs > STALE_TEMP_MS) {
          rmSync(path, { force: true });
        }
      } else if (ENTRY_NAME.test(name)) {
        entries.push({ path, size: stat.size, mtime: stat.mtimeMs });
      }
    }
    entries.sort((a, b) => a.mtime - b.mtime);
    let total = entries.reduce((sum, e) => sum + e.size, 0);
    for (const e of entries) {
      if (now - e.mtime <= MAX_AGE_MS && total <= MAX_SHARD_BYTES) {
        break;
      }
      rmSync(e.path, { force: true });
      total -= e.size;
    }
  } catch {
    // pruning is best effort
  }
}

/**
 * Makes sure each directory of a chain is a real directory, creating the
 * missing ones, and refuses the chain when any level is a symlink or a file.
 * An existing directory is only looked at, never created again.
 *
 * @param base - an existing directory to start from.
 * @param parts - the directories below it, outermost first.
 * @returns the innermost directory, or undefined when the chain can't be used.
 */
function safeDirs(base: string, parts: readonly string[]): string | undefined {
  let dir = base;
  for (const part of parts) {
    dir = join(dir, part);
    if (!realDirectory(dir)) {
      return undefined;
    }
  }
  return dir;
}

/**
 * Makes a directory unless something is there, then tells whether what is
 * there is a real directory (not a symlink, not a file).
 *
 * @param dir - a path inside the cache, one level below a checked directory.
 * @returns true for a real directory.
 */
function realDirectory(dir: string): boolean {
  try {
    return lstatSync(dir).isDirectory();
  } catch {
    // nothing there yet: make it below
  }
  try {
    mkdirSync(dir, { mode: 0o700 });
  } catch {
    // made by a concurrent run, or can't be made: the check below decides
  }
  try {
    return lstatSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Tells whether an entry was written for exactly this identity.
 *
 * @param entry - a well-formed entry.
 * @param identity - what was looked up.
 * @param textHash - the SHA-256 of the identity's text.
 * @returns true when every field matches, the text by its hash.
 */
function matches(entry: Entry, identity: ExtractionIdentity, textHash: string): boolean {
  return (
    entry.format === FORMAT &&
    entry.revision === identity.revision &&
    entry.module === identity.module &&
    entry.isPackage === identity.isPackage &&
    entry.textHash === textHash
  );
}
