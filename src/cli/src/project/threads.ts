/**
 * @file How many threads parse a full check (#61), and running the engine on
 * them. `INWARDS_THREADS` sets the count (1: the main thread alone, no
 * workers), else half the cores beyond two, up to a cap; a check of fewer files
 * than the threshold stays on the main thread, where starting workers would
 * cost more than they save. The main thread parses too, so a pool has one
 * worker fewer than there are threads. No I/O and no thread of its own: the
 * pool comes from `ProjectIo`, and the check that opens it closes it.
 */
import type {
  Checked,
  Engine,
  ExtractionBatch,
  ExtractionJob,
  GrammarBinaries,
  ProjectIndex,
  SourceFile,
} from "@inwards/core";
import type { Runtime } from "../platform/contracts.ts";
import type { ExtractionPool, ProjectIo } from "./contracts.ts";

/**
 * Threads at most when `INWARDS_THREADS` doesn't say. Reading the files and
 * the rules stay on the main thread, so more threads gain little (chapter 6).
 */
export const DEFAULT_MAX_THREADS = 4;
/**
 * Cores per thread by default, and the cores left out first. Each thread
 * runs its own JavaScript VM, whose JIT compiler and garbage collector run on
 * threads of their own: on four Linux cores, four parsing threads made the
 * synthetic repo's check 60% slower, and two made the CI bench job's 19%
 * slower (chapter 6). So a 4-core machine keeps one thread.
 */
const CORES_PER_THREAD = 2;
const RESERVED_CORES = 2;
/** A check of fewer files than this runs on the main thread alone. */
export const MIN_PARALLEL_FILES = 1000;
/** Each thread gets at least this many files, so a check just over the threshold starts few. */
const FILES_PER_THREAD = 500;
/** `INWARDS_THREADS`: digits only. */
const WHOLE_NUMBER = /^\d+$/u;

/**
 * Reads how many threads may parse a full check: `INWARDS_THREADS` when it
 * is a whole number, else half of the cores beyond two, up to
 * `DEFAULT_MAX_THREADS`: one on 4 cores, three on 8, four from 10. One or
 * fewer means the main thread alone.
 *
 * @param runtime - `threads` (`INWARDS_THREADS` as set) and `cores`.
 * @returns the limit, 0 or more.
 */
export function threadLimit(runtime: Pick<Runtime, "threads" | "cores">): number {
  const setting = runtime.threads?.trim();
  if (setting !== undefined && WHOLE_NUMBER.test(setting)) {
    return Number(setting);
  }
  const spare = Math.max(runtime.cores - RESERVED_CORES, 0);
  return Math.min(Math.floor(spare / CORES_PER_THREAD), DEFAULT_MAX_THREADS);
}

/**
 * Sizes the worker pool for one check: none below `MIN_PARALLEL_FILES`
 * files, else one thread per `FILES_PER_THREAD` files up to the limit, the
 * main thread being one of them.
 *
 * @param threads - the most threads allowed (`threadLimit`).
 * @param files - how many files the check reads.
 * @returns how many worker threads to start; 0 for none.
 */
export function poolSize(threads: number, files: number): number {
  if (files < MIN_PARALLEL_FILES) {
    return 0;
  }
  return Math.max(0, Math.min(threads, Math.ceil(files / FILES_PER_THREAD)) - 1);
}

/**
 * Starts the worker threads for a check of this many files, when `poolSize`
 * gives any and the I/O can start them. The check starts them before it
 * reads the files (#281), so the workers load the grammar while this
 * thread reads; the caller closes the pool once the engine is done.
 *
 * @param io - starts the pool, when it can.
 * @param wasm - the grammars every worker loads.
 * @param threads - how many threads may parse, this one included.
 * @param files - how many source files the check will hand the engine.
 * @returns the pool, or undefined to check on this thread alone.
 */
export function openPool(
  io: Pick<ProjectIo, "extractionPool">,
  wasm: GrammarBinaries,
  threads: number,
  files: number,
): ExtractionPool | undefined {
  const size = poolSize(threads, files);
  return size > 0 && io.extractionPool ? io.extractionPool(wasm, size) : undefined;
}

/**
 * Runs the engine over the loaded files: on this thread, or with the parsing
 * spread over a pool's worker threads as well (#61). Either way the result is
 * the same. The pool stays open; its owner closes it.
 *
 * @param engine - the project's engine.
 * @param pool - the worker threads from `openPool`, or undefined for this thread alone.
 * @param run - what the engine's `check` takes.
 * @param run.files - the source files.
 * @param run.index - the project's module index.
 * @param run.accepted - accepted copies by baseline key, when a baseline applies.
 * @param run.options - `whole` and `edit`, as `Engine.check` takes them.
 * @param run.options.whole - true for a whole-project run.
 * @param run.options.edit - true for a per-edit check.
 * @returns the findings and the suppressed ones.
 */
export function checkOnThreads(
  engine: Engine,
  pool: ExtractionPool | undefined,
  {
    files,
    index,
    accepted,
    options,
  }: {
    files: SourceFile[];
    index: ProjectIndex;
    accepted: ReadonlyMap<string, number> | undefined;
    options: { whole: boolean; edit: boolean };
  },
): Promise<Checked> {
  if (pool === undefined) {
    return Promise.resolve(engine.check(files, index, accepted, options));
  }
  // Called as a method: a pool may keep its state on `this`.
  return engine.checkWith(
    files,
    index,
    { accepted, ...options },
    (jobs: readonly ExtractionJob[]): ReturnType<ExtractionBatch> => pool.extract(jobs),
  );
}
