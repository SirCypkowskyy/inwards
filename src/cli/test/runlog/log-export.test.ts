/**
 * @file `inwards stats --export [--redact]`: every readable run-log line in
 * time order, in a file only its owner can read. With `--redact`, paths and
 * fingerprints are HMACs keyed by a per-project key kept in `.inwards/`.
 */
import { expect, test } from "bun:test";
import { readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { inwards } from "../support/run.ts";
import { LOG, line, withLog } from "../support/stats-helpers.ts";

/**
 * Reads an exported log.
 *
 * @param path - the export file.
 * @returns its lines as objects.
 */
function exported(path: string): { files: string[]; lines: { file: string }[] }[] {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
}

test("--export writes every readable line in time order", () => {
  const root = withLog([...LOG].reverse());
  const out = join(root, "export.jsonl");
  const run = inwards(["stats", root, "--export", out], { cwd: root });
  expect(run.code).toBe(0);
  const lines = exported(out);
  expect(lines).toHaveLength(LOG.length - 1); // "not json" is dropped
  expect(lines.flatMap((l) => l.files)).toContain("a.py");
});

test("--redact hashes every path with a key kept in .inwards", () => {
  const root = withLog(LOG);
  const out = join(root, "export.jsonl");
  expect(inwards(["stats", root, "--export", out, "--redact"], { cwd: root }).code).toBe(0);
  const text = readFileSync(out, "utf8");
  expect(text).not.toContain(".py");
  const lines = exported(out);
  const a = lines.flatMap((l) => l.files);
  expect(a).toContain("."); // a whole-project check stays readable
  expect(new Set(a.filter((f) => f !== ".")).size).toBe(3); // a.py, b.py, c.py stay apart
  expect(lines.flatMap((l) => l.lines.map((c) => c.file))).not.toContain("a.py");
  inwards(["stats", root, "--export", `${out}.2`, "--redact"], { cwd: root });
  expect(readFileSync(`${out}.2`, "utf8")).toBe(text); // same key, same hashes
});

test("the export key is readable by you only", () => {
  const root = withLog(LOG);
  inwards(["stats", root, "--export", join(root, "x.jsonl"), "--redact"], { cwd: root });
  const mode = statSync(join(root, ".inwards/export-key")).mode.toString(8);
  // Windows has no Unix permission bits; the key is still in the gitignored .inwards/.
  expect(process.platform === "win32" || mode.endsWith("600")).toBe(true);
});

test("--redact alone is a usage error", () => {
  const root = withLog(LOG);
  expect(inwards(["stats", root, "--redact"], { cwd: root }).code).toBe(2);
});

test("--redact hashes the fingerprints too, and keeps only known fields", () => {
  const crafted = line(9, {
    secret: "import shop.infra.db",
    tool: { t: "SECRET1" },
    exit: "SECRET2",
    lines: [{ file: "a.py", added: 1, removed: 0, snippet: "SECRET3" }],
  });
  const root = withLog([...LOG, crafted, '{"note":"x"}']);
  const out = join(root, "export.jsonl");
  inwards(["stats", root, "--export", out, "--redact"], { cwd: root });
  const text = readFileSync(out, "utf8");
  expect(text).not.toContain("SECRET");
  expect(text).not.toContain("secret");
  expect(text).not.toContain("note");
  expect(text).not.toContain('"p1"');
  expect(text).not.toContain('"pOld"');
});

test("unsafe keys and targets are refused", () => {
  const root = withLog(LOG);
  const log = join(root, ".inwards/runs.jsonl");
  expect(inwards(["stats", root, "--export", log], { cwd: root }).code).toBe(2);
  const key = join(root, ".inwards/export-key");
  expect(inwards(["stats", root, "--export", key, "--redact"], { cwd: root }).code).toBe(2);
  writeFileSync(join(root, ".inwards/export-key"), "");
  const out = join(root, "x.jsonl");
  expect(inwards(["stats", root, "--export", out, "--redact"], { cwd: root }).code).toBe(2);
  const linked = withLog(LOG);
  rmSync(join(linked, ".inwards/export-key"), { force: true });
  symlinkSync(join(linked, "pyproject.toml"), join(linked, ".inwards/export-key"));
  const run = inwards(["stats", linked, "--export", join(linked, "y.jsonl"), "--redact"], {
    cwd: linked,
  });
  expect(run.code).toBe(2);
});
