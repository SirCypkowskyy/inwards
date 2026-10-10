/**
 * @file A full check gives the same output on one thread and on several
 * (#61): the same JSON, byte for byte apart from the duration, the same exit
 * code and the same baseline, for a project big enough to start the worker
 * pool, with violations, suppressions, a dynamic import, an import inside a
 * string and a file outside the layers. In CI this runs the compiled binary,
 * whose workers are the binary itself.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BASELINE_FILE } from "../../src/project/baseline.ts";
import { MIN_PARALLEL_FILES } from "../../src/project/threads.ts";
import { inwards, LAYERS, project } from "../support/run.ts";

/** The duration field, the one part of the output that may differ. */
const DURATION = /"durationMs":\s*[\d.]+/gu;

/** One module in ten of each: INW001, a suppressed INW001, INW011, an import in a string. */
const BODIES: readonly string[] = [
  "import shop.infrastructure.db\n",
  'import shop.infrastructure.db  # inwards: ignore[INW001] reason="legacy"\n',
  'import importlib\nimportlib.import_module("shop.infrastructure.db")\n',
  "x = '''\nimport shop.infrastructure.db\n'''\nimport shop.domain.m1\n",
];

/**
 * Builds a project with more files than the pool's threshold.
 *
 * @returns the project root.
 */
function bigProject(): string {
  const files: Record<string, string> = {
    "pyproject.toml": LAYERS,
    "shop/__init__.py": "",
    "shop/domain/__init__.py": "",
    "tools/run.py": "import shop.domain.m1\n", // outside every layer
  };
  for (let n = 0; n < MIN_PARALLEL_FILES + 50; n += 1) {
    const plain = `from shop.domain import m${n + 1}\n${"y = 1\n".repeat(n % 40)}`;
    files[`shop/domain/m${n}.py`] = BODIES[n % 10] ?? plain;
  }
  return project(files);
}

describe("threads never change the result", () => {
  test("inwards check: one thread and four give the same JSON", () => {
    const root = bigProject();
    const [one, four] = ["1", "4"].map((threads) =>
      inwards(["check", "--format", "json"], {
        cwd: root,
        env: { INWARDS_NO_CACHE: "1", INWARDS_THREADS: threads },
      }),
    );
    expect(one?.stderr).toBe("");
    expect(four?.stderr).toBe("");
    expect(one?.code).toBe(1);
    expect(four?.code).toBe(1);
    expect(four?.stdout.replace(DURATION, "")).toBe(one?.stdout.replace(DURATION, ""));
    expect(one?.stdout).toContain("INW011");
  });

  test("inwards baseline: one thread and four write the same baseline", () => {
    const root = bigProject();
    const [one, four] = ["1", "4"].map((threads) => {
      const run = inwards(["baseline"], { cwd: root, env: { INWARDS_THREADS: threads } });
      expect(run.code).toBe(0);
      return readFileSync(join(root, BASELINE_FILE), "utf8");
    });
    expect(four).toBe(one);
    expect(one?.length).toBeGreaterThan(100);
  });
});
