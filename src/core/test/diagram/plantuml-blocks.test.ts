/**
 * @file Finding marked PlantUML diagrams (#346, ADR-045) in `.puml` files and
 * fenced `plantuml` blocks, with their line numbers, and reading the
 * ArchUnitPython diagrams under `fixtures/archunitpython/`, copied from that
 * project's tests and README, the way its `generate_rule` reads them. The
 * statements themselves are tested in `plantuml.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Diagram } from "../../src/diagram/model.ts";
import { markedPlantUml } from "../../src/diagram/plantuml-blocks.ts";
import { readDiagrams } from "../../src/diagram/read.ts";

/** The ArchUnitPython diagrams, copied with their license notice. */
const FIXTURES = join(import.meta.dir, "fixtures", "archunitpython");

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

/**
 * Reads an ArchUnitPython fixture with a marker added right after its
 * `@startuml`, as a user would add it.
 *
 * @param name - the fixture's file name.
 * @returns the text unmarked and marked.
 */
function fixture(name: string): { plain: string; marked: string } {
  const plain = readFileSync(join(FIXTURES, name), "utf8");
  return { plain, marked: plain.replace("@startuml\n", "@startuml\n' inwards: contexts\n") };
}

describe("ArchUnitPython's diagrams", () => {
  // What ArchUnitPython's generate_rule returns for each (rules, contained_nodes),
  // from tests/slices/test_slices.py.
  const cases: readonly [string, string[], string[]][] = [
    [
      "sample-project.puml",
      ["controllers --> services", "services --> models"],
      ["controllers", "services", "models", "utils"],
    ],
    ["colors.puml", ["api -> db"], ["api", "db"]],
    ["implicit.puml", ["auth --> users"], ["auth", "users"]],
    ["multiple.puml", ["ui --> business", "business --> data"], ["ui", "business", "data"]],
    [
      "readme-components.puml",
      ["UserInterface --> BusinessLogic", "BusinessLogic --> DataAccess"],
      ["UserInterface", "BusinessLogic", "DataAccess"],
    ],
  ];

  test.each(cases)("%s reads as ArchUnitPython reads it", (name, rules, nodes) => {
    const { plain, marked } = fixture(name);
    expect(readDiagrams({ path: name, text: plain })).toEqual([]);
    const [read] = readDiagrams({ path: name, text: marked });
    expect(read?.kind).toBe("contexts");
    expect(read?.notation).toBe("plantuml");
    expect(read === undefined ? [] : edges(read)).toEqual(rules);
    expect(read === undefined ? [] : ids(read)).toEqual(nodes);
  });

  test("a color after a component is styling, not part of its name", () => {
    const { marked } = fixture("colors.puml");
    const [read] = readDiagrams({ path: "colors.puml", text: marked });
    expect(read?.nodes.map((n) => [n.id, n.classes])).toEqual([
      ["api", []],
      ["db", []],
      ["api", []],
      ["db", []],
    ]);
  });
});

describe("marked diagrams", () => {
  test("a .puml file counts only with the marker among the opening comments", () => {
    const text = [
      "@startuml", //                1
      "' Shop layers", //            2
      "' inwards: layers", //        3
      "", //                         4
      "[api] --> [domain]", //       5
      "@enduml", //                  6
      "@startuml", //                7
      "[a] --> [b]", //              8
      "@enduml", //                  9
      "@startuml", //                10
      "[c] --> [d]", //              11
      "' inwards: layers", //        12
      "@enduml",
    ].join("\n");
    expect(markedPlantUml({ path: "docs/arch.puml", text })).toEqual([
      {
        kind: "layers",
        markerLine: 3,
        firstLine: 2,
        lines: ["' Shop layers", "' inwards: layers", "", "[api] --> [domain]"],
      },
    ]);
  });

  test("a fenced plantuml or puml block in Markdown counts, with or without @startuml", () => {
    const text = [
      "# Architecture", //           1
      "", //                         2
      "```plantuml", //              3
      "@startuml", //                4
      "' inwards: layers", //        5
      "[api] --> [domain]", //       6
      "@enduml", //                  7
      "```", //                      8
      "", //                         9
      "~~~puml", //                  10
      "' inwards: contexts", //      11
      "package sales {", //          12
      "}", //                        13
      "~~~", //                      14
      "", //                         15
      "```plantuml", //              16
      "[x] --> [y]", //              17
      "```",
    ].join("\n");
    const found = readDiagrams({ path: "docs/arch.md", text });
    expect(found.map((d) => [d.kind, d.markerLine, d.notation])).toEqual([
      ["layers", 5, "plantuml"],
      ["contexts", 11, "plantuml"],
    ]);
    expect(found[0]?.edges.map((e) => [e.from, e.to, e.line])).toEqual([["api", "domain", 6]]);
    expect(found[1]?.subgraphs.map((s) => [s.id, s.line])).toEqual([["sales", 12]]);
  });

  test("other file types and other fences hold no PlantUML diagram", () => {
    const marked = "@startuml\n' inwards: layers\n[a] --> [b]\n@enduml\n";
    expect(markedPlantUml({ path: "a.mmd", text: marked })).toEqual([]);
    expect(markedPlantUml({ path: "a.md", text: `\`\`\`text\n${marked}\`\`\`\n` })).toEqual([]);
    expect(markedPlantUml({ path: "a.md", text: marked })).toEqual([]);
    for (const path of ["a.puml", "a.plantuml", "a.pu", "a.iuml", "A.PUML"]) {
      expect(markedPlantUml({ path, text: marked })).toHaveLength(1);
    }
  });

  test("a diagram left open runs to the end of its file or block", () => {
    const [found] = markedPlantUml({
      path: "a.puml",
      text: "@startuml\n' inwards: layers\n[a] --> [b]",
    });
    expect(found?.lines).toEqual(["' inwards: layers", "[a] --> [b]"]);
  });

  test("a Markdown file mixes Mermaid and PlantUML diagrams in file order", () => {
    const text = [
      "```plantuml",
      "' inwards: contexts",
      "[a] --> [b]",
      "```",
      "```mermaid",
      "%% inwards: layers",
      "flowchart TD",
      "  c --> d",
      "```",
    ].join("\n");
    expect(readDiagrams({ path: "x.md", text }).map((d) => [d.notation, d.kind])).toEqual([
      ["plantuml", "contexts"],
      ["mermaid", "layers"],
    ]);
  });
});
