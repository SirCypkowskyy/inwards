/**
 * @file Paired negative cases for INW013's options (#293) in the
 * `[tool.inwards]` JSON Schema, kept beside `schema-negatives.test.ts`. Each
 * structural mistake fails both the schema and the parser, and a valid table
 * passes both, so the two can't drift on `extend-blocking-calls` and
 * `extend-blocking-types`.
 */
import { describe, expect, test } from "bun:test";
import { MINIMAL, parserError, schemaErrors } from "../support/config-schema.ts";

/**
 * Builds a config with INW013's options table.
 *
 * @param body - the table's body, TOML.
 * @returns the config text.
 */
function blocking(body: string): string {
  return `${MINIMAL}[tool.inwards.rules.async-blocking]\n${body}\n`;
}

describe("INW013's options", () => {
  test.each([
    ["extend-blocking-calls that isn't a list", blocking('extend-blocking-calls = "shop.db.*"')],
    ["a call pattern with a space", blocking('extend-blocking-calls = ["shop. db"]')],
    ["an empty type segment", blocking('extend-blocking-types = ["shop..Client"]')],
    ["a type pattern with a colon", blocking('extend-blocking-types = ["shop.db:Client"]')],
    ["a number in the list", blocking("extend-blocking-types = [1]")],
    ["an unknown key", blocking('blocking-calls = ["shop.db.*"]')],
    ["an empty modules", blocking("modules = []")],
  ])("%s fails both", (_what, text) => {
    expect(parserError(text)).toBeDefined();
    expect(schemaErrors(text)).not.toEqual([]);
  });

  test("a valid table passes both", () => {
    const text = blocking(`modules = ["shop.api", "shop.*.service"]
extend-blocking-calls = ["shop.legacy.fetch_*", "ldap3.*"]
extend-blocking-types = ["shop.legacy.Client", "pymongo.MongoClient"]`);
    expect([parserError(text), schemaErrors(text)]).toEqual([undefined, []]);
  });
});
