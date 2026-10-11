/**
 * @file INW017 diagram-unknown-name: nodes of marked layers and contexts
 * diagrams that name no declared layer or context, quoted labels that match
 * no module, `:::external` nodes, links to subgraphs, unmarked blocks, the
 * `diagrams` entries that match no file, and the opt-in switch. The checks
 * go through `checkDiagrams`, the entry the CLI calls.
 */
import { describe, expect, test } from "bun:test";
import { checkDiagrams, type Diagnostic, parseConfig } from "../../src/index.ts";

const PYPROJECT = `
[tool.inwards]
diagrams = ["docs/architecture.md", "docs/*.mmd"]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "application", modules = ["shop.application"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
]

[[tool.inwards.contexts]]
name = "orders"
modules = ["shop.orders"]

[[tool.inwards.contexts]]
name = "billing"
modules = ["shop.billing"]

[tool.inwards.rules]
extend-select = ["INW017"]
`;

const MODULES = new Set([
  "shop.domain.order",
  "shop.application.place_order",
  "shop.infrastructure.db",
  "shop.orders.api",
  "shop.billing.invoices",
]);

/**
 * Checks one Markdown file holding the given Mermaid lines in a fenced block.
 *
 * @param mermaid - the block's lines, marker and header included.
 * @param pyproject - the config to check against.
 * @returns INW017's findings.
 */
function check(mermaid: readonly string[], pyproject = PYPROJECT): Diagnostic[] {
  const text = ["# Architecture", "", "```mermaid", ...mermaid, "```", ""].join("\n");
  return checkDiagrams(parseConfig(pyproject), {
    modules: MODULES,
    sources: [{ path: "docs/architecture.md", text }],
    unmatched: [],
    configFile: { path: "pyproject.toml", text: pyproject },
  });
}

/**
 * Summarises findings as `line:column message`.
 *
 * @param found - the findings.
 * @returns one string per finding.
 */
function where(found: readonly Diagnostic[]): string[] {
  return found.map((d) => `${d.line}:${d.column} ${d.message}`);
}

describe("INW017 diagram-unknown-name", () => {
  test("a layers diagram that matches the config gives nothing", () => {
    const lines = [
      "%% inwards: layers",
      "flowchart LR",
      '  infrastructure["shop.infrastructure"] --> application --> domain["shop.domain"]',
    ];
    expect(check(lines)).toEqual([]);
  });

  test("a node that names no layer is a warning on the diagram's own line, with the nearest layer", () => {
    const found = check([
      "%% inwards: layers",
      "flowchart LR",
      "  infra --> aplication --> domain",
    ]);
    expect(where(found)).toEqual([
      '6:3 Node "infra" in this layers diagram names no layer: the layers are "domain", "application" and "infrastructure".',
      '6:13 Node "aplication" in this layers diagram names no layer: the layers are "domain", "application" and "infrastructure".',
    ]);
    expect(found[0]).toMatchObject({
      code: "INW017",
      rule: "diagram-unknown-name",
      severity: "warning",
      file: "docs/architecture.md",
      module: "",
      endColumn: 8,
    });
    expect(found[0]?.fix.summary).toBe('Rename "infra" or mark it :::external.');
    expect(found[1]?.fix.summary).toBe('Rename "aplication" to "application".');
  });

  test("a node is reported once, at its first mention", () => {
    const found = check([
      "%% inwards: layers",
      "flowchart LR",
      "  web --> domain",
      "  web --> application",
    ]);
    expect(found.map((d) => d.line)).toEqual([6]);
  });

  test("a quoted label that matches no module is reported; a caption isn't", () => {
    const found = check([
      "%% inwards: layers",
      "flowchart LR",
      '  domain["shop.domian"] --> application["The use cases"]',
      '  infrastructure["shop.*.cache"]',
    ]);
    expect(where(found)).toEqual([
      '6:3 "domain" is labelled "shop.domian" in this layers diagram, and no module matches "shop.domian".',
      '7:3 "infrastructure" is labelled "shop.*.cache" in this layers diagram, and no module matches "shop.*.cache".',
    ]);
    expect(found[0]?.fix.summary).toBe('Change the label to "shop.domain".');
  });

  test("an unquoted label is a caption", () => {
    expect(check(["%% inwards: layers", "flowchart LR", "  domain[shop.nothing]"])).toEqual([]);
  });

  test(":::external and class statements skip a node", () => {
    const lines = [
      "%% inwards: layers",
      "flowchart LR",
      '  infrastructure --> db[("postgres")]:::external',
      "  infrastructure --> stripe",
      "  class stripe external",
    ];
    expect(check(lines)).toEqual([]);
  });

  test("in a contexts diagram, top-level subgraphs and nodes name contexts; inner nodes are free", () => {
    const found = check([
      "%% inwards: contexts",
      "flowchart LR",
      "  subgraph orders",
      '    api["shop.orders.api"]',
      "  end",
      "  subgraph shipping",
      '    labels["shop.shipping.labels"]',
      "  end",
      "  orders --> billing",
      "  shipping --> billing",
      "  payments --> billing",
    ]);
    expect(where(found)).toEqual([
      '9:12 Subgraph "shipping" in this contexts diagram names no context: the contexts are "orders" and "billing".',
      '10:5 "labels" is labelled "shop.shipping.labels" in this contexts diagram, and no module matches "shop.shipping.labels".',
      '14:3 Node "payments" in this contexts diagram names no context: the contexts are "orders" and "billing".',
    ]);
  });

  test("a contexts diagram without contexts in the config says so", () => {
    const pyproject = PYPROJECT.replace(/\[\[tool\.inwards\.contexts\]\][^[]*/gu, "");
    const [d] = check(["%% inwards: contexts", "graph", "  orders"], pyproject);
    expect(d?.message).toBe(
      'Node "orders" in this contexts diagram names no context: [tool.inwards] declares no contexts.',
    );
  });

  test("an unmarked diagram is not checked", () => {
    expect(check(["flowchart LR", "  start --> stop"])).toEqual([]);
  });

  test("a diagrams entry that matches no file is reported on the entry", () => {
    const found = checkDiagrams(parseConfig(PYPROJECT), {
      modules: MODULES,
      sources: [],
      unmatched: ["docs/*.mmd"],
      configFile: { path: "pyproject.toml", text: PYPROJECT },
    });
    expect(found).toMatchObject([
      {
        code: "INW017",
        file: "pyproject.toml",
        line: 3,
        column: 37,
        message: 'diagrams entry "docs/*.mmd" matches no file, so no diagram is checked for it.',
      },
    ]);
  });

  test("the rule is opt-in, and [tool.inwards.rules] can raise it to an error", () => {
    const lines = ["%% inwards: layers", "flowchart LR", "  web --> domain"];
    expect(check(lines, PYPROJECT.replace('extend-select = ["INW017"]', ""))).toEqual([]);
    const raised = PYPROJECT.replace(
      'extend-select = ["INW017"]',
      'extend-select = ["INW017"]\nseverity = { INW017 = "error" }',
    );
    expect(check(lines, raised).map((d) => d.severity)).toEqual(["error"]);
  });
});
