/**
 * @file `diagrams` in `[tool.inwards]` (#344, ADR-045): parsing the list of
 * paths and globs, refusing `..` anywhere but at the start, checking that
 * the leading `..` stay inside the project root the adapter found (#413), and
 * matching file paths against an entry segment by segment. The CLI walks
 * from `diagramBase` and keeps what `diagramMatches` accepts.
 */
import { describe, expect, test } from "bun:test";
import {
  checkDiagramsRoot,
  type DiagramsRoot,
  diagramBase,
  diagramMatches,
  parseConfig,
} from "../../src/index.ts";

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

  test("leading .. segments are kept for the adapter to check against the project root", () => {
    expect(diagrams('["../../docs/architecture.md", "../docs/**/*.md"]')).toEqual([
      "../../docs/architecture.md",
      "../docs/**/*.md",
    ]);
  });

  test.each([
    ['"docs/a.md"', "must be a list of paths"],
    ["[1]", "diagrams[0] must be a non-empty string"],
    ['[""]', "diagrams[0] must be a non-empty string"],
    ['["docs\\\\a.md"]', "must use forward slashes"],
    ['["/etc/a.md"]', "must be relative to the config file"],
    ['["C:/a.md"]', "must be relative to the config file"],
    ['["docs/../a.md"]', "may use .. only at the start"],
    ['["../docs/../a.md"]', "may use .. only at the start"],
    ['["../.."]', "must name a file after its .. segments"],
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
    ["../../docs/a.md", "../../docs/a.md", true],
    ["../../docs/a.md", "../docs/a.md", false],
    ["../**/*.md", "../docs/a.md", true],
    ["../**/*.md", "../../docs/a.md", false],
    ["**/*.md", "../docs/a.md", false],
    ["../*.md", "../x/../a.md", false],
  ])("%s against %s is %p", (entry, path, matches) => {
    expect(diagramMatches(entry, path)).toBe(matches);
  });

  test("the base is the directory before the first wildcard; a plain path has none", () => {
    expect(diagramBase("docs/**/*.md")).toBe("docs");
    expect(diagramBase("*.md")).toBe("");
    expect(diagramBase("docs/architecture.md")).toBeUndefined();
    expect(diagramBase("../../docs/**/*.md")).toBe("../../docs");
  });
});

describe("the project root (#413)", () => {
  /** A uv workspace root two directories above the config. */
  const Workspace: DiagramsRoot = { up: 2, name: 'the uv workspace root ("../..")' };

  test("an entry that climbs as far as the root passes", () => {
    expect(() =>
      checkDiagramsRoot(["../../docs/architecture.md", "../**/*.md"], () => Workspace),
    ).not.toThrow();
  });

  test("an entry that climbs past the root is refused, naming the root", () => {
    expect(() => checkDiagramsRoot(["docs/a.md", "../../../docs/a.md"], () => Workspace)).toThrow(
      `tool.inwards.diagrams[1] ("../../../docs/a.md") must stay inside the project root, the uv workspace root ("../..")`,
    );
  });

  test("without a root no entry may climb", () => {
    expect(() => checkDiagramsRoot(["../docs/a.md"], () => undefined)).toThrow(
      "outside a git repository or uv workspace",
    );
  });

  test("the root is looked for once, and only when an entry climbs", () => {
    let calls = 0;
    /**
     * Finds the workspace root and counts the calls.
     *
     * @returns the workspace root two directories up.
     */
    function find(): DiagramsRoot {
      calls += 1;
      return Workspace;
    }
    checkDiagramsRoot(["docs/a.md", "docs/**/*.md"], find);
    checkDiagramsRoot(undefined, find);
    expect(calls).toBe(0);
    checkDiagramsRoot(["../a.md", "../../b.md"], find);
    expect(calls).toBe(1);
  });
});
