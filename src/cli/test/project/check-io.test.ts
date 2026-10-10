/**
 * @file How `runCheck` reads a project and uses worker threads (#281): a
 * check of `MIN_PARALLEL_FILES` files or more reads them in one batch,
 * after it has started the pool, and closes the pool when the check ends,
 * failed reads included; a smaller check, such as a hook's, reads each file
 * in turn and starts no pool. The report is the same either way.
 */
import { expect, test } from "bun:test";
import { join } from "node:path";
import {
  createExtractionWorker,
  type ExtractionAnswer,
  type ExtractionJob,
  type GrammarBinaries,
  type Report,
} from "@inwards/core";
import { nodePlatform, nodeProjectIo } from "../../src/adapters/compose.ts";
import { loadGrammars } from "../../src/adapters/grammars.ts";
import { runCheck } from "../../src/project/check.ts";
import type { ExtractionPool, ProjectIo } from "../../src/project/contracts.ts";
import { MIN_PARALLEL_FILES } from "../../src/project/threads.ts";
import { LAYERS, project } from "../support/run.ts";

const local: (job: ExtractionJob) => ExtractionAnswer = await createExtractionWorker(
  await loadGrammars(),
);

/** The generated domain modules, `m<n>.py`. */
const DOMAIN_MODULE = /m\d+\.py$/u;

/** What the instrumented I/O saw, in order. */
interface Seen {
  events: string[];
  /** Domain modules read one at a time (the index may read others for itself). */
  single: number;
  /** Sizes of the batch reads. */
  batches: number[];
}

/**
 * Builds the real project I/O with its reads, and a pool that runs jobs in
 * this thread, recorded.
 *
 * @param fail - true to make the batch read fail.
 * @returns the I/O and what it saw.
 */
function recordingIo(fail = false): { io: ProjectIo; seen: Seen } {
  const seen: Seen = { events: [], single: 0, batches: [] };
  const base = nodeProjectIo(nodePlatform());
  const pool: ExtractionPool = {
    extract: (jobs: readonly ExtractionJob[]): Promise<ExtractionAnswer[]> =>
      Promise.resolve(jobs.map(local)),
    close: (): void => {
      seen.events.push("close");
    },
  };
  const io: ProjectIo = {
    ...base,
    read: {
      ...base.read,
      text: (path: string): string => {
        if (DOMAIN_MODULE.test(path)) {
          seen.single += 1;
        }
        return base.read.text(path);
      },
      texts: (paths: readonly string[]): Promise<string[]> => {
        seen.events.push("read");
        seen.batches.push(paths.length);
        return fail ? Promise.reject(new Error("unreadable")) : base.read.texts(paths);
      },
    },
    extractionPool: (_wasm: GrammarBinaries, size: number): ExtractionPool => {
      seen.events.push(`pool ${size}`);
      return pool;
    },
  };
  return { io, seen };
}

/**
 * Builds a project of `n` domain modules, every fifth importing infrastructure.
 *
 * @param n - how many modules.
 * @returns the project's root.
 */
function bigProject(n: number): string {
  const files: Record<string, string> = { "pyproject.toml": LAYERS, "shop/__init__.py": "" };
  for (let k = 0; k < n; k += 1) {
    files[`shop/domain/m${k}.py`] =
      k % 5 === 0 ? "import shop.infrastructure.db\n" : `import shop.domain.m${k + 1}\n`;
  }
  files["shop/infrastructure/db.py"] = "X = 1\n";
  return project(files);
}

/**
 * Drops the timing from a report, the one field that differs between runs.
 *
 * @param report - a report.
 * @returns the report without `durationMs`.
 */
function untimed(report: Report): Omit<Report, "durationMs"> {
  const { durationMs: _ignored, ...rest } = report;
  return rest;
}

test("a big check starts the pool, then reads in one batch, and closes the pool", async () => {
  const root = bigProject(MIN_PARALLEL_FILES);
  const config = join(root, "pyproject.toml");
  const threaded = recordingIo();
  const report = await runCheck(threaded.io, config, undefined, { base: root, threads: 4 });
  const { events, batches } = threaded.seen;
  expect(events).toEqual(["pool 2", "read", "close"]);
  expect(batches).toEqual([MIN_PARALLEL_FILES + 2]);
  expect(threaded.seen.single).toBe(0);
  expect(report.diagnostics.length).toBeGreaterThan(0);
  const alone = recordingIo();
  const one = await runCheck(alone.io, config, undefined, { base: root, threads: 1 });
  expect(alone.seen.events).toEqual(["read"]);
  expect(untimed(one)).toEqual(untimed(report));
});

test("a failed read still closes the pool", async () => {
  const root = bigProject(MIN_PARALLEL_FILES);
  const { io, seen } = recordingIo(true);
  const run = runCheck(io, join(root, "pyproject.toml"), undefined, { base: root, threads: 4 });
  expect(run).rejects.toThrow("unreadable");
  await run.catch(() => undefined);
  expect(seen.events).toEqual(["pool 2", "read", "close"]);
});

test("a small check reads each file in turn and starts no pool", async () => {
  const root = bigProject(20);
  const { io, seen } = recordingIo();
  const report = await runCheck(io, join(root, "pyproject.toml"), undefined, {
    base: root,
    threads: 4,
  });
  expect(seen.events).toEqual([]);
  expect(seen.single).toBe(20);
  expect(report.filesChecked).toBe(22);
});
