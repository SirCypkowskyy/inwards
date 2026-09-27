/**
 * @file The real filesystem adapter's error contract. `FileReader.list`
 * answers undefined only when nothing, or something other than a directory,
 * is at the path; a directory that can't be examined, because an ancestor
 * can't be entered, throws as it did on develop instead of reading as empty.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { nodeFileReader } from "../../src/adapters/filesystem.ts";
import { tempDir } from "../support/temp.ts";

const root = tempDir("inwards-fs-");
const locked = join(root, "locked");
mkdirSync(join(locked, "inner"), { recursive: true });
writeFileSync(join(root, "file.txt"), "x");
afterAll(() => chmodSync(locked, 0o755));

test("nothing there, or a file, lists as undefined", () => {
  expect(nodeFileReader.list(join(root, "missing"))).toBeUndefined();
  expect(nodeFileReader.list(join(root, "file.txt"))).toBeUndefined();
  expect(
    nodeFileReader
      .list(root)
      ?.map((e) => e.name)
      .sort(),
  ).toEqual(["file.txt", "locked"]);
});

// Permissions don't bind root, and Windows has no POSIX modes.
describe.skipIf(process.platform === "win32" || process.getuid?.() === 0)("permissions", () => {
  test("a directory under an ancestor that can't be entered throws", () => {
    chmodSync(locked, 0o000);
    try {
      expect(() => nodeFileReader.list(join(locked, "inner"))).toThrow();
      expect(() => nodeFileReader.list(locked)).toThrow();
    } finally {
      chmodSync(locked, 0o755);
    }
  });
});
