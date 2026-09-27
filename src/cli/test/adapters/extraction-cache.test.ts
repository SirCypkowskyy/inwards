/**
 * @file The extraction cache on disk (#56), read back. An entry comes back
 * only for the exact identity it was written for, and a corrupt, oversized,
 * reshaped or mismatched entry reads as a miss. A symlink, a file or a FIFO
 * where the cache expects a directory or an entry turns the cache off or
 * reads as a miss; pruning and failed writes are in `extraction-prune.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fileExtractionCache } from "../../src/adapters/extraction-cache.ts";
import { MAX_ENTRY_BYTES } from "../../src/adapters/extraction-store.ts";
import { entryFiles, id, SPAN, VALUE, WASM } from "../support/cache-helpers.ts";
import { tempDir } from "../support/temp.ts";

describe("reading back", () => {
  test("an entry comes back for its identity only", () => {
    const root = tempDir("inwards-cache-");
    const cache = fileExtractionCache(root, WASM);
    cache?.set(id("import shop.db\n"), VALUE);
    const again = fileExtractionCache(root, WASM);
    expect(again?.get(id("import shop.db\n"))).toEqual(VALUE);
    expect(again?.get(id("import shop.db\n", "shop.domain.other"))).toBeUndefined();
    expect(again?.get({ ...id("import shop.db\n"), isPackage: true })).toBeUndefined();
    expect(again?.get({ ...id("import shop.db\n"), revision: "2" })).toBeUndefined();
    expect(again?.get(id("import shop.db  \n"))).toBeUndefined();
  });

  test("other grammars get their own namespace", () => {
    const root = tempDir("inwards-cache-");
    fileExtractionCache(root, WASM)?.set(id("x = 1\n"), VALUE);
    const other = { ...WASM, python: new Uint8Array([7]) };
    expect(fileExtractionCache(root, other)?.get(id("x = 1\n"))).toBeUndefined();
    expect(readdirSync(join(root, ".inwards", "cache"))).toHaveLength(2);
  });

  test("a corrupt, reshaped, mismatched or oversized entry is a miss", () => {
    const root = tempDir("inwards-cache-");
    const cache = fileExtractionCache(root, WASM);
    cache?.set(id("x = 1\n"), VALUE);
    const [path = ""] = entryFiles(root);
    const entry = JSON.parse(readFileSync(path, "utf8"));
    const bad = [
      "{not json",
      JSON.stringify({ ...entry, value: { skeleton: "no" } }),
      JSON.stringify({ ...entry, value: { full: [{ target: "x" }] } }),
      JSON.stringify({ ...entry, value: { comments: [{ span: SPAN, codes: [1] }] } }),
      JSON.stringify({ ...entry, value: { skeleton: [{ ...SPAN, line: 0, target: "a" }] } }),
      JSON.stringify({ ...entry, textHash: createHash("sha256").update("y").digest("hex") }),
      JSON.stringify({ ...entry, module: "shop.other" }),
      JSON.stringify({ ...entry, format: "0" }),
      JSON.stringify({ ...entry, padding: "x".repeat(MAX_ENTRY_BYTES) }),
    ];
    for (const text of bad) {
      writeFileSync(path, text);
      expect(cache?.get(id("x = 1\n"))).toBeUndefined();
    }
  });

  test("an entry too big to keep is not written", () => {
    const root = tempDir("inwards-cache-");
    const cache = fileExtractionCache(root, WASM);
    const huge = "x".repeat(MAX_ENTRY_BYTES);
    cache?.set(id("x = 1\n"), {
      comments: [{ span: SPAN, codes: [], reason: huge, problems: [] }],
    });
    expect(cache?.get(id("x = 1\n"))).toBeUndefined();
    expect(entryFiles(root)).toEqual([]);
  });
});

describe("links and files where directories belong", () => {
  test.each([".inwards", ".inwards/cache"])("a symlinked %s turns the cache off", (link) => {
    const root = tempDir("inwards-cache-");
    const outside = tempDir("inwards-cache-outside-");
    mkdirSync(join(root, link, ".."), { recursive: true });
    symlinkSync(outside, join(root, link), "junction");
    expect(fileExtractionCache(root, WASM)).toBeUndefined();
    expect(readdirSync(outside)).toEqual([]);
  });

  test("a shard that became a link is neither read nor written by the next run", () => {
    const root = tempDir("inwards-cache-");
    const cache = fileExtractionCache(root, WASM);
    cache?.set(id("x = 1\n"), VALUE);
    const [path = ""] = entryFiles(root);
    const shard = join(path, "..");
    const outside = tempDir("inwards-cache-outside-");
    writeFileSync(join(outside, path.slice(shard.length + 1)), readFileSync(path));
    renameSync(shard, `${shard}-moved`);
    symlinkSync(outside, shard, "junction");
    const next = fileExtractionCache(root, WASM);
    expect(next?.get(id("x = 1\n"))).toBeUndefined();
    next?.set(id("x = 1\n"), VALUE);
    expect(readdirSync(outside)).toHaveLength(1);
  });

  test("a symlinked entry is a miss", () => {
    const root = tempDir("inwards-cache-");
    const cache = fileExtractionCache(root, WASM);
    cache?.set(id("x = 1\n"), VALUE);
    const [path = ""] = entryFiles(root);
    const planted = join(tempDir("inwards-cache-outside-"), "entry.json");
    writeFileSync(planted, readFileSync(path));
    rmSync(path);
    symlinkSync(planted, path, "file");
    expect(cache?.get(id("x = 1\n"))).toBeUndefined();
  });

  describe.skipIf(process.platform === "win32")("FIFOs", () => {
    test("a FIFO where an entry belongs is a miss, not a hang", () => {
      const root = tempDir("inwards-cache-");
      const cache = fileExtractionCache(root, WASM);
      cache?.set(id("x = 1\n"), VALUE);
      const [path = ""] = entryFiles(root);
      rmSync(path);
      expect(Bun.spawnSync(["mkfifo", path]).exitCode).toBe(0);
      expect(fileExtractionCache(root, WASM)?.get(id("x = 1\n"))).toBeUndefined();
    });
  });

  test("a file named .inwards turns the cache off", () => {
    const root = tempDir("inwards-cache-");
    writeFileSync(join(root, ".inwards"), "");
    expect(fileExtractionCache(root, WASM)).toBeUndefined();
  });
});
