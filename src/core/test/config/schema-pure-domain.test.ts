/**
 * @file Paired negative cases for INW005's `deny` option (#219) in the
 * `[tool.inwards]` JSON Schema, kept beside `schema-negatives.test.ts`. Each
 * structural mistake fails both the schema and the parser, and a valid table
 * passes both.
 */
import { describe, expect, test } from "bun:test";
import { MINIMAL, parserError, schemaErrors } from "../support/config-schema.ts";

/**
 * Builds a config with a `deny` option, INW005's by default.
 *
 * @param value - the TOML value of `deny`.
 * @param rule - the rule whose options table holds it.
 * @returns the config text.
 */
function deny(value: string, rule = "pure-domain"): string {
  return `${MINIMAL}[tool.inwards.rules.${rule}]\ndeny = ${value}\n`;
}

describe("INW005's deny option", () => {
  test.each([
    ["a deny that isn't a list", deny("{}")],
    ["a deny entry without libraries", deny('[{ modules = ["shop.a"] }]')],
    ["a deny entry without modules", deny('[{ libraries = ["django"] }]')],
    ["a deny entry with no modules", deny('[{ modules = [], libraries = ["django"] }]')],
    ["a deny entry with no libraries", deny('[{ modules = ["shop.a"], libraries = [] }]')],
    ["a deny entry with a distribution name", deny('[{ modules = ["a"], libraries = ["a-b"] }]')],
    ["an unknown deny key", deny('[{ modules = ["a"], libraries = ["b"], layer = "a" }]')],
    ["deny on another rule", deny('[{ modules = ["a"], libraries = ["b"] }]', "layer-dependency")],
  ])("%s fails both", (_what, text) => {
    expect(parserError(text)).toBeDefined();
    expect(schemaErrors(text)).not.toEqual([]);
  });

  test("a valid table passes both", () => {
    const text = deny(
      '[{ modules = ["shop.a", "shop.*.jobs"], libraries = ["django", "http.client"] }]',
    );
    expect([parserError(text), schemaErrors(text)]).toEqual([undefined, []]);
  });
});
