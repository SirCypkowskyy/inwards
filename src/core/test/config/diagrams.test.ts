/**
 * @file `diagrams` in `[tool.inwards]` (#344, ADR-045): parsing the list of
 * paths and globs, refusing paths that leave the config's directory, and
 * matching file paths against an entry segment by segment. The CLI walks
 * from `diagramBase` and keeps what `diagramMatches` accepts.
 */
import { describe, expect, test } from "bun:test";
import { diagramBase, diagramMatches, parseConfig } from "../../src/index.ts";

/**
 * Parses a config with the given `diagrams` value.
 *
 * @param value - the TOML value of `diagrams`.
 * @returns the parsed `diagrams`.
 */
function diagrams(value: string): string[] | undefined {
  return parseConfig(`[tool.inwards]
diagrams = ${value}
layers = [{ name = "domain", modules = ["shop.domain"] }]
`).diagrams;
}

describe("parsing", () => {
  test("paths and globs are kept as written; an empty list is the same as none", () => {
    expect(diagrams('["docs/architecture.md", "docs/**/*.mmd"]')).toEqual([
      "docs/architecture.md",
      "docs/**/*.mmd",
    ]);
    expect(diagrams("[]")).toBeUndefined();
  });

  test.each([
    ['"docs/a.md"', "must be a list of paths"],
    ["[1]", "diagrams[0] must be a non-empty string"],
    ['[""]', "diagrams[0] must be a non-empty string"],
    ['["docs\\\\a.md"]', "must use forward slashes"],
    ['["/etc/a.md"]', "must be relative to the config file"],
    ['["C:/a.md"]', "must be relative to the config file"],
    ['["../docs/a.md"]', "must not leave the config file's directory"],
    ['["docs//a.md"]', "has an empty segment"],
    ['["docs/[a.md"]', "unclosed ["],
  ])("diagrams = %s is refused", (value, message) => {
    expect(() => diagrams(value)).toThrow(message);
  });
});

describe("matching", () => {
  test.each([
    ["docs/architecture.md", "docs/architecture.md", true],
    ["docs/architecture.md", "docs/other.md", false],
    ["docs/*.md", "docs/a.md", true],
    ["docs/*.md", "docs/sub/a.md", false],
    ["docs/**/*.md", "docs/a.md", true],
    ["docs/**/*.md", "docs/sub/deeper/a.md", true],
    ["**/*.mmd", "a.mmd", true],
    ["**/*.mmd", "docs/a.md", false],
    ["docs/?.md", "docs/a.md", true],
    ["docs/[ab].md", "docs/c.md", false],
  ])("%s against %s is %p", (entry, path, matches) => {
    expect(diagramMatches(entry, path)).toBe(matches);
  });

  test("the base is the directory before the first wildcard; a plain path has none", () => {
    expect(diagramBase("docs/**/*.md")).toBe("docs");
    expect(diagramBase("*.md")).toBe("");
    expect(diagramBase("docs/architecture.md")).toBeUndefined();
  });
});
