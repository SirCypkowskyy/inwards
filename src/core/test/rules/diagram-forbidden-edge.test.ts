/**
 * @file INW018 diagram-forbidden-edge: solid arrows in marked diagrams that
 * draw an import `[tool.inwards]` forbids. Layers: outward and sibling edges.
 * Contexts: a missing `depends-on` and an arrow into a module that isn't
 * `public`. Also what it leaves alone (dotted links, `:::external`, unknown
 * names, edges inside one context), names that can't be Mermaid ids, and
 * the opt-in switch. The checks go through `checkDiagrams`.
 */
import { describe, expect, test } from "bun:test";
import { checkDiagrams, type Diagnostic, parseConfig } from "../../src/index.ts";

const PYPROJECT = `
[tool.inwards]
diagrams = ["docs/architecture.md"]
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
extend-select = ["INW018"]
`;

/**
 * Checks one Markdown file holding the given Mermaid lines in a fenced block.
 *
 * @param mermaid - the block's lines, marker and header included.
 * @param pyproject - the config to check against.
 * @returns the findings of the diagram rules that are on.
 */
function check(mermaid: readonly string[], pyproject = PYPROJECT): Diagnostic[] {
  const text = ["# Architecture", "", "```mermaid", ...mermaid, "```", ""].join("\n");
  return checkDiagrams(parseConfig(pyproject), {
    modules: new Set(["shop.domain.x", "shop.adapters.x"]),
    sources: [{ path: "docs/architecture.md", text }],
    unmatched: [],
    configFile: { path: "pyproject.toml", text: pyproject },
  });
}

/**
 * Summarises findings as `line:column-endColumn message`.
 *
 * @param found - the findings.
 * @returns one string per finding.
 */
function where(found: readonly Diagnostic[]): string[] {
  return found.map((d) => `${d.line}:${d.column}-${d.endColumn} ${d.message}`);
}

describe("INW018 diagram-forbidden-edge: layers", () => {
  test("arrows that point inward give nothing, across ranks too", () => {
    const lines = [
      "%% inwards: layers",
      "flowchart TD",
      "  infrastructure --> orders & billing --> domain",
      "  infrastructure --> domain",
    ];
    expect(check(lines)).toEqual([]);
  });

  test("an outward arrow is a warning on the diagram's line, from the first node to the last", () => {
    const found = check(["%% inwards: layers", "flowchart TD", "  domain --> infrastructure"]);
    expect(where(found)).toEqual([
      '6:3-28 "domain --> infrastructure" draws an import [tool.inwards] forbids: "domain" is inner to "infrastructure", and an inner layer may not import an outer one.',
    ]);
    expect(found[0]).toMatchObject({
      code: "INW018",
      rule: "diagram-forbidden-edge",
      severity: "warning",
      file: "docs/architecture.md",
      module: "",
    });
    expect(found[0]?.fix.summary).toBe(
      'Turn the arrow around or remove it: "infrastructure --> domain" is the direction [tool.inwards] allows.',
    );
  });

  test("an arrow between sibling layers is a warning", () => {
    const found = check(["%% inwards: layers", "flowchart TD", "  orders --> billing"]);
    expect(where(found)).toEqual([
      '6:3-21 "orders --> billing" draws an import [tool.inwards] forbids: "orders" and "billing" are sibling layers, which may not import each other.',
    ]);
    expect(found[0]?.fix.summary).toBe("Remove the arrow: sibling layers don't import each other.");
  });

  test("each forbidden pair is reported once, at its first arrow", () => {
    const found = check([
      "%% inwards: layers",
      "flowchart TD",
      "  domain --> orders",
      "  domain --> orders",
    ]);
    expect(found.map((d) => d.line)).toEqual([6]);
  });

  test("dotted, open and two-way links, :::external nodes and unknown names are left alone", () => {
    const lines = [
      "%% inwards: layers",
      "flowchart TD",
      "  domain -.-> infrastructure",
      "  domain --- infrastructure",
      "  domain <--> infrastructure",
      "  domain --> db[(Postgres)]:::external",
      "  domain --> nowhere",
    ];
    expect(check(lines)).toEqual([]);
  });

  test("a layer whose name isn't a Mermaid id is named by its quoted label", () => {
    const pyproject = `
[tool.inwards]
layers = [
  { name = "core.domain", modules = ["shop.domain"] },
  { name = "core.adapters", modules = ["shop.adapters"] },
]
[tool.inwards.rules]
extend-select = ["INW017", "INW018"]
`;
    const ok = check(
      ["%% inwards: layers", "flowchart TD", '  a["shop.adapters"] --> d["shop.domain"]'],
      pyproject,
    );
    expect(ok).toEqual([]);
    const found = check(
      ["%% inwards: layers", "flowchart TD", '  d["shop.domain"] --> a["shop.adapters"]'],
      pyproject,
    );
    expect(found.map((d) => d.code)).toEqual(["INW018"]);
    expect(found[0]?.message).toContain('"core.domain" is inner to "core.adapters"');
  });

  test("off by default, and [tool.inwards.rules] sets its severity", () => {
    const lines = ["%% inwards: layers", "flowchart TD", "  domain --> infrastructure"];
    expect(check(lines, PYPROJECT.replace('extend-select = ["INW018"]', ""))).toEqual([]);
    const raised = check(
      lines,
      PYPROJECT.replace(
        'extend-select = ["INW018"]',
        'extend-select = ["INW018"]\nseverity = { INW018 = "error" }',
      ),
    );
    expect(raised.map((d) => d.severity)).toEqual(["error"]);
  });
});

describe("INW018 diagram-forbidden-edge: contexts", () => {
  test("an arrow along depends-on into a public module gives nothing", () => {
    const lines = [
      "%% inwards: contexts",
      "flowchart LR",
      "  subgraph sales",
      '    checkout["shop.sales.checkout"]',
      "  end",
      "  subgraph catalog",
      '    api["shop.catalog.api"]:::public',
      '    store["shop.catalog.store"]',
      "    api --> store",
      "  end",
      "  checkout --> api",
      "  sales --> catalog",
    ];
    expect(check(lines)).toEqual([]);
  });

  test("an arrow between contexts that depends-on doesn't list is a warning", () => {
    const found = check([
      "%% inwards: contexts",
      "flowchart LR",
      "  subgraph sales",
      "    checkout",
      "  end",
      "  subgraph catalog",
      "    api",
      "  end",
      "  api --> checkout",
      "  catalog --> sales",
    ]);
    expect(where(found)).toEqual([
      '12:3-19 "api --> checkout" draws an import [tool.inwards] forbids: context "catalog" doesn\'t list "sales" in depends-on.',
    ]);
    expect(found[0]?.fix.summary).toBe(
      'Remove the arrow, or ask the user to add "sales" to the depends-on of "catalog".',
    );
  });

  test("top-level context nodes count as their contexts", () => {
    const found = check(["%% inwards: contexts", "flowchart LR", "  catalog --> sales"]);
    expect(found.map((d) => d.code)).toEqual(["INW018"]);
  });

  test("an arrow into a module of another context that isn't public is a warning", () => {
    const found = check([
      "%% inwards: contexts",
      "flowchart LR",
      "  subgraph sales",
      "    checkout",
      "  end",
      "  subgraph catalog",
      '    store["shop.catalog.store"]',
      "  end",
      "  checkout --> store",
    ]);
    expect(where(found)).toEqual([
      '12:3-21 "checkout --> store" draws an import [tool.inwards] forbids: "shop.catalog.store" isn\'t one of the public modules of context "catalog".',
    ]);
    expect(found[0]?.fix.summary).toBe(
      'Point the arrow at a public module of "catalog": "shop.catalog.api".',
    );
  });

  test("arrows inside one context, and into an unlabelled node, are left alone", () => {
    const lines = [
      "%% inwards: contexts",
      "flowchart LR",
      "  subgraph sales",
      '    checkout["shop.sales.checkout"] --> cart["shop.sales.cart"]',
      "  end",
      "  subgraph catalog",
      "    store",
      "  end",
      "  checkout --> store",
    ];
    expect(check(lines)).toEqual([]);
  });
});
