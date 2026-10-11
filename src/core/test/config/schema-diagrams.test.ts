/**
 * @file Paired negative cases for `diagrams` (#344) in the `[tool.inwards]`
 * JSON Schema, kept beside `schema-negatives.test.ts`. Each structural
 * mistake fails both the schema and the parser, and valid entries pass both,
 * so the two can't drift on the type or on what a path may look like.
 */
import { describe, expect, test } from "bun:test";
import { MINIMAL, parserError, schemaErrors } from "../support/config-schema.ts";

/**
 * Builds a config with a `diagrams` value.
 *
 * @param value - the TOML value.
 * @returns the config text.
 */
function diagrams(value: string): string {
  return MINIMAL.replace("[tool.inwards]\n", `[tool.inwards]\ndiagrams = ${value}\n`);
}

describe("diagrams", () => {
  test.each([
    ["a string, not a list", diagrams('"docs/architecture.md"')],
    ["a number in the list", diagrams("[1]")],
    ["an empty path", diagrams('[""]')],
    ["an absolute path", diagrams('["/docs/a.md"]')],
    ["a Windows drive", diagrams('["C:/docs/a.md"]')],
    ["a backslash", diagrams(String.raw`['docs\a.md']`)],
    ["a path that climbs out with ..", diagrams('["docs/../../a.md"]')],
    ["an empty segment", diagrams('["docs//a.md"]')],
    [
      "INW017 options with an unknown key",
      `${MINIMAL}[tool.inwards.rules.diagram-unknown-name]\nfiles = []\n`,
    ],
  ])("%s fails both", (_what, text) => {
    expect(parserError(text)).toBeDefined();
    expect(schemaErrors(text)).not.toEqual([]);
  });

  test("paths, globs and the rule's switch pass both", () => {
    const text = diagrams('["docs/architecture.md", "docs/**/*.md", "*.mmd"]').replace(
      "[tool.inwards]\n",
      '[tool.inwards]\nrules = { extend-select = ["INW017"], severity = { INW017 = "error" } }\n',
    );
    expect([parserError(text), schemaErrors(text)]).toEqual([undefined, []]);
  });
});
