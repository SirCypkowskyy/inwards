/**
 * @file `inwards import-config` (#55) as a command. Each project under
 * `fixtures/import-linter/projects` breaks its import-linter contracts on
 * purpose; the expected findings are what `lint-imports` (import-linter 2.15)
 * reports there, so after `--write` the converted config must flag the same
 * imports, or the report must say why it can't. Also: printing, the file
 * argument, the src root, and the refusals.
 */
import { describe, expect, test } from "bun:test";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseConfig } from "@inwards/core";
import { inwards, project } from "../support/run.ts";
import { tempDir } from "../support/temp.ts";

const FIXTURES = join(import.meta.dir, "../support/fixtures/import-linter");
const ROOT = "[importlinter]\nroot_package = mypackage\n\n";

/**
 * Copies a fixture project to a temp directory.
 *
 * @param name - the folder under fixtures/import-linter/projects.
 * @returns the copy's path.
 */
function copy(name: string): string {
  const dir = tempDir("inwards-import-config-");
  cpSync(join(FIXTURES, "projects", name), dir, { recursive: true });
  return dir;
}

/**
 * Lists the errors and warnings `inwards check` reports.
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

// What lint-imports reported in each project, as the Inwards finding that stands for it.
const PROJECTS: Record<string, string[]> = {
  // mypackage.low -> mypackage.high; mypackage.blue -> mypackage.green.
  layers: ["INW001 mypackage/blue.py:1", "INW001 mypackage/low.py:1"],
  // mypackage.foo.low -> mypackage.foo.high; mypackage.foo.extra is not a layer (exhaustive).
  // mypackage.bar has no (medium) layer, which the report points out.
  containers: [
    "INW001 mypackage/foo/low.py:1",
    "INW006 mypackage/foo/extra.py:1",
    "INW006 pyproject.toml:20",
  ],
  // mypackage.domain -> pydantic and -> mypackage.legacy; Inwards adds INW006 for the unlayered legacy package.
  forbidden: [
    "INW002 mypackage/domain/model.py:3",
    "INW005 mypackage/domain/model.py:1",
    "INW006 mypackage/domain/model.py:3",
    "INW006 mypackage/legacy/__init__.py:1",
  ],
  // mypackage.bar -> mypackage.foo; baz -> foo is in ignore_imports, which the report names.
  independence: ["INW002 mypackage/bar/green.py:1", "INW002 mypackage/baz/blue.py:1"],
};

describe("inwards import-config", () => {
  test.each(Object.entries(PROJECTS))(
    "%s: --write, then check flags what import-linter flags",
    (name, expected) => {
      const dir = copy(name);
      const run = inwards(["import-config", "--write"], { cwd: dir });
      expect(run.code).toBe(0);
      expect(run.stdout).toContain("wrote [tool.inwards] to pyproject.toml");
      expect(run.stderr).toContain("inwards import-config: converted");
      expect(findings(dir)).toEqual(expected);
    },
  );

  test("prints the table on stdout and the report on stderr", () => {
    const run = inwards(["import-config"], { cwd: copy("independence") });
    expect(run.code).toBe(0);
    expect(() => parseConfig(run.stdout)).not.toThrow();
    expect(run.stdout).toStartWith("# Converted from .importlinter by inwards import-config.\n");
    expect(run.stderr).toContain("partial independent");
    expect(run.stderr).toContain("mypackage.baz.blue -> mypackage.foo.purple");
  });

  test("reads the file named on the command line and picks the src root", () => {
    const dir = project({
      "lint.ini": `${ROOT}[importlinter:contract:l]\nname = L\ntype = layers\nlayers =\n  mypackage.b\n  mypackage.a\n`,
      "src/mypackage/__init__.py": "",
    });
    const run = inwards(["import-config", "lint.ini"], { cwd: dir });
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('root = "src"');
  });

  test("never overwrites an existing [tool.inwards]", () => {
    const dir = copy("layers");
    const path = join(dir, "pyproject.toml");
    writeFileSync(path, `${readFileSync(path, "utf8")}\n[tool.inwards]\nlayers = []\n`);
    const before = readFileSync(path, "utf8");
    const run = inwards(["import-config", "--write"], { cwd: dir });
    expect(run.code).toBe(2);
    expect(run.stderr).toContain("already has [tool.inwards]");
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  test.each([
    [[], {}, "no import-linter config"],
    [["missing.ini"], {}, "missing.ini: no such file"],
    [["--write"], { ".importlinter": `${ROOT}` }, "there is no pyproject.toml to write to"],
    [[], { ".importlinter": "[importlinter]\n[importlinter]\n" }, "appears twice"],
  ])("exits 2: %p", (args, files, message) => {
    const run = inwards(["import-config", ...args], { cwd: project({ "x.txt": "", ...files }) });
    expect([run.code, run.stderr]).toEqual([2, expect.stringContaining(message)]);
  });
});
