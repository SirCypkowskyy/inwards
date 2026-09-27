/**
 * @file The CLI's own architecture (#176), checked by behaviour rather than by
 * reading: invocation state doesn't leak between two invocations in one
 * process, the policy folders really can't reach node:fs or the `process`
 * global (Biome rejects a probe file), and every source folder has a fallow
 * zone that keeps policy away from the concrete adapters.
 * These tests would fail if a refactor put a cache back into a module global or
 * let a policy folder reach the filesystem directly.
 */
import { describe, expect, test } from "bun:test";
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Diagnostic } from "@inwards/core";
import { nodePlatform } from "../../src/adapters/compose.ts";
import { createRunLog } from "../../src/runlog/record.ts";
import { createStartIdentity } from "../../src/session/start-identity.ts";
import { project } from "../support/run.ts";
import { tempDir } from "../support/temp.ts";

const REPO = resolve(import.meta.dir, "../../../..");
const SRC = join(REPO, "src/cli/src");
const BIOME = join(REPO, "node_modules/.bin/biome");
/** Folders that hold policy: no I/O of their own, no concrete adapters. */
const POLICY = [
  "claude-code",
  "commands",
  "init",
  "json",
  "paths",
  "platform",
  "project",
  "runlog",
  "session",
];
/** The run-log fields these tests read. */
interface LogLine {
  files: string[];
  fingerprints: string[];
}

/** The part of `.fallowrc.jsonc` these tests read. */
interface FallowConfig {
  boundaries: {
    zones: { name: string; patterns: string[] }[];
    rules: { from: string; allow: string[] }[];
  };
}

const FINDING: Diagnostic = {
  code: "INW001",
  rule: "layers",
  severity: "error",
  file: "shop/domain/order.py",
  line: 1,
  column: 1,
  endLine: 1,
  endColumn: 1,
  module: "shop.domain.order",
  message: 'Layer "domain" imports "shop.infrastructure".',
  fix: { summary: "", steps: [] },
  docs: "",
};

/**
 * Lints some source as if it were a file at a path, with the repo's Biome
 * config. Biome shows no rule findings for stdin, so the text goes into a
 * temporary copy of the tree next to a copy of biome.jsonc.
 *
 * @param path - repo-relative path the text pretends to live at.
 * @param text - the source.
 * @returns Biome's exit code and output.
 */
function lintAs(path: string, text: string): { code: number | null; out: string } {
  const root = tempDir("inwards-arch-");
  copyFileSync(join(REPO, "biome.jsonc"), join(root, "biome.jsonc"));
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
  const run = Bun.spawnSync(
    [BIOME, "lint", "--vcs-enabled=false", `--config-path=${root}`, join(root, path)],
    { cwd: root },
  );
  return { code: run.exitCode, out: `${run.stdout.toString()}${run.stderr.toString()}` };
}

describe("invocation state", () => {
  test("two run logs in one process keep their own notes", () => {
    const root = project({
      "pyproject.toml":
        '[tool.inwards]\nrun-log = true\nlayers = [{ name = "domain", modules = ["shop.domain"] }]\n',
      "shop/domain/order.py": "X = 1\n",
    });
    const io = nodePlatform();
    const first = createRunLog(io);
    const second = createRunLog(io);
    first.noteRun(root, [join(root, "shop/domain/order.py")], [FINDING]);
    second.logRun(root, { event: "check", exit: 0, force: true });
    first.logRun(root, { event: "check", exit: 1, force: true });
    const lines: LogLine[] = readFileSync(join(root, ".inwards/runs.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line): LogLine => JSON.parse(line));
    expect(lines.map((line) => line.files)).toEqual([[], ["shop/domain/order.py"]]);
    expect(lines.map((line) => line.fingerprints.length)).toEqual([0, 1]);
  });

  test("two start identities in one process don't share their caches", () => {
    const root = project({ "shop/domain/order.py": "X = 1\n", "shop/domain/saved.py": "X = 1\n" });
    const { probe } = nodePlatform();
    const real = probe.realpath(root) ?? root;
    const file = join(real, "shop/domain/order.py");
    const first = createStartIdentity(probe);
    expect(first.startPath(real, file)).toBe("shop/domain/order.py");
    // The agent swaps the file for a link: a fresh invocation sees it, the first keeps its answer.
    rmSync(file);
    symlinkSync("saved.py", file);
    expect(createStartIdentity(probe).startPath(real, file)).toBeUndefined();
    expect(first.startPath(real, file)).toBe("shop/domain/order.py");
  });
});

describe("boundaries", () => {
  test("a policy folder can't import node:fs or use the process global", () => {
    for (const folder of ["session", "claude-code", "project"]) {
      const imports = lintAs(
        `src/cli/src/${folder}/probe.ts`,
        'import { readFileSync } from "node:fs";\nexport const read = readFileSync;\n',
      );
      expect(imports.code).not.toBe(0);
      expect(imports.out).toContain("noRestrictedImports");
      const global = lintAs(
        `src/cli/src/${folder}/probe.ts`,
        "export const cwd = (): string => process.cwd();\n",
      );
      expect(global.code).not.toBe(0);
      expect(global.out).toContain("noRestrictedGlobals");
    }
  });

  test("an adapter may import node:fs", () => {
    const adapter = lintAs(
      "src/cli/src/adapters/probe.ts",
      'import { readFileSync } from "node:fs";\n\n/** Reads. */\nexport const read = readFileSync;\n',
    );
    expect(adapter.out).not.toContain("noRestrictedImports");
  });

  test("every source folder has a fallow zone, and no policy zone may import adapters", () => {
    const text = readFileSync(join(REPO, ".fallowrc.jsonc"), "utf8").replace(/^\s*\/\/.*$/gmu, "");
    const config: FallowConfig = JSON.parse(text);
    const patterns = config.boundaries.zones.flatMap((zone) => zone.patterns);
    const folders = readdirSync(SRC, { withFileTypes: true }).filter((entry) =>
      entry.isDirectory(),
    );
    for (const folder of folders) {
      expect(patterns).toContain(`src/cli/src/${folder.name}/**`);
    }
    const policyZones = new Set(POLICY.map((folder) => `cli-${folder}`));
    for (const rule of config.boundaries.rules.filter((r) => policyZones.has(r.from))) {
      expect(rule.allow).not.toContain("cli-adapters");
      expect(rule.allow).not.toContain("cli-main");
    }
  });
});
