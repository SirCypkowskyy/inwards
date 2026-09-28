/**
 * @file The language server's in-memory extraction cache (#56). An entry
 * comes back only for its exact identity. Only a module's latest text is
 * kept, so edits don't pile up versions. The cache never holds more entries
 * or bytes than its limits, and the least recently used entry goes first.
 */
import { expect, test } from "bun:test";
import type { CachedExtraction, ExtractionIdentity } from "@inwards/core";
import { memoryCache } from "../src/server/memory-cache.ts";

const VALUE: CachedExtraction = { skeleton: [] };
const ROOMY = { entries: 100, bytes: 1_000_000 };

/**
 * An identity for a module's text.
 *
 * @param module - the module name.
 * @param text - the file's text.
 * @returns the identity at revision 1, not a package.
 */
function id(module: string, text = "x = 1\n"): ExtractionIdentity {
  return { revision: "1", text, module, isPackage: false };
}

/**
 * An extraction of about a given size: one comment with a long reason.
 *
 * @param length - how many characters the comment's reason has.
 * @returns a value whose JSON is a little longer than `length`.
 */
function withReason(length: number): CachedExtraction {
  const span = { line: 1, column: 1, endLine: 1, endColumn: 2 };
  return { comments: [{ span, codes: [], reason: "r".repeat(length), problems: [] }] };
}

test("an entry comes back for its identity only", () => {
  const cache = memoryCache(ROOMY);
  cache.set(id("shop.a"), VALUE);
  expect(cache.get(id("shop.a"))).toEqual(VALUE);
  expect(cache.get(id("shop.b"))).toBeUndefined();
  expect(cache.get({ ...id("shop.a"), isPackage: true })).toBeUndefined();
  expect(cache.get({ ...id("shop.a"), revision: "2" })).toBeUndefined();
  expect(cache.get(id("shop.a", "x = 2\n"))).toBeUndefined();
});

test("a module's new text replaces its old one", () => {
  const cache = memoryCache(ROOMY);
  for (let i = 0; i < 50; i += 1) {
    cache.set(id("shop.a", `x = ${i}\n`), VALUE);
  }
  cache.set(id("shop.b"), VALUE);
  expect(cache.get(id("shop.a", "x = 49\n"))).toEqual(VALUE);
  expect(cache.get(id("shop.a", "x = 48\n"))).toBeUndefined();
  expect(cache.get(id("shop.b"))).toEqual(VALUE);
});

test("the least recently used entry goes once the entry limit is reached", () => {
  const cache = memoryCache({ entries: 2, bytes: 1_000_000 });
  cache.set(id("shop.a"), VALUE);
  cache.set(id("shop.b"), VALUE);
  expect(cache.get(id("shop.a"))).toEqual(VALUE); // a is now the most recent
  cache.set(id("shop.c"), VALUE);
  expect(cache.get(id("shop.b"))).toBeUndefined();
  expect(cache.get(id("shop.a"))).toEqual(VALUE);
  expect(cache.get(id("shop.c"))).toEqual(VALUE);
});

test("the byte budget evicts too, and an entry bigger than it isn't kept", () => {
  const big = withReason(400);
  const cache = memoryCache({ entries: 100, bytes: 1000 });
  cache.set(id("shop.a"), big);
  cache.set(id("shop.b"), big);
  cache.set(id("shop.c"), big);
  expect(cache.get(id("shop.a"))).toBeUndefined();
  expect(cache.get(id("shop.c"))).toEqual(big);
  const huge = withReason(2000);
  cache.set(id("shop.d"), huge);
  expect(cache.get(id("shop.d"))).toBeUndefined();
  expect(cache.get(id("shop.c"))).toEqual(big);
});
