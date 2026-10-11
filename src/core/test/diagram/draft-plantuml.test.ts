/**
 * @file What `inwards import-diagram` reads out of a marked PlantUML diagram
 * (#346): the same layers and contexts as from Mermaid, ArchUnitPython's own
 * diagram with module aliases added, and refusals whose hints are written in
 * PlantUML. The Mermaid cases are in `draft.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { draftDiagrams } from "../../src/index.ts";

/** ArchUnitPython's sample-project diagram, copied with its license notice. */
const SAMPLE = readFileSync(
  join(import.meta.dir, "fixtures", "archunitpython", "sample-project.puml"),
  "utf8",
);

/**
 * Drafts the config one `.puml` file stands for.
 *
 * @param lines - the diagram's lines, between `@startuml` and `@enduml`.
 * @returns the draft, or why there is none.
 */
function draft(lines: readonly string[]): ReturnType<typeof draftDiagrams> {
  return draftDiagrams({
    path: "docs/architecture.puml",
    text: ["@startuml", ...lines, "@enduml"].join("\n"),
  });
}

describe("draftDiagrams: PlantUML", () => {
  test("layers rank by the longest path, aliases name their modules", () => {
    const found = draft([
      "' inwards: layers",
      "[api] --> [orders]",
      "component [shop.orders] as orders",
      "component [shop.billing] as billing",
      "component [shop.domain] as domain",
      "[api] --> [billing]",
      "[orders] --> [domain]",
      "[domain] <-- [billing]",
      "[api] ..> [domain]",
      "[api] --> [db]",
      "database Postgres as db <<external>>",
    ]);
    expect(found).toEqual({
      layers: [
        [{ name: "domain", modules: ["shop.domain"] }],
        [
          { name: "orders", modules: ["shop.orders"] },
          { name: "billing", modules: ["shop.billing"] },
        ],
        [{ name: "api", modules: [] }],
      ],
      contexts: [],
      notes: [
        'Layer "api" has no module: give its node a module and an alias such as [shop.api] as api, or fill in its modules by hand.',
      ],
    });
  });

  test("ArchUnitPython's diagram becomes contexts once its components name modules", () => {
    const text = SAMPLE.replace("@startuml\n", "@startuml\n' inwards: contexts\n")
      .replace("component [controllers]", "component [sample.controllers] as controllers")
      .replace("component [services]", "component [sample.services] as services")
      .replace("component [models]", "component [sample.models] as models")
      .replace("component [utils]", "component [sample.utils] as utils");
    const found = draftDiagrams({ path: "architecture.puml", text });
    expect(typeof found === "string" ? found : found.contexts).toEqual([
      { name: "controllers", modules: ["sample.controllers"], public: [], dependsOn: ["services"] },
      { name: "services", modules: ["sample.services"], public: [], dependsOn: ["models"] },
      { name: "models", modules: ["sample.models"], public: [], dependsOn: [] },
      { name: "utils", modules: ["sample.utils"], public: [], dependsOn: [] },
    ]);
  });

  test("ArchUnitPython's diagram as it is: a context without a module is refused, in PlantUML", () => {
    const text = SAMPLE.replace("@startuml\n", "@startuml\n' inwards: contexts\n");
    expect(draftDiagrams({ path: "architecture.puml", text })).toBe(
      'architecture.puml:23: context "controllers" has no module: give it a module and an alias such as [mypackage.controllers] as controllers.',
    );
  });

  test("a package without a module, and a <<public>> node without one, are refused", () => {
    expect(draft(["' inwards: contexts", "package sales {", "}"])).toBe(
      'docs/architecture.puml:3: context "sales" has no module: give it a module and an alias such as package "mypackage.sales" as sales {.',
    );
    expect(
      draft(["' inwards: contexts", 'package "shop.sales" as sales {', "  [api] <<public>>", "}"]),
    ).toBe(
      'docs/architecture.puml:4: public node "api" in context "sales" has no module: give it a module and an alias such as [shop.sales.api] as api.',
    );
  });
});
