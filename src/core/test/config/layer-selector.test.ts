/**
 * @file Layer selectors (#191, ADR-034): the grammar `parseConfig` accepts and
 * rejects, and the truth table of which layer owns a module when literal
 * prefixes and selectors compete. The table here is the one in the
 * configuration guide; a change to either must change both.
 */
import { describe, expect, test } from "bun:test";
import { entryReach, matchEntry } from "../../src/config/layer-selector.ts";
import { ConfigError, layerIndexOf, layerPackages, parseConfig } from "../../src/index.ts";
import { layerMembership } from "../../src/rules/shared/layer-ownership.ts";

/**
 * Parses a config whose layers hold the given entries, one layer per list.
 *
 * @param layers - each layer's `modules`, innermost first; layers are named a, b, c...
 * @returns the parsed config.
 */
function config(...layers: string[][]): ReturnType<typeof parseConfig> {
  const rows = layers.map(
    (modules, i) =>
      `  { name = "${String.fromCharCode(97 + i)}", modules = [${modules.map((m) => `"${m}"`).join(", ")}] },`,
  );
  return parseConfig(`[tool.inwards]\nlayers = [\n${rows.join("\n")}\n]\n`);
}

describe("selector grammar", () => {
  test.each([
    "shop.*.domain",
    "shop.*",
    "shop.**",
    "shop.**.domain",
    "shop.**.domain.**",
    "shop.*.*",
    "shop.**.**",
    "_shop.*",
  ])("%s is a valid selector", (selector) => {
    expect(config([selector]).layers[0]?.modules).toEqual([selector]);
  });

  test.each([
    ["*", "start with a package name"],
    ["**", "start with a package name"],
    ["*.*", "start with a package name"],
    ["**.*", "start with a package name"],
    ["*.domain", "start with a package name"],
    ["shop.dom*", 'segment "dom*"'],
    ["shop.*?", 'segment "*?"'],
    ["shop.[ab].*", 'segment "[ab]"'],
    ["shop..*", "empty segment"],
    ["shop.*.", "empty segment"],
    [".shop.*", "empty segment"],
    ["shop/*/domain", 'segment "shop/*/domain"'],
    ["shop.***", 'segment "***"'],
  ])("%s is rejected: %s", (selector, reason) => {
    expect(() => config(["shop.domain"], [selector])).toThrow(ConfigError);
    expect(() => config(["shop.domain"], [selector])).toThrow(
      `tool.inwards.layers[1].modules[0]: "${selector}" is not a valid selector`,
    );
    expect(() => config([selector])).toThrow(reason);
  });

  test("literal entries keep the lenient validation, empty module lists included", () => {
    expect(config(["shop/domain", "shop..x", "1bad"], []).layers.map((l) => l.modules)).toEqual([
      ["shop/domain", "shop..x", "1bad"],
      [],
    ]);
  });

  test("a selector in two layers is rejected like a literal", () => {
    expect(() => config(["shop.*.domain"], ["shop.*.domain"])).toThrow(
      '"shop.*.domain" is in two layers, "a" and "b"',
    );
  });

  test("layerPackages names each entry's top-level package once", () => {
    expect(layerPackages(config(["shop.*.domain", "billing.domain"], ["shop.**"]))).toEqual([
      "shop",
      "billing",
    ]);
  });
});

/** One row of the truth table: layers, module, and the expected owner. */
type Row = [
  string,
  string[][],
  string,
  { layer: string; entry: string; prefix: string; slice: string } | undefined,
];

/** The truth table in `guides/configuration.md` ("Selectors"), row for row. */
const TABLE: Row[] = [
  // Literal prefixes: the module itself and its descendants, whole segments only.
  [
    "a literal owns itself",
    [["shop.domain"]],
    "shop.domain",
    { layer: "a", entry: "shop.domain", prefix: "shop.domain", slice: "shop.domain" },
  ],
  [
    "a literal owns descendants",
    [["shop.domain"]],
    "shop.domain.order",
    { layer: "a", entry: "shop.domain", prefix: "shop.domain", slice: "shop.domain" },
  ],
  ["a literal stops at a segment boundary", [["shop.domain"]], "shop.domainx", undefined],
  ["a literal doesn't own its parent", [["shop.domain"]], "shop", undefined],
  // Interior `*`: exactly one segment.
  [
    "an interior * matches one segment",
    [["shop.*.domain"]],
    "shop.orders.domain",
    {
      layer: "a",
      entry: "shop.*.domain",
      prefix: "shop.orders.domain",
      slice: "shop.orders.domain",
    },
  ],
  [
    "a selector owns its matches' descendants",
    [["shop.*.domain"]],
    "shop.orders.domain.order",
    {
      layer: "a",
      entry: "shop.*.domain",
      prefix: "shop.orders.domain",
      slice: "shop.orders.domain",
    },
  ],
  ["an interior * never matches two segments", [["shop.*.domain"]], "shop.a.b.domain", undefined],
  ["an interior * never matches zero segments", [["shop.*.domain"]], "shop.domain", undefined],
  ["a partial match owns nothing", [["shop.*.domain"]], "shop.orders", undefined],
  ["the anchor must match", [["shop.*.domain"]], "billing.orders.domain", undefined],
  // Trailing wildcards.
  ["a trailing * needs a segment", [["shop.*"]], "shop", undefined],
  [
    "a trailing * owns the segment and below",
    [["shop.*"]],
    "shop.orders.order",
    { layer: "a", entry: "shop.*", prefix: "shop.orders", slice: "shop" },
  ],
  [
    "a trailing ** matches as deep as the module goes",
    [["shop.**"]],
    "shop.orders.infra.db",
    { layer: "a", entry: "shop.**", prefix: "shop.orders.infra.db", slice: "shop" },
  ],
  // Interior and multiple `**`.
  [
    "an interior ** takes one or more segments",
    [["shop.**.domain"]],
    "shop.a.b.domain.order",
    { layer: "a", entry: "shop.**.domain", prefix: "shop.a.b.domain", slice: "shop.a.b.domain" },
  ],
  ["an interior ** takes at least one", [["shop.**.domain"]], "shop.domain", undefined],
  [
    "with several **, the deepest last literal counts",
    [["shop.**.domain.**"]],
    "shop.a.domain.b.domain.c",
    {
      layer: "a",
      entry: "shop.**.domain.**",
      prefix: "shop.a.domain.b.domain.c",
      slice: "shop.a.domain.b.domain",
    },
  ],
  // Competing entries: 1. deepest last literal, 2. deeper match, 3. more literals, 4. earlier layer.
  [
    "a literal subtree beats a broad ** that matches deeper",
    [["shop.orders.domain"], ["shop.**"]],
    "shop.orders.domain.order",
    {
      layer: "a",
      entry: "shop.orders.domain",
      prefix: "shop.orders.domain",
      slice: "shop.orders.domain",
    },
  ],
  [
    "the broad ** keeps the rest",
    [["shop.orders.domain"], ["shop.**"]],
    "shop.orders.api",
    { layer: "b", entry: "shop.**", prefix: "shop.orders.api", slice: "shop" },
  ],
  [
    "the deeper last literal wins across layers",
    [["shop.orders.*"], ["shop.*.domain"]],
    "shop.orders.domain.order",
    {
      layer: "b",
      entry: "shop.*.domain",
      prefix: "shop.orders.domain",
      slice: "shop.orders.domain",
    },
  ],
  [
    "on the same last literal, the deeper match wins",
    [["shop.orders.*"], ["shop.orders.*.*"]],
    "shop.orders.x.y",
    { layer: "b", entry: "shop.orders.*.*", prefix: "shop.orders.x.y", slice: "shop.orders" },
  ],
  [
    "on the same depth, more literal segments win",
    [["shop.*.domain"], ["shop.orders.domain"]],
    "shop.orders.domain.order",
    {
      layer: "b",
      entry: "shop.orders.domain",
      prefix: "shop.orders.domain",
      slice: "shop.orders.domain",
    },
  ],
  [
    "on a full tie, the earlier layer wins",
    [["shop.**.domain"], ["shop.*.domain"]],
    "shop.orders.domain",
    {
      layer: "a",
      entry: "shop.**.domain",
      prefix: "shop.orders.domain",
      slice: "shop.orders.domain",
    },
  ],
  [
    "literal prefixes alone: the longest wins",
    [["shop"], ["shop.domain"]],
    "shop.domain.order",
    { layer: "b", entry: "shop.domain", prefix: "shop.domain", slice: "shop.domain" },
  ],
  [
    "and the shorter keeps the rest",
    [["shop"], ["shop.domain"]],
    "shop.api",
    { layer: "a", entry: "shop", prefix: "shop", slice: "shop" },
  ],
];

describe("layer membership truth table", () => {
  test.each(TABLE)("%s", (_, layers, module, want) => {
    const { layers: parsed } = config(...layers);
    const got = layerMembership(module, parsed);
    expect(
      got && { layer: got.layer.name, entry: got.entry, prefix: got.prefix, slice: got.slice },
    ).toEqual(want);
    expect(layerIndexOf(module, parsed)).toBe(got?.index ?? -1);
  });
});

describe("matching internals", () => {
  test("matching work stays linear in the module's length", () => {
    const module = Array.from({ length: 400 }, () => "a").join(".");
    const selector = `a.${Array.from({ length: 40 }, () => "**").join(".")}.b`;
    const started = performance.now();
    expect(matchEntry(selector, module)).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(500);
  });

  test.each([
    ["shop.*.domain", ["shop"], "descend"],
    ["shop.*.domain", ["shop", "orders"], "descend"],
    ["shop.*.domain", ["shop", "orders", "domain"], "match"],
    ["shop.*.domain", ["shop", "orders", "domain", "x"], "prune"],
    ["shop.*.domain", ["billing"], "prune"],
    ["shop.**.domain", ["shop", "a", "b"], "descend"],
    ["shop.**", ["shop", "a", "b"], "match"],
  ] as const)("%s at %j: %s", (selector, segments, want) => {
    expect(entryReach(selector, segments)).toBe(want);
  });
});
