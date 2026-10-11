/**
 * @file What `inwards import-diagram` reads out of a marked diagram
 * (`draftDiagrams`): layer ranks as the longest path to a sink, siblings,
 * cycles, labels as modules, and contexts with `depends-on` and `public`;
 * plus the refusals. Rendering and writing the table are the CLI's.
 */
import { describe, expect, test } from "bun:test";
import { draftDiagrams } from "../../src/index.ts";

/**
 * Drafts the config one `.mmd` file stands for.
 *
 * @param lines - the file's lines.
 * @returns the draft, or why there is none.
 */
function draft(lines: readonly string[]): ReturnType<typeof draftDiagrams> {
  return draftDiagrams({ path: "docs/architecture.mmd", text: lines.join("\n") });
}

describe("draftDiagrams: layers", () => {
  test("a rank is the longest path to a sink, and same-rank layers are siblings", () => {
    const found = draft([
      "%% inwards: layers",
      "flowchart TD",
      '  api["shop.api"] --> orders["shop.orders"] & billing["shop.billing"]',
      '  orders --> domain["shop.domain"]',
      "  billing --> domain",
      "  api --> domain",
      "  api --> db[(Postgres)]:::external",
    ]);
    expect(found).toEqual({
      layers: [
        [{ name: "domain", modules: ["shop.domain"] }],
        [
          { name: "orders", modules: ["shop.orders"] },
          { name: "billing", modules: ["shop.billing"] },
        ],
        [{ name: "api", modules: ["shop.api"] }],
      ],
      contexts: [],
      notes: [],
    });
  });

  test("an unconnected layer is a sink, a sibling of the innermost", () => {
    const found = draft(["%% inwards: layers", "flowchart TD", "  a --> b", "  c"]);
    expect(
      typeof found === "string" ? found : found.layers.map((p) => p.map((l) => l.name)),
    ).toEqual([["b", "c"], ["a"]]);
  });

  test("a node without a quoted label gets no modules, and a note", () => {
    const found = draft(["%% inwards: layers", "flowchart TD", '  app --> domain["shop domain"]']);
    expect(typeof found === "string" ? found : found.notes).toEqual([
      'Layer "domain" has no module: give its node a quoted label such as domain["mypackage.domain"], or fill in its modules by hand.',
      'Layer "app" has no module: give its node a quoted label such as app["mypackage.app"], or fill in its modules by hand.',
    ]);
  });

  test("dotted links don't order layers", () => {
    const found = draft(["%% inwards: layers", "flowchart TD", "  a -.-> b"]);
    expect(
      typeof found === "string" ? found : found.layers.map((p) => p.map((l) => l.name)),
    ).toEqual([["a", "b"]]);
  });

  test("a cycle is refused, naming it", () => {
    expect(draft(["%% inwards: layers", "flowchart TD", "  a --> b --> c --> a"])).toBe(
      "docs/architecture.mmd:3: the layers diagram has a cycle, a --> b --> c --> a, so the layers have no order.",
    );
  });
});

describe("draftDiagrams: contexts", () => {
  test("subgraphs are contexts, arrows between them depends-on, :::public nodes public", () => {
    const found = draft([
      "%% inwards: contexts",
      "flowchart LR",
      '  subgraph sales["shop.sales"]',
      '    checkout["shop.sales.checkout"]',
      "  end",
      '  subgraph catalog["shop.catalog"]',
      '    api["shop.catalog.api"]:::public',
      '    store["shop.catalog.store"]',
      "  end",
      '  shipping["shop.shipping"]:::public',
      "  checkout --> api",
      "  sales --> shipping",
      "  sales --> catalog",
    ]);
    expect(found).toEqual({
      layers: [[{ name: "app", modules: ["shop.sales", "shop.catalog", "shop.shipping"] }]],
      contexts: [
        { name: "sales", modules: ["shop.sales"], public: [], dependsOn: ["catalog", "shipping"] },
        { name: "catalog", modules: ["shop.catalog"], public: ["shop.catalog.api"], dependsOn: [] },
        { name: "shipping", modules: ["shop.shipping"], public: ["shop.shipping"], dependsOn: [] },
      ],
      notes: [
        'The file has no layers diagram, so one layer, "app", holds every context; draw a layers diagram to split it.',
      ],
    });
  });

  test("a layers and a contexts diagram in one file give both tables", () => {
    const found = draftDiagrams({
      path: "docs/architecture.md",
      text: [
        "```mermaid",
        "%% inwards: layers",
        "flowchart TD",
        '  app["shop"]',
        "```",
        "```mermaid",
        "%% inwards: contexts",
        "flowchart LR",
        '  sales["shop.sales"]',
        "```",
      ].join("\n"),
    });
    expect(found).toEqual({
      layers: [[{ name: "app", modules: ["shop"] }]],
      contexts: [{ name: "sales", modules: ["shop.sales"], public: [], dependsOn: [] }],
      notes: [],
    });
  });

  test("a file without a marked diagram is refused", () => {
    expect(draftDiagrams({ path: "docs/architecture.md", text: "# Architecture\n" })).toBe(
      "docs/architecture.md: no marked diagram; a diagram counts when it opens with %% inwards: layers or %% inwards: contexts.",
    );
  });

  test("a context without a quoted label is refused", () => {
    expect(draft(["%% inwards: contexts", "flowchart LR", "  subgraph sales", "  end"])).toBe(
      'docs/architecture.mmd:3: context "sales" has no module: give it a quoted label such as subgraph sales["mypackage.sales"].',
    );
  });

  test("a :::public node without a quoted label is refused", () => {
    expect(
      draft([
        "%% inwards: contexts",
        "flowchart LR",
        '  subgraph sales["shop.sales"]',
        "    api:::public",
        "  end",
      ]),
    ).toBe(
      'docs/architecture.mmd:4: public node "api" in context "sales" has no module: give it a quoted label such as api["shop.sales.api"].',
    );
  });

  test("two diagrams of one kind are refused", () => {
    const two = draftDiagrams({
      path: "docs/architecture.md",
      text: [
        "```mermaid",
        "%% inwards: layers",
        "flowchart TD",
        "  a",
        "```",
        "```mermaid",
        "%% inwards: layers",
        "flowchart TD",
        "  b",
        "```",
      ].join("\n"),
    });
    expect(two).toBe(
      "docs/architecture.md:7: a second layers diagram; import-diagram reads one layers and one contexts diagram per file.",
    );
  });
});
