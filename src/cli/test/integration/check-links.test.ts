/**
 * @file `inwards check` on symlinks inside layers (#83, #84): a link out of the
 * config root, or into another layer, is an INW006 error at the link, while a
 * link within its layer, or out of the root from a package outside every
 * layer, passes. Symlinks need privileges on Windows, so these skip there.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { inwards, LAYERS, project, SLICES } from "../support/run.ts";
import { tempDir } from "../support/temp.ts";

const WINDOWS = process.platform === "win32";

/**
 * Runs `inwards check --format json` and keeps each finding's code, file and severity.
 *
 * @param root - the project.
 * @returns the exit code and the findings.
 */
function check(root: string): { code: number; found: { code: string; file: string }[] } {
  const { code, stdout } = inwards(["check", "--format", "json"], { cwd: root });
  const report: { diagnostics: { code: string; file: string; severity: string }[] } =
    JSON.parse(stdout);
  const found = report.diagnostics
    .filter((d) => d.severity === "error")
    .map((d) => ({ code: d.code, file: d.file }));
  return { code, found };
}

/**
 * Makes a directory outside every project with a module that imports infrastructure.
 *
 * @returns the directory.
 */
function outsideLeak(): string {
  const outside = tempDir("inwards-outside-");
  writeFileSync(join(outside, "leak.py"), "import shop.infrastructure.db\n");
  return outside;
}

describe.skipIf(WINDOWS)("inwards check: symlinks in layers", () => {
  test("a layer linking to a directory outside the project fails (#83)", () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "X = 1\n" });
    symlinkSync(outsideLeak(), join(root, "shop/domain/ext"), "dir");
    expect(check(root)).toEqual({ code: 1, found: [{ code: "INW006", file: "shop/domain/ext" }] });
  });

  test("a layer linking into another layer fails (#84)", () => {
    const root = project({
      "pyproject.toml": LAYERS,
      "shop/domain/order.py": "from shop.domain.infra_alias import db\n",
      "shop/infrastructure/db.py": "X = 1\n",
    });
    symlinkSync("../infrastructure", join(root, "shop/domain/infra_alias"), "dir");
    expect(check(root)).toEqual({
      code: 1,
      found: [{ code: "INW006", file: "shop/domain/infra_alias" }],
    });
  });

  test("a module linked from another layer fails too", () => {
    const root = project({
      "pyproject.toml": LAYERS,
      "shop/domain/order.py": "from shop.domain import db\n",
      "shop/infrastructure/db.py": "X = 1\n",
    });
    symlinkSync("../infrastructure/db.py", join(root, "shop/domain/db.py"), "file");
    expect(check(root).found).toEqual([{ code: "INW006", file: "shop/domain/db.py" }]);
  });

  test("a link within its layer passes", () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/real/order.py": "X = 1\n" });
    symlinkSync("real", join(root, "shop/domain/alias"), "dir");
    expect(check(root)).toEqual({ code: 0, found: [] });
  });

  test("a link out of the project from outside every layer isn't reported", () => {
    // Nothing under `tools` is layer code, so INW006 only warns about the package.
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "X = 1\n" });
    mkdirSync(join(root, "tools"));
    symlinkSync(outsideLeak(), join(root, "tools/ext"), "dir");
    expect(check(root)).toEqual({ code: 0, found: [] });
  });

  test("a layer package that is itself a link out of the root is named", () => {
    // A root of links to each uv workspace member's package: the walk skips them all.
    const root = project({
      "pyproject.toml": `[tool.inwards]
  root = "pyroot"
  layers = [{ name = "core", modules = ["core"] }]
  `,
      "src/core/model.py": "X = 1\n",
    });
    mkdirSync(join(root, "pyroot"));
    symlinkSync(join(root, "src/core"), join(root, "pyroot/core"), "dir");
    const { stdout } = inwards(["check", "--format", "json"], { cwd: root });
    const report: { diagnostics: { file: string; message: string }[] } = JSON.parse(stdout);
    const link = report.diagnostics.find((d) => d.file === "pyroot/core");
    expect(link?.message).toStartWith('pyroot/core is a symlink out of root "pyroot"');
  });

  test("a chain through code outside every layer is followed (review P2-1)", () => {
    const root = project({
      "pyproject.toml": LAYERS,
      "shop/domain/order.py": "from shop.domain.a.y import db\n",
      "shop/misc/__init__.py": "",
      "shop/infrastructure/db.py": "X = 1\n",
      "lib/__init__.py": "",
    });
    symlinkSync("../misc", join(root, "shop/domain/a"), "dir");
    symlinkSync("../infrastructure", join(root, "shop/misc/y"), "dir");
    symlinkSync("../../lib", join(root, "shop/domain/b"), "dir");
    symlinkSync(outsideLeak(), join(root, "lib/ext"), "dir");
    expect(check(root).found).toEqual([
      { code: "INW006", file: "shop/domain/a/y" },
      { code: "INW006", file: "shop/domain/b/ext" },
    ]);
  });

  test("a target under a linked layer package is named as Python imports it (review P2-2)", () => {
    // Not LAYERS itself: project() would add a real shop/infrastructure.
    const root = project({
      "pyproject.toml": `${LAYERS}\n`,
      "packages/shop/domain/order.py": "from shop.domain.alias import db\n",
      "packages/shop/infrastructure/db.py": "X = 1\n",
    });
    symlinkSync("packages/shop", join(root, "shop"), "dir");
    symlinkSync("../infrastructure", join(root, "packages/shop/domain/alias"), "dir");
    expect(check(root).found).toEqual([{ code: "INW006", file: "shop/domain/alias" }]);
  });

  test("a link to a directory above a linked layer package's real code is reported (review 2 P2)", () => {
    const root = project({
      "pyproject.toml": `${LAYERS}\n`,
      "packages/shop/domain/order.py": "from shop.domain.p.shop.infrastructure import db\n",
      "packages/shop/infrastructure/db.py": "X = 1\n",
    });
    symlinkSync("packages/shop", join(root, "shop"), "dir");
    symlinkSync("../../../packages", join(root, "packages/shop/domain/p"), "dir");
    expect(check(root).found).toEqual([{ code: "INW006", file: "shop/domain/p" }]);
  });

  test("a new slice linked out of the root is reported (review P2-3)", () => {
    const outside = tempDir("inwards-outside-");
    mkdirSync(join(outside, "domain"));
    writeFileSync(join(outside, "domain/svc.py"), "import shop.orders.infrastructure.db\n");
    const root = project({
      "pyproject.toml": SLICES,
      "shop/orders/domain/order.py": "X = 1\n",
      "shop/orders/infrastructure/db.py": "X = 1\n",
    });
    symlinkSync(outside, join(root, "shop/payments"), "dir");
    expect(check(root).found).toEqual([{ code: "INW006", file: "shop/payments" }]);
  });
});
