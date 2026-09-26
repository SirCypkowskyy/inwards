import { describe, expect, test } from "bun:test";
import { LAYERS } from "./run.ts";
import { LEAK, put, session, stop } from "./stop-helpers.ts";

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

  test('"changed", the default, checks only what the session changed', () => {
    for (const gate of ["changed", undefined]) {
      const root = started(gate);
      put(root, "shop/tools/fmt.py", "X = 1\n");
      expect(stop(root).code).toBe(0);
    }
  });
});
