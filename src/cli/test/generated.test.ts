import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { inwards, LAYERS, project } from "./run.ts";

/**
 * Runs `inwards check --format json` and lists what it reports.
 *
 * @param root - the project directory.
 * @returns the exit code and the code of each diagnostic.
 */
function checkCodes(root: string): { code: number; found: string[] } {
  const { code, stdout } = inwards(["check", "--format", "json"], { cwd: root });
  const report: { diagnostics: { code: string }[] } = JSON.parse(stdout);
  return { code, found: report.diagnostics.map((d) => d.code) };
}

/**
 * Checks a project twice: as a developer's checkout, with the generated file,
 * and as a fresh CI checkout, without it.
 *
 * @param config - the pyproject.toml text.
 * @param generated - the generated file, relative to the project.
 * @param src - the domain module that imports it.
 * @returns the result with the file, then without it.
 */
function bothCheckouts(
  config: string,
  generated: string,
  src: string,
): { code: number; found: string[] }[] {
  const root = project({
    "pyproject.toml": config,
    "shop/__init__.py": "",
    "shop/infrastructure/db.py": "",
    "shop/domain/order.py": src,
    [generated]: "",
  });
  const local = checkCodes(root);
  rmSync(join(root, generated));
  return [local, checkCodes(root)];
}

const IMPORTS_PB2 = "from shop.domain.orders_pb2 import Order\n";

describe("generated modules in inwards check (#160)", () => {
  test("a *_pb2 import passes with and without the file, with no config", () => {
    const pass = { code: 0, found: [] };
    expect(bothCheckouts(LAYERS, "shop/domain/orders_pb2.py", IMPORTS_PB2)).toEqual([pass, pass]);
  });

  test("a configured pattern passes with and without the file", () => {
    const config = LAYERS.replace("[tool.inwards]\n", '[tool.inwards]\ngenerated = ["*_schema"]\n');
    const src = "import shop.domain.orders_schema\n";
    const pass = { code: 0, found: [] };
    expect(bothCheckouts(config, "shop/domain/orders_schema.py", src)).toEqual([pass, pass]);
  });

  test("with generated = [], a fresh checkout reports the missing module", () => {
    const config = LAYERS.replace("[tool.inwards]\n", "[tool.inwards]\ngenerated = []\n");
    expect(bothCheckouts(config, "shop/domain/orders_pb2.py", IMPORTS_PB2)).toEqual([
      { code: 0, found: [] },
      { code: 1, found: ["INW010"] },
    ]);
  });

  test("an invalid pattern is a config error", () => {
    const config = LAYERS.replace("[tool.inwards]\n", '[tool.inwards]\ngenerated = ["*"]\n');
    const root = project({ "pyproject.toml": config, "shop/domain/order.py": "" });
    const { code, stderr } = inwards(["check"], { cwd: root });
    expect(code).toBe(2);
    expect(stderr).toContain('tool.inwards.generated: "*" has no fixed character');
  });
});
