/**
 * @file The two things the daemon keeps between requests, both identified by
 * their content (ADR-039): what the engine extracted from a file's text, and
 * git's answers about a fixed commit (the session-start text of a file, the
 * tree listing). Neither can go stale: a text hash names one extraction, and
 * a full commit id names one blob. Both live in memory only, bounded by entry
 * count and bytes, least recently used first out; nothing touches the disk,
 * so the hooks still read no cache the agent can write (ADR-031). The config,
 * the baseline, the listing and the session are never kept.
 */
import { createHash } from "node:crypto";
import type { CachedExtraction, ExtractionCache, ExtractionIdentity } from "@inwards/core";
import type { Git } from "../platform/contracts.ts";

/** How many extractions the daemon keeps, as the language server does. */
const EXTRACTION_ENTRIES = 5000;
/** About how many bytes of extractions it keeps, measured as JSON. */
const EXTRACTION_BYTES = 33_554_432;
/**
 * How many texts of one module it keeps: the text at session start and the
 * edited one are both in use, and an edit or two back is often asked again.
 */
const TEXTS_PER_MODULE = 4;
/** How many git answers it keeps. */
const GIT_ENTRIES = 2000;
/** About how many bytes of git answers it keeps, in UTF-16 code units. */
const GIT_BYTES = 33_554_432;
/** `cat-file blob <object>`: three words. */
const CAT_FILE_WORDS = 3;
/** A full commit id: SHA-1 or SHA-256 hex. */
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

/** A bounded least-recently-used map whose entries have a size. */
interface Lru<V> {
  /**
   * Finds a value and marks it as just used.
   *
   * @param key - the value's key.
   * @returns the value, or undefined when it isn't kept.
   */
  get: (key: string) => V | undefined;
  /**
   * Keeps a value, then evicts the oldest entries over the bounds.
   *
   * @param key - the value's key.
   * @param value - what to keep.
   * @param bytes - what it costs against the byte budget.
   * @returns the keys evicted, the new one included when it was too big to keep.
   */
  set: (key: string, value: V, bytes: number) => string[];
  /**
   * Drops a value, if it is kept.
   *
   * @param key - the value's key.
   */
  delete: (key: string) => void;
}

/**
 * Builds an LRU map. A Map iterates in insertion order, so re-inserting on use
 * keeps the oldest entry first.
 *
 * @param limits - the most entries and about the most bytes kept.
 * @param limits.entries - the most entries.
 * @param limits.bytes - about the most bytes.
 * @returns the map.
 */
function lru<V>(limits: { entries: number; bytes: number }): Lru<V> {
  const entries = new Map<string, { value: V; bytes: number }>();
  let held = 0;
  /**
   * Drops one entry, if it is there.
   *
   * @param key - the entry's key.
   */
  function drop(key: string): void {
    const kept = entries.get(key);
    if (kept !== undefined) {
      entries.delete(key);
      held -= kept.bytes;
    }
  }
  return {
    get(key: string): V | undefined {
      const kept = entries.get(key);
      if (kept !== undefined) {
        entries.delete(key);
        entries.set(key, kept);
      }
      return kept?.value;
    },
    set(key: string, value: V, bytes: number): string[] {
      drop(key);
      if (bytes > limits.bytes) {
        return [key];
      }
      entries.set(key, { value, bytes });
      held += bytes;
      const evicted: string[] = [];
      for (const oldest of entries.keys()) {
        if (entries.size <= limits.entries && held <= limits.bytes) {
          break;
        }
        drop(oldest);
        evicted.push(oldest);
      }
      return evicted;
    },
    delete: drop,
  };
}

/**
 * Builds the daemon's in-memory extraction cache. Unlike the language
 * server's, it keeps several texts per module, since one PostToolUse checks
 * the file as edited and as it was at session start.
 *
 * @param limits - the bounds; the defaults match the language server's.
 * @param limits.entries - the most extractions kept.
 * @param limits.bytes - about the most bytes kept, as JSON.
 * @param limits.perModule - the most texts kept for one module.
 * @returns a cache for the daemon's lifetime.
 */
export function daemonExtractionCache(
  limits: { entries: number; bytes: number; perModule: number } = {
    entries: EXTRACTION_ENTRIES,
    bytes: EXTRACTION_BYTES,
    perModule: TEXTS_PER_MODULE,
  },
): ExtractionCache {
  const kept = lru<CachedExtraction>(limits);
  // Each module's keys, oldest first, so a module's old texts go before others'.
  const modules = new Map<string, string[]>();
  const owner = new Map<string, string>();
  /**
   * Forgets evicted keys in the per-module lists.
   *
   * @param keys - keys the LRU dropped.
   */
  function forget(keys: readonly string[]): void {
    for (const key of keys) {
      const slot = owner.get(key);
      owner.delete(key);
      const list = slot === undefined ? undefined : modules.get(slot);
      if (slot !== undefined && list !== undefined) {
        const left = list.filter((k) => k !== key);
        if (left.length === 0) {
          modules.delete(slot);
        } else {
          modules.set(slot, left);
        }
      }
    }
  }
  return {
    get(identity: ExtractionIdentity): CachedExtraction | undefined {
      return kept.get(extractionKey(identity));
    },
    set(identity: ExtractionIdentity, value: CachedExtraction): void {
      const key = extractionKey(identity);
      const slot = JSON.stringify([identity.module, identity.isPackage]);
      forget([key]);
      const list = [...(modules.get(slot) ?? []), key];
      while (list.length > limits.perModule) {
        const oldest = list.shift();
        if (oldest !== undefined) {
          kept.delete(oldest);
          owner.delete(oldest);
        }
      }
      modules.set(slot, list);
      owner.set(key, slot);
      forget(kept.set(key, value, JSON.stringify(value).length));
    },
  };
}

/**
 * Names an extraction's entry.
 *
 * @param identity - the text, the module and the extraction revision.
 * @returns the SHA-256 of all its fields, 64 hex digits.
 */
function extractionKey(identity: ExtractionIdentity): string {
  return createHash("sha256")
    .update(JSON.stringify([identity.revision, identity.module, identity.isPackage, identity.text]))
    .digest("hex");
}

/**
 * Wraps git so the answers that name a full commit id are kept: `cat-file
 * blob <commit>:<path>` and `ls-tree <commit>`, which is how the hooks read
 * a file as it was at session start. Anything else runs every time, and a
 * failure is never kept, so a blob fetched later is still found.
 *
 * @param git - the real git.
 * @param limits - the bounds.
 * @param limits.entries - the most answers kept.
 * @param limits.bytes - about the most bytes kept.
 * @returns git with the commit-keyed answers kept for the daemon's lifetime.
 */
export function commitKeyedGit(
  git: Git,
  limits: { entries: number; bytes: number } = { entries: GIT_ENTRIES, bytes: GIT_BYTES },
): Git {
  const kept = lru<string>(limits);
  return {
    run(dir: string, args: string[]): string | undefined {
      if (!namesCommit(args)) {
        return git.run(dir, args);
      }
      const key = JSON.stringify([dir, args]);
      const hit = kept.get(key);
      if (hit !== undefined) {
        return hit;
      }
      const out = git.run(dir, args);
      if (out !== undefined) {
        kept.set(key, out, out.length);
      }
      return out;
    },
  };
}

/**
 * Tells whether a git command's output is fixed by a full commit id in it.
 *
 * @param args - git arguments, as the session code passes them.
 * @returns true for `cat-file blob <commit>:<path>` and `ls-tree ... <commit>`.
 */
function namesCommit(args: readonly string[]): boolean {
  const words = args[0] === "--no-lazy-fetch" ? args.slice(1) : args;
  const last = words.at(-1) ?? "";
  if (words[0] === "cat-file" && words[1] === "blob" && words.length === CAT_FILE_WORDS) {
    return COMMIT.test(last.split(":", 1)[0] ?? "");
  }
  return words[0] === "ls-tree" && COMMIT.test(last);
}
