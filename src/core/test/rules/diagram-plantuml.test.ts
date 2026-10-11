/**
 * @file INW017 and INW018 on PlantUML diagrams (#346): the same checks as on
 * Mermaid, read from `.puml` files and fenced `plantuml` blocks, with the
 * spans on the PlantUML line, arrows written right to left, `<<external>>`
 * and `<<public>>`, and fix hints written in PlantUML. The checks go through
 * `checkDiagrams`, the entry the CLI calls.
 */
import { describe, expect, test } from "bun:test";
import { checkDiagrams, type Diagnostic, parseConfig } from "../../src/index.ts";

const PYPROJECT = `
[tool.inwards]
diagrams = ["docs/architecture.puml"]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  [
    { name = "orders", modules = ["shop.orders"] },
    { name = "billing", modules = ["shop.billing"] },
  ],
  { name = "infrastructure", modules = ["shop.infrastructure"] },
]

[[tool.inwards.contexts]]
name = "sales"
modules = ["shop.sales"]
public = ["shop.sales.api"]
depends-on = ["catalog"]

[[tool.inwards.contexts]]
name = "catalog"
modules = ["shop.catalog"]
public = ["shop.catalog.api"]

[tool.inwards.rules]
extend-select = ["INW017", "INW018"]
`;

const MODULES = new Set([
  "shop.domain.order",
  "shop.orders.place",
  "shop.billing.invoice",
  "shop.infrastructure.db",
  "shop.sales.checkout",
  "shop.catalog.api",
  "shop.catalog.store",
]);

/**
 * Checks one file against the config.
 *
 * @param path - the file, whose extension picks how it is read.
 * @param lines - its lines.
 * @returns the findings of INW017 and INW018.
 */
function check(path: string, lines: readonly string[]): Diagnostic[] {
  return checkDiagrams(parseConfig(PYPROJECT), {
    modules: MODULES,
    sources: [{ path, text: lines.join("\n") }],
    unmatched: [],
    configFile: { path: "pyproject.toml", text: PYPROJECT },
  });
}

/**
 * Checks a `.puml` file holding one diagram with the given marker and body.
 *
 * @param kind - `layers` or `contexts`.
 * @param body - the statements, one per line, starting on line 3.
 * @returns the findings of INW017 and INW018.
 */
function puml(kind: string, body: readonly string[]): Diagnostic[] {
  return check("docs/architecture.puml", ["@startuml", `' inwards: ${kind}`, ...body, "@enduml"]);
}

/**
 * Summarises findings as `code line:column-endColumn message`.
 *
 * @param found - the findings.
 * @returns one string per finding.
 */
function where(found: readonly Diagnostic[]): string[] {
  return found.map((d) => `${d.code} ${d.line}:${d.column}-${d.endColumn} ${d.message}`);
}

describe("PlantUML layers diagrams", () => {
  test("a diagram that matches the config gives nothing", () => {
    const body = [
      "component [shop.infrastructure] as infrastructure",
      "[infrastructure] --> [orders]",
      "[infrastructure] -> [billing]",
      "[orders] -down-> [domain]",
      "[domain] <-- [billing]",
      "[domain] ..> [infrastructure] : events",
      "[infrastructure] --> [db]",
      "database Postgres as db <<external>>",
    ];
    expect(puml("layers", body)).toEqual([]);
  });

  test("an outward arrow is INW018, the same written either way round", () => {
    const found = puml("layers", [
      "[domain] --> [infrastructure]",
      "[infrastructure] <-- [domain]",
    ]);
    expect(where(found)).toEqual([
      'INW018 3:2-29 "domain --> infrastructure" draws an import [tool.inwards] forbids: "domain" is inner to "infrastructure", and an inner layer may not import an outer one.',
    ]);
    const reversed = puml("layers", ["[infrastructure] <-- [domain]"]);
    expect(where(reversed)).toEqual([
      'INW018 3:2-29 "domain --> infrastructure" draws an import [tool.inwards] forbids: "domain" is inner to "infrastructure", and an inner layer may not import an outer one.',
    ]);
    expect(found[0]?.fix.steps).toContain(
      "If the arrow shows a call at run time or a flow of data rather than an import, draw it dotted (..>), which INW018 doesn't read.",
    );
  });

  test("an unknown component is INW017, with a hint in PlantUML", () => {
    const found = puml("layers", ["component [infra]", "[shop.domian] as domain"]);
    expect(where(found)).toEqual([
      'INW017 3:12-17 Node "infra" in this layers diagram names no layer: the layers are "domain", "orders", "billing" and "infrastructure".',
      'INW017 4:18-24 "domain" is labelled "shop.domian" in this layers diagram, and no module matches "shop.domian".',
    ]);
    expect(found[0]?.fix.summary).toBe('Rename "infra" or mark it <<external>>.');
    expect(found[0]?.fix.steps[1]).toBe(
      "If it stands for something outside [tool.inwards] (a database, a third-party service), mark it [infra] <<external>>.",
    );
  });
});

describe("PlantUML contexts diagrams", () => {
  test("packages are contexts, and <<public>> marks a public module", () => {
    const body = [
      'package "shop.sales" as sales {',
      "  [shop.sales.checkout] as checkout",
      "}",
      'package "shop.catalog" as catalog {',
      "  [shop.catalog.api] as api <<public>>",
      "  [shop.catalog.store] as store",
      "}",
      "[checkout] --> [api]",
    ];
    expect(puml("contexts", body)).toEqual([]);
  });

  test("an arrow the config forbids, and an unknown package", () => {
    const found = puml("contexts", [
      "package catalog {",
      "  [shop.catalog.store] as store",
      "}",
      "package shipping {",
      "}",
      "[catalog] --> [sales]",
      "[sales] --> [store]",
    ]);
    expect(where(found)).toEqual([
      'INW017 6:9-17 Package "shipping" in this contexts diagram names no context: the contexts are "sales" and "catalog".',
      'INW018 8:2-21 "catalog --> sales" draws an import [tool.inwards] forbids: context "catalog" doesn\'t list "sales" in depends-on.',
      'INW018 9:2-19 "sales --> store" draws an import [tool.inwards] forbids: "shop.catalog.store" isn\'t one of the public modules of context "catalog".',
    ]);
  });
});

test("a Markdown file's PlantUML and Mermaid blocks are both checked", () => {
  const found = check("docs/architecture.md", [
    "```plantuml",
    "' inwards: layers",
    "[domain] --> [orders]",
    "```",
    "```mermaid",
    "%% inwards: layers",
    "flowchart TD",
    "  domain --> billing",
    "```",
  ]);
  expect(found.map((d) => `${d.code}:${d.line}`)).toEqual(["INW018:3", "INW018:8"]);
});
