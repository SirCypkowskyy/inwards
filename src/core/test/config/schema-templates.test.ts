/**
 * @file Paired negative cases for templates and sibling layers (#97) in the
 * `[tool.inwards]` JSON Schema, kept beside `schema-negatives.test.ts`. Each
 * structural mistake fails both the schema and the parser. Each relation only
 * the expansion can see fails the parser alone.
 */
import { describe, expect, test } from "bun:test";
import { MINIMAL, parserError, schemaErrors } from "../support/config-schema.ts";

/**
 * Builds a config from the minimal one plus extra TOML.
 *
 * @param extra - keys or tables to add.
 * @returns the config text.
 */
function withExtra(extra: string): string {
  return `${MINIMAL}${extra}`;
}

/**
 * Builds a config whose only layer entry is the given TOML value.
 *
 * @param layer - the entry, an inline table or a nested array.
 * @returns the config text.
 */
function withLayer(layer: string): string {
  return `[tool.inwards]\nlayers = [${layer}]\n`;
}

describe("template mistakes fail both the schema and the parser", () => {
  test.each([
    ["templates that aren't a table", withExtra('templates = ["t"]\n')],
    ["a template that isn't a table", withExtra("templates = { t = 1 }\n")],
    ["a blank template name", withExtra('[tool.inwards.templates." "]\nroles = ["a"]\n')],
    ["an unknown template key", withExtra('[tool.inwards.templates.t]\nrole = ["a"]\n')],
    ["empty roles", withExtra("[tool.inwards.templates.t]\nroles = []\n")],
    ["a role that isn't a list", withExtra('[tool.inwards.templates.t]\nroles = "a"\n')],
    ["a malformed role", withExtra('[tool.inwards.templates.t]\nroles = ["b |"]\n')],
    ["a wildcard role", withExtra('[tool.inwards.templates.t]\nroles = ["*"]\n')],
    [
      "a wildcard template public entry",
      withExtra('[tool.inwards.templates.t]\npublic = ["a.*"]\n'),
    ],
    ["a bad template member pattern", withExtra('[tool.inwards.templates.t]\nallow = ["a/b"]\n')],
    ["an unknown template extra", withExtra('[tool.inwards.templates.t]\nextra = "fatal"\n')],
    ["an empty template hint", withExtra('[tool.inwards.templates.t]\nhints = [""]\n')],
    [
      "shape hints that aren't a list",
      withExtra('[[tool.inwards.shape]]\npackages = ["shop"]\nhints = "x"\n'),
    ],
    [
      "a template name that isn't a string",
      withLayer('{ name = "d", modules = ["shop"], template = 1 }'),
    ],
    ["a sibling group of one", withLayer('[{ name = "a", modules = ["a"] }]')],
    [
      "a sibling with a template",
      `${withLayer('[{ name = "a", modules = ["a"] }, { name = "b", modules = ["b"], template = "t" }]')}[tool.inwards.templates.t]\nroles = ["x"]\n`,
    ],
    ["a sibling without modules", withLayer('[{ name = "a", modules = ["a"] }, { name = "b" }]')],
  ])("%s", (_what, text) => {
    expect(parserError(text)).toBeDefined();
    expect(schemaErrors(text)).not.toEqual([]);
  });

  test("templates, their uses and sibling layers pass both", () => {
    const text = `[tool.inwards]
layers = [
  [{ name = "a", modules = ["shop.a"] }, { name = "b", modules = ["shop.b"] }],
  { name = "d", modules = ["shop.*"], template = "t" },
]

[tool.inwards.templates.t]
roles = ["constants", "models | schemas", "api.v1 | api.v2", "service"]
public = ["service", "api.v1"]
allow = ["utils"]
require = ["__init__", "service"]
forbid = ["helpers"]
extra = "warning"
hints = ["Shared code goes in shop/common.py."]

[[tool.inwards.shape]]
packages = ["shop.*"]
template = "t"
hints = ["One more hint."]

[[tool.inwards.contexts]]
name = "orders"
modules = ["shop.orders"]
template = "t"
`;
    expect([parserError(text), schemaErrors(text)]).toEqual([undefined, []]);
  });
});

describe("relations only the expansion shows fail the parser only", () => {
  test.each([
    [
      "a template no table declares",
      withLayer('{ name = "d", modules = ["shop"], template = "t" }'),
    ],
    ["a role listed twice", withExtra('[tool.inwards.templates.t]\nroles = ["a | b", "b"]\n')],
    [
      "a layer template without roles",
      `${withLayer('{ name = "d", modules = ["shop"], template = "t" }')}[tool.inwards.templates.t]\npublic = ["api"]\n`,
    ],
    [
      "a context template without public",
      withExtra(
        '[tool.inwards.templates.t]\nroles = ["a"]\n[[tool.inwards.contexts]]\nname = "c"\nmodules = ["shop.c"]\ntemplate = "t"\n',
      ),
    ],
    [
      "a role layer named like another layer",
      `${withLayer('{ name = "d.a", modules = ["x"] }, { name = "d", modules = ["shop"], template = "t" }')}[tool.inwards.templates.t]\nroles = ["a"]\n`,
    ],
  ])("%s", (_what, text) => {
    expect(parserError(text)).toBeDefined();
    expect(schemaErrors(text)).toEqual([]);
  });
});
