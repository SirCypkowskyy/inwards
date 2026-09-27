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
  ImportRef,
  SuppressionComment,
} from "@inwards/core";

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

/** What an entry file holds: the identity it was written for, and the components. */
interface Entry {
  format: string;
  revision: string;
  module: string;
  isPackage: boolean;
  textHash: string;
  value: CachedExtraction;
}

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
  const pruned = new Set<string>();
  return {
    get: (identity: ExtractionIdentity): CachedExtraction | undefined =>
      readEntry(namespace, identity),
    set(identity: ExtractionIdentity, value: CachedExtraction): void {
      writeEntry(namespace, identity, value, pruned);
    },
  };
}

/**
 * Names an identity's entry.
 *
 * @param identity - the file and the extraction revision.
 * @returns 64 hex digits.
 */
function keyOf(identity: ExtractionIdentity): string {
  return sha256(
    JSON.stringify([identity.revision, identity.module, identity.isPackage, identity.text]),
  );
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
 * @param namespace - the cache's namespace directory.
 * @param identity - what is looked up.
 * @returns the entry's components, or undefined.
 */
function readEntry(namespace: string, identity: ExtractionIdentity): CachedExtraction | undefined {
  const key = keyOf(identity);
  const shard = join(namespace, key.slice(0, SHARD_LENGTH));
  const path = join(shard, `${key}.json`);
  try {
    if (!lstatSync(shard).isDirectory()) {
      return undefined; // a symlinked shard could serve entries from anywhere
    }
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > MAX_ENTRY_BYTES) {
      return undefined;
    }
    const entry: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isEntry(entry) && matches(entry, identity) ? entry.value : undefined;
  } catch {
    return undefined; // missing, unreadable or malformed: a miss
  }
}

/**
 * Writes an entry through a temporary file and a rename, and prunes its
 * shard once per run. Failures are ignored: the check goes on without it.
 *
 * @param namespace - the cache's namespace directory.
 * @param identity - what the entry is for.
 * @param value - the components to store.
 * @param pruned - shards already pruned in this run, updated in place.
 */
function writeEntry(
  namespace: string,
  identity: ExtractionIdentity,
  value: CachedExtraction,
  pruned: Set<string>,
): void {
  const key = keyOf(identity);
  const entry: Entry = {
    format: FORMAT,
    revision: identity.revision,
    module: identity.module,
    isPackage: identity.isPackage,
    textHash: sha256(identity.text),
    value,
  };
  const text = JSON.stringify(entry);
  if (Buffer.byteLength(text) > MAX_ENTRY_BYTES) {
    return; // too big to cache: the file is simply parsed each time
  }
  const shard = safeDirs(namespace, [key.slice(0, SHARD_LENGTH)]);
  if (shard === undefined) {
    return;
  }
  const temp = join(
    shard,
    `.${key}.${process.pid}.${randomBytes(TEMP_NONCE_BYTES).toString("hex")}.tmp`,
  );
  try {
    writeFileSync(temp, text, { flag: "wx" });
    renameSync(temp, join(shard, `${key}.json`));
  } catch {
    rmSync(temp, { force: true }); // a failed write leaves nothing behind
  }
  if (!pruned.has(shard)) {
    pruned.add(shard);
    prune(shard);
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
 *
 * @param base - an existing directory to start from.
 * @param parts - the directories below it, outermost first.
 * @returns the innermost directory, or undefined when the chain can't be used.
 */
function safeDirs(base: string, parts: readonly string[]): string | undefined {
  let dir = base;
  for (const part of parts) {
    dir = join(dir, part);
    try {
      mkdirSync(dir, { mode: 0o700 });
    } catch {
      // already there, or can't be made: the check below decides
    }
    try {
      if (!lstatSync(dir).isDirectory()) {
        return undefined; // a symlink or a file where a directory should be
      }
    } catch {
      return undefined;
    }
  }
  return dir;
}

/**
 * Tells whether an entry was written for exactly this identity.
 *
 * @param entry - a well-formed entry.
 * @param identity - what was looked up.
 * @returns true when every field matches, the text by its hash.
 */
function matches(entry: Entry, identity: ExtractionIdentity): boolean {
  return (
    entry.format === FORMAT &&
    entry.revision === identity.revision &&
    entry.module === identity.module &&
    entry.isPackage === identity.isPackage &&
    entry.textHash === sha256(identity.text)
  );
}

/**
 * Tells whether a parsed file is a well-formed entry.
 *
 * @param value - the parsed JSON.
 * @returns true for an entry whose components have the right shapes.
 */
function isEntry(value: unknown): value is Entry {
  return (
    isRecord(value) &&
    typeof value["format"] === "string" &&
    typeof value["revision"] === "string" &&
    typeof value["module"] === "string" &&
    typeof value["isPackage"] === "boolean" &&
    typeof value["textHash"] === "string" &&
    isExtraction(value["value"])
  );
}

/**
 * Tells whether a parsed value holds well-formed components.
 *
 * @param value - the entry's `value`.
 * @returns true when every present component has its shape.
 */
function isExtraction(value: unknown): value is CachedExtraction {
  if (!isRecord(value)) {
    return false;
  }
  const { skeleton, full, comments } = value;
  return (
    (skeleton === undefined || skeleton === "refused" || isImportList(skeleton)) &&
    (full === undefined || isImportList(full)) &&
    (comments === undefined || (Array.isArray(comments) && comments.every(isComment)))
  );
}

/**
 * Tells whether a value is a list of import references.
 *
 * @param value - any parsed value.
 * @returns true for an array of well-formed references.
 */
function isImportList(value: unknown): value is ImportRef[] {
  return Array.isArray(value) && value.every(isImportRef);
}

/**
 * Tells whether a value is an import reference.
 *
 * @param value - any parsed value.
 * @returns true for a span with a target, a statement and an optional `from`.
 */
function isImportRef(value: unknown): value is ImportRef {
  return (
    isSpan(value) &&
    typeof value["target"] === "string" &&
    typeof value["statement"] === "string" &&
    (value["from"] === undefined || typeof value["from"] === "string")
  );
}

/**
 * Tells whether a value is a suppression comment.
 *
 * @param value - any parsed value.
 * @returns true for a span-bearing comment with codes, a reason and problems.
 */
function isComment(value: unknown): value is SuppressionComment {
  return (
    isRecord(value) &&
    isSpan(value["span"]) &&
    isStringList(value["codes"]) &&
    typeof value["reason"] === "string" &&
    isStringList(value["problems"])
  );
}

/**
 * Tells whether a value carries a 1-based span of whole numbers.
 *
 * @param value - any parsed value.
 * @returns true when line, column, endLine and endColumn are positive integers.
 */
function isSpan(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    ["line", "column", "endLine", "endColumn"].every(
      (key) => Number.isInteger(value[key]) && Number(value[key]) >= 1,
    )
  );
}

/**
 * Tells whether a value is a list of strings.
 *
 * @param value - any parsed value.
 * @returns true for an array of strings.
 */
function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Tells whether a parsed value is a JSON object.
 *
 * @param value - any parsed JSON value.
 * @returns true for a non-null, non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
