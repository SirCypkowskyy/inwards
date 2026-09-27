/**
 * @file The docs snippet scanner (`test/support/snippets.ts`) on made-up pages.
 * It must find the table in any TOML spelling and any fence style, reject a
 * marker that is misspelled or attached to the wrong fence, and accept an
 * invalid example only when the parser fails for the key the marker names.
 * The real docs pages are checked in `schema.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { fences, isInwardsSnippet, snippetProblems } from "../support/snippets.ts";

const LAYERS = 'layers = [{ name = "domain", modules = ["shop.domain"] }]';

/**
 * Wraps TOML in a fence, with an optional marker before it.
 *
 * @param toml - the fence's content.
 * @param marker - the marker line's content, if any.
 * @param fence - the fence characters.
 * @returns the Markdown.
 */
function page(toml: string, marker?: string, fence = "```"): string {
  const head = marker === undefined ? "" : `<!-- config: ${marker} -->\n\n`;
  return `# Page\n\nText.\n\n${head}${fence}toml\n${toml}\n${fence}\n`;
}

describe("finding fences", () => {
  test("backtick and tilde fences, indented ones too, with their markers", () => {
    const markdown = `${page("a = 1", "fragment")}\n1. Item\n\n   ~~~toml\n   b = 2\n   ~~~\n`;
    expect(fences(markdown).map((f) => [f.lang, f.body, f.marker])).toEqual([
      ["toml", "a = 1", "fragment"],
      ["toml", "b = 2", undefined],
    ]);
  });

  test.each([
    ['["tool"."inwards"]\nlayers = []'],
    ["[tool . inwards]\nlayers = []"],
    ["[tool]\ninwards = { layers = [] }"],
    ["[tool.inwards\nbroken"],
  ])("the table is recognised in %p", (toml) => {
    expect(isInwardsSnippet(toml)).toBe(true);
  });

  test("other TOML isn't an Inwards snippet", () => {
    expect(isInwardsSnippet("[tool.ruff]\nline-length = 100\n# see tool.inwards docs")).toBe(false);
  });
});

describe("checking a page", () => {
  test("a complete, valid config passes", () => {
    expect(snippetProblems("p", page(`[tool.inwards]\n${LAYERS}`))).toEqual([]);
  });

  test.each([['["tool"."inwards"]\nlayers = []'], ["[tool . inwards]\nlayers = []"]])(
    "an invalid config in an unusual spelling is caught: %p",
    (toml) => {
      expect(snippetProblems("p", page(toml))).not.toEqual([]);
    },
  );

  test("a tilde fence is checked like a backtick one", () => {
    expect(snippetProblems("p", page("[tool.inwards]\nlayers = []", undefined, "~~~"))).not.toEqual(
      [],
    );
  });

  test("a fragment is checked merged into a minimal config", () => {
    expect(snippetProblems("p", page('[tool.inwards]\nstop-gate = "changed"', "fragment"))).toEqual(
      [],
    );
    expect(
      snippetProblems("p", page('[tool.inwards]\nstop-gate = "never"', "fragment")),
    ).not.toEqual([]);
  });

  test("an unmarked partial config fails", () => {
    expect(snippetProblems("p", page('[tool.inwards]\nstop-gate = "changed"'))).not.toEqual([]);
  });

  test("an invalid example passes only when the error names its key", () => {
    const bad = '[tool.inwards]\nstop-gate = "never"';
    expect(snippetProblems("p", page(bad, "invalid tool.inwards.stop-gate"))).toEqual([]);
    expect(snippetProblems("p", page(bad, "invalid tool.inwards.run-log"))).not.toEqual([]);
    expect(snippetProblems("p", page(bad, "invalid"))).not.toEqual([]);
    // A missing prerequisite (no layers) can't stand in for the intended error.
    expect(
      snippetProblems(
        "p",
        page('[tool.inwards]\nstop-gate = "changed"', "invalid tool.inwards.stop-gate"),
      ),
    ).not.toEqual([]);
  });

  test("a misspelled marker, or one before other TOML, is a problem", () => {
    expect(snippetProblems("p", page(`[tool.inwards]\n${LAYERS}`, "typo"))).not.toEqual([]);
    expect(snippetProblems("p", page("[tool.ruff]\nx = 1", "fragment"))).not.toEqual([]);
  });

  test("a marker not one blank line before a fence is a problem", () => {
    const markdown = `<!-- config: fragment -->\nText.\n\n${page(`[tool.inwards]\n${LAYERS}`)}`;
    expect(snippetProblems("p", markdown)).not.toEqual([]);
  });
});
