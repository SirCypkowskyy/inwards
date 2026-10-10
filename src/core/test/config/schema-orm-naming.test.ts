/**
 * @file Paired negative cases for INW016's options (#297) in the
 * `[tool.inwards]` JSON Schema, kept beside `schema-negatives.test.ts`. Each
 * structural mistake fails both the schema and the parser, and a valid table
 * passes both, so the two can't drift on `table-name`, the suffixes,
 * `allow-tables` or `require-naming-convention`.
 */
import { describe, expect, test } from "bun:test";
import { MINIMAL, parserError, schemaErrors } from "../support/config-schema.ts";

/**
 * Builds a config with INW016's options table.
 *
 * @param body - the table's body, TOML.
 * @returns the config text.
 */
function naming(body: string): string {
  return `${MINIMAL}[tool.inwards.rules.orm-naming]\n${body}\n`;
}

describe("INW016's options", () => {
  test.each([
    ["an unknown table-name style", naming('table-name = "camel"')],
    ["table-name = true", naming("table-name = true")],
    ["an upper-case suffix", naming('datetime-suffix = "_AT"')],
    ["an empty suffix", naming('date-suffix = ""')],
    ["a suffix of true", naming("date-suffix = true")],
    ["a numeric suffix", naming("datetime-suffix = 1")],
    ["allow-tables that isn't a list", naming('allow-tables = "news"')],
    ["a blank allowed table", naming('allow-tables = [" "]')],
    ["require-naming-convention as a string", naming('require-naming-convention = "yes"')],
    ["an unknown key", naming('tables = "snake"')],
  ])("%s fails both", (_what, text) => {
    expect(parserError(text)).toBeDefined();
    expect(schemaErrors(text)).not.toEqual([]);
  });

  test("a valid table passes both", () => {
    const text = naming(`modules = ["shop.*.models"]
table-name = "snake"
datetime-suffix = "_ts"
date-suffix = false
allow-tables = ["news", "user_settings"]
require-naming-convention = false`);
    expect([parserError(text), schemaErrors(text)]).toEqual([undefined, []]);
  });
});
