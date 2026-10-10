/**
 * @file How many threads parse a full check (#61). The limit is
 * `INWARDS_THREADS` when it is a whole number, else the cores up to the cap.
 * There are no workers below the file threshold or with one thread, and one
 * worker fewer than threads otherwise, since the main thread parses too. A
 * check big enough gets the pool, through its own methods, closes it, and
 * finds what it finds alone.
 */
import { describe, expect, test } from "bun:test";
import {
  createExtractionWorker,
  Engine,
  type ExtractionAnswer,
  type ExtractionJob,
  type GrammarBinaries,
  type ProjectIndex,
  parseConfig,
  type SourceFile,
} from "@inwards/core";
import { loadGrammars } from "../../src/adapters/grammars.ts";
import type { ExtractionPool } from "../../src/project/contracts.ts";
import {
  checkOnThreads,
  DEFAULT_MAX_THREADS,
  MIN_PARALLEL_FILES,
  poolSize,
  threadLimit,
} from "../../src/project/threads.ts";
import { LAYERS } from "../support/run.ts";

describe("threadLimit", () => {
  test("follows the cores up to the cap", () => {
    expect(threadLimit({ threads: undefined, cores: 2 })).toBe(2);
    expect(threadLimit({ threads: undefined, cores: 64 })).toBe(DEFAULT_MAX_THREADS);
  });

  test("INWARDS_THREADS sets it, past the cap too", () => {
    expect(threadLimit({ threads: "1", cores: 16 })).toBe(1);
    expect(threadLimit({ threads: "0", cores: 16 })).toBe(0);
    expect(threadLimit({ threads: " 12 ", cores: 4 })).toBe(12);
  });

  test("a value that isn't a whole number is ignored", () => {
    for (const threads of ["auto", "-2", "1.5", "two"]) {
      expect(threadLimit({ threads, cores: 3 })).toBe(3);
    }
  });
});

describe("poolSize", () => {
  test("no workers below the threshold or with one thread", () => {
    expect(poolSize(8, MIN_PARALLEL_FILES - 1)).toBe(0);
    expect(poolSize(1, 100_000)).toBe(0);
    expect(poolSize(0, 100_000)).toBe(0);
  });

  test("one worker fewer than threads, and few for a check just over the threshold", () => {
    expect(poolSize(4, 100_000)).toBe(3);
    expect(poolSize(4, MIN_PARALLEL_FILES)).toBe(1);
    expect(poolSize(16, 2500)).toBe(4);
  });
});

const wasm: GrammarBinaries = await loadGrammars();
const engine: Engine = await Engine.create(wasm, parseConfig(LAYERS));
const files: SourceFile[] = Array.from({ length: MIN_PARALLEL_FILES }, (_unused, n) => ({
  path: `shop/domain/m${n}.py`,
  module: `shop.domain.m${n}`,
  isPackage: false,
  text: n % 5 === 0 ? "import shop.infrastructure.db\n" : `import shop.domain.m${n + 1}\n`,
}));
const index: ProjectIndex = engine.index({
  kind: (): undefined => undefined,
  list: (): string[] => files.map((f) => f.path),
  read: (): string => "",
  listDir: (): undefined => undefined,
});
const run: Parameters<typeof checkOnThreads>[3] = {
  files,
  index,
  accepted: undefined,
  options: { whole: true, edit: false },
};
const local: (job: ExtractionJob) => ExtractionAnswer = await createExtractionWorker(wasm);

/** A pool that runs every job in this thread and records how it was used. */
class FakePool implements ExtractionPool {
  jobs = 0;
  closed = false;

  /**
   * Runs the jobs here, through `this`, as a real pool's method would.
   *
   * @param jobs - the engine's jobs.
   * @returns one answer per job.
   */
  extract(jobs: readonly ExtractionJob[]): Promise<ExtractionAnswer[]> {
    this.jobs += jobs.length;
    return Promise.resolve(jobs.map(local));
  }

  /** Records that the check closed the pool. */
  close(): void {
    this.closed = true;
  }
}

describe("checkOnThreads", () => {
  test("uses the pool for a big check, closes it, and finds the same", async () => {
    const pool = new FakePool();
    const sizes: number[] = [];
    const io = {
      grammars: (): Promise<GrammarBinaries> => Promise.resolve(wasm),
      extractionPool: (_wasm: GrammarBinaries, size: number): ExtractionPool => {
        sizes.push(size);
        return pool;
      },
    };
    const alone = await checkOnThreads(io, engine, 1, run);
    expect(sizes).toEqual([]);
    expect(await checkOnThreads(io, engine, 4, run)).toEqual(alone);
    expect(sizes).toEqual([1]);
    expect(pool.jobs).toBeGreaterThan(files.length);
    expect(pool.closed).toBe(true);
    expect(alone.diagnostics.length).toBeGreaterThan(0);
  });
});
