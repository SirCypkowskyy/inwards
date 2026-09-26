import { describe, expect, test } from "bun:test";
import { rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import type { Diagnostic } from "@inwards/core";
import { LAYERS } from "./run.ts";
import { agentWrites, LEAK, put, session, stop } from "./stop-helpers.ts";

const PROJECT_MODE = LAYERS.replace("[tool.inwards]", '[tool.inwards]\nstop-gate = "project"');

/** The domain's leak, as `inwards baseline` records it. */
const BASELINE = `${JSON.stringify({
  schema: "inwards/baseline@1",
  violations: [
    {
      code: "INW001",
      module: "shop.domain.legacy",
      message: 'Layer "domain" imports "shop.infrastructure.db" from outer layer "infrastructure".',
      count: 1,
    },
  ],
})}\n`;

/**
 * A started session on a project with a baselined violation and a domain
 * module that imports `shop.tools.fmt`, which doesn't exist yet (so it's
 * third-party code, and fine).
 *
 * @param gate - the `stop-gate` value, or undefined to leave it out.
 * @returns the project directory.
 */
function started(gate: string | undefined): string {
  const key = gate === undefined ? "" : `\nstop-gate = "${gate}"`;
  return session({
    "pyproject.toml": LAYERS.replace("[tool.inwards]", `[tool.inwards]${key}`),
    "shop/infrastructure/db.py": "",
    "shop/domain/legacy.py": LEAK,
    "shop/domain/svc.py": "from shop.tools import fmt\n",
    "inwards-baseline.json": BASELINE,
  });
}

describe('stop-gate = "project"', () => {
  test("the whole project is checked against the baseline", () => {
    expect(stop(started("project")).code).toBe(0);
  });

  test("a violation in a file the session didn't touch blocks", () => {
    const root = started("project");
    // First-party now: svc.py imports code that belongs to no layer (INW006).
    put(root, "shop/tools/fmt.py", "X = 1\n");
    const { code, stderr } = stop(root);
    expect(code).toBe(2);
    expect(stderr).toContain('"file":"shop/domain/svc.py"');
  });

  test("a baseline deleted during the session falls back to the changed files", () => {
    const root = started("project");
    rmSync(join(root, "inwards-baseline.json"));
    const { code, stderr } = stop(root);
    expect(code).toBe(2);
    expect(stderr).toContain("inwards-baseline.json changed");
    expect(stderr).not.toContain("shop.domain.legacy");
  });

  test("an emptied layer is reported once", () => {
    const root = started("project");
    rmSync(join(root, "shop/infrastructure"), { recursive: true });
    const { code, stderr } = stop(root);
    expect(code).toBe(2);
    const json = stderr.split("\n").find((line) => line.startsWith("{")) ?? "{}";
    const { diagnostics }: { diagnostics: Diagnostic[] } = JSON.parse(json);
    expect(diagnostics.filter((d) => d.file === "pyproject.toml")).toHaveLength(1);
  });

  test("a symlinked pyproject.toml governs the tree it sits in", () => {
    const tree = { "shop/domain/order.py": "X = 1\n", "shop/infrastructure/db.py": "" };
    const files: Record<string, string> = { "api/pyproject.toml": PROJECT_MODE };
    for (const [rel, text] of Object.entries(tree)) {
      files[`api/${rel}`] = text;
      files[`worker/${rel}`] = text;
    }
    files["worker/shop/domain/legacy.py"] = LEAK;
    const root = session(files, (dir) =>
      symlinkSync("../api/pyproject.toml", join(dir, "worker/pyproject.toml")),
    );
    const { code, stderr } = stop(root);
    expect(code).toBe(2);
    expect(stderr).toContain('"file":"worker/shop/domain/legacy.py"');
  });

  test('"changed", the default, checks only what the session changed', () => {
    for (const gate of ["changed", undefined]) {
      const root = started(gate);
      put(root, "shop/tools/fmt.py", "X = 1\n");
      expect(stop(root).code).toBe(0);
    }
  });
});

test("a Stop over files under two configs checks both", () => {
  const root = session({
    "pkg/pyproject.toml": LAYERS,
    "pkg/shop/domain/order.py": "X = 1\n",
    "pkg/shop/infrastructure/db.py": "",
  });
  agentWrites(root, "shop/domain/order.py", LEAK);
  agentWrites(root, "pkg/shop/domain/order.py", LEAK);
  const { code, stderr } = stop(root);
  expect(code).toBe(2);
  expect(stderr).not.toContain("Stop gate failed");
  expect(stderr).toContain('"file":"shop/domain/order.py"');
  expect(stderr).toContain('"file":"pkg/shop/domain/order.py"');
});
