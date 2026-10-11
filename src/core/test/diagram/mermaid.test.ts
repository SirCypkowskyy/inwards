/**
 * @file The Mermaid reader (ADR-045), one construct at a time: finding marked
 * blocks in Markdown and `.mmd` files with their line numbers, then node
 * shapes, quoted labels, `:::class`, every kind of link, chains, `&`,
 * subgraphs, `class` statements and comments. The rules built on it are
 * tested in `test/rules/`.
 */
import { describe, expect, test } from "bun:test";
import { markedBlocks } from "../../src/diagram/blocks.ts";
import { readFlowchart } from "../../src/diagram/mermaid.ts";
import type { Diagram } from "../../src/diagram/model.ts";

/**
 * Reads a `.mmd` file made of a marked header and the given body.
 *
 * @param body - flowchart statements, one per line.
 * @returns the one diagram it holds.
 * @throws {Error} when the reader finds no marked block, which fails the test.
 */
function flowchart(body: string): Diagram {
  const [block] = markedBlocks({
    path: "a.mmd",
    text: `%% inwards: layers\nflowchart LR\n${body}`,
  });
  if (block === undefined) {
    throw new Error("no marked block");
  }
  return readFlowchart(block, "a.mmd");
}

/**
 * Lists the edges of a diagram as `from link to` strings.
 *
 * @param diagram - a read diagram.
 * @returns one string per edge, e.g. `a --> b`.
 */
function edges(diagram: Diagram): string[] {
  return diagram.edges.map((e) => `${e.from} ${e.link} ${e.to}${e.mayImport ? "" : " (no)"}`);
}

describe("marked blocks", () => {
  test("a fenced mermaid block in Markdown counts only with the marker", () => {
    const text = [
      "# Architecture", //                1
      "",
      "```mermaid", //                    3
      "%% inwards: layers",
      "flowchart TD", //                  5
      "  api --> domain", //              6
      "```",
      "",
      "```mermaid",
      "flowchart TD",
      "  a --> b",
      "```",
    ].join("\n");
    const blocks = markedBlocks({ path: "docs/arch.md", text });
    expect(blocks).toEqual([
      { kind: "layers", markerLine: 4, firstLine: 6, lines: ["  api --> domain"] },
    ]);
  });

  test("the marker may follow the header, and front matter and directives may precede it", () => {
    const text =
      "---\ntitle: Layers\n---\n%%{init: {}}%%\ngraph LR\n%% inwards: contexts\na --> b\n";
    const [block] = markedBlocks({ path: "c.mermaid", text });
    expect(block).toMatchObject({ kind: "contexts", markerLine: 6, firstLine: 6 });
  });

  test("a marker after the first statement, or on another diagram type, doesn't count", () => {
    expect(
      markedBlocks({ path: "a.mmd", text: "flowchart LR\na --> b\n%% inwards: layers\n" }),
    ).toEqual([]);
    expect(markedBlocks({ path: "a.mmd", text: "%% inwards: layers\nsequenceDiagram\n" })).toEqual(
      [],
    );
  });

  test("tilde fences, longer fences and an unclosed block are read as CommonMark reads them", () => {
    const text =
      "~~~~ mermaid\n%% inwards: layers\ngraph\n~~~\na\n~~~~\n````mermaid\n%% inwards: layers\ngraph\nb\n";
    const blocks = markedBlocks({ path: "x.md", text });
    expect(blocks.map((b) => b.lines.filter((l) => l !== ""))).toEqual([["~~~", "a"], ["b"]]);
  });
});

describe("nodes", () => {
  test.each([
    ["a[text]", "text"],
    ["a(text)", "text"],
    ["a([text])", "text"],
    ["a[[text]]", "text"],
    ["a[(text)]", "text"],
    ["a((text))", "text"],
    ["a(((text)))", "text"],
    ["a>text]", "text"],
    ["a{text}", "text"],
    ["a{{text}}", "text"],
    ["a[/text/]", "text"],
    ["a[\\text\\]", "text"],
    ["a[/text\\]", "text"],
    ["a[\\text/]", "text"],
    ["a@{ shape: rect, label: text }", "text"],
  ])("%s has the unquoted label", (statement, text) => {
    const [node] = flowchart(statement).nodes;
    expect(node).toMatchObject({ id: "a", label: { text, quoted: false } });
  });

  test.each([
    ['a["shop.domain"]'],
    ['a(["shop.domain"])'],
    ['a[("shop.domain")]'],
    ['a@{ shape: cyl, label: "shop.domain" }'],
  ])("%s has a quoted label", (statement) => {
    const [node] = flowchart(statement).nodes;
    expect(node?.label).toEqual({ text: "shop.domain", quoted: true });
  });

  test("a Markdown string is not a quoted label", () => {
    expect(flowchart('a["`**bold**`"]').nodes[0]?.label?.quoted).toBe(false);
  });

  test("ids, lines and columns point at the id as written", () => {
    const d = flowchart("  order-api --> domain\n\tinfra");
    expect(d.nodes.map(({ id, line, column, endColumn }) => [id, line, column, endColumn])).toEqual(
      [
        ["order-api", 3, 3, 12],
        ["domain", 3, 17, 23],
        ["infra", 4, 2, 7],
      ],
    );
  });

  test(":::class is read, once or several times", () => {
    const [a, b] = flowchart("a:::external --> b[x]:::one:::two").nodes;
    expect(a?.classes).toEqual(["external"]);
    expect(b?.classes).toEqual(["one", "two"]);
  });

  test("class statements give classes by id", () => {
    expect(flowchart("a --> b\nclass a,b external").classes.get("b")).toEqual(["external"]);
  });
});

describe("links", () => {
  test.each([
    ["a --> b", "a --> b"],
    ["a-->b", "a --> b"],
    ["a ---> b", "a ---> b"],
    ["a ==> b", "a ==> b"],
    ["a -- uses --> b", "a -- uses --> b"],
    ["a == uses ==> b", "a == uses ==> b"],
    ["a -->|uses| b", "a --> b"],
    ["a e1@--> b", "a --> b"],
  ])("%s may import", (statement, edge) => {
    expect(edges(flowchart(statement))).toEqual([edge]);
  });

  test.each([
    ["a --- b", "a --- b (no)"],
    ["a -.-> b", "a -.-> b (no)"],
    ["a -. text .-> b", "a -. text .-> b (no)"],
    ["a ~~~ b", "a ~~~ b (no)"],
    ["a <--> b", "a <--> b (no)"],
    ["a --o b", "a --o b (no)"],
    ["a ---xb", "a ---x b (no)"],
    ["a o--o b", "a o--o b (no)"],
  ])("%s does not", (statement, edge) => {
    expect(edges(flowchart(statement))).toEqual([edge]);
  });

  test("chains and & expand into every pair", () => {
    expect(edges(flowchart("a & b --> c --> d & e"))).toEqual([
      "a --> c",
      "b --> c",
      "c --> d",
      "c --> e",
    ]);
  });

  test("semicolons separate statements", () => {
    expect(edges(flowchart("a --> b; b --> c;"))).toEqual(["a --> b", "b --> c"]);
  });
});

describe("structure", () => {
  test("subgraphs nest, take an explicit id or a title, and hold the nodes named inside", () => {
    const d = flowchart(
      [
        'subgraph orders ["Orders"]',
        "  direction TB",
        "  subgraph inner",
        "    x",
        "  end",
        "  y",
        "end",
        "subgraph Billing and payments",
        "end",
        "z",
      ].join("\n"),
    );
    expect(d.subgraphs.map(({ id, parent, label }) => [id, parent, label?.text])).toEqual([
      ["orders", undefined, "Orders"],
      ["inner", "orders", undefined],
      ["Billing and payments", undefined, undefined],
    ]);
    expect(d.nodes.map(({ id, subgraph }) => [id, subgraph])).toEqual([
      ["x", "inner"],
      ["y", "orders"],
      ["z", undefined],
    ]);
  });

  test("comments, styling and accessibility statements name no node", () => {
    const d = flowchart(
      [
        "%% a --> b",
        "classDef external fill:#eee",
        "style a fill:#f9f",
        "linkStyle 0 stroke:#f00",
        'click a href "https://example.com"',
        "accTitle: Layers",
        "accDescr {",
        "  c --> d",
        "}",
        "e --> f %% trailing",
      ].join("\n"),
    );
    expect(d.nodes.map((n) => n.id)).toEqual(["e", "f"]);
  });

  test("a statement it can't read keeps what came before it", () => {
    expect(flowchart("a --> b --> ???").nodes.map((n) => n.id)).toEqual(["a", "b"]);
  });
});
