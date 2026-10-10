/**
 * @file The extraction pool on worker threads (#61) answers every job with
 * what `createExtractionWorker` gives in this thread, at the job's own place
 * whatever order the threads finish in, and it still answers when its
 * workers crash, answer with an error or can't start: the calling thread
 * works through the queue too. A worker's answers land at their own jobs.
 * The workers run `main.ts`, as the binary's do.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  createExtractionWorker,
  type ExtractionAnswer,
  type ExtractionJob,
  type GrammarBinaries,
  type SourceFile,
} from "@inwards/core";
import { startExtractionPool } from "../../src/adapters/extraction-pool.ts";
import { loadGrammars } from "../../src/adapters/grammars.ts";

const ENTRY = join(import.meta.dir, "../../src/main.ts");
const WASM: GrammarBinaries = await loadGrammars();
const run: (job: ExtractionJob) => ExtractionAnswer = await createExtractionWorker(WASM);

/**
 * Builds a job for a module of the domain layer.
 *
 * @param n - which module; every seventh holds a dynamic import.
 * @param want - what to extract.
 * @returns the job, for `shop/domain/m<n>.py`.
 */
function job(n: number, want: ExtractionJob["want"]): ExtractionJob {
  const text =
    n % 7 === 0
      ? `import importlib\nimportlib.import_module("shop.m${n}")\n`
      : `import shop.m${n}\nfrom shop.domain import m${n + 1}\n${"x = 1\n".repeat(n % 50)}`;
  const file: SourceFile = {
    path: `shop/domain/m${n}.py`,
    module: `shop.domain.m${n}`,
    isPackage: false,
    text,
  };
  return { file, want };
}

describe("the pool answers like this thread", () => {
  test("every job, in order, both kinds", async () => {
    const jobs = Array.from({ length: 300 }, (_, n) => job(n, n % 3 === 0 ? "full" : "skeleton"));
    const pool = startExtractionPool(ENTRY, WASM, 3);
    try {
      expect(await pool.extract(jobs)).toEqual(jobs.map(run));
      expect(await pool.extract([])).toEqual([]);
      const again = jobs.slice(0, 5);
      expect(await pool.extract(again)).toEqual(again.map(run));
    } finally {
      pool.close();
    }
  });

  test.each([
    ["crash", "self.onmessage = () => { throw new Error('boom'); };"],
    [
      "answer with an error",
      "self.onmessage = (e) => { if (e.data.id) postMessage({ id: e.data.id, error: 'no grammar' }); };",
    ],
  ])("workers that %s leave their jobs to the calling thread", async (_name, code) => {
    const entry = URL.createObjectURL(new Blob([code], { type: "application/javascript" }));
    const jobs = Array.from({ length: 100 }, (_unused, n) => job(n, "skeleton"));
    const pool = startExtractionPool(entry, WASM, 2);
    try {
      expect(await pool.extract(jobs)).toEqual(jobs.map(run));
    } finally {
      pool.close();
    }
  });

  test("workers that can't start leave every job to the calling thread", async () => {
    const jobs = Array.from({ length: 60 }, (_unused, n) => job(n, "full"));
    const pool = startExtractionPool(join(import.meta.dir, "no-such-entry.ts"), WASM, 2);
    try {
      expect(await pool.extract(jobs)).toEqual(jobs.map(run));
    } finally {
      pool.close();
    }
  });

  test("the workers' answers are used, each at its own job", async () => {
    // A worker that answers every job with an empty skeleton, unlike this thread.
    const code = `self.onmessage = (e) => {
      if (e.data.id) postMessage({ id: e.data.id, answers: e.data.jobs.map(() => ({ extraction: { skeleton: [] }, dynamic: false })) });
    };`;
    const entry = URL.createObjectURL(new Blob([code], { type: "application/javascript" }));
    const jobs = Array.from({ length: 480 }, (_unused, n) => job(n + 1, "skeleton"));
    const pool = startExtractionPool(entry, WASM, 3);
    try {
      const answers = await pool.extract(jobs);
      const fake = { extraction: { skeleton: [] }, dynamic: false };
      const fromWorkers = answers.filter((answer) => Bun.deepEquals(answer, fake)).length;
      expect(fromWorkers).toBeGreaterThan(0);
      expect(fromWorkers % 24).toBe(0); // whole batches
      const fromHere = jobs.filter((each, n) => Bun.deepEquals(answers[n], run(each))).length;
      expect(fromHere + fromWorkers).toBe(jobs.length);
    } finally {
      pool.close();
    }
  });
});
