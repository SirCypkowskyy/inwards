/**
 * @file The extraction cache on disk (#56). An entry comes back only for the
 * exact identity it was written for, and a corrupt, oversized, reshaped or
 * mismatched entry reads as a miss. A symlink at any level turns the cache
 * off instead of reading or writing through it. Pruning drops stale
 * temporary files, entries past their age and a shard's oldest entries once
 * it grows past its byte limit.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { CachedExtraction, ExtractionIdentity } from "@inwards/core";
import {
  fileExtractionCache,
  MAX_AGE_MS,
  MAX_ENTRY_BYTES,
  MAX_SHARD_BYTES,
} from "../../src/adapters/extraction-cache.ts";
import { tempDir } from "../support/temp.ts";

const WASM = { runtime: new Uint8Array([1, 2, 3]), python: new Uint8Array([4, 5, 6]) };
const SPAN = { line: 1, column: 1, endLine: 1, endColumn: 10 };
const VALUE: CachedExtraction = {
  skeleton: [{ ...SPAN, target: "shop.db", statement: "import shop.db" }],
  comments: [{ span: SPAN, codes: ["INW001"], reason: "legacy", problems: [] }],
};

/**
 * An identity for a file's text.
 *
 * @param text - the file's text.
 * @param module - its module name.
 * @returns the identity at revision 1, not a package.
 */
function id(text: string, module = "shop.domain.order"): ExtractionIdentity {
  return { revision: "1", text, module, isPackage: false };
}

/**
 * Lists every entry file under a project's cache.
 *
 * @param root - the project directory.
 * @returns the entry files' absolute paths.
 */
function entryFiles(root: string): string[] {
  const base = join(root, ".inwards", "cache");
  const files: string[] = [];
  for (const ns of readdirSync(base)) {
    for (const shard of readdirSync(join(base, ns))) {
      for (const name of readdirSync(join(base, ns, shard))) {
        files.push(join(base, ns, shard, name));
      }
    }
  }
  return files;
}

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

  test("a symlinked shard is neither written nor read through", () => {
    const root = tempDir("inwards-cache-");
    const cache = fileExtractionCache(root, WASM);
    cache?.set(id("x = 1\n"), VALUE);
    const [path = ""] = entryFiles(root);
    const shard = join(path, "..");
    const outside = tempDir("inwards-cache-outside-");
    writeFileSync(join(outside, path.slice(shard.length + 1)), readFileSync(path));
    const moved = `${shard}-moved`;
    renameSync(shard, moved);
    symlinkSync(outside, shard, "junction");
    expect(cache?.get(id("x = 1\n"))).toBeUndefined();
    cache?.set(id("x = 1\n"), VALUE);
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

  test("a file named .inwards turns the cache off", () => {
    const root = tempDir("inwards-cache-");
    writeFileSync(join(root, ".inwards"), "");
    expect(fileExtractionCache(root, WASM)).toBeUndefined();
  });
});

describe("pruning", () => {
  test("stale temporary files and entries past their age go; fresh ones stay", () => {
    const root = tempDir("inwards-cache-");
    const writer = fileExtractionCache(root, WASM);
    writer?.set(id("old = 1\n"), VALUE);
    const [old = ""] = entryFiles(root);
    const shard = join(old, "..");
    const past = (Date.now() - MAX_AGE_MS - 60_000) / 1000;
    utimesSync(old, past, past);
    const staleTemp = join(shard, ".abc.1.00.tmp");
    const freshTemp = join(shard, ".abc.2.00.tmp");
    writeFileSync(staleTemp, "");
    writeFileSync(freshTemp, "");
    utimesSync(staleTemp, past, past);
    // A new run prunes a shard the first time it writes there.
    const run = fileExtractionCache(root, WASM);
    const text = sameShardText(old);
    run?.set(id(text), VALUE);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(staleTemp)).toBe(false);
    expect(existsSync(freshTemp)).toBe(true);
    expect(run?.get(id(text))).toEqual(VALUE);
  });

  test("a shard past its byte limit loses its oldest entries", () => {
    const root = tempDir("inwards-cache-");
    const reason = "r".repeat(MAX_SHARD_BYTES / 8);
    const big: CachedExtraction = { comments: [{ span: SPAN, codes: [], reason, problems: [] }] };
    const first = fileExtractionCache(root, WASM);
    first?.set(id("a = 0\n"), big);
    const [seed = ""] = entryFiles(root);
    const oldest = (Date.now() - 3_600_000) / 1000;
    utimesSync(seed, oldest, oldest);
    const texts: string[] = [];
    for (let i = 0; texts.length < 12; i += 1) {
      const text = `a = ${i + 1}\n`;
      if (sameShard(text, seed)) {
        texts.push(text);
      }
    }
    texts.forEach((text, i) => {
      fileExtractionCache(root, WASM)?.set(id(text), big);
      const at = (Date.now() - (texts.length - i) * 60_000) / 1000;
      const newest = entryFiles(root).find((p) => p.endsWith(`${keyOf(id(text))}.json`)) ?? "";
      utimesSync(newest, at, at);
    });
    fileExtractionCache(root, WASM)?.set(id(texts.at(-1) ?? ""), big);
    const total = entryFiles(root).reduce((sum, p) => sum + readFileSync(p).length, 0);
    expect(total).toBeLessThanOrEqual(MAX_SHARD_BYTES);
    expect(fileExtractionCache(root, WASM)?.get(id(texts.at(-1) ?? ""))).toEqual(big);
    expect(fileExtractionCache(root, WASM)?.get(id("a = 0\n"))).toBeUndefined();
  });
});

/**
 * The key the adapter gives an identity, as documented: a SHA-256 of its fields.
 *
 * @param identity - the file's text, module, package flag and revision.
 * @returns 64 hex digits.
 */
function keyOf(identity: ExtractionIdentity): string {
  const fields = [identity.revision, identity.module, identity.isPackage, identity.text];
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}

/**
 * Tells whether a text's entry lands in the same shard as an existing entry.
 *
 * @param text - the candidate text.
 * @param entry - an existing entry file.
 * @returns true when both keys start with the same two hex digits.
 */
function sameShard(text: string, entry: string): boolean {
  return keyOf(id(text)).slice(0, 2) === join(entry, "..").slice(-2);
}

/**
 * Finds a text whose entry lands in the same shard as an existing entry.
 *
 * @param entry - an existing entry file.
 * @returns the first `x = N` text in that shard.
 */
function sameShardText(entry: string): string {
  for (let i = 0; ; i += 1) {
    if (sameShard(`x = ${i}\n`, entry)) {
      return `x = ${i}\n`;
    }
  }
}
