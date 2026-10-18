/**
 * @file Paired negative cases for INW020's options (#433) in the
 * `[tool.inwards]` JSON Schema, kept beside `schema-negatives.test.ts`. Each
 * structural mistake fails both the schema and the parser, and a valid table
 * passes both, so the two can't drift on `ports`, `allow-bases`,
 * `extend-allow-bases`, `allow-decorators` or `check-tests`.
 */
import { describe, expect, test } from "bun:test";
import { MINIMAL, parserError, schemaErrors } from "../support/config-schema.ts";

/**
 * Builds a config with INW020's options table.
 *
 * @param body - the table's body, TOML.
 * @returns the config text.
 */
function conformance(body: string): string {
  return `${MINIMAL}[tool.inwards.rules.adapter-conformance]\n${body}\n`;
}

describe("INW020's options", () => {
  test.each([
    ["ports that isn't a list", conformance('ports = "shop.ports"')],
    ["an empty ports", conformance("ports = []")],
    ["a number among the ports", conformance("ports = [1]")],
    ["a base pattern with a colon", conformance('allow-bases = ["shop.dto:Base"]')],
    ["an empty base segment", conformance('extend-allow-bases = ["shop..Base"]')],
    ["a number among the decorators", conformance("allow-decorators = [1]")],
    ["check-tests that isn't a boolean", conformance('check-tests = "yes"')],
    ["an unknown key", conformance('port = ["shop.ports"]')],
    ["an empty modules", conformance("modules = []")],
  ])("%s fails both", (_what, text) => {
    expect(parserError(text)).toBeDefined();
    expect(schemaErrors(text)).not.toEqual([]);
  });

  test("a valid table passes both", () => {
    const text = conformance(`modules = ["shop.adapters.outbound", "shop.*.adapters"]
ports = ["shop.application.ports"]
allow-bases = ["Exception", "*Error", "pydantic.BaseModel"]
extend-allow-bases = ["shop.kit.Schema"]
allow-decorators = ["dataclasses.dataclass", "attrs.*"]
check-tests = true`);
    expect([parserError(text), schemaErrors(text)]).toEqual([undefined, []]);
  });

  test("empty pattern lists pass both", () => {
    const text = conformance("allow-bases = []\nextend-allow-bases = []\nallow-decorators = []");
    expect([parserError(text), schemaErrors(text)]).toEqual([undefined, []]);
  });
});
