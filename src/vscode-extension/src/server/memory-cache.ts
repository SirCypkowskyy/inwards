/**
 * @file The language server's extraction cache (#56): what the engine read
 * out of a file's text, kept in memory for the server's lifetime so a
 * workspace refresh or a config reload doesn't parse unchanged files again.
 * It never touches the disk. Entries are keyed by a SHA-256 of the whole
 * identity and bounded: the least recently used go first.
 */
import { createHash } from "node:crypto";
import type { CachedExtraction, ExtractionCache, ExtractionIdentity } from "@inwards/core";

/** How many files' extractions the server keeps. */
const MEMORY_CACHE_ENTRIES = 5000;

/**
 * Builds an in-memory cache holding at most `limit` entries.
 *
 * @param limit - the most entries kept; the least recently used are dropped.
 * @returns a cache that lives as long as the server, never touching the disk.
 */
export function memoryCache(limit: number = MEMORY_CACHE_ENTRIES): ExtractionCache {
  // A Map iterates in insertion order, so re-inserting on use keeps it LRU.
  const entries = new Map<string, CachedExtraction>();
  return {
    get(identity: ExtractionIdentity): CachedExtraction | undefined {
      const key = keyOf(identity);
      const value = entries.get(key);
      if (value !== undefined) {
        entries.delete(key);
        entries.set(key, value);
      }
      return value;
    },
    set(identity: ExtractionIdentity, value: CachedExtraction): void {
      const key = keyOf(identity);
      entries.delete(key);
      entries.set(key, value);
      for (const oldest of entries.keys()) {
        if (entries.size <= limit) {
          break;
        }
        entries.delete(oldest);
      }
    },
  };
}

/**
 * Names an identity's entry.
 *
 * @param identity - the file and the extraction revision.
 * @returns the SHA-256 of all its fields, 64 hex digits.
 */
function keyOf(identity: ExtractionIdentity): string {
  return createHash("sha256")
    .update(JSON.stringify([identity.revision, identity.module, identity.isPackage, identity.text]))
    .digest("hex");
}
