import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { markdown, parsePrescan } from "../corpus.ts";
import { isRepo, readManifest, toml } from "../corpus-manifest.ts";

const MANIFEST = join(import.meta.dir, "../corpus.json");
/** prescan-diff's summary line, a template literal in its source. */
const SUMMARY_TEMPLATE = /`(?<line>\$\{corpus\}: files=[^`]*)`/u;
/** One `${expression}` in that template. */
const PLACEHOLDER = /\$\{(?<expr>[^}]+)\}/gu;

describe("bench corpus", () => {
  test("every manifest entry is valid and pinned to a full SHA", () => {
    const repos = readManifest(MANIFEST);
    expect(repos.length).toBeGreaterThan(0);
    expect(new Set(repos.map((r) => r.name)).size).toBe(repos.length);
    expect(isRepo({ ...repos[0], sha: "main" })).toBe(false);
    expect(isRepo({ ...repos[0], url: "file:///etc" })).toBe(false);
  });

  test("the config is rendered as a [tool.inwards] table", () => {
    const config = {
      root: "src",
      ignore: ["tests"],
      layers: [
        { name: "domain", modules: ["app.domain"] },
        { name: "api", modules: ["app.api", "app.main"] },
      ],
    };
    expect(toml(config)).toBe(
      [
        "[tool.inwards]",
        'root = "src"',
        'ignore = ["tests"]',
        "layers = [",
        '  { name = "domain", modules = ["app.domain"] },',
        '  { name = "api", modules = ["app.api","app.main"] },',
        "]",
        "",
      ].join("\n"),
    );
    expect(toml({ root: ".", layers: [] })).not.toContain("ignore");
  });

  test("prescan-diff's summary line is read for the right directory", () => {
    const out = [
      "generated: files=10 refused=9 (90.0%) extra=1 hinted=2 missed=0",
      "/c/saleor: files=4324 refused=13 (0.3%) extra=2 hinted=7 missed=0",
    ].join("\n");
    expect(parsePrescan(out, "/c/saleor")).toEqual({
      files: 4324,
      refused: 13,
      extra: 2,
      hinted: 7,
      missed: 0,
    });
    expect(parsePrescan(out, "/c/polar")).toBeUndefined();
  });

  test("the parser reads the summary line as prescan-diff.ts formats it", () => {
    // Running prescan-diff takes seconds (its generated corpus always runs),
    // so fill in its summary template instead: a changed format fails here.
    const source = readFileSync(
      join(import.meta.dir, "../../src/core/scripts/prescan-diff.ts"),
      "utf8",
    );
    const template = SUMMARY_TEMPLATE.exec(source)?.groups?.["line"];
    expect(template).toBeDefined();
    const values: Record<string, string> = {
      corpus: "/c/polar",
      files: "1831",
      refused: "22",
      pct: "1.2",
      extra: "8",
      hinted: "14",
      "missed.length": "0",
    };
    const line = (template ?? "").replaceAll(PLACEHOLDER, (_, expr: string) => values[expr] ?? "?");
    expect(parsePrescan(line, "/c/polar")).toEqual({
      files: 1831,
      refused: 22,
      extra: 8,
      hinted: 14,
      missed: 0,
    });
  });

  test("the table flags a prescan miss", () => {
    const row = {
      name: "r",
      sha: "a".repeat(40),
      lines: 10,
      prescan: { files: 2, refused: 0, extra: 0, hinted: 0, missed: 1 },
      check: { filesChecked: 2, violations: 0, warnings: 0 },
      samples: { full: [10, 20], file: [5, 6] },
    };
    expect(markdown([row])).toContain("| **1** |");
    expect(markdown([{ ...row, error: "git fetch exited 128\nmore" }])).toContain(
      "**r failed:** git fetch exited 128",
    );
  });
});
