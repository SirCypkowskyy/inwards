/**
 * @file Paired negative cases for INW014's options (#295) in the
 * `[tool.inwards]` JSON Schema, kept beside `schema-negatives.test.ts`. Each
 * structural mistake fails both the schema and the parser, and a valid table
 * passes both, so the two can't drift on `allow-bases`,
 * `extend-allow-bases` or `allow-decorators`.
 */
import { describe, expect, test } from "bun:test";
import { MINIMAL, parserError, schemaErrors } from "../support/config-schema.ts";

/**
 * Builds a config with INW014's options table.
 *
 * @param body - the table's body, TOML.
 * @returns the config text.
 */
function ports(body: string): string {
  return `${MINIMAL}[tool.inwards.rules.ports-abstract]\n${body}\n`;
}

describe("INW014's options", () => {
  test.each([
    ["allow-bases that isn't a list", ports('allow-bases = "Exception"')],
    ["a base pattern with a space", ports('allow-bases = ["shop. Base"]')],
    ["an empty base segment", ports('extend-allow-bases = ["shop..Base"]')],
    ["a base pattern with a colon", ports('extend-allow-bases = ["shop.dto:Base"]')],
    ["a number among the decorators", ports("allow-decorators = [1]")],
    ["a decorator pattern with a hyphen", ports('allow-decorators = ["my-lib.record"]')],
    ["an unknown key", ports('allow-classes = ["Exception"]')],
    ["an empty modules", ports("modules = []")],
  ])("%s fails both", (_what, text) => {
    expect(parserError(text)).toBeDefined();
    expect(schemaErrors(text)).not.toEqual([]);
  });

  test("a valid table passes both", () => {
    const text = ports(`modules = ["shop.application.ports", "shop.*.ports"]
allow-bases = ["Exception", "*Error", "pydantic.BaseModel"]
extend-allow-bases = ["shop.domain.ValueObject"]
allow-decorators = ["dataclasses.dataclass", "attrs.*"]`);
    expect([parserError(text), schemaErrors(text)]).toEqual([undefined, []]);
  });

  test("empty lists pass both", () => {
    const text = ports("allow-bases = []\nextend-allow-bases = []\nallow-decorators = []");
    expect([parserError(text), schemaErrors(text)]).toEqual([undefined, []]);
  });
});
