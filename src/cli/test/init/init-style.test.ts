/**
 * @file `inwards init --style`, with and without `--scaffold`, on a fresh uv
 * project: the preset's table, the example package, the annotated tree and the
 * check result. It is idempotent: a second run exits 2 and writes nothing, and
 * so does an existing `[tool.inwards]` or a file in the way.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import {
  checkSummary,
  init,
  STYLES,
  stable,
  tree,
  UV_PROJECT,
} from "../support/init-style-helpers.ts";
import { LAYERS, project } from "../support/run.ts";

describe("inwards init --style X --scaffold on a fresh uv project", () => {
  test.each([...STYLES])("%s: exit 0, then check reports 0 violations and 0 warnings", (style) => {
    const root = project(UV_PROJECT);
    const run = init(root, "--style", style, "--scaffold");
    expect(run.code).toBe(0);
    expect(run.stderr).toBe("");
    const check = checkSummary(root);
    expect(check.code).toBe(0);
    expect(check.summary["violations"]).toBe(0);
    expect(check.summary["warnings"]).toBe(0);
    const files = tree(root);
    const table = (files["pyproject.toml"] ?? "").split("[tool.inwards]")[1] ?? "";
    expect({
      stdout: stable(run.stdout, root),
      table: stable(`[tool.inwards]${table}`, root),
      created: Object.keys(files).filter((path) => !(path in UV_PROJECT)),
      check: check.summary,
    }).toMatchSnapshot();
    // uv's own package file is kept as it was.
    expect(files["src/my_app/__init__.py"]).toBe(UV_PROJECT["src/my_app/__init__.py"]);
  });

  test("running it twice changes nothing: the second run exits 2 and writes nothing", () => {
    const root = project(UV_PROJECT);
    expect(init(root, "--style", "hexagonal", "--scaffold").code).toBe(0);
    const before = tree(root);
    const again = init(root, "--style", "hexagonal", "--scaffold");
    expect(again.code).toBe(2);
    expect(again.stderr).toContain("already has [tool.inwards]");
    expect(tree(root)).toEqual(before);
  });

  test("an existing [tool.inwards] makes it exit 2 without writing anything", () => {
    const root = project({ "pyproject.toml": LAYERS });
    const before = tree(root);
    const run = init(root, "--style", "clean", "--scaffold", "--package", "shop");
    expect(run.code).toBe(2);
    expect(run.stderr).toContain("never rewrites layers");
    expect(tree(root)).toEqual(before);
  });

  test("a file the scaffold would create makes it exit 2, list the file and write nothing", () => {
    const mine = "# my own order\n";
    const root = project({ ...UV_PROJECT, "src/my_app/domain/order.py": mine });
    const before = tree(root);
    const run = init(root, "--style", "layered", "--scaffold");
    expect(run.code).toBe(2);
    expect(run.stderr).toContain("\n  src/my_app/domain/order.py\n");
    expect(tree(root)).toEqual(before);
  });

  test("uv itself, when installed: uv init --package, then init and check", () => {
    const uv = Bun.which("uv");
    if (uv === null) {
      return; // CI's test job has no uv; the fixture above mirrors what it writes.
    }
    const parent = project({});
    const made = Bun.spawnSync([uv, "init", "--package", "--no-workspace", "-q", "shop"], {
      cwd: parent,
    });
    expect(made.exitCode).toBe(0);
    const root = join(parent, "shop");
    expect(init(root, "--style", "hexagonal", "--scaffold").code).toBe(0);
    expect(checkSummary(root)).toEqual({
      code: 0,
      summary: { filesChecked: 14, violations: 0, warnings: 0 },
    });
  });
});

describe("inwards init --style", () => {
  test("without --scaffold, only [tool.inwards] is written, and the tree marks the missing layers", () => {
    const root = project(UV_PROJECT);
    const run = init(root, "--style", "clean");
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("domain/          domain: imports no other layer (missing)");
    // A missing module is drawn the way the scaffold would create it.
    expect(run.stdout).toContain(
      "bootstrap.py     bootstrap: may import every other layer (missing)",
    );
    expect(Object.keys(tree(root)).sort()).toEqual(Object.keys(UV_PROJECT).sort());
  });

  test("--dry-run prints every change as a diff and writes nothing", () => {
    const root = project(UV_PROJECT);
    const run = init(
      root,
      "--style",
      "hexagonal",
      "--scaffold",
      "--agent",
      "agents-md",
      "--dry-run",
    );
    expect(run.code).toBe(0);
    const out = stable(run.stdout, root);
    expect(out).toContain("+[tool.inwards]");
    expect(out).toContain(`+required-version = "<VERSION>"`);
    expect(out).toContain("+++ <ROOT>/src/my_app/adapters/inbound/cli.py (after init)");
    expect(out).toContain("+++ <ROOT>/AGENTS.md (after init)");
    expect(tree(root)).toEqual(tree(project(UV_PROJECT)));
  });

  test("combines with --agent: the agent is wired too, and init --agent then finds nothing to do", () => {
    const root = project(UV_PROJECT);
    const run = init(root, "--style", "layered", "--scaffold", "--agent", "claude");
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("settings.local.json");
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toContain(".inwards/");
    expect(init(root, "--agent", "claude").stdout).toContain("nothing to change");
  });

  test("the package comes from [project].name, or from --package", () => {
    const bare = { "pyproject.toml": "[build-system]\nrequires = []\n" };
    const root = project(bare);
    const missing = init(root, "--style", "hexagonal");
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain("--package");
    expect(init(root, "--style", "hexagonal", "--scaffold", "--package", "shop").code).toBe(0);
    // No src/ directory: a flat layout, so the root is the project directory.
    expect(readFileSync(join(root, "pyproject.toml"), "utf8")).toContain('root = "."');
    expect(existsSync(join(root, "shop", "bootstrap.py"))).toBe(true);
    expect(checkSummary(root).summary).toEqual({ filesChecked: 15, violations: 0, warnings: 0 });
  });

  test("without a pyproject.toml, init exits 2 and suggests uv init --package", () => {
    const run = init(project({}), "--style", "clean");
    expect(run.code).toBe(2);
    expect(run.stderr).toContain("uv init --package");
  });

  test("a CRLF pyproject.toml stays CRLF", () => {
    const text = (UV_PROJECT["pyproject.toml"] ?? "").replaceAll("\n", "\r\n");
    const root = project({ ...UV_PROJECT, "pyproject.toml": text });
    expect(init(root, "--style", "clean").code).toBe(0);
    const after = readFileSync(join(root, "pyproject.toml"), "utf8");
    expect(after.startsWith(text)).toBe(true);
    expect(after.replaceAll("\r\n", "")).not.toContain("\n");
  });

  test.each([
    [["--style", "onion"], "--style must be one of"],
    [["--agent", "claude", "--scaffold"], "need --style"],
    [["--style", "clean", "--package", "my-app"], "not a Python package name"],
    [["--style", "clean", "--package", "class"], "not a Python package name"],
    [["--style", "clean", "--package", "acme.import"], "not a Python package name"],
  ])("%p exits 2", (args, message) => {
    const root = project(UV_PROJECT);
    const run = init(root, ...args);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain(message);
  });
});

describe("inwards init without --style or --agent", () => {
  test("with no terminal, it exits 2 within 1 s and lists the styles and flags", () => {
    const root = project(UV_PROJECT);
    const start = performance.now();
    const run = init(root);
    const elapsed = performance.now() - start;
    expect(run.code).toBe(2);
    expect(elapsed).toBeLessThan(1000);
    for (const style of STYLES) {
      expect(run.stderr).toContain(`${style}: `);
    }
    expect(run.stderr).toContain("--style layered|clean|hexagonal");
    expect(tree(root)).toEqual(tree(project(UV_PROJECT)));
  });

  test("--list-styles prints each preset's layers", () => {
    const run = init(process.cwd(), "--list-styles", "--package", "shop");
    expect(run.code).toBe(0);
    expect(run.stdout).toMatchSnapshot();
  });
});
