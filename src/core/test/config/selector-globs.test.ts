/**
 * @file Globs inside one selector segment (#411): `app.*._*_store`, `test_?`,
 * `[!_]*`. It covers the grammar the parser and the JSON Schema accept and
 * reject for them, how they match and rank against `*` and literal entries,
 * how the directory walk and `filledFrom` treat them, and shape selectors
 * that use them. The grammar without globs lives in `layer-selector.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { entryReach, filledFrom, matchEntry } from "../../src/config/_layer-selector.ts";
import { ConfigError, checkPrefixes, checkShape, parseConfig } from "../../src/index.ts";
import { layerMembership } from "../../src/rules/shared/layer-ownership.ts";
import { MINIMAL, parserError, schemaErrors } from "../support/config-schema.ts";
import { file } from "../support/helpers.ts";

/**
 * Builds the text of a config with one layer per entry, named a, b, c...
 *
 * @param entries - one module entry per layer, innermost first.
 * @returns the TOML text.
 */
function layered(...entries: string[]): string {
  const tables = entries.map((m, i) => `{ name = "${"abc"[i] ?? "z"}", modules = ["${m}"] }`);
  return `[tool.inwards]\nlayers = [${tables.join(", ")}]\n`;
}

/**
 * Builds the text of a config with shape entries, one per selector.
 *
 * @param selectors - each shape's one package selector, in order.
 * @returns the TOML text.
 */
function shaped(...selectors: string[]): string {
  const shapes = selectors.map(
    (s) => `[[tool.inwards.shape]]\npackages = ["${s}"]\nallow = ["x"]\n`,
  );
  return `${layered("app")}${shapes.join("")}`;
}

describe("glob segment grammar", () => {
  test.each([
    "shop.dom*",
    "shop.*?",
    "shop.[ab].*",
    "app.*._*_store",
    "app.test_?",
    "app.[!_]*",
    "app.**.*_router",
  ])("%s is a valid selector", (selector) => {
    expect(parseConfig(layered(selector)).layers[0]?.modules).toEqual([selector]);
  });

  test.each([
    ["_*.domain", "start with a package name"],
    ["shop.[ab", 'segment "[ab" is not a valid glob'],
    ["shop.[z-a]*", 'segment "[z-a]*" is not a valid glob'],
    ["shop.a-*", 'segment "a-*" holds "-"'],
    ["shop.*.a b", 'segment "a b" is neither an identifier'],
  ])("%s is rejected: %s", (selector, reason) => {
    expect(() => parseConfig(layered(selector))).toThrow(ConfigError);
    expect(() => parseConfig(layered(selector))).toThrow(reason);
  });

  test.each([
    ["** inside a role segment", 'role = ["shop.*.a**_store"]'],
    ["an unclosed bracket in a role", 'role = ["shop.[ab"]'],
    ["punctuation in a glob segment", 'role = ["shop.a-*"]'],
    ["a glob as the first segment", 'role = ["sh*.domain"]'],
  ])("%s fails both the schema and the parser", (_, options) => {
    const text = `${MINIMAL}[tool.inwards.rules.construct-only-in]\n${options}\n`;
    expect(parserError(text)).toBeDefined();
    expect(schemaErrors(text)).not.toEqual([]);
  });

  test("** inside a shape selector segment fails both", () => {
    const text = `${MINIMAL}[[tool.inwards.shape]]\npackages = ["shop.a**"]\n`;
    expect(parserError(text)).toBeDefined();
    expect(schemaErrors(text)).not.toEqual([]);
  });

  test("a reversed range fails the parser only: the schema can't see it", () => {
    const text = layered("shop.[z-a]*");
    expect(parserError(text)).toBeDefined();
    expect(schemaErrors(text)).toEqual([]);
  });

  test("glob segments in layers, rule options and shapes pass both", () => {
    const text = `[tool.inwards]
layers = [{ name = "d", modules = ["app.*._*_store", "app.test_?", "app.[!_]*.domain", "app.**.*_router"] }]
[tool.inwards.rules.construct-only-in]
role = ["app.*._*_store"]
allowed-in = ["app.di_*"]
[[tool.inwards.shape]]
packages = ["app.*_svc", "*._*"]
`;
    expect([parserError(text), schemaErrors(text)]).toEqual([undefined, []]);
  });
});

describe("glob segment ownership", () => {
  test.each([
    [
      "a glob segment matches one segment by its name",
      ["app.*._*_store"],
      "app.runs._admission_store.sql",
      ["a", "app.*._*_store", "app.runs._admission_store"],
    ],
    [
      "a glob segment matches the whole segment",
      ["app.*._*_store"],
      "app.runs._admission_store_v2",
      undefined,
    ],
    ["a glob segment needs its name to fit", ["app.*._*_store"], "app.runs.store", undefined],
    [
      "a glob segment counts as the last named segment",
      ["app.*.*", "app.*._*_store"],
      "app.runs._admission_store",
      ["b", "app.*._*_store", "app.runs._admission_store"],
    ],
    [
      "a literal beats a glob segment: more literal segments",
      ["app.*._*_store", "app.runs._admission_store"],
      "app.runs._admission_store",
      ["b", "app.runs._admission_store", "app.runs._admission_store"],
    ],
  ] as const)("%s", (_, entries, module, want) => {
    const got = layerMembership(module, parseConfig(layered(...entries)).layers);
    expect(got && [got.layer.name, got.entry, got.slice]).toEqual(want && [...want]);
  });

  test.each([
    ["app.*._*_store", ["app", "runs"], "descend"],
    ["app.*._*_store", ["app", "runs", "_admission_store"], "match"],
    ["app.*._*_store", ["app", "runs", "service"], "prune"],
    ["app.**.test_?", ["app", "a", "b", "test_x"], "match"],
    ["app.[!_]*", ["app", "_private"], "prune"],
  ] as const)("the walk at %s on %j: %s", (selector, segments, want) => {
    expect(entryReach(selector, segments)).toBe(want);
  });

  test.each([
    ["src.*_svc.service", "src.posts_svc.router", "src.posts_svc.service"],
    ["src.*_svc.service", "src.posts.router", undefined],
    ["src.*._*_store", "src.posts.router", undefined],
  ] as const)("%s filled from %s: %s", (selector, module, want) => {
    expect(filledFrom(selector, module)).toBe(want);
  });
});

describe("glob segments in session slices", () => {
  test.each([
    ["app.*._*_store", "app.orders._run_store", 1],
    ["app.*.*", "app.orders._run_store", 1],
    ["app.orders._*_store", "app.orders._run_store.sql", 2],
    ["app.*_svc.domain", "app.orders_svc.domain.x", 3],
  ] as const)("%s on %s has a slice %d deep", (selector, module, want) => {
    expect(matchEntry(selector, module)?.slice).toBe(want);
  });

  test("deleting one store while another remains empties no slice", () => {
    const text = layered("app.*._*_store");
    const pyproject = { path: "pyproject.toml", text };
    const config = parseConfig(text);
    const before = new Set(["app", "app.orders._run_store", "app.orders._cache_store"]);
    const now = new Set(["app", "app.orders._cache_store"]);
    expect(checkPrefixes(config, now, pyproject, before)).toEqual([]);
  });

  test("deleting the last store kills the selector", () => {
    const text = layered("app.*._*_store");
    const pyproject = { path: "pyproject.toml", text };
    const before = new Set(["app", "app.orders._run_store"]);
    const found = checkPrefixes(parseConfig(text), new Set(["app"]), pyproject, before);
    expect(found.map((d) => d.code)).toEqual(["INW006"]);
  });
});

describe("glob segments in shape selectors", () => {
  test.each([
    ["a glob segment after an earlier *", ["app.*", "app.*_svc"], "first match wins"],
    ["the same glob segment twice", ["app.*_svc", "app.*_svc"], 'repeats "app.*_svc"'],
    [
      "a literal an earlier glob segment matches",
      ["app.*_svc", "app.orders_svc"],
      "already matches every package it does",
    ],
    ["an unclosed bracket", ["app.[ab"], 'segment "[ab" is not a valid glob'],
  ])("%s is a config error", (_, selectors, message) => {
    expect(() => parseConfig(shaped(...selectors))).toThrow(message);
  });

  test("glob segments that only overlap are fine, either way round", () => {
    expect(parseConfig(shaped("app.a?", "app.a*", "app.[ab]*")).shape).toHaveLength(3);
  });

  test("a glob segment selects the packages whose segment it matches", () => {
    const globbed = parseConfig(shaped("app.*_svc"));
    expect(checkShape(file("app/orders_svc/helpers.py", ""), globbed).map((d) => d.code)).toEqual([
      "INW007",
    ]);
    expect(checkShape(file("app/orders/helpers.py", ""), globbed)).toEqual([]);
  });
});
