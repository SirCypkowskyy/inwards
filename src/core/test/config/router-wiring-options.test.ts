/**
 * @file FAPI003's options table (#184), `[tool.inwards.rules.router-wiring]`:
 * `entrypoints`, `allow-unmounted`, `unresolved-includes` and `check-order`
 * are parsed into the rule's options, each bad value is a config error that
 * names the key, and no other rule's table accepts them. What each option
 * does to the findings is tested with the rule.
 */
import { describe, expect, test } from "bun:test";
import { ConfigError, parseConfig } from "../../src/index.ts";

describe("[tool.inwards.rules.router-wiring]", () => {
  const Layer = '[tool.inwards]\nlayers = [{ name = "app", modules = ["app"] }]\n';

  test("are parsed from [tool.inwards.rules.router-wiring]", () => {
    const { rules } = parseConfig(
      `${Layer}\n[tool.inwards.rules.router-wiring]\nentrypoints = ["app.main:app"]\nallow-unmounted = ["app.*.experimental"]\nunresolved-includes = "silent"\ncheck-order = false\n`,
    );
    expect(rules?.options?.["router-wiring"]).toEqual({
      entrypoints: ["app.main:app"],
      allowUnmounted: ["app.*.experimental"],
      unresolvedIncludes: "silent",
      checkOrder: false,
    });
  });

  test.each([
    ['entrypoints = ["app.main"]', 'entrypoints must be a non-empty list of "module:name" entries'],
    [
      'entrypoints = "app.main:app"',
      'entrypoints must be a non-empty list of "module:name" entries',
    ],
    ['allow-unmounted = ["*.x"]', "it must start with a package name"],
    ['unresolved-includes = "error"', 'unresolved-includes must be "warn" or "silent"'],
    ["check-order = 1", "check-order must be true or false"],
  ])("%s is a config error naming the key", (body, message) => {
    const text = `${Layer}\n[tool.inwards.rules.router-wiring]\n${body}\n`;
    expect(() => parseConfig(text)).toThrow(ConfigError);
    expect(() => parseConfig(text)).toThrow(message);
  });

  test("its keys belong to its own table only", () => {
    const text = `${Layer}\n[tool.inwards.rules.layer-dependency]\ncheck-order = false\n`;
    expect(() => parseConfig(text)).toThrow(
      "Unknown key tool.inwards.rules.layer-dependency.check-order. Known keys: modules.",
    );
  });
});
