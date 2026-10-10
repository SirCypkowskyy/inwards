/**
 * @file `Engine.checkWith` hands the parsing to an `ExtractionBatch` (#61) and
 * must return exactly what `check` returns: with answers from
 * `createExtractionWorker`, with no answers, with a batch that fails, with a
 * cache, a baseline and a whole-project run. It must also use the answers it
 * gets (a batch that answers wrongly changes the result), and a worker's
 * answer must be what the engine stores in its cache for the same file.
 */
import { describe, expect, test } from "bun:test";
import {
  baselineKey,
  type CachedExtraction,
  type Checked,
  createExtractionWorker,
  Engine,
  type ExtractionAnswer,
  type ExtractionBatch,
  type ExtractionCache,
  type ExtractionIdentity,
  type ExtractionJob,
  parseConfig,
} from "../../src/index.ts";
import { CONFIG, CountingCache, FILES } from "../support/every-path.ts";
import { grammars, PROJECT } from "../support/helpers.ts";

const run: (job: ExtractionJob) => ExtractionAnswer = await createExtractionWorker(grammars());

/**
 * A batch that runs every job in this thread, as a worker would.
 *
 * @param jobs - what to extract, from which texts.
 * @returns one answer per job, as a worker would give it.
 */
const inProcess: ExtractionBatch = (
  jobs: readonly ExtractionJob[],
): Promise<readonly ExtractionAnswer[]> => Promise.resolve(jobs.map(run));

/**
 * Checks the files with a fresh engine, plain or through a batch.
 *
 * @param extract - the batch for `checkWith`; undefined for `check`.
 * @param options - the cache, baseline and run kind to check with.
 * @param options.cache - the engine's cache, if any.
 * @param options.accepted - baseline copies by key.
 * @param options.whole - true for a whole-project run.
 * @returns what the engine found.
 */
async function checked(
  extract: ExtractionBatch | undefined,
  {
    cache,
    accepted,
    whole = false,
  }: { cache?: ExtractionCache; accepted?: ReadonlyMap<string, number>; whole?: boolean } = {},
): Promise<Checked> {
  const engine = await Engine.create(grammars(), CONFIG, cache ? { cache } : {});
  return extract === undefined
    ? engine.check(FILES, PROJECT, accepted, { whole })
    : engine.checkWith(FILES, PROJECT, { accepted, whole }, extract);
}

describe("checkWith returns what check returns", () => {
  test("with answers from an extraction worker", async () => {
    const plain = await checked(undefined);
    expect(await checked(inProcess)).toEqual(plain);
    expect(plain.diagnostics.length).toBeGreaterThan(5);
    expect(plain.suppressed.length).toBeGreaterThan(0);
  });

  test("with no answers, or a batch that fails", async () => {
    const plain = await checked(undefined);
    /**
     * Answers no job, as a pool whose threads all failed.
     *
     * @param jobs - the jobs, left unanswered.
     * @returns an undefined answer for each.
     */
    const silent: ExtractionBatch = (jobs: readonly ExtractionJob[]): Promise<undefined[]> =>
      Promise.resolve(jobs.map((): undefined => undefined));
    /**
     * Fails the whole batch.
     *
     * @returns a rejected promise.
     */
    const failing: ExtractionBatch = (): Promise<never> => Promise.reject(new Error("worker died"));
    expect(await checked(silent)).toEqual(plain);
    expect(await checked(failing)).toEqual(plain);
  });

  test("with an empty and a warm cache", async () => {
    const plain = await checked(undefined);
    const cache = new CountingCache();
    expect(await checked(inProcess, { cache })).toEqual(plain);
    cache.writes = 0;
    expect(await checked(inProcess, { cache })).toEqual(plain);
    expect(cache.writes).toBe(0);
  });

  test("with a baseline and a whole-project run", async () => {
    const all = await checked(undefined, { whole: true });
    const accepted = new Map<string, number>();
    for (const d of all.diagnostics) {
      accepted.set(baselineKey(d), (accepted.get(baselineKey(d)) ?? 0) + 1);
    }
    const plain = await checked(undefined, { accepted, whole: true });
    expect(await checked(inProcess, { accepted, whole: true })).toEqual(plain);
  });

  test("with contexts, where files outside the layers are read too", async () => {
    const config = parseConfig(`
[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
]
contexts = [{ name = "persistence", modules = ["shop.persistence"] }]
`);
    const engine = await Engine.create(grammars(), config);
    const plain = engine.check(FILES, PROJECT);
    expect(await engine.checkWith(FILES, PROJECT, {}, inProcess)).toEqual(plain);
  });
});

describe("checkWith uses the answers it gets", () => {
  test("a batch that reads no imports hides every import finding", async () => {
    /**
     * Answers every job with no imports at all.
     *
     * @param jobs - the jobs, answered without reading their texts.
     * @returns an empty skeleton or full extraction for each.
     */
    const empty: ExtractionBatch = (
      jobs: readonly ExtractionJob[],
    ): Promise<readonly ExtractionAnswer[]> =>
      Promise.resolve(
        jobs.map(
          (job): ExtractionAnswer =>
            job.want === "skeleton"
              ? { extraction: { skeleton: [] }, dynamic: false }
              : { extraction: { full: [], comments: [] } },
        ),
      );
    const codes = (await checked(empty)).diagnostics.map((d) => d.code);
    expect(codes).not.toContain("INW001");
    expect((await checked(undefined)).diagnostics.map((d) => d.code)).toContain("INW001");
  });

  test("a worker's answer is what the engine caches for the same file", async () => {
    const stored: [ExtractionIdentity, CachedExtraction][] = [];
    const recording: ExtractionCache = {
      get: (): undefined => undefined,
      set(identity: ExtractionIdentity, value: CachedExtraction): void {
        stored.push([identity, value]);
      },
    };
    const engine = await Engine.create(grammars(), CONFIG, { cache: recording });
    engine.check(FILES, PROJECT);
    expect(stored.length).toBeGreaterThan(5);
    // Each stored component, next to what a worker answers for the same text.
    const pairs = stored.flatMap(([{ text, module, isPackage }, entry]) => {
      const file = { path: "x.py", text, module, isPackage };
      const { skeleton } = run({ file, want: "skeleton" }).extraction;
      const { full, comments } = run({ file, want: "full" }).extraction;
      return [
        ...(entry.skeleton === undefined ? [] : [[skeleton, entry.skeleton]]),
        ...(entry.full === undefined
          ? []
          : [
              [
                { full, comments },
                { full: entry.full, comments: entry.comments },
              ],
            ]),
      ];
    });
    expect(pairs.length).toBeGreaterThan(5);
    for (const [answer, cached] of pairs) {
      expect(answer).toEqual(cached);
    }
  });

  test("a skeleton job reports the loader test and skips the prescan when it sends the file on", () => {
    const [loader] = FILES.filter((f) => f.path === "shop/domain/loader.py");
    if (loader === undefined) {
      throw new Error("fixture missing");
    }
    expect(run({ file: loader, want: "skeleton" })).toEqual({ extraction: {}, dynamic: true });
    const plain = { ...loader, text: "import os\n" };
    expect(run({ file: plain, want: "skeleton" }).dynamic).toBe(false);
  });
});
