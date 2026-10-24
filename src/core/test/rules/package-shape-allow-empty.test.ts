/**
 * @file INW007's dead-selector warning and `allow-empty` (#416): a shape
 * declared ahead of the code skips the warning for its own selectors, while
 * the other entries are still checked for typos. Kept beside
 * `package-shape.test.ts`, which covers the rest of the rule.
 */
import { describe, expect, test } from "bun:test";
import {
  ConfigError,
  checkSelectors,
  checkShape,
  packagesOf,
  parseConfig,
} from "../../src/index.ts";
import { file } from "../support/helpers.ts";

const BASE = `[tool.inwards]
root = "."
layers = [{ name = "app", modules = ["app"] }]

[[tool.inwards.shape]]
packages = ["app.*"]
allow = ["router", "service"]
forbid = ["conftest"]
`;
const PACKAGES = packagesOf(["app/orders/router.py"]);

/**
 * Runs the dead-selector check on a config text.
 *
 * @param text - the whole `[tool.inwards]` config.
 * @returns the INW007 warnings' messages.
 */
function deadSelectors(text: string): string[] {
  return checkSelectors(parseConfig(text), PACKAGES, { path: "pyproject.toml", text }).map(
    (d) => d.message,
  );
}

describe("INW007 allow-empty", () => {
  test("silences the dead-selector warning for its own entry only", () => {
    const text = `${BASE}
[[tool.inwards.shape]]
packages = ["lib.*.services", "lib.*.queries"]
allow = ["_*"]
allow-empty = true

[[tool.inwards.shape]]
packages = ["libs.*"]
`;
    expect(deadSelectors(text)).toEqual(['Shape selector "libs.*" matches no package.']);
  });

  test("false reports the dead selector, as leaving it out does", () => {
    const entry = '\n[[tool.inwards.shape]]\npackages = ["lib.*"]\n';
    const expected = ['Shape selector "lib.*" matches no package.'];
    expect(deadSelectors(`${BASE}${entry}`)).toEqual(expected);
    expect(deadSelectors(`${BASE}${entry}allow-empty = false\n`)).toEqual(expected);
  });

  test("the dead-selector fix points at allow-empty for a shape declared ahead of the code", () => {
    const text = BASE.replace('["app.*"]', '["app.*", "ap.*"]');
    const [found] = checkSelectors(parseConfig(text), PACKAGES, { path: "pyproject.toml", text });
    expect(found?.fix?.steps?.join("\n")).toContain("allow-empty = true");
  });

  test("doesn't change what a matching entry checks", () => {
    const parsed = parseConfig(BASE.replace("forbid", "allow-empty = true\nforbid"));
    expect(parsed.shape?.[0]?.allowEmpty).toBe(true);
    expect(parseConfig(BASE).shape?.[0]?.allowEmpty).toBeUndefined();
    const conftest = file("app/orders/conftest.py", "");
    expect(checkShape(conftest, parsed)).toHaveLength(1);
    expect(checkShape(conftest, parsed)).toEqual(checkShape(conftest, parseConfig(BASE)));
  });

  test("a value that isn't a boolean is a config error", () => {
    const text = `${BASE}allow-empty = "yes"\n`;
    expect(() => parseConfig(text)).toThrow(ConfigError);
    expect(() => parseConfig(text)).toThrow(
      "tool.inwards.shape[0].allow-empty must be true or false.",
    );
  });
});
