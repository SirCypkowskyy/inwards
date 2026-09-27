/**
 * @file The extraction cache's pruning and failed writes (#56). Pruning drops
 * stale temporary files this cache named and entries past their age, and
 * keeps a shard under its byte limit even when one run writes a lot to it.
 * It never writes or deletes through a shard that became a link during the run. A
 * write that fails leaves no temporary file and never throws into the check.
 */
import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fileExtractionCache } from "../../src/adapters/extraction-cache.ts";
import { MAX_AGE_MS, MAX_SHARD_BYTES } from "../../src/adapters/extraction-store.ts";
import {
  entryFiles,
  id,
  keyOf,
  shardOf,
  sized,
  textsInShard,
  VALUE,
  WASM,
} from "../support/cache-helpers.ts";
import { tempDir } from "../support/temp.ts";

/** A second-based timestamp from before the entry age limit. */
const PAST: number = (Date.now() - MAX_AGE_MS - 60_000) / 1000;

/**
 * A temporary file name in the cache's own format.
 *
 * @param key - the entry's key.
 * @returns `.<key>.<nonce>.<n>.tmp`.
 */
function tempName(key: string): string {
  return `.${key}.0123456789ab.1.tmp`;
}

describe("pruning", () => {
  test("stale temporary files and entries past their age go; the rest stay", () => {
    const root = tempDir("inwards-cache-");
    fileExtractionCache(root, WASM)?.set(id("old = 1\n"), VALUE);
    const [old = ""] = entryFiles(root);
    const shard = join(old, "..");
    utimesSync(old, PAST, PAST);
    const staleTemp = join(shard, tempName(keyOf(id("a"))));
    const freshTemp = join(shard, tempName(keyOf(id("b"))));
    const foreign = join(shard, "notes.tmp");
    for (const path of [staleTemp, freshTemp, foreign]) {
      writeFileSync(path, "");
    }
    utimesSync(staleTemp, PAST, PAST);
    utimesSync(foreign, PAST, PAST);
    // A new run prunes a shard the first time it writes there.
    const run = fileExtractionCache(root, WASM);
    const [text = ""] = textsInShard(shardOf(old), 1);
    run?.set(id(text), VALUE);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(staleTemp)).toBe(false);
    expect(existsSync(freshTemp)).toBe(true);
    expect(existsSync(foreign)).toBe(true); // not a name this cache writes
    expect(run?.get(id(text))).toEqual(VALUE);
  });

  test("one run writing a lot to a shard keeps it under the byte limit", () => {
    const root = tempDir("inwards-cache-");
    const run = fileExtractionCache(root, WASM);
    const big = sized(MAX_SHARD_BYTES / 5);
    const texts = textsInShard("7f", 12);
    for (const text of texts) {
      run?.set(id(text), big);
    }
    const files = entryFiles(root);
    const total = files.reduce((sum, p) => sum + readFileSync(p).length, 0);
    expect(total).toBeLessThanOrEqual(MAX_SHARD_BYTES);
    expect(files.length).toBeGreaterThan(0);
  });

  test("a shard that became a link mid-run is neither written nor pruned through", () => {
    const root = tempDir("inwards-cache-");
    const run = fileExtractionCache(root, WASM);
    const [first = "", ...rest] = textsInShard("3c", 8);
    run?.set(id(first), VALUE);
    const [entry = ""] = entryFiles(root);
    const shard = join(entry, "..");
    const outside = tempDir("inwards-cache-outside-");
    const planted = [
      join(outside, `${keyOf(id("planted"))}.json`),
      join(outside, tempName(keyOf(id("planted")))),
    ];
    for (const path of planted) {
      writeFileSync(path, "{}");
      utimesSync(path, PAST, PAST);
    }
    renameSync(shard, `${shard}-moved`);
    symlinkSync(outside, shard, "junction");
    const big = sized(MAX_SHARD_BYTES / 3);
    for (const text of rest) {
      run?.set(id(text), big); // past the limit: the run would prune now
    }
    for (const path of planted) {
      expect(existsSync(path)).toBe(true);
    }
    expect(readdirSync(outside)).toHaveLength(planted.length); // nothing published there
  });
});

describe("failed writes", () => {
  test("a directory where the entry belongs: no throw, no temporary file left", () => {
    const root = tempDir("inwards-cache-");
    const run = fileExtractionCache(root, WASM);
    run?.set(id("x = 1\n"), VALUE);
    const [entry = ""] = entryFiles(root);
    const [text = ""] = textsInShard(shardOf(entry), 1, "y");
    mkdirSync(join(entry, "..", `${keyOf(id(text))}.json`));
    expect(() => run?.set(id(text), VALUE)).not.toThrow();
    expect(entryFiles(root).filter((p) => p.endsWith(".tmp"))).toEqual([]);
    expect(run?.get(id(text))).toBeUndefined();
  });

  // Permissions don't bind root, and Windows has no POSIX modes.
  describe.skipIf(process.platform === "win32" || process.getuid?.() === 0)("permissions", () => {
    test("a shard that can't be written: no throw, and the check goes on", () => {
      const root = tempDir("inwards-cache-");
      const run = fileExtractionCache(root, WASM);
      run?.set(id("x = 1\n"), VALUE);
      const [entry = ""] = entryFiles(root);
      const shard = join(entry, "..");
      chmodSync(shard, 0o500);
      try {
        const [text = ""] = textsInShard(shardOf(entry), 1, "z");
        expect(() => run?.set(id(text), VALUE)).not.toThrow();
        expect(run?.get(id("x = 1\n"))).toEqual(VALUE);
      } finally {
        chmodSync(shard, 0o700);
      }
    });
  });
});
