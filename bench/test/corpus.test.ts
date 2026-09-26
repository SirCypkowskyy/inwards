import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { markdown, parsePrescan } from "../corpus.ts";
import { isRepo, readManifest, toml } from "../corpus-manifest.ts";

const MANIFEST = join(import.meta.dir, "../corpus.json");

describe("bench corpus", () => {
  test("every manifest entry is valid and pinned to a full SHA", () => {
    const repos = readManifest(MANIFEST);
    expect(repos.length).toBeGreaterThan(0);
    expect(new Set(repos.map((r) => r.name)).size).toBe(repos.length);
    expect(isRepo({ ...repos[0], sha: "main" })).toBe(false);
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
  });
});
