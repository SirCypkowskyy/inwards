/**
 * @file Where `inwards init --style` writes, and what it refuses: it names the
 * pyproject.toml it will change, picks the source root carefully, and never
 * writes through a symlink, outside the project, or halfway.
 * A refused run leaves the project byte for byte as it was.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { checkSummary, init, tree, UV_PROJECT } from "../support/init-style-helpers.ts";
import { inwards, project } from "../support/run.ts";

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
  test("a dangling symlink where a file would go is refused, and its target is not created", () => {
    if (process.platform === "win32") {
      return; // creating symlinks needs a privilege on Windows
    }
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
  });

  test("a layer directory that is a symlink out of the project is refused", () => {
    if (process.platform === "win32") {
      return; // creating symlinks needs a privilege on Windows
    }
    const outside = project({});
    const root = project(UV_PROJECT);
    symlinkSync(outside, join(root, "src/my_app/domain"));
    const run = init(root, "--style", "hexagonal", "--scaffold");
    expect(run.code).toBe(2);
    expect(run.stderr).toContain("src/my_app/domain/order.py");
    expect(readdirSync(outside)).toEqual([]);
    expect(readFileSync(join(root, "pyproject.toml"), "utf8")).toBe(
      UV_PROJECT["pyproject.toml"] ?? "",
    );
  });

  test("a write that fails removes what this run created and leaves pyproject.toml alone", () => {
    if (process.platform === "win32" || process.getuid?.() === 0) {
      return; // Windows has no read-only directories this way, and root ignores the bit
    }
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
