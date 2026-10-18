/**
 * @file How a whole-project check finds the files `diagrams` lists (#344):
 * plain paths and globs relative to the config file, each file once, report
 * paths relative to the base, the entries that match nothing, and no read at
 * all while the diagram rules are off. The findings themselves are the engine's and are
 * tested in core.
 */
import { expect, test } from "bun:test";
import { join } from "node:path";
import { parseConfig } from "@inwards/core";
import { nodePlatform, nodeProjectIo } from "../../src/adapters/compose.ts";
import { readDiagrams } from "../../src/check/_diagrams.ts";
import type { ProjectIo } from "../../src/check/contracts.ts";
import { project } from "../support/run.ts";

const ON = '\n[tool.inwards.rules]\nextend-select = ["INW017"]\n';

/**
 * Builds a project with diagram files and the given `diagrams` value.
 *
 * @param diagrams - the TOML value of `diagrams`.
 * @param rules - the rules table, INW017 on by default.
 * @returns the project directory, its config path and parsed config.
 */
function setUp(
  diagrams: string,
  rules = ON,
): { dir: string; configPath: string; config: ReturnType<typeof parseConfig> } {
  const text = `[tool.inwards]\ndiagrams = ${diagrams}\nlayers = [{ name = "domain", modules = ["shop.domain"] }]\n${rules}`;
  const dir = project({
    "pyproject.toml": text,
    "README.md": "# Shop\n",
    "docs/architecture.md": "# A\n",
    "docs/c4/context.mmd": "graph\n",
    "docs/notes.txt": "x\n",
  });
  return { dir, configPath: join(dir, "pyproject.toml"), config: parseConfig(text) };
}

/**
 * Wraps the real project I/O so every text read is recorded.
 *
 * @param reads - collects the paths read.
 * @returns the I/O.
 */
function recording(reads: string[]): ProjectIo {
  const base = nodeProjectIo(nodePlatform());
  return {
    ...base,
    read: {
      ...base.read,
      text: (path: string): string => {
        reads.push(path);
        return base.read.text(path);
      },
    },
  };
}

test("plain paths and globs are read once each, with report paths and the entries that matched nothing", () => {
  const { dir, configPath, config } = setUp(
    '["README.md", "docs/**/*.md", "docs/**/*.mmd", "docs/architecture.md", "missing.md", "nowhere/*.md"]',
  );
  const listed = readDiagrams(recording([]), configPath, config, { base: dir });
  expect(listed.sources.map((s) => s.path)).toEqual([
    "README.md",
    "docs/architecture.md",
    "docs/c4/context.mmd",
  ]);
  expect(listed.sources[0]?.text).toBe("# Shop\n");
  expect(listed.unmatched).toEqual(["missing.md", "nowhere/*.md"]);
});

test("report paths are relative to the base, not the config", () => {
  const { dir, configPath, config } = setUp('["docs/architecture.md"]');
  const listed = readDiagrams(recording([]), configPath, config, { base: join(dir, "docs") });
  expect(listed.sources.map((s) => s.path)).toEqual(["architecture.md"]);
});

test("INW018 or INW019 alone reads the diagrams too", () => {
  for (const code of ["INW018", "INW019"]) {
    const { dir, configPath, config } = setUp(
      '["README.md"]',
      `\n[tool.inwards.rules]\nextend-select = ["${code}"]\n`,
    );
    const read = readDiagrams(recording([]), configPath, config, { base: dir }).sources;
    expect([code, read.length]).toEqual([code, 1]);
  }
});

test("nothing is read while INW017, INW018 and INW019 are off", () => {
  const { dir, configPath, config } = setUp('["README.md"]', "");
  const reads: string[] = [];
  expect(readDiagrams(recording(reads), configPath, config, { base: dir })).toEqual({
    sources: [],
    unmatched: [],
  });
  expect(reads).toEqual([]);
});
