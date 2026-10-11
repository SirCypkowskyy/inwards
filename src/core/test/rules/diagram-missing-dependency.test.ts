/**
 * @file INW019 diagram-missing-dependency: an import in the code between two
 * layers or contexts a marked diagram draws, with no arrow for it. Layers:
 * a path of arrows is enough, a dotted or reversed arrow isn't. Contexts: a
 * direct arrow between the two contexts, from any node inside them. Also the
 * imports that count (`if TYPE_CHECKING:`) and the ones that don't (an import
 * line inside a string), PlantUML hints, one finding per pair and diagram,
 * and the opt-in switch. The checks go through `Engine.check` on a
 * whole-project run, which is where the rule runs.
 */
import { describe, expect, test } from "bun:test";
import {
  type Diagnostic,
  Engine,
  type InwardsConfig,
  parseConfig,
  type SourceFile,
} from "../../src/index.ts";
import { file, grammars, indexOn } from "../support/helpers.ts";

const LAYERS = `
[tool.inwards]
diagrams = ["docs/architecture.md"]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "application", modules = ["shop.application"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
]

[tool.inwards.rules]
extend-select = ["INW019"]
`;

const CONTEXTS = `
[tool.inwards]
diagrams = ["docs/architecture.md"]
layers = [{ name = "app", modules = ["shop"] }]

[[tool.inwards.contexts]]
name = "sales"
modules = ["shop.sales"]
depends-on = ["catalog"]

[[tool.inwards.contexts]]
name = "catalog"
modules = ["shop.catalog"]
public = ["shop.catalog.api"]

[tool.inwards.rules]
extend-select = ["INW019"]
`;

/** The project's files and directories, for the module index. */
const DISK = new Map<string, "file" | "dir">([
  ["shop", "dir"],
  ["shop/__init__.py", "file"],
  ["shop/domain", "dir"],
  ["shop/domain/order.py", "file"],
  ["shop/application", "dir"],
  ["shop/application/place_order.py", "file"],
  ["shop/infrastructure", "dir"],
  ["shop/infrastructure/db.py", "file"],
  ["shop/infrastructure/mail.py", "file"],
  ["shop/sales", "dir"],
  ["shop/sales/checkout.py", "file"],
  ["shop/catalog", "dir"],
  ["shop/catalog/api.py", "file"],
]);
const PROJECT = indexOn(DISK);

/** Engines by config text, so each config loads the grammar once. */
const ENGINES = new Map<string, Engine>();

/**
 * Builds (once) the engine for a config.
 *
 * @param config - the pyproject.toml text.
 * @returns the engine and the parsed config.
 */
async function engineFor(config: string): Promise<{ engine: Engine; parsed: InwardsConfig }> {
  const parsed = parseConfig(config);
  const engine = ENGINES.get(config) ?? (await Engine.create(grammars(), parsed));
  ENGINES.set(config, engine);
  return { engine, parsed };
}

/** The Python files of the layers project, with their imports. */
const LAYER_FILES: readonly SourceFile[] = [
  file("shop/domain/order.py", "class Order:\n    pass\n"),
  file("shop/application/place_order.py", "from shop.domain.order import Order\n"),
  file(
    "shop/infrastructure/db.py",
    "import os\n\nfrom shop.domain.order import Order\nfrom shop.application import place_order\n",
  ),
  file("shop/infrastructure/mail.py", "from shop.domain import order\n"),
];

/** The Python files of the contexts project. */
const CONTEXT_FILES: readonly SourceFile[] = [
  file("shop/catalog/api.py", "def price():\n    return 1\n"),
  file("shop/sales/checkout.py", "from shop.catalog.api import price\n"),
];

/**
 * Checks a project as a whole-project run, with one Markdown file holding
 * the given diagram lines in a fenced block.
 *
 * @param lines - the block's lines (marker and header included), or a whole
 *   file's text when `fence` is false.
 * @param options - the config and the files, and how the diagram is written.
 * @param options.config - the pyproject.toml text.
 * @param options.files - the Python files to check.
 * @param options.fence - the fence's language, `mermaid` by default.
 * @param options.whole - false for a check of some paths.
 * @returns the INW019 findings.
 */
async function check(
  lines: readonly string[],
  {
    config = LAYERS,
    files = LAYER_FILES,
    fence = "mermaid",
    whole = true,
  }: {
    config?: string;
    files?: readonly SourceFile[];
    fence?: string;
    whole?: boolean;
  } = {},
): Promise<Diagnostic[]> {
  const { engine } = await engineFor(config);
  const text = ["# Architecture", "", `\`\`\`${fence}`, ...lines, "```", ""].join("\n");
  const diagrams = [{ path: "docs/architecture.md", text }];
  return engine
    .check(files, PROJECT, undefined, { whole, diagrams })
    .diagnostics.filter((d) => d.code === "INW019");
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

describe("INW019 diagram-missing-dependency: layers", () => {
  test("a diagram that draws every import, directly or through a path, passes", async () => {
    expect(
      await check([
        "%% inwards: layers",
        "flowchart LR",
        "  infrastructure --> application --> domain",
      ]),
    ).toEqual([]);
  });

  test("an import with no arrow is reported once per pair, on the importing node's line", async () => {
    const found = await check([
      "%% inwards: layers",
      "flowchart LR",
      "  application --> domain",
      "  infrastructure",
    ]);
    expect(where(found)).toEqual([
      '7:3-17 Layer "infrastructure" imports layer "application" in the code (shop/infrastructure/db.py:4 imports shop.application.place_order), and the diagram draws no arrow or path of arrows from "infrastructure" to "application".',
      '7:3-17 Layer "infrastructure" imports layer "domain" in the code (shop/infrastructure/db.py:3 imports shop.domain.order.Order), and the diagram draws no arrow or path of arrows from "infrastructure" to "domain".',
    ]);
    const [first] = found;
    expect(first).toMatchObject({
      file: "docs/architecture.md",
      module: "",
      severity: "warning",
      rule: "diagram-missing-dependency",
    });
    expect(first?.fix.summary).toBe(
      'Draw the import in the diagram: "infrastructure --> application".',
    );
    expect(first?.fix.steps).toEqual([
      "Arrows point from the importing layer to the imported one, and solid arrows only: a dotted one (-.->) stands for something other than an import.",
      'If the code shouldn\'t import "application" from "infrastructure", remove the import instead; INW001 reports it when [tool.inwards] forbids it.',
    ]);
  });

  test("an arrow the wrong way round, or a dotted one, doesn't draw the import", async () => {
    const links = ["application --> infrastructure", "infrastructure -.-> application"];
    const found = await Promise.all(
      links.map((link) =>
        check([
          "%% inwards: layers",
          "flowchart LR",
          "  application --> domain",
          "  infrastructure --> domain",
          `  ${link}`,
        ]),
      ),
    );
    expect(found.map((each) => each.map((d) => d.message.slice(0, 53)))).toEqual([
      ['Layer "infrastructure" imports layer "application" in'],
      ['Layer "infrastructure" imports layer "application" in'],
    ]);
  });

  test("a layer the diagram doesn't draw, or draws as external, is left alone", async () => {
    expect(await check(["%% inwards: layers", "flowchart LR", "  application --> domain"])).toEqual(
      [],
    );
    expect(
      await check([
        "%% inwards: layers",
        "flowchart LR",
        "  application --> domain",
        "  infrastructure:::external",
      ]),
    ).toEqual([]);
  });

  test("a layer named through its quoted label counts as drawn", async () => {
    const config = LAYERS.replace('name = "infrastructure"', 'name = "infra structure"');
    const found = await check(
      [
        "%% inwards: layers",
        "flowchart LR",
        "  application --> domain",
        '  infra["shop.infrastructure"] --> domain',
      ],
      { config },
    );
    expect(found.map((d) => d.fix.summary)).toEqual([
      'Draw the import in the diagram: "infra --> application".',
    ]);
  });

  test("an import under TYPE_CHECKING counts; an import line inside a string doesn't", async () => {
    const lines = ["%% inwards: layers", "flowchart LR", "  domain", "  application"];
    const typed = file(
      "shop/domain/order.py",
      "from typing import TYPE_CHECKING\n\nif TYPE_CHECKING:\n    from shop.application import place_order\n",
    );
    const files = [typed, LAYER_FILES[1]].flatMap((f) => (f === undefined ? [] : [f]));
    expect(where(await check(lines, { files })).map((s) => s.split(" in the code")[0])).toEqual([
      '6:3-9 Layer "domain" imports layer "application"',
      '7:3-14 Layer "application" imports layer "domain"',
    ]);
    const quoted = file("shop/domain/order.py", 'NOTE = """\nimport shop.application\n"""\n');
    const plain = [quoted, LAYER_FILES[1]].flatMap((f) => (f === undefined ? [] : [f]));
    expect((await check(lines, { files: plain })).map((d) => d.line)).toEqual([7]);
  });

  test("each diagram is judged on its own", async () => {
    const { engine } = await engineFor(LAYERS);
    const block = [
      "```mermaid",
      "%% inwards: layers",
      "flowchart LR",
      "  application",
      "  domain",
      "```",
    ];
    const text = ["# One", ...block, "", "# Two", ...block, ""].join("\n");
    const found = engine
      .check(LAYER_FILES.slice(0, 2), PROJECT, undefined, {
        whole: true,
        diagrams: [{ path: "docs/architecture.md", text }],
      })
      .diagnostics.filter((d) => d.code === "INW019");
    expect(found.map((d) => d.line)).toEqual([5, 13]);
  });

  test("off unless turned on, and only on whole-project runs", async () => {
    const lines = ["%% inwards: layers", "flowchart LR", "  application", "  domain"];
    expect(
      await check(lines, { config: LAYERS.replace('extend-select = ["INW019"]', "") }),
    ).toEqual([]);
    expect(await check(lines, { whole: false })).toEqual([]);
    const raised = LAYERS.replace(
      'extend-select = ["INW019"]',
      'extend-select = ["INW019"]\nseverity = { INW019 = "error" }',
    );
    const found = await check(lines, { config: raised });
    expect(found.map((d) => d.severity)).toEqual(["error"]);
  });
});

describe("INW019 diagram-missing-dependency: contexts", () => {
  test("an arrow between the two contexts, from any node inside them, draws the import", async () => {
    const found = await Promise.all(
      ["sales --> catalog", "checkout --> api"].map((link) =>
        check(
          [
            "%% inwards: contexts",
            "flowchart LR",
            '  subgraph sales["shop.sales"]',
            '    checkout["shop.sales.checkout"]',
            "  end",
            '  subgraph catalog["shop.catalog"]',
            '    api["shop.catalog.api"]:::public',
            "  end",
            `  ${link}`,
          ],
          { config: CONTEXTS, files: CONTEXT_FILES },
        ),
      ),
    );
    expect(found).toEqual([[], []]);
  });

  test("an import between two drawn contexts with no arrow is reported on the context's line", async () => {
    const found = await check(
      [
        "%% inwards: contexts",
        "flowchart LR",
        '  subgraph sales["shop.sales"]',
        '    checkout["shop.sales.checkout"]',
        "  end",
        '  subgraph catalog["shop.catalog"]',
        '    api["shop.catalog.api"]:::public',
        "  end",
        "  catalog --> sales",
      ],
      { config: CONTEXTS, files: CONTEXT_FILES },
    );
    expect(where(found)).toEqual([
      '6:12-17 Context "sales" imports context "catalog" in the code (shop/sales/checkout.py:1 imports shop.catalog.api.price), and the diagram draws no arrow from "sales" to "catalog".',
    ]);
    expect(found[0]?.fix.steps[1]).toBe(
      'If the code shouldn\'t import "catalog" from "sales", remove the import instead; INW002 reports it when [tool.inwards] forbids it.',
    );
  });
});

describe("INW019 diagram-missing-dependency: PlantUML", () => {
  test("the hint is written in PlantUML", async () => {
    const found = await check(
      ["' inwards: layers", "[shop.application] as application", "[shop.domain] as domain"],
      { fence: "plantuml", files: LAYER_FILES.slice(0, 2) },
    );
    expect(found.map((d) => [d.line, d.fix.summary, d.fix.steps[0]])).toEqual([
      [
        5,
        'Draw the import in the diagram: "[application] --> [domain]".',
        "Arrows point from the importing layer to the imported one, and solid arrows only: a dotted one (..>) stands for something other than an import.",
      ],
    ]);
  });
});
