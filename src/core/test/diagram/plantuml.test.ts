/**
 * @file The PlantUML reader (#346, ADR-045), one construct at a time:
 * components and their aliases, stereotypes, every arrow it reads, packages
 * and the other groups, and the statements it skips. Finding the diagrams
 * and the ArchUnitPython fixtures are in `plantuml-blocks.test.ts`; the rules
 * built on the reader are tested in `test/rules/`.
 */
import { describe, expect, test } from "bun:test";
import type { Diagram } from "../../src/diagram/_model.ts";
import { readDiagrams } from "../../src/diagram/_read.ts";

/**
 * Reads a `.puml` file made of a marked `@startuml` and the given body.
 *
 * @param body - diagram statements, one per line.
 * @param kind - the marker's kind.
 * @returns the one diagram it holds.
 * @throws {Error} when the reader finds no marked diagram, which fails the test.
 */
function diagram(body: string, kind = "layers"): Diagram {
  const [found] = readDiagrams({
    path: "a.puml",
    text: `@startuml\n' inwards: ${kind}\n${body}\n@enduml\n`,
  });
  if (found === undefined) {
    throw new Error("no marked diagram");
  }
  return found;
}

/**
 * Lists the edges of a diagram as `from link to` strings.
 *
 * @param read - a read diagram.
 * @returns one string per edge, e.g. `a --> b`, with ` (no)` when it doesn't mean "may import".
 */
function edges(read: Diagram): string[] {
  return read.edges.map((e) => `${e.from} ${e.link} ${e.to}${e.mayImport ? "" : " (no)"}`);
}

/**
 * Lists the distinct node ids of a diagram, in the order first written.
 *
 * @param read - a read diagram.
 * @returns each node id once, such as `["api", "domain"]`.
 */
function ids(read: Diagram): string[] {
  return [...new Set(read.nodes.map((n) => n.id))];
}

describe("components", () => {
  test("every way to name one, with the column of its id", () => {
    const read = diagram(
      [
        "component [controllers]", //               3
        "component Comp3", //                       4
        "[Another component] as Comp2", //          5
        'component "shop.web" as web', //           6
        "component [shop.domain] as domain", //     7
        "component comp1 [long description]", //    8
        "  [api]", //                               9
      ].join("\n"),
    );
    expect(
      read.nodes.map(({ id, line, column, endColumn }) => [id, line, column, endColumn]),
    ).toEqual([
      ["controllers", 3, 12, 23],
      ["Comp3", 4, 11, 16],
      ["Comp2", 5, 24, 29],
      ["web", 6, 25, 28],
      ["domain", 7, 28, 34],
      ["comp1", 8, 11, 16],
      ["api", 9, 4, 7],
    ]);
    expect(read.nodes.map((n) => n.label)).toEqual([
      undefined,
      undefined,
      { text: "Another component", quoted: true },
      { text: "shop.web", quoted: true },
      { text: "shop.domain", quoted: true },
      { text: "long description", quoted: false },
      undefined,
    ]);
  });

  test("other element keywords name nodes too", () => {
    const read = diagram('database "Postgres" as db\nnode worker\nqueue [jobs]\nrectangle box');
    expect(ids(read)).toEqual(["db", "worker", "jobs", "box"]);
  });

  test("stereotypes become classes, colors and the rest are styling", () => {
    const read = diagram(
      [
        "component [db] <<external>> #Yellow",
        "[api] << public >> <<web, rest>>",
        'component "Web Server" as WS << Apache >>',
      ].join("\n"),
    );
    expect(read.nodes.map((n) => [n.id, n.classes])).toEqual([
      ["db", ["external"]],
      ["api", ["public", "web", "rest"]],
      ["WS", ["Apache"]],
    ]);
  });

  test("interfaces aren't components", () => {
    const read = diagram('() "HTTP"\ninterface Port\n() "Other" as O');
    expect(read.nodes).toEqual([]);
  });
});

describe("arrows", () => {
  const solid: readonly [string, string][] = [
    ["[a] --> [b]", "a --> b"],
    ["[a] -> [b]", "a -> b"],
    ["[a] ---> [b]", "a ---> b"],
    ["[a]-->[b]", "a --> b"],
    ["a --> b", "a --> b"],
    ["[a] --> b : uses", "a --> b"],
    ["[a] -up-> [b]", "a -up-> b"],
    ["[a] -d-> [b]", "a -d-> b"],
    ["[a] -[#red]-> [b]", "a -[#red]-> b"],
    ["[a] -[bold,#red]down-> [b]", "a -[bold,#red]down-> b"],
    ["[b] <-- [a]", "a --> b"],
    ["[b] <- [a]", "a -> b"],
    ["[b] <-left- [a]", "a -left-> b"],
  ];

  test.each(solid)("%s means may import", (statement, edge) => {
    expect(edges(diagram(statement))).toEqual([edge]);
  });

  const other: readonly [string, string][] = [
    ["[a] ..> [b]", "a ..> b (no)"],
    ["[a] .> [b]", "a .> b (no)"],
    ["[a] -- [b]", "a -- b (no)"],
    ["[a] .. [b]", "a .. b (no)"],
    ["[a] <--> [b]", "a <--> b (no)"],
    ["[a] --|> [b]", "a --|> b (no)"],
    ["[a] --o [b]", "a --o b (no)"],
    ["[a] -[dashed]-> [b]", "a -[dashed]-> b (no)"],
    ["[a] -[dotted]-> [b]", "a -[dotted]-> b (no)"],
    ["[a] -[hidden]-> [b]", "a -[hidden]-> b (no)"],
    ["[b] <.. [a]", "a ..> b (no)"],
  ];

  test.each(other)("%s doesn't", (statement, edge) => {
    expect(edges(diagram(statement))).toEqual([edge]);
  });

  test("a direction word is a node when no dashes follow it", () => {
    expect(edges(diagram("a --> down"))).toEqual(["a --> down"]);
  });

  test("both ends are recorded as nodes on the arrow's line", () => {
    const read = diagram("[a] --> [b]");
    expect(read.nodes.map(({ id, line, column }) => [id, line, column])).toEqual([
      ["a", 3, 2],
      ["b", 3, 10],
    ]);
  });

  test("an arrow to an interface or an unreadable end is skipped", () => {
    expect(edges(diagram('[a] --> () "HTTP"\n[a] --> "quoted"\n[a] -->'))).toEqual([]);
  });
});

describe("packages", () => {
  test("groups nest, with their ids, labels and nodes", () => {
    const read = diagram(
      [
        'package "shop.sales" as sales {', //   3
        "  [checkout]", //                     4
        "  folder inner {", //                 5
        "    [cart]", //                       6
        "  }", //                              7
        "}", //                                8
        "package catalog <<public>> {", //     9
        "  [api]", //                          10
        "}", //                                11
        'node "Order handling" {', //          12
        "  [x]", //                            13
        "}", //                                14
        "cloud {", //                          15
        "  [y]", //                            16
        "}", //                                17
        "[z]", //                              18
        "sales --> catalog", //                19
      ].join("\n"),
      "contexts",
    );
    expect(
      read.subgraphs.map(({ id, parent, label, line, column }) => [
        id,
        parent,
        label,
        line,
        column,
      ]),
    ).toEqual([
      ["sales", undefined, { text: "shop.sales", quoted: true }, 3, 25],
      ["inner", "sales", undefined, 5, 10],
      ["catalog", undefined, undefined, 9, 9],
      ["Order handling", undefined, undefined, 12, 7],
    ]);
    expect(read.nodes.map(({ id, subgraph }) => [id, subgraph])).toEqual([
      ["checkout", "sales"],
      ["cart", "inner"],
      ["api", "catalog"],
      ["x", "Order handling"],
      ["y", undefined],
      ["z", undefined],
      ["sales", undefined],
      ["catalog", undefined],
    ]);
    expect(read.classes.get("catalog")).toEqual(["public"]);
    expect(edges(read)).toEqual(["sales --> catalog"]);
  });

  test("a component written with braces is a group", () => {
    const read = diagram("component api {\n  [routes]\n}", "contexts");
    expect(read.subgraphs.map((s) => s.id)).toEqual(["api"]);
    expect(read.nodes.map(({ id, subgraph }) => [id, subgraph])).toEqual([["routes", "api"]]);
  });
});

describe("what the reader skips", () => {
  test("styling, layout, notes, comments and preprocessor lines name nothing", () => {
    const read = diagram(
      [
        "skinparam componentStyle rectangle",
        "skinparam component {",
        "  BorderColor<<Apache>> #FF6655",
        "  [inside] --> [skin]",
        "}",
        "skinparam component { BorderColor #FF6655 }",
        "<style>",
        "  component { LineColor red }",
        "</style>",
        "left to right direction",
        "title Shop",
        "!include common.puml",
        "hide stereotype",
        "note top of [a] : a note",
        "note as N",
        "  [in] --> [note]",
        "end note",
        "/' a block",
        "  [in] --> [comment] '/",
        "/' one line '/",
        "' [a] --> [comment]",
        "legend",
        "  [in] --> [legend]",
        "endlegend",
        "[a] --> [b]",
      ].join("\n"),
    );
    expect(edges(read)).toEqual(["a --> b"]);
    expect(read.subgraphs).toEqual([]);
  });

  test("a stray closing brace doesn't break what follows", () => {
    expect(edges(diagram("}\n[a] --> [b]"))).toEqual(["a --> b"]);
  });
});
