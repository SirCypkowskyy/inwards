/**
 * @file Paired negative cases for INW012's options (#182) in the
 * `[tool.inwards]` JSON Schema, kept beside `schema-negatives.test.ts`. Each
 * structural mistake fails both the schema and the parser, and a valid table
 * passes both. Whether a `delegate-to` entry names a layer is a relation
 * between keys, so only the parser checks it.
 */
import { describe, expect, test } from "bun:test";
import { MINIMAL, parserError, schemaErrors } from "../support/config-schema.ts";

/**
 * Builds a config with an options table, INW012's by default.
 *
 * @param body - the table's body, TOML.
 * @param rule - the rule whose options table holds it.
 * @returns the config text.
 */
function thin(body: string, rule = "thin-endpoint"): string {
  return `${MINIMAL}[tool.inwards.rules.${rule}]\n${body}\n`;
}

describe("INW012's options", () => {
  test.each([
    ["a negative threshold", thin("max-statements = -1")],
    ["a threshold above 1000", thin("max-branches = 1001")],
    ["true as a threshold", thin("max-nesting = true")],
    ["a string flag", thin('allow-loops = "no"')],
    ["deny-calls that isn't a list", thin('deny-calls = "httpx.*"')],
    ["a call pattern with a space", thin('extend-deny-calls = ["http x"]')],
    ["an empty type segment", thin('deny-receiver-types = ["sqlalchemy..Session"]')],
    ["a dotted parameter name", thin('deny-receiver-params = ["db.session"]')],
    ["an empty delegate-to", thin("delegate-to = []")],
    ["a blank delegate-to entry", thin('delegate-to = [" "]')],
    ["a decorator with a slash", thin('decorators = ["app/http"]')],
    ["max-statements on another rule", thin("max-statements = 8", "layer-dependency")],
  ])("%s fails both", (_what, text) => {
    expect(parserError(text)).toBeDefined();
    expect(schemaErrors(text)).not.toEqual([]);
  });

  test("a valid table passes both", () => {
    const text = thin(`max-statements = 12
max-branches = false
max-nesting = 3
allow-loops = false
allow-comprehensions = true
deny-calls = ["httpx.*", "psycopg*.*"]
extend-deny-calls = ["shop.integrations.*"]
deny-receiver-types = ["sqlalchemy.orm.Session"]
deny-receiver-params = ["db"]
delegate-to = ["shop.application"]
decorators = ["shop.http.endpoint", "*.get"]`);
    expect([parserError(text), schemaErrors(text)]).toEqual([undefined, []]);
  });
});
