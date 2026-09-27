/**
 * @file The sentence count behind `check-module-overviews.ts`. File names,
 * version numbers, URLs, inline code and abbreviations must not pass for
 * sentence ends, and only the `@file` block's prose counts, not its tags.
 */
import { expect, test } from "bun:test";
import { overviewProse, sentences } from "../check-module-overviews.ts";

test("dotted names, code, URLs and abbreviations don't end a sentence", () => {
  expect(sentences("Reads runs.jsonl and runs.1.jsonl for v0.3.0 users.")).toBe(1);
  expect(sentences("Calls `a.b()` first. Then it stops.")).toBe(2);
  expect(sentences("See https://example.org/a.b. It helps.")).toBe(2);
  expect(sentences("Takes a path, e.g. `x.py`, or a dir, i.e. a package. Done.")).toBe(2);
});

test("only the @file block's prose counts, up to the next tag", () => {
  const text =
    "/**\n * @file One thing. Two things.\n * @see elsewhere. Not counted.\n */\nexport {};\n";
  expect(overviewProse(text)).toBe("One thing. Two things.");
  expect(sentences(overviewProse(text) ?? "")).toBe(2);
});

test("a module without a leading @file block has no overview", () => {
  expect(overviewProse("/** Documents a function. */\nexport function f(): void {}\n")).toBe(
    undefined,
  );
  expect(overviewProse("#!/usr/bin/env bun\n/**\n * @file Runs. Exits.\n */\n")).toBe(
    "Runs. Exits.",
  );
});
