import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import process from "node:process";
import { VERSION } from "@inwards/core";
import { inwards, LAYERS, project, type RunResult } from "./run.ts";

/** What `uv init --package my-app` writes (uv 0.12), so the tests don't need uv. */
const UV_PROJECT: Record<string, string> = {
  "pyproject.toml": `[project]
name = "my-app"
version = "0.1.0"
description = "Add your description here"
readme = "README.md"
requires-python = ">=3.12"
dependencies = []

[project.scripts]
my-app = "my_app:main"

[build-system]
requires = ["uv_build>=0.12.0,<0.13.0"]
build-backend = "uv_build"
`,
  "README.md": "",
  ".python-version": "3.12\n",
  ".gitignore": "# Python-generated files\n__pycache__/\n\n# Virtual environments\n.venv\n",
  "src/my_app/__init__.py": 'def main() -> None:\n    print("Hello from my-app!")\n',
};

const STYLES = ["layered", "clean", "hexagonal"] as const;
const RELEASE = VERSION.replace(/-.*$/u, "");

/**
 * Runs `inwards init` in a project.
 *
 * @param root - the project directory.
 * @param args - arguments after `init`.
 * @returns the exit code and output.
 */
function init(root: string, ...args: string[]): RunResult {
  return inwards(["init", ...args], { cwd: root });
}

/**
 * Reads every file of a project, keyed by forward-slash path; a symlink is
 * recorded by its target, not followed.
 *
 * @param root - the project directory.
 * @returns the file texts, sorted by path.
 */
function tree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  /**
   * Adds a directory's files to `out`, recursively.
   *
   * @param dir - the directory to read.
   */
  function walk(dir: string): void {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const key = relative(root, path).split(sep).join("/");
      const entry = lstatSync(path);
      if (entry.isSymbolicLink()) {
        out[key] = `-> ${readlinkSync(path)}`; // never followed: it may lead outside
      } else if (entry.isDirectory()) {
        walk(path);
      } else {
        out[key] = readFileSync(path, "utf8");
      }
    }
  }
  walk(root);
  return out;
}

/**
 * Makes output comparable across machines: the project path becomes <ROOT>,
 * backslashes become slashes, and the release number becomes <VERSION>.
 *
 * @param text - CLI output.
 * @param root - the project directory.
 * @returns the normalised text.
 */
function stable(text: string, root: string): string {
  // The CLI sees the cwd as the OS resolves it: /private/var for /var on macOS.
  return [realpathSync.native(root), root]
    .reduce((out, path) => out.replaceAll(path, "<ROOT>"), text)
    .replaceAll("\\", "/")
    .replaceAll(RELEASE, "<VERSION>");
}

/**
 * Runs `inwards check --format json` and keeps the summary counts.
 *
 * @param root - the project directory.
 * @returns the exit code and the violation, warning and file counts.
 */
function checkSummary(root: string): { code: number; summary: Record<string, number> } {
  const { code, stdout } = inwards(["check", "--format", "json"], { cwd: root });
  const { summary } = JSON.parse(stdout);
  const { durationMs: _, ...counts } = summary;
  return { code, summary: counts };
}

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

describe("inwards init --style: where it writes", () => {
  test("run below the project, it names the pyproject.toml it is about to change", () => {
    const root = project({ ...UV_PROJECT, "docs/.keep": "" });
    const run = inwards(["init", "--style", "clean"], { cwd: join(root, "docs") });
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("using ../pyproject.toml, the nearest pyproject.toml above here.");
    expect(readFileSync(join(root, "pyproject.toml"), "utf8")).toContain("[tool.inwards]");
  });

  test("an unrelated src/ (no Python, no uv_build) doesn't make it a src layout", () => {
    const root = project({
      "pyproject.toml": '[project]\nname = "shop"\n',
      "src/index.ts": "export {};\n",
    });
    expect(init(root, "--style", "hexagonal", "--scaffold").code).toBe(0);
    expect(readFileSync(join(root, "pyproject.toml"), "utf8")).toContain('root = "."');
    expect(existsSync(join(root, "shop", "bootstrap.py"))).toBe(true);
    expect(checkSummary(root).summary).toMatchObject({ violations: 0, warnings: 0 });
  });
});

describe("inwards init --scaffold never writes through a symlink or halfway", () => {
  // Symlinks need privileges on Windows, and root ignores the read-only bit.
  const posixOnly = process.platform === "win32" ? test.skip : test;
  const asUser = process.platform === "win32" || process.getuid?.() === 0 ? test.skip : test;

  posixOnly(
    "a dangling symlink where a file would go is refused, and its target is not created",
    () => {
      const outside = project({});
      const root = project(UV_PROJECT);
      mkdirSync(join(root, "src/my_app/domain"), { recursive: true });
      symlinkSync(join(outside, "stolen.py"), join(root, "src/my_app/domain/order.py"));
      const before = tree(root);
      const run = init(root, "--style", "clean", "--scaffold");
      expect(run.code).toBe(2);
      expect(run.stderr).toContain("\n  src/my_app/domain/order.py\n");
      expect(existsSync(join(outside, "stolen.py"))).toBe(false);
      expect(tree(root)).toEqual(before);
    },
  );

  posixOnly("a layer directory that is a symlink out of the project is refused", () => {
    const outside = project({});
    const root = project(UV_PROJECT);
    symlinkSync(outside, join(root, "src/my_app/domain"));
    const run = init(root, "--style", "hexagonal", "--scaffold");
    expect(run.code).toBe(2);
    expect(run.stderr).toContain("src/my_app/domain/order.py");
    expect(readdirSync(outside)).toEqual([]);
    expect(readFileSync(join(root, "pyproject.toml"), "utf8")).toBe(UV_PROJECT["pyproject.toml"]);
  });

  asUser("a write that fails removes what this run created and leaves pyproject.toml alone", () => {
    const root = project(UV_PROJECT);
    mkdirSync(join(root, "tests"));
    chmodSync(join(root, "tests"), 0o500); // the test file is written last of the scaffold
    const before = tree(root);
    const run = init(root, "--style", "layered", "--scaffold");
    chmodSync(join(root, "tests"), 0o700);
    expect(run.code).toBe(2);
    expect(run.stderr.trim().split("\n")).toHaveLength(1);
    expect(run.stderr).toContain("could not write");
    expect(tree(root)).toEqual(before);
    expect(existsSync(join(root, "src/my_app/domain"))).toBe(false);
    // Nothing is half-done, so the same command works once the cause is gone.
    expect(init(root, "--style", "layered", "--scaffold").code).toBe(0);
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
