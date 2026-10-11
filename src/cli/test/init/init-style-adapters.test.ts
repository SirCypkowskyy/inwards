/**
 * @file INW015 in the presets with a layer of driven adapters, clean and
 * hexagonal: the config names that layer as `role` and `bootstrap` as
 * `allowed-in`, the scaffold passes, and a driving module that builds the
 * in-memory repository itself gets an INW015 warning. Each test runs init on
 * a fresh uv project, then edits the scaffold by hand; INW014 has its own
 * file, `init-style-ports.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findings, init, PASSING, UV_PROJECT } from "../support/init-style-helpers.ts";
import { inwards, project } from "../support/run.ts";

/** The adapter class the scaffold's driven layer defines, and its module's name. */
const ADAPTER = "InMemoryOrderRepository";
const ADAPTER_MODULE = "in_memory_orders";

/**
 * Runs `inwards check --format json` and lists each finding with its severity.
 *
 * @param root - the project directory.
 * @returns the exit code and each finding as `CODE severity file`, sorted.
 */
function graded(root: string): { code: number; found: string[] } {
  const { code, stdout } = inwards(["check", "--format", "json"], { cwd: root });
  const { diagnostics } = JSON.parse(stdout);
  const found: string[] = [];
  for (const d of diagnostics) {
    found.push(`${d.code} ${d.severity} ${d.file}`);
  }
  return { code, found: found.sort() };
}

/**
 * Adds lines to a scaffold module after its `import argparse`, so they sit
 * among its imports.
 *
 * @param path - the module's path.
 * @param lines - the lines to add.
 * @throws Error when the module has no `import argparse` line, so the edit would be lost.
 */
function afterArgparse(path: string, lines: string): void {
  const text = readFileSync(path, "utf8");
  if (!text.includes("import argparse\n")) {
    throw new Error(`${path} has no "import argparse" line`);
  }
  writeFileSync(path, text.replace("import argparse\n", `import argparse\n\n${lines}\n`));
}

describe.each([
  {
    style: "clean",
    role: "infrastructure",
    driving: "presentation/cli.py",
    direct: { code: 0, found: ["INW015 warning src/my_app/presentation/cli.py"] },
  },
  {
    // inbound and outbound are siblings, so INW001 reports the import first
    // and INW015 doesn't repeat it.
    style: "hexagonal",
    role: "adapters.outbound",
    driving: "adapters/inbound/cli.py",
    direct: { code: 1, found: ["INW001 error src/my_app/adapters/inbound/cli.py"] },
  },
])("$style: INW015 construct-only-in", ({ style, role, driving, direct }) => {
  /**
   * Scaffolds the preset on a fresh uv project.
   *
   * @returns the project directory.
   */
  function scaffolded(): string {
    const root = project(UV_PROJECT);
    init(root, "--style", style, "--scaffold");
    return root;
  }

  test("is on as a warning for the driven adapters, built only in bootstrap", () => {
    const root = project(UV_PROJECT);
    const run = init(root, "--style", style, "--scaffold");
    expect({ init: run.code, check: findings(root) }).toEqual(PASSING);
    const text = readFileSync(join(root, "pyproject.toml"), "utf8");
    expect(text).toContain('extend-select = ["INW014", "INW015"]');
    expect(text).toContain('INW014 = "warning"\nINW015 = "warning"\n');
    expect(text).toContain(
      `[tool.inwards.rules.construct-only-in]\nrole = ["my_app.${role}"]\nallowed-in = ["my_app.bootstrap"]\n`,
    );
    const bootstrap = readFileSync(join(root, "src/my_app/bootstrap.py"), "utf8");
    expect(bootstrap).toContain(`from my_app.${role}.${ADAPTER_MODULE} import ${ADAPTER}`);
  });

  test("a driving module that builds the adapter through a re-export is an INW015 warning", () => {
    const root = scaffolded();
    appendFileSync(
      join(root, "src/my_app/__init__.py"),
      `\n\nfrom my_app.${role}.${ADAPTER_MODULE} import ${ADAPTER} as ${ADAPTER}\n`,
    );
    const path = join(root, "src/my_app", driving);
    afterArgparse(path, `from my_app import ${ADAPTER}`);
    appendFileSync(path, `\n\nREPOSITORY = ${ADAPTER}()\n`);
    const file = `src/my_app/${driving}`;
    // INW006 reports the import from the package above the layers; INW015
    // follows the re-export to the class and reports the call.
    expect(graded(root)).toEqual({
      code: 1,
      found: [`INW006 error ${file}`, `INW015 warning ${file}`],
    });
  });

  test("a driving module that imports the adapter directly is reported once", () => {
    const root = scaffolded();
    const path = join(root, "src/my_app", driving);
    afterArgparse(path, `from my_app.${role}.${ADAPTER_MODULE} import ${ADAPTER}`);
    appendFileSync(path, `\n\nREPOSITORY = ${ADAPTER}()\n`);
    expect(graded(root)).toEqual({ code: direct.code, found: [...direct.found] });
  });
});
