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
 * The filesystem side, and what it guards against, is `extraction-store.ts`.
 */
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import type {
  CachedExtraction,
  ExtractionCache,
  ExtractionIdentity,
  GrammarBinaries,
} from "@inwards/core";
import { type Entry, isEntry } from "./extraction-entry.ts";
import {
  chainIntact,
  isRealDirectory,
  MAX_ENTRY_BYTES,
  MAX_SHARD_BYTES,
  prune,
  publish,
  readBounded,
  safeDirs,
} from "./extraction-store.ts";

/** The on-disk format; bump it when the entry layout changes. */
const FORMAT = "1";
/** Characters of a key that name its shard directory. */
const SHARD_LENGTH = 2;
/** Characters of the grammar hash in the namespace's name. */
const GRAMMAR_ID_LENGTH = 16;
/** Random bytes that tell this run's temporary files from any other's. */
const NONCE_BYTES = 6;

/** What one run of the cache keeps between calls. */
interface Run {
  /** The project directory, where the chain of cache directories starts. */
  project: string;
  /** The directories from the project to the namespace, outermost first. */
  chain: string[];
  /** The namespace directory. */
  namespace: string;
  /** Names this run's temporary files. */
  nonce: string;
  /** Temporary files made so far. */
  temps: number;
  /** Shards already looked at: true for a real directory, false for anything else. */
  shards: Map<string, boolean>;
  /** Bytes of entries in each shard written to, as of its last prune plus this run's writes. */
  sizes: Map<string, number>;
  /** The last text hashed, so a lookup and the store that follows hash it once. */
  lastText: string | undefined;
  lastHash: string;
}

/** Where an identity's entry lives, and the text hash it must record. */
interface Located {
  key: string;
  textHash: string;
  shard: string;
  path: string;
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
  const chain = [
    ".inwards",
    "cache",
    `extraction-${FORMAT}-${grammar.slice(0, GRAMMAR_ID_LENGTH)}`,
  ];
  const namespace = safeDirs(project, chain);
  if (namespace === undefined) {
    return undefined;
  }
  const run: Run = {
    project,
    chain,
    namespace,
    nonce: randomBytes(NONCE_BYTES).toString("hex"),
    temps: 0,
    shards: new Map(),
    sizes: new Map(),
    lastText: undefined,
    lastHash: "",
  };
  return {
    get: (identity: ExtractionIdentity): CachedExtraction | undefined => readEntry(run, identity),
    set(identity: ExtractionIdentity, value: CachedExtraction): void {
      writeEntry(run, identity, value);
    },
  };
}

/**
 * Names an identity's entry: a SHA-256 over the revision, module, package flag
 * and the text's own SHA-256.
 *
 * @param run - this run, which remembers the last text it hashed.
 * @param identity - the file and the extraction revision.
 * @returns the key, the text hash, the shard and the entry's path.
 */
function locate(run: Run, identity: ExtractionIdentity): Located {
  if (run.lastText !== identity.text) {
    run.lastText = identity.text;
    run.lastHash = sha256(identity.text);
  }
  const textHash = run.lastHash;
  const key = sha256(
    JSON.stringify([identity.revision, identity.module, identity.isPackage, textHash]),
  );
  const shard = join(run.namespace, key.slice(0, SHARD_LENGTH));
  return { key, textHash, shard, path: join(shard, `${key}.json`) };
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
  if (!(create || isRealDirectory(shard))) {
    return false; // missing for now, or not a directory: a miss either way
  }
  const ok = safeDirs(run.namespace, [shard.slice(run.namespace.length + 1)]) !== undefined;
  run.shards.set(shard, ok);
  return ok;
}

/**
 * Reads an entry, treating anything unexpected as a miss.
 *
 * @param run - this run's memory of its directories.
 * @param identity - what is looked up.
 * @returns the entry's components, or undefined.
 */
function readEntry(run: Run, identity: ExtractionIdentity): CachedExtraction | undefined {
  const at = locate(run, identity);
  if (!shardReady(run, at.shard, false)) {
    return undefined;
  }
  const text = readBounded(at.path);
  try {
    const entry: unknown = text === undefined ? undefined : JSON.parse(text);
    return isEntry(entry) && matches(entry, identity, at.textHash) ? entry.value : undefined;
  } catch {
    return undefined; // malformed: a miss
  }
}

/**
 * Writes an entry through a temporary file and a rename. A shard is pruned
 * the first time a run writes to it and again whenever this run's writes
 * take it past its byte limit. Failures are ignored: the check goes on.
 *
 * @param run - this run's memory of its directories.
 * @param identity - what the entry is for.
 * @param value - the components to store.
 */
function writeEntry(run: Run, identity: ExtractionIdentity, value: CachedExtraction): void {
  const at = locate(run, identity);
  const entry: Entry = {
    format: FORMAT,
    revision: identity.revision,
    module: identity.module,
    isPackage: identity.isPackage,
    textHash: at.textHash,
    value,
  };
  const text = JSON.stringify(entry);
  const bytes = Buffer.byteLength(text);
  if (bytes > MAX_ENTRY_BYTES || !shardReady(run, at.shard, true)) {
    return; // too big to cache, or nowhere safe to put it: the file is simply parsed each time
  }
  run.temps += 1;
  const temp = join(at.shard, `.${at.key}.${run.nonce}.${run.temps}.tmp`);
  if (!publish(temp, at.path, text)) {
    return;
  }
  const size = run.sizes.get(at.shard);
  if (size === undefined || size + bytes > MAX_SHARD_BYTES) {
    run.sizes.set(at.shard, pruneChecked(run, at.shard));
  } else {
    run.sizes.set(at.shard, size + bytes);
  }
}

/**
 * Prunes a shard after checking again that no directory from the project
 * down to it has become a link since the run looked.
 *
 * @param run - this run's memory of its directories.
 * @param shard - the shard directory.
 * @returns the bytes of entries left, or `MAX_SHARD_BYTES` when the chain
 *   changed, and then the run writes to the shard no more.
 */
function pruneChecked(run: Run, shard: string): number {
  const parts = [...run.chain, shard.slice(run.namespace.length + 1)];
  if (chainIntact(run.project, parts)) {
    return prune(shard, Date.now());
  }
  run.shards.set(shard, false);
  return MAX_SHARD_BYTES;
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
