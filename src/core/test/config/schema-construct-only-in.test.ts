/**
 * @file Paired negative cases for INW015's options (#296) in the
 * `[tool.inwards]` JSON Schema, kept beside `schema-negatives.test.ts`. Each
 * structural mistake fails both the schema and the parser, and a valid table
 * passes both, so the two can't drift on `role` (required, non-empty) and
 * `allowed-in`.
 */
import { describe, expect, test } from "bun:test";
import { MINIMAL, parserError, schemaErrors } from "../support/config-schema.ts";

/**
 * Builds a config with INW015's options table.
 *
 * @param body - the table's body, TOML.
 * @returns the config text.
 */
function construct(body: string): string {
  return `${MINIMAL}[tool.inwards.rules.construct-only-in]\n${body}\n`;
}

describe("INW015's options", () => {
  test.each([
    ["a table without role", construct('allowed-in = ["shop.di"]')],
    ["an empty role", construct("role = []")],
    ["role that isn't a list", construct('role = "shop.adapters.outbound"')],
    ["a role selector that starts with a wildcard", construct('role = ["*.outbound"]')],
    ["a role number", construct("role = [1]")],
    ["an empty allowed-in", construct('role = ["shop.outbound"]\nallowed-in = []')],
    ["allowed-in that isn't a list", construct('role = ["shop.outbound"]\nallowed-in = "shop.di"')],
    ["an unknown key", construct('role = ["shop.outbound"]\nallowed = ["shop.di"]')],
  ])("%s fails both", (_what, text) => {
    expect(parserError(text)).toBeDefined();
    expect(schemaErrors(text)).not.toEqual([]);
  });

  test("a valid table passes both", () => {
    const text = construct(`role = ["shop.adapters.outbound", "shop.*.gateways"]
allowed-in = ["shop.di", "shop.main"]
modules = ["shop.adapters"]`);
    expect([parserError(text), schemaErrors(text)]).toEqual([undefined, []]);
  });

  test("role alone passes both", () => {
    const text = construct('role = ["shop.adapters.outbound"]');
    expect([parserError(text), schemaErrors(text)]).toEqual([undefined, []]);
  });

  test("the parser names the missing key", () => {
    expect(parserError(construct('allowed-in = ["shop.di"]'))).toContain(
      "tool.inwards.rules.construct-only-in.role must be set",
    );
  });
});
