/**
 * @file A full check gives the same output on one thread and on several
 * (#61): the same JSON, byte for byte apart from the duration, the same exit
 * code and the same baseline, for a project big enough to start the worker
 * pool, with violations, suppressions, a dynamic import, an import inside a
 * string and a file outside the layers. Every run must also exit on its own
 * within a time limit, so a worker that kept the process alive fails here.
 * In CI this runs the compiled binary, whose workers are the binary itself.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BASELINE_FILE } from "../../src/project/baseline.ts";
import { MIN_PARALLEL_FILES } from "../../src/project/threads.ts";
import { inwards, LAYERS, project, type RunResult } from "../support/run.ts";

/** The duration field, the one part of the output that may differ. */
const DURATION = /"durationMs":\s*[\d.]+/gu;

/**
 * Limits for these tests. Each makes a project of over 1,000 files and runs
 * the CLI on it twice, cold (`INWARDS_NO_CACHE=1`); one such run took about
 * 0.8 s on a Windows runner, and Windows runners vary a lot. A run that
 * takes longer than `RUN_MS` is killed and fails with its time.
 */
const RUN_MS = 30_000;
const TEST_MS: number = 2 * RUN_MS + 15_000;
/** A run that exited on its own, with 0 or 1, as `timed` labels it. */
const EXITED = /exit [01] after/u;
/** A baseline run that exited on its own, with 0. */
const WROTE = /exit 0 after/u;

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

/**
 * Runs the CLI cold on a thread count, timed.
 *
 * @param args - CLI arguments.
 * @param root - the project.
 * @param threads - the `INWARDS_THREADS` value.
 * @returns what the run printed, and a label with its exit code and time, which
 *   says which thread count was slow or never exited when a test fails.
 */
function timed(args: string[], root: string, threads: string): RunResult & { label: string } {
  const started = performance.now();
  const run = inwards(args, {
    cwd: root,
    env: { INWARDS_NO_CACHE: "1", INWARDS_THREADS: threads },
    timeout: RUN_MS,
  });
  const ms = Math.round(performance.now() - started);
  return { ...run, label: `${args[0]} on ${threads} thread(s): exit ${run.code} after ${ms} ms` };
}

describe("threads never change the result", () => {
  test(
    "inwards check: one thread and four give the same JSON",
    () => {
      const root = bigProject();
      const [one, four] = ["1", "4"].map((threads) =>
        timed(["check", "--format", "json"], root, threads),
      );
      expect(one?.label).toMatch(EXITED);
      expect(four?.label).toMatch(EXITED);
      expect(one?.stderr).toBe("");
      expect(four?.stderr).toBe("");
      expect(one?.code).toBe(1);
      expect(four?.code).toBe(1);
      expect(four?.stdout.replace(DURATION, "")).toBe(one?.stdout.replace(DURATION, ""));
      expect(one?.stdout).toContain("INW011");
    },
    TEST_MS,
  );

  test(
    "inwards baseline: one thread and four write the same baseline",
    () => {
      const root = bigProject();
      const runs = ["1", "4"].map((threads) => {
        const run = timed(["baseline"], root, threads);
        return { label: run.label, written: readFileSync(join(root, BASELINE_FILE), "utf8") };
      });
      const [one, four] = runs;
      expect(one?.label).toMatch(WROTE);
      expect(four?.label).toMatch(WROTE);
      expect(four?.written).toBe(one?.written);
      expect(one?.written.length).toBeGreaterThan(100);
    },
    TEST_MS,
  );
});
