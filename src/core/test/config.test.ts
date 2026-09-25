import { describe, expect, test } from "bun:test";
import { ConfigError, declaresInwards, parseConfig } from "../src/index.ts";

const NEWER = /requires Inwards 0\.2\.0 or newer; this is 0\.1\.0/u;
const MALFORMED = /must look like/u;

describe("config", () => {
  test("missing table is a clear error", () => {
    expect(() => parseConfig("[project]\nname='x'\n")).toThrow(ConfigError);
  });
});

describe("declaresInwards", () => {
  test.each([
    ["[tool.inwards]\nlayers = []\n", true],
    ["[ tool.inwards ]\nlayers = []\n", true],
    ['["tool"."inwards"]\nlayers = []\n', true],
    ["[tool.inwards\n", true],
    ["[project]\nname = 'x'\n", false],
    ["[tool.ruff]\n", false],
  ])("%j -> %p", (text, expected) => {
    expect(declaresInwards(text)).toBe(expected);
  });
});

/**
 * Builds a minimal config that requires a given Inwards version.
 *
 * @param v - the `required-version` value.
 * @returns the pyproject.toml text.
 */
function withVersion(v: string): string {
  return `[tool.inwards]\nrequired-version = "${v}"\nlayers = [{ name = "d", modules = ["d"] }]\n`;
}

describe("required-version", () => {
  test("an equal or older requirement passes", () => {
    expect(parseConfig(withVersion("0.1.0")).requiredVersion).toBe("0.1.0");
    expect(parseConfig(withVersion("0.0.0")).requiredVersion).toBe("0.0.0");
  });

  test("a newer requirement is a config error naming both versions", () => {
    expect(() => parseConfig(withVersion("0.2.0"))).toThrow(NEWER);
    expect(() => parseConfig(withVersion("1.0.0"))).toThrow(ConfigError);
  });

  test("a malformed requirement is a config error", () => {
    expect(() => parseConfig(withVersion(">=0.1"))).toThrow(MALFORMED);
  });
});

describe("config integrity (INW006)", () => {
  const layer = '{ name = "domain", modules = ["shop.domain"] }';
  test.each([
    [
      "an unknown table key",
      `[tool.inwards]\nlayer = []\nlayers = [${layer}]\n`,
      "tool.inwards.layer",
    ],
    [
      "an unknown layer key",
      '[tool.inwards]\nlayers = [{ name = "d", module = ["x"], modules = ["x"] }]\n',
      "tool.inwards.layers[0].module",
    ],
    [
      "a prefix in two layers",
      `[tool.inwards]\nlayers = [${layer}, { name = "app", modules = ["shop.domain"] }]\n`,
      '"shop.domain" is in two layers',
    ],
    [
      "an ignore that isn't a list",
      `[tool.inwards]\nignore = "tests"\nlayers = [${layer}]\n`,
      "ignore",
    ],
  ])("%s is a config error", (_, text, message) => {
    expect(() => parseConfig(text)).toThrow(message);
  });

  test("ignore is absent unless set", () => {
    expect(parseConfig(`[tool.inwards]\nlayers = [${layer}]\n`).ignore).toBeUndefined();
  });
});
