/**
 * @file The options tables of FAPI001 and FAPI002 (#183): each rule takes its
 * own keys next to `modules`, validated per rule, so a key of one rule is an
 * error in the other's table, and a bad value names its key. Sorted keys keep
 * the parsed config stable for the Stop gate's comparison.
 */
import { describe, expect, test } from "bun:test";
import { ConfigError, parseConfig } from "../../../src/index.ts";

const LAYERS = '[tool.inwards]\nlayers = [{ name = "app", modules = ["app"] }]\n';

/**
 * Parses a config with one options table.
 *
 * @param table - the rule's name.
 * @param body - the table's body, TOML.
 * @returns the error message, or the parsed options as JSON.
 */
function parsed(table: string, body: string): string {
  try {
    const config = parseConfig(`${LAYERS}\n[tool.inwards.rules.${table}]\n${body}\n`);
    return JSON.stringify(config.rules?.options);
  } catch (error) {
    return error instanceof ConfigError ? error.message : "not a ConfigError";
  }
}

describe("FAPI options tables", () => {
  test("take each rule's own keys, sorted", () => {
    expect(
      parsed(
        "endpoint-metadata",
        'require-tags = true\nrequire-summary = "summary"\nrequire-status-code = ["post"]\nmodules = ["app"]',
      ),
    ).toBe(
      '{"endpoint-metadata":{"modules":["app"],"require-status-code":["post"],"require-summary":"summary","require-tags":true}}',
    );
    expect(parsed("undocumented-error-response", 'max-depth = 0\ncodes = "4xx-5xx"')).toBe(
      '{"undocumented-error-response":{"codes":"4xx-5xx","max-depth":0}}',
    );
  });

  test.each([
    [
      "endpoint-metadata",
      "max-depth = 1",
      "Unknown key tool.inwards.rules.endpoint-metadata.max-depth.",
    ],
    [
      "undocumented-error-response",
      "require-tags = true",
      "Unknown key tool.inwards.rules.undocumented-error-response.require-tags.",
    ],
    [
      "router-wiring",
      "require-tags = true",
      "Unknown key tool.inwards.rules.router-wiring.require-tags.",
    ],
    [
      "endpoint-metadata",
      "require-summary = true",
      'tool.inwards.rules.endpoint-metadata.require-summary must be one of "summary-or-docstring", "summary", false.',
    ],
    [
      "endpoint-metadata",
      'require-status-code = ["fetch"]',
      "tool.inwards.rules.endpoint-metadata.require-status-code must be a list of distinct entries from",
    ],
    [
      "endpoint-metadata",
      'require-response-fields = ["model", "model"]',
      "tool.inwards.rules.endpoint-metadata.require-response-fields must be a list of distinct entries",
    ],
    [
      "endpoint-metadata",
      'require-tags = "yes"',
      "tool.inwards.rules.endpoint-metadata.require-tags must be true or false.",
    ],
    [
      "undocumented-error-response",
      "max-depth = -1",
      "tool.inwards.rules.undocumented-error-response.max-depth must be an integer from 0 to 8.",
    ],
    [
      "undocumented-error-response",
      "max-depth = 1.5",
      "tool.inwards.rules.undocumented-error-response.max-depth must be an integer from 0 to 8.",
    ],
    [
      "undocumented-error-response",
      'codes = "5xx"',
      'tool.inwards.rules.undocumented-error-response.codes must be one of "4xx", "4xx-5xx".',
    ],
    [
      "undocumented-error-response",
      'explicit-422 = "warn"',
      'tool.inwards.rules.undocumented-error-response.explicit-422 must be one of "ignore", "report".',
    ],
  ])("[%s] %s is an error naming the key", (table, body, message) => {
    expect(parsed(table, body)).toStartWith(message);
  });
});
