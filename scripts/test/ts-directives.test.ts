/**
 * @file TypeScript's escape hatches stay rare and explained (#176). No source
 * file may use `@ts-expect-error` or `@ts-nocheck`, and a `@ts-expect-error` must say
 * why after the directive, since the compiler checks that an error exists but
 * not that the reason for silencing it is written down.
 */
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
/** A directive comment and whatever follows it on the line. */
const DIRECTIVE = /@ts-(?<kind>ignore|nocheck|expect-error)\b(?<rest>[^\n]*)/gu;
/** Enough text after `@ts-expect-error` to count as a reason. */
const REASON = /[A-Za-z]{3,}/u;

/** The directories that hold TypeScript, as check:overviews walks them. */
const DIRS = ["src", "scripts", "eval", "bench", "docs/test"];
/** Directories that hold no source of ours. */
const SKIPPED = new Set(["node_modules", "dist", "site", "fixtures", "__snapshots__"]);

/**
 * Lists the TypeScript files below a directory. It walks the tree rather than
 * asking git, so it works in a checkout without `.git` (act's containers).
 *
 * @param dir - a repo-relative directory.
 * @returns repo-relative paths.
 */
function typeScriptFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) {
      return SKIPPED.has(entry.name) ? [] : typeScriptFiles(rel);
    }
    return entry.name.endsWith(".ts") ? [rel] : [];
  });
}

test("no @ts-ignore or @ts-nocheck, and every @ts-expect-error gives a reason", () => {
  const files = DIRS.flatMap((dir) => typeScriptFiles(dir));
  expect(files.length).toBeGreaterThan(0);
  const bad = files.flatMap((file) =>
    [...readFileSync(join(ROOT, file), "utf8").matchAll(DIRECTIVE)]
      .filter((m) => m.groups?.["kind"] !== "expect-error" || !REASON.test(m.groups["rest"] ?? ""))
      .map((m) => `${file}: ${m[0].trim()}`),
  );
  // This file names the directives in its own text; nothing else may.
  expect(bad.filter((line) => !line.startsWith("scripts/test/ts-directives.test.ts"))).toEqual([]);
});
