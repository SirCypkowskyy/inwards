/**
 * @file `inwards import-diagram` (#345) as a command. The round trip: a
 * project whose docs draw its layers and contexts gets its `[tool.inwards]`
 * from the diagram with `--write`, and `inwards check` then finds no INW017
 * or INW018 in that same diagram, while a drawn edge the config forbids is
 * still caught after an edit. Also: printing, the notes, the src root, a
 * file outside the project, and the refusals.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseConfig } from "@inwards/core";
import { inwards, project } from "../support/run.ts";

const ARCHITECTURE = `# Architecture

\`\`\`mermaid
%% inwards: layers
flowchart TD
  api["shop.api"] --> orders["shop.orders"] & billing["shop.billing"]
  orders --> domain["shop.domain"]
  billing --> domain
  api --> db[(Postgres)]:::external
\`\`\`

\`\`\`mermaid
%% inwards: contexts
flowchart LR
  subgraph ordering["shop.orders"]
    place["shop.orders.place"]:::public
  end
  subgraph invoicing["shop.billing"]
    invoices["shop.billing.invoices"]:::public
  end
  invoicing --> place
\`\`\`
`;

const FILES: Record<string, string> = {
  "pyproject.toml": '[project]\nname = "shop"\n',
  "docs/architecture.md": ARCHITECTURE,
  "shop/__init__.py": "",
  "shop/domain/__init__.py": "",
  "shop/domain/order.py": "class Order:\n    pass\n",
  "shop/orders/__init__.py": "",
  "shop/orders/place.py": "from shop.domain.order import Order\n",
  "shop/billing/__init__.py": "",
  "shop/billing/invoices.py": "from shop.domain.order import Order\n",
  "shop/api/__init__.py": "",
  "shop/api/app.py":
    "from shop.orders.place import Order\nfrom shop.billing.invoices import Order as O\n",
};

/**
 * Lists the codes `inwards check` reports.
 *
 * @param cwd - the project.
 * @returns `CODE file:line` per finding, sorted.
 */
function findings(cwd: string): string[] {
  const run = inwards(["check", "--format", "json"], { cwd });
  const report: unknown = JSON.parse(run.stdout);
  const diagnostics =
    typeof report === "object" && report !== null ? Reflect.get(report, "diagnostics") : [];
  return (Array.isArray(diagnostics) ? diagnostics : [])
    .map((d: unknown) =>
      typeof d === "object" && d !== null
        ? `${String(Reflect.get(d, "code"))} ${String(Reflect.get(d, "file"))}:${String(Reflect.get(d, "line"))}`
        : "",
    )
    .sort();
}

describe("inwards import-diagram", () => {
  test("round trip: the table written from a diagram checks clean against it", () => {
    const dir = project(FILES);
    const run = inwards(["import-diagram", "docs/architecture.md", "--write"], { cwd: dir });
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("wrote [tool.inwards] to pyproject.toml");
    expect(run.stderr).toContain("read 4 layers and 2 contexts from docs/architecture.md.");
    const config = parseConfig(readFileSync(join(dir, "pyproject.toml"), "utf8"));
    expect(config.diagrams).toEqual(["docs/architecture.md"]);
    expect(config.layers.map((l) => [l.name, l.rank])).toEqual([
      ["domain", 0],
      ["orders", 1],
      ["billing", 1],
      ["api", 2],
    ]);
    expect(config.contexts).toEqual([
      { name: "ordering", modules: ["shop.orders"], public: ["shop.orders.place"], dependsOn: [] },
      {
        name: "invoicing",
        modules: ["shop.billing"],
        public: ["shop.billing.invoices"],
        dependsOn: ["ordering"],
      },
    ]);
    expect(findings(dir)).toEqual([]);

    const path = join(dir, "docs/architecture.md");
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace("invoicing --> place", "place --> invoices"),
    );
    expect(findings(dir)).toEqual(["INW018 docs/architecture.md:21"]);
  });

  test("prints the table on stdout and the notes on stderr", () => {
    const dir = project({
      "pyproject.toml": '[project]\nname = "shop"\n',
      "layers.mmd": '%% inwards: layers\nflowchart TD\n  app --> domain["shop.domain"]\n',
      "src/shop/domain/__init__.py": "",
    });
    const run = inwards(["import-diagram", "layers.mmd"], { cwd: dir });
    expect(run.code).toBe(0);
    expect(() => parseConfig(run.stdout)).not.toThrow();
    expect(run.stdout).toBe(
      [
        "# Converted from layers.mmd by inwards import-diagram.",
        "[tool.inwards]",
        'root = "src"',
        'diagrams = ["layers.mmd"]',
        "layers = [",
        '  { name = "domain", modules = ["shop.domain"] },',
        '  { name = "app", modules = [] },',
        "]",
        "",
        "[tool.inwards.rules]",
        'extend-select = ["INW017", "INW018"]',
        "",
      ].join("\n"),
    );
    expect(run.stderr).toContain(
      'Layer "app" has no module: give its node a quoted label such as app["shop.app"]',
    );
    expect(readFileSync(join(dir, "pyproject.toml"), "utf8")).toBe('[project]\nname = "shop"\n');
  });

  test("a diagram outside the working directory isn't listed in diagrams", () => {
    const dir = project({
      "app/pyproject.toml": '[project]\nname = "shop"\n',
      "layers.mmd": '%% inwards: layers\nflowchart TD\n  domain["shop.domain"]\n',
    });
    const run = inwards(["import-diagram", "../layers.mmd"], { cwd: join(dir, "app") });
    expect(run.code).toBe(0);
    expect(run.stdout).not.toContain("diagrams =");
    expect(run.stderr).toContain("lies outside the working directory");
  });

  test("never overwrites an existing [tool.inwards]", () => {
    const dir = project({
      ...FILES,
      "pyproject.toml": '[tool.inwards]\nlayers = [{ name = "a", modules = ["shop"] }]\n',
    });
    const before = readFileSync(join(dir, "pyproject.toml"), "utf8");
    const run = inwards(["import-diagram", "docs/architecture.md", "--write"], { cwd: dir });
    expect(run.code).toBe(2);
    expect(run.stderr).toContain(
      "already has [tool.inwards], and import-diagram never overwrites it",
    );
    expect(readFileSync(join(dir, "pyproject.toml"), "utf8")).toBe(before);
  });

  test.each([
    [[], {}, "Usage: inwards import-diagram FILE [--write]"],
    [["missing.md"], {}, "inwards import-diagram: missing.md: no such file."],
    [["README.md"], { "README.md": "# Shop\n" }, "README.md: no marked diagram"],
    [
      ["a.mmd"],
      { "a.mmd": "%% inwards: layers\nflowchart TD\n  a --> b --> a\n" },
      "a.mmd:3: the layers diagram has a cycle, a --> b --> a",
    ],
    [
      ["a.mmd"],
      { "a.mmd": '%% inwards: layers\nflowchart TD\n  a["shop"] --> b["shop"]\n' },
      "the table read from a.mmd doesn't parse",
    ],
    [
      ["a.mmd", "--write"],
      { "a.mmd": "%% inwards: layers\nflowchart TD\n  a\n" },
      "there is no pyproject.toml to write to",
    ],
  ])("exits 2: %p", (args, files, message) => {
    const run = inwards(["import-diagram", ...args], { cwd: project({ "x.txt": "", ...files }) });
    expect([run.code, run.stderr]).toEqual([2, expect.stringContaining(message)]);
  });
});
