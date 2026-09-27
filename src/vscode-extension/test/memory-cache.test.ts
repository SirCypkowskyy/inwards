/**
 * @file The language server's in-memory extraction cache (#56). An entry
 * comes back only for its exact identity. The cache never holds more than
 * its limit, and the least recently used entry is the one dropped.
 */
import { expect, test } from "bun:test";
import type { CachedExtraction, ExtractionIdentity } from "@inwards/core";
import { memoryCache } from "../src/server/memory-cache.ts";

const VALUE: CachedExtraction = { skeleton: [] };

/**
 * An identity for a file's text.
 *
 * @param text - the file's text.
 * @returns the identity at revision 1 for `shop.a`, not a package.
 */
function id(text: string): ExtractionIdentity {
  return { revision: "1", text, module: "shop.a", isPackage: false };
}

test("an entry comes back for its identity only", () => {
  const cache = memoryCache();
  cache.set(id("x = 1\n"), VALUE);
  expect(cache.get(id("x = 1\n"))).toEqual(VALUE);
  expect(cache.get({ ...id("x = 1\n"), module: "shop.b" })).toBeUndefined();
  expect(cache.get({ ...id("x = 1\n"), isPackage: true })).toBeUndefined();
  expect(cache.get({ ...id("x = 1\n"), revision: "2" })).toBeUndefined();
  expect(cache.get(id("x = 2\n"))).toBeUndefined();
});

test("the least recently used entry goes once the limit is reached", () => {
  const cache = memoryCache(2);
  cache.set(id("a"), VALUE);
  cache.set(id("b"), VALUE);
  expect(cache.get(id("a"))).toEqual(VALUE); // a is now the most recent
  cache.set(id("c"), VALUE);
  expect(cache.get(id("b"))).toBeUndefined();
  expect(cache.get(id("a"))).toEqual(VALUE);
  expect(cache.get(id("c"))).toEqual(VALUE);
});

test("storing an entry again replaces it without growing the cache", () => {
  const cache = memoryCache(2);
  cache.set(id("a"), VALUE);
  cache.set(id("b"), VALUE);
  cache.set(id("a"), { skeleton: "refused" });
  cache.set(id("a"), { skeleton: "refused" });
  expect(cache.get(id("a"))).toEqual({ skeleton: "refused" });
  expect(cache.get(id("b"))).toEqual(VALUE);
});
