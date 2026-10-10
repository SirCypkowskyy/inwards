/**
 * @file INW012's options table (#182), `[tool.inwards.rules.thin-endpoint]`:
 * the thresholds, flags, call and type lists, `delegate-to` and `decorators`
 * are parsed into the rule's options, each bad value is a config error that
 * names the key, and a `delegate-to` entry that names no layer must be a
 * module prefix or selector. What each option does to the findings is tested
 * with the rule.
 */
import { describe, expect, test } from "bun:test";
import { ConfigError, parseConfig } from "../../src/index.ts";

const LAYERS = `[tool.inwards]
layers = [
  { name = "application", modules = ["shop.application"] },
  { name = "http-api", modules = ["shop.api"] },
]
`;

/**
 * Builds a config with an INW012 options table.
 *
 * @param body - the table's body, TOML.
 * @returns the config text.
 */
function table(body: string): string {
  return `${LAYERS}\n[tool.inwards.rules.thin-endpoint]\n${body}\n`;
}

describe("[tool.inwards.rules.thin-endpoint]", () => {
  test("are parsed with their values as written", () => {
    const { rules } = parseConfig(
      table(`max-statements = 8
max-branches = false
max-nesting = 0
allow-loops = true
allow-comprehensions = false
deny-calls = ["httpx.*", "psycopg*.*"]
extend-deny-calls = ["shop.integrations.stripe.*"]
deny-receiver-types = ["sqlalchemy.orm.Session"]
deny-receiver-params = ["db", "session"]
delegate-to = ["application", "http-api", "shop.*.service"]
decorators = ["shop.http.endpoint", "*.get"]
frameworks = ["flask", "django"]
base-classes = ["shop.http.Resource", "*.BaseView"]`),
    );
    expect(rules?.options?.["thin-endpoint"]).toEqual({
      "allow-comprehensions": false,
      "allow-loops": true,
      "base-classes": ["shop.http.Resource", "*.BaseView"],
      decorators: ["shop.http.endpoint", "*.get"],
      "delegate-to": ["application", "http-api", "shop.*.service"],
      "deny-calls": ["httpx.*", "psycopg*.*"],
      "deny-receiver-params": ["db", "session"],
      "deny-receiver-types": ["sqlalchemy.orm.Session"],
      "extend-deny-calls": ["shop.integrations.stripe.*"],
      frameworks: ["flask", "django"],
      "max-branches": false,
      "max-nesting": 0,
      "max-statements": 8,
    });
  });

  test.each([
    ["max-statements = -1", "max-statements must be an integer from 0 to 1000, or false"],
    ["max-branches = true", "max-branches must be an integer from 0 to 1000, or false"],
    ["max-nesting = 1.5", "max-nesting must be an integer from 0 to 1000, or false"],
    ['allow-loops = "yes"', "allow-loops must be true or false"],
    ['deny-calls = ["http x"]', "deny-calls must be a list of qualified names"],
    ['extend-deny-calls = "httpx.*"', "extend-deny-calls must be a list of qualified names"],
    ['deny-receiver-types = ["a..b"]', "deny-receiver-types must be a list of qualified names"],
    [
      'deny-receiver-params = ["db.session"]',
      "deny-receiver-params must be a list of parameter names",
    ],
    ["delegate-to = []", "delegate-to must be a non-empty list of layer names"],
    ['delegate-to = ["  "]', "delegate-to must be a non-empty list of layer names"],
    [
      'delegate-to = ["no-such-layer"]',
      '"no-such-layer" is not a layer name, module prefix or selector',
    ],
    ['delegate-to = ["*.service"]', '"*.service" is not a layer name, module prefix or selector'],
    ['decorators = ["@endpoint"]', "decorators must be a list of qualified names"],
    ['frameworks = ["bottle"]', "frameworks must be a list of distinct entries from"],
    ['frameworks = ["flask", "flask"]', "frameworks must be a list of distinct entries from"],
    ['frameworks = "flask"', "frameworks must be a list of distinct entries from"],
    ['base-classes = ["shop/http"]', "base-classes must be a list of qualified names"],
  ])("%s is a config error naming the key", (body, message) => {
    expect(() => parseConfig(table(body))).toThrow(ConfigError);
    expect(() => parseConfig(table(body))).toThrow(message);
  });

  test("its keys belong to its own table only", () => {
    const text = `${LAYERS}\n[tool.inwards.rules.layer-dependency]\nmax-statements = 8\n`;
    expect(() => parseConfig(text)).toThrow(
      "Unknown key tool.inwards.rules.layer-dependency.max-statements. Known keys: modules.",
    );
  });
});
