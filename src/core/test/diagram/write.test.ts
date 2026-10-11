/**
 * @file `writeDiagram` (#349): `[tool.inwards]` written as a marked Mermaid
 * or PlantUML diagram. Each case writes a config, checks that INW017 and
 * INW018 find nothing in the diagram against that config, and reads it back
 * with `draftDiagrams` to the same layers (ranks and siblings included) and
 * contexts; then the exact text of the common shapes, names that can't be
 * ids, and the notes for what a diagram can't show.
 */
import { describe, expect, test } from "bun:test";
import {
  checkDiagrams,
  type DiagramKind,
  type DiagramNotation,
  draftDiagrams,
  type InwardsConfig,
  parseConfig,
  writeDiagram,
} from "../../src/index.ts";

const NOTATIONS: readonly DiagramNotation[] = ["mermaid", "plantuml"];

/** Hexagonal with sibling adapters, and two contexts, one with public modules. */
const HEXAGONAL = `[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "application", modules = ["shop.application"] },
  [
    { name = "outbound", modules = ["shop.adapters.outbound"] },
    { name = "inbound", modules = ["shop.adapters.inbound"] },
  ],
  { name = "bootstrap", modules = ["shop.bootstrap"] },
]

[[tool.inwards.contexts]]
name = "orders"
modules = ["shop.orders"]
public = ["shop.orders.api", "=shop.orders"]

[[tool.inwards.contexts]]
name = "billing"
modules = ["shop.billing"]
depends-on = ["orders"]

[[tool.inwards.contexts]]
name = "order-history"
modules = ["shop.history"]
public = ["shop.history.read"]
depends-on = ["orders", "billing"]
`;

/** A template's layers, whose names (`slice.domain`) can't be node ids. */
const TEMPLATED = `[tool.inwards]
layers = [
  { name = "slice", modules = ["shop.*"], template = "slice" },
  { name = "main", modules = ["shop.main"] },
]

[tool.inwards.templates.slice]
roles = ["domain", "service | schemas", "router"]
`;

/** Modules that every label above matches. */
const MODULES = new Set([
  "shop.domain",
  "shop.application",
  "shop.adapters.outbound",
  "shop.adapters.inbound",
  "shop.bootstrap",
  "shop.orders",
  "shop.orders.api",
  "shop.billing",
  "shop.history",
  "shop.history.read",
  "shop.posts.domain",
  "shop.posts.service",
  "shop.posts.schemas",
  "shop.posts.router",
  "shop.main",
]);

/**
 * Checks a written diagram against the config it was written from.
 *
 * @param config - the parsed config.
 * @param text - the diagram, in a `.mmd` or `.puml` file.
 * @param notation - which file extension to give it.
 * @returns the codes INW017 and INW018 report.
 */
function findings(config: InwardsConfig, text: string, notation: DiagramNotation): string[] {
  const on: InwardsConfig = { ...config, rules: { extendSelect: ["INW017", "INW018"] } };
  return checkDiagrams(on, {
    modules: MODULES,
    sources: [{ path: notation === "mermaid" ? "a.mmd" : "a.puml", text }],
    unmatched: [],
    configFile: { path: "pyproject.toml", text: "" },
  }).map((d) => `${d.code} ${d.line}: ${d.message}`);
}

/**
 * Writes a diagram, checks it and reads it back.
 *
 * @param toml - the config.
 * @param kind - which diagram.
 * @param notation - which notation.
 * @returns the findings and the draft.
 */
function roundTrip(
  toml: string,
  kind: DiagramKind,
  notation: DiagramNotation,
): { findings: string[]; draft: ReturnType<typeof draftDiagrams>; notes: string[] } {
  const config = parseConfig(toml);
  const { text, notes } = writeDiagram(config, kind, notation);
  const path = notation === "mermaid" ? "a.mmd" : "a.puml";
  return {
    findings: findings(config, text, notation),
    draft: draftDiagrams({ path, text }),
    notes,
  };
}

describe("writeDiagram: round trip", () => {
  test.each([...NOTATIONS])("%s: layers keep their ranks and sibling groups", (notation) => {
    const { findings: found, draft, notes } = roundTrip(HEXAGONAL, "layers", notation);
    expect(found).toEqual([]);
    expect(notes).toEqual([]);
    expect(typeof draft === "string" ? draft : draft.layers).toEqual([
      [{ name: "domain", modules: ["shop.domain"] }],
      [{ name: "application", modules: ["shop.application"] }],
      [
        { name: "outbound", modules: ["shop.adapters.outbound"] },
        { name: "inbound", modules: ["shop.adapters.inbound"] },
      ],
      [{ name: "bootstrap", modules: ["shop.bootstrap"] }],
    ]);
  });

  test.each([...NOTATIONS])(
    "%s: contexts keep public, exact entries and depends-on",
    (notation) => {
      const { findings: found, draft } = roundTrip(HEXAGONAL, "contexts", notation);
      expect(found).toEqual([]);
      expect(typeof draft === "string" ? draft : draft.contexts).toEqual([
        {
          name: "orders",
          modules: ["shop.orders"],
          public: ["shop.orders.api", "=shop.orders"],
          dependsOn: [],
        },
        { name: "billing", modules: ["shop.billing"], public: [], dependsOn: ["orders"] },
        {
          name: "order-history",
          modules: ["shop.history"],
          public: ["shop.history.read"],
          dependsOn: ["billing", "orders"],
        },
      ]);
    },
  );

  test.each([...NOTATIONS])("%s: a template's layers are named by their module", (notation) => {
    const { findings: found, draft } = roundTrip(TEMPLATED, "layers", notation);
    expect(found).toEqual([]);
    expect(typeof draft === "string" ? draft : draft.layers).toEqual([
      [{ name: "slice_domain", modules: ["shop.*.domain"] }],
      [
        { name: "slice_service", modules: ["shop.*.service"] },
        { name: "slice_schemas", modules: ["shop.*.schemas"] },
      ],
      [{ name: "slice_router", modules: ["shop.*.router"] }],
      [{ name: "main", modules: ["shop.main"] }],
    ]);
  });

  test("the check still catches an arrow turned around in the written diagram", () => {
    const config = parseConfig(HEXAGONAL);
    const { text } = writeDiagram(config, "layers", "mermaid");
    const turned = text.replace("application --> domain", "domain --> application");
    expect(findings(config, turned, "mermaid").map((f) => f.slice(0, 10))).toEqual(["INW018 10:"]);
  });

  test("mermaid: a layer with two modules names both, one line each", () => {
    const toml = `[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "interface", modules = ["shop.application", "shop.bootstrap"] },
]
`;
    const { findings: found, draft, notes } = roundTrip(toml, "layers", "mermaid");
    expect([found, notes]).toEqual([[], []]);
    expect(typeof draft === "string" ? draft : draft.layers[1]).toEqual([
      { name: "interface", modules: ["shop.application", "shop.bootstrap"] },
    ]);
  });
});

describe("writeDiagram: text", () => {
  test("mermaid layers: marker, header, nodes outermost first, arrows one rank in", () => {
    const { text } = writeDiagram(parseConfig(HEXAGONAL), "layers", "mermaid");
    expect(text).toBe(
      [
        "%% inwards: layers",
        "flowchart TB",
        '  bootstrap["shop.bootstrap"]',
        '  outbound["shop.adapters.outbound"]',
        '  inbound["shop.adapters.inbound"]',
        '  application["shop.application"]',
        '  domain["shop.domain"]',
        "  bootstrap --> outbound & inbound",
        "  outbound & inbound --> application",
        "  application --> domain",
        "",
      ].join("\n"),
    );
  });

  test("plantuml contexts: packages around public components, a hyphenated name in brackets", () => {
    const { text } = writeDiagram(parseConfig(HEXAGONAL), "contexts", "plantuml");
    expect(text).toBe(
      [
        "@startuml",
        "' inwards: contexts",
        '  package "shop.orders" as orders {',
        "    [shop.orders.api] as orders_api <<public>>",
        "    [=shop.orders] as orders_orders <<public>>",
        "  }",
        "  [shop.billing] as billing",
        '  package [order-history] as "shop.history" {',
        "    [shop.history.read] as order_history_read <<public>>",
        "  }",
        "  billing --> orders",
        "  [order-history] --> orders",
        "  [order-history] --> billing",
        "@enduml",
        "",
      ].join("\n"),
    );
  });

  test("mermaid contexts: subgraphs, public nodes and depends-on joined with &", () => {
    const { text } = writeDiagram(parseConfig(HEXAGONAL), "contexts", "mermaid");
    expect(text).toBe(
      [
        "%% inwards: contexts",
        "flowchart LR",
        '  subgraph orders["shop.orders"]',
        '    orders_api["shop.orders.api"]:::public',
        '    orders_orders["=shop.orders"]:::public',
        "  end",
        '  billing["shop.billing"]',
        '  subgraph order-history["shop.history"]',
        '    order_history_read["shop.history.read"]:::public',
        "  end",
        "  billing --> orders",
        "  order-history --> orders & billing",
        "",
      ].join("\n"),
    );
  });
});

describe("writeDiagram: notes", () => {
  test("plantuml names one module per layer and says which, a keyword in brackets", () => {
    const config = parseConfig(`[tool.inwards]
layers = [{ name = "interface", modules = ["shop.api", "shop.cli"] }]
`);
    expect(writeDiagram(config, "layers", "plantuml")).toEqual({
      text: '@startuml\n\' inwards: layers\n  [interface] as "shop.api"\n@enduml\n',
      notes: [
        'Layer "interface" has 2 modules; a PlantUML component names one, so the diagram shows "shop.api" only.',
      ],
    });
  });

  test("a context with public modules and two modules shows the first", () => {
    const config = parseConfig(`[tool.inwards]
layers = [{ name = "app", modules = ["shop"] }]

[[tool.inwards.contexts]]
name = "orders"
modules = ["shop.orders", "shop.carts"]
public = ["shop.orders.api"]
`);
    expect(writeDiagram(config, "contexts", "mermaid").notes).toEqual([
      'Context "orders" has 2 modules; a subgraph names one, so the diagram shows "shop.orders" only.',
    ]);
  });

  test("a layer without modules is a node without a label; one that can't be an id gets a note", () => {
    const config = parseConfig(`[tool.inwards]
layers = [
  { name = "domain", modules = [] },
  { name = "web api", modules = [] },
]
`);
    expect(writeDiagram(config, "layers", "mermaid")).toEqual({
      text: "%% inwards: layers\nflowchart TB\n  web_api\n  domain\n  web_api --> domain\n",
      notes: [
        'Layer "web api" has no module and its name can\'t be a node id, so the diagram can\'t name it; INW017 reports node "web_api".',
      ],
    });
  });

  test("a layer named after a Mermaid keyword gets a note", () => {
    const config = parseConfig(`[tool.inwards]
layers = [
  { name = "class", modules = ["shop.domain"] },
  { name = "end", modules = ["shop.main"] },
]
`);
    expect(writeDiagram(config, "layers", "mermaid").notes).toEqual([
      'Layer "class" is a Mermaid keyword, so a node can\'t be named after it; rename it, or draw the diagram with --format plantuml.',
      'Layer "end" is a Mermaid keyword, so a node can\'t be named after it; rename it, or draw the diagram with --format plantuml.',
    ]);
    expect(writeDiagram(config, "layers", "plantuml").notes).toEqual([]);
  });

  test("a made-up id never takes a declared name", () => {
    const config = parseConfig(`[tool.inwards]
layers = [
  { name = "a_b", modules = ["shop.ab"] },
  { name = "a.b", modules = ["shop.dotted"] },
]
`);
    const { text } = writeDiagram(config, "layers", "mermaid");
    expect(text).toContain('a_b_2["shop.dotted"]');
    expect(findings(config, text, "mermaid").filter((f) => !f.includes("no module"))).toEqual([]);
  });
});
