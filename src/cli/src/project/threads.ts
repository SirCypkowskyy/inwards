/**
 * @file How many threads parse a full check (#61), and running the engine on
 * them. `INWARDS_THREADS` sets the count (1: the main thread alone, no
 * workers), else it follows the cores up to a cap; a check of fewer files
 * than the threshold stays on the main thread, where starting workers would
 * cost more than they save. The main thread parses too, so a pool has one
 * worker fewer than there are threads. No I/O and no thread of its own: the
 * pool comes from `ProjectIo`.
 */
import type {
  Checked,
  Engine,
  ExtractionBatch,
  ExtractionJob,
  ProjectIndex,
  SourceFile,
} from "@inwards/core";
import type { Runtime } from "../platform/contracts.ts";
import type { ProjectIo } from "./contracts.ts";

/**
 * Threads at most when `INWARDS_THREADS` doesn't say. Reading the files and
 * the rules stay on the main thread, so more threads gain little (chapter 6).
 */
export const DEFAULT_MAX_THREADS = 4;
/** A check of fewer files than this runs on the main thread alone. */
export const MIN_PARALLEL_FILES = 1000;
/** Each thread gets at least this many files, so a check just over the threshold starts few. */
const FILES_PER_THREAD = 500;
/** `INWARDS_THREADS`: digits only. */
const WHOLE_NUMBER = /^\d+$/u;

/**
 * Reads how many threads may parse a full check: `INWARDS_THREADS` when it
 * is a whole number, else the cores up to `DEFAULT_MAX_THREADS`. One or
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
  return Math.min(runtime.cores, DEFAULT_MAX_THREADS);
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
 * Runs the engine over the loaded files: on this thread, or with the parsing
 * spread over worker threads as well when `poolSize` gives any for this many
 * files and the I/O can start them (#61). Either way the result is the same.
 *
 * @param io - loads the grammars for the workers and starts the pool, when it can.
 * @param engine - the project's engine.
 * @param threads - how many threads may parse, this one included.
 * @param run - what the engine's `check` takes.
 * @param run.files - the source files.
 * @param run.index - the project's module index.
 * @param run.accepted - accepted copies by baseline key, when a baseline applies.
 * @param run.options - `whole` and `edit`, as `Engine.check` takes them.
 * @param run.options.whole - true for a whole-project run.
 * @param run.options.edit - true for a per-edit check.
 * @returns the findings and the suppressed ones.
 */
export async function checkOnThreads(
  io: Pick<ProjectIo, "extractionPool" | "grammars">,
  engine: Engine,
  threads: number,
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
  const size = poolSize(threads, files.length);
  const pool =
    size > 0 && io.extractionPool ? io.extractionPool(await io.grammars(), size) : undefined;
  if (pool === undefined) {
    return engine.check(files, index, accepted, options);
  }
  try {
    // Called as a method: a pool may keep its state on `this`.
    return await engine.checkWith(
      files,
      index,
      { accepted, ...options },
      (jobs: readonly ExtractionJob[]): ReturnType<ExtractionBatch> => pool.extract(jobs),
    );
  } finally {
    pool.close();
  }
}
