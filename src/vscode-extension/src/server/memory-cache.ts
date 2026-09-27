/**
 * @file The language server's extraction cache (#56): what the engine read
 * out of a file's text, kept in memory for the server's lifetime so a
 * workspace refresh or a config reload doesn't parse unchanged files again.
 * It never touches the disk. Entries are keyed by a SHA-256 of the whole
 * identity. Only the latest text of each module is kept, so typing in a file
 * doesn't pile up versions, and both the entry count and the bytes held are
 * bounded: the least recently used entries go first.
 */
import { createHash } from "node:crypto";
import type { CachedExtraction, ExtractionCache, ExtractionIdentity } from "@inwards/core";

/** How many files' extractions the server keeps. */
const MEMORY_CACHE_ENTRIES = 5000;
/** About how many bytes of extractions the server keeps, measured as JSON. */
const MEMORY_CACHE_BYTES = 33_554_432;

/** One kept extraction, with what it costs and which module it belongs to. */
interface Kept {
  value: CachedExtraction;
  bytes: number;
  slot: string;
}

/**
 * Builds an in-memory cache with an entry limit and a byte budget.
 *
 * @param limits - the most entries and about the most bytes kept.
 * @param limits.entries - the most entries.
 * @param limits.bytes - about the most bytes, as the values' JSON length.
 * @returns a cache that lives as long as the server, never touching the disk.
 */
export function memoryCache(
  limits: { entries: number; bytes: number } = {
    entries: MEMORY_CACHE_ENTRIES,
    bytes: MEMORY_CACHE_BYTES,
  },
): ExtractionCache {
  // A Map iterates in insertion order, so re-inserting on use keeps it LRU.
  const entries = new Map<string, Kept>();
  // The key each module's latest text is kept under.
  const slots = new Map<string, string>();
  let held = 0;

  /**
   * Drops an entry, and its module's slot when the slot points at it.
   *
   * @param key - the entry's key.
   */
  function drop(key: string): void {
    const kept = entries.get(key);
    if (kept === undefined) {
      return;
    }
    entries.delete(key);
    held -= kept.bytes;
    if (slots.get(kept.slot) === key) {
      slots.delete(kept.slot);
    }
  }

  return {
    get(identity: ExtractionIdentity): CachedExtraction | undefined {
      const key = keyOf(identity);
      const kept = entries.get(key);
      if (kept !== undefined) {
        entries.delete(key);
        entries.set(key, kept);
      }
      return kept?.value;
    },
    set(identity: ExtractionIdentity, value: CachedExtraction): void {
      const key = keyOf(identity);
      const bytes = JSON.stringify(value).length;
      const slot = JSON.stringify([identity.module, identity.isPackage]);
      drop(key);
      const previous = slots.get(slot);
      if (previous !== undefined) {
        drop(previous); // the module's older text: it won't be asked for again
      }
      if (bytes > limits.bytes) {
        return; // bigger than the whole budget: parse it each time
      }
      entries.set(key, { value, bytes, slot });
      slots.set(slot, key);
      held += bytes;
      for (const oldest of entries.keys()) {
        if (entries.size <= limits.entries && held <= limits.bytes) {
          break;
        }
        drop(oldest);
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
