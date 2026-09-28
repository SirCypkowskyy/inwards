/**
 * @file Parsing `[tool.inwards]`: accepted and rejected tables, `declaresInwards`,
 * `required-version`, and the config integrity checks INW006 reports. Every
 * rejection must name the key that caused it.
 */
import { describe, expect, test } from "bun:test";
import { ConfigError, declaresInwards, parseConfig, VERSION } from "../../src/index.ts";

/** This release without a pre-release suffix, and a version always newer (built so a release PR's bump can't break the tests). */
const CURRENT = VERSION.replace(/-.*$/u, "");
const LATER = `${Number(CURRENT.split(".")[0]) + 1}.0.0`;
const NEWER = new RegExp(
  `requires Inwards ${LATER} or newer; this is ${VERSION}`.replaceAll(".", "\\."),
  "u",
);
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
    expect(parseConfig(withVersion(CURRENT)).requiredVersion).toBe(CURRENT);
    expect(parseConfig(withVersion("0.0.0")).requiredVersion).toBe("0.0.0");
  });

  test("a newer requirement is a config error naming both versions", () => {
    expect(() => parseConfig(withVersion(LATER))).toThrow(NEWER);
    expect(() => parseConfig(withVersion(`${LATER.split(".")[0]}.1.0`))).toThrow(ConfigError);
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
      "an unknown stop-gate mode",
      `[tool.inwards]\nstop-gate = "all"\nlayers = [${layer}]\n`,
      'stop-gate must be "changed" or "project"',
    ],
    [
      "cycles that isn't a list",
      `[tool.inwards]\ncycles = "modules"\nlayers = [${layer}]\n`,
      'tool.inwards.cycles must be a list of "modules" and "contexts"',
    ],
    [
      "an unknown cycle mode",
      `[tool.inwards]\ncycles = ["loops"]\nlayers = [${layer}]\n`,
      'tool.inwards.cycles[0] must be "modules" or "contexts"',
    ],
    [
      "a repeated cycle mode",
      `[tool.inwards]\ncycles = ["modules", "modules"]\nlayers = [${layer}]\n`,
      'tool.inwards.cycles[1] repeats "modules"',
    ],
    [
      "an ignore that isn't a list",
      `[tool.inwards]\nignore = "tests"\nlayers = [${layer}]\n`,
      "ignore",
    ],
  ])("%s is a config error", (_, text, message) => {
    expect(() => parseConfig(text)).toThrow(message);
  });

  test("stop-gate is read when set and absent otherwise", () => {
    const text = `[tool.inwards]\nstop-gate = "project"\nlayers = [${layer}]\n`;
    expect(parseConfig(text).stopGate).toBe("project");
    expect(parseConfig(`[tool.inwards]\nlayers = [${layer}]\n`).stopGate).toBeUndefined();
    expect(
      parseConfig(`[tool.inwards]\ncycles = ["modules", "contexts"]\nlayers = [${layer}]\n`).cycles,
    ).toEqual(["modules", "contexts"]);
    expect(parseConfig(`[tool.inwards]\ncycles = []\nlayers = [${layer}]\n`).cycles).toEqual([]);
  });

  test("ignore is absent unless set", () => {
    expect(parseConfig(`[tool.inwards]\nlayers = [${layer}]\n`).ignore).toBeUndefined();
  });
});
