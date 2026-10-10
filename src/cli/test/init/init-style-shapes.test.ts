/**
 * @file The package shapes `inwards init --style X --scaffold` writes: the
 * scaffold passes with them, a module planted beside the layers fails with
 * INW007 (and its Write is denied by the shape guard), normal growth inside a
 * layer passes, and a missing layer package fails with INW008. Each test
 * runs init on a fresh uv project, then changes the scaffold by hand.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { denied, pre } from "../support/guard-helpers.ts";
import { init, STYLES, UV_PROJECT } from "../support/init-style-helpers.ts";
import { inwards, project } from "../support/run.ts";

/**
 * Runs `inwards check --format json` and lists the package-shape findings.
 *
 * @param root - the project directory.
 * @returns the exit code and each INW007 or INW008 finding as `CODE severity file`.
 */
function shapeFindings(root: string): { code: number; findings: string[] } {
  const { code, stdout } = inwards(["check", "--format", "json"], { cwd: root });
  const { diagnostics } = JSON.parse(stdout);
  const findings: string[] = [];
  for (const d of diagnostics) {
    if (d.code === "INW007" || d.code === "INW008") {
      findings.push(`${d.code} ${d.severity} ${d.file}`);
    }
  }
  return { code, findings: findings.sort() };
}

/**
 * Writes a Python file into a project, creating its directory.
 *
 * @param root - the project directory.
 * @param rel - the file's path, relative to the project.
 */
function plant(root: string, rel: string): void {
  const path = join(root, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "VALUE = 1\n");
}

/**
 * Asks the shape guard (PreToolUse) whether a Write may create a file.
 *
 * @param root - the project directory.
 * @param rel - the file, relative to the project.
 * @returns the denial's reason, or undefined when the Write may go ahead.
 */
function preWrite(root: string, rel: string): string | undefined {
  return denied(pre(root, "Write", { file_path: rel, content: "X = 1\n" }));
}

/** Where each preset grows normally: a new module inside a layer. */
const GROWTH: Readonly<Record<(typeof STYLES)[number], string>> = {
  layered: "src/my_app/domain/customer.py",
  clean: "src/my_app/domain/customer.py",
  hexagonal: "src/my_app/domain/customer.py",
  "vertical-slices": "src/my_app/features/orders/customer.py",
  "bounded-contexts": "src/my_app/orders/domain/customer.py",
  django: "src/my_app/orders/admin.py",
  fastapi: "src/my_app/pagination.py",
};

describe("inwards init --style X --scaffold writes package shapes", () => {
  test.each([...STYLES])(
    "%s: a module beside the layers fails with INW007, one inside a layer passes",
    (style) => {
      const root = project(UV_PROJECT);
      expect(init(root, "--style", style, "--scaffold").code).toBe(0);
      expect(shapeFindings(root)).toEqual({ code: 0, findings: [] });
      plant(root, GROWTH[style]); // normal growth: a new entity
      plant(root, "src/my_app/_version.py"); // written by hatch-vcs or setuptools-scm
      plant(root, "src/my_app/__main__.py");
      expect(shapeFindings(root)).toEqual({ code: 0, findings: [] });
      plant(root, "src/my_app/helpers.py");
      expect(shapeFindings(root)).toEqual({
        code: 1,
        findings: ["INW007 error src/my_app/helpers.py"],
      });
    },
  );

  test.each([
    ["clean", "src/my_app/application/dto.py", "INW007 warning src/my_app/application/dto.py"],
    ["hexagonal", "src/my_app/application/dto.py", "INW007 warning src/my_app/application/dto.py"],
    [
      "hexagonal",
      "src/my_app/adapters/http/__init__.py",
      "INW007 error src/my_app/adapters/http/__init__.py",
    ],
    [
      "vertical-slices",
      "src/my_app/features/helpers.py",
      "INW007 error src/my_app/features/helpers.py",
    ],
    ["bounded-contexts", "src/my_app/orders/utils.py", "INW007 warning src/my_app/orders/utils.py"],
    ["django", "src/my_app/orders/forms.py", "INW007 warning src/my_app/orders/forms.py"],
    ["fastapi", "src/my_app/posts/helpers.py", "INW007 error src/my_app/posts/helpers.py"],
  ])("%s: planting %s reports %s", (style, rel, finding) => {
    const root = project(UV_PROJECT);
    expect(init(root, "--style", style, "--scaffold").code).toBe(0);
    plant(root, rel);
    expect(shapeFindings(root)).toEqual({
      code: finding.includes("error") ? 1 : 0,
      findings: [finding],
    });
  });

  test("the shape guard denies a module beside the layers, not a new entity, adapter or use case", () => {
    const root = project(UV_PROJECT);
    expect(init(root, "--style", "hexagonal", "--scaffold").code).toBe(0);
    expect(preWrite(root, "src/my_app/domain/customer.py")).toBeUndefined();
    expect(preWrite(root, "src/my_app/adapters/outbound/sql_orders.py")).toBeUndefined();
    expect(preWrite(root, "src/my_app/application/use_cases/cancel_order.py")).toBeUndefined();
    expect(preWrite(root, "src/my_app/application/dto.py")).toBeUndefined(); // a warning only
    expect(preWrite(root, "src/my_app/helpers.py")).toContain(
      '"helpers.py" is not an allowed member',
    );
    expect(preWrite(root, "src/my_app/adapters/http.py")).toContain('"http.py" is not an allowed');
  });

  test.each([
    [
      "vertical-slices",
      "src/my_app/features/orders/api.py",
      "src/my_app/features/orders/__init__.py",
    ],
    ["bounded-contexts", "src/my_app/orders/api.py", "src/my_app/orders/__init__.py"],
    ["django", "src/my_app/orders/services.py", "src/my_app/orders/__init__.py"],
    ["fastapi", "src/my_app/posts/router.py", "src/my_app/posts/__init__.py"],
  ])("%s: removing %s fails with INW008", (style, rel, where) => {
    const root = project(UV_PROJECT);
    expect(init(root, "--style", style, "--scaffold").code).toBe(0);
    rmSync(join(root, rel));
    expect(shapeFindings(root).findings).toContain(`INW008 error ${where}`);
  });

  test("removing a layer package fails with INW008", () => {
    const root = project(UV_PROJECT);
    expect(init(root, "--style", "clean", "--scaffold").code).toBe(0);
    rmSync(join(root, "src/my_app/presentation"), { recursive: true });
    expect(shapeFindings(root).findings).toEqual(["INW008 error src/my_app/__init__.py"]);
  });
});
