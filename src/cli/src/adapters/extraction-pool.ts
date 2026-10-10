/**
 * @file The `ExtractionPool` contract on Bun worker threads (#61): starts the
 * workers, hands each one a batch of extraction jobs at a time until none
 * are left, works through batches on the calling thread too while it would
 * otherwise wait, and puts every answer back at its job's place, so the
 * order the threads finish in never shows. A worker runs this same program
 * (`main.ts` sends a worker thread to `serveExtractions`), so the compiled
 * binary needs nothing else on disk. Once the queue is empty, the calling
 * thread also takes over batches the workers still hold, so a slow or stuck
 * worker never makes a call wait longer than this thread alone would. A
 * worker that dies or answers with an error is retired and its batch goes
 * back in the queue; a job no thread could answer stays unanswered, and the
 * engine computes it itself, so its error surfaces there as without the
 * pool. The pool never decides anything about a file.
 */
import {
  createExtractionWorker,
  type ExtractionAnswer,
  type ExtractionJob,
  type GrammarBinaries,
} from "@inwards/core";
import type { ExtractionPool } from "../project/contracts.ts";
import { isExtraction, isRecord } from "./extraction-entry.ts";

/** Jobs per message: big enough that posting is cheap, small enough to share the tail. */
const BATCH_SIZE = 24;

/** A run of consecutive jobs sent as one message. */
interface Batch {
  id: number;
  /** Index of its first job in the call's job list. */
  start: number;
  jobs: ExtractionJob[];
}

/** One worker thread and the batch it is working on, if any. */
interface Slot {
  worker: Worker;
  /** The batch it was sent last, until it answers; undefined while idle. */
  batch: Batch | undefined;
  /** False once it failed: it gets no more batches. */
  alive: boolean;
}

/** One `extract` call in progress. */
interface Call {
  answers: (ExtractionAnswer | undefined)[];
  /** Batches nobody has taken yet, first to last. */
  queue: Batch[];
  /** Batches taken and not answered yet, by the workers or this thread. */
  pending: number;
  done: () => void;
}

/** Runs one job on the calling thread. */
type LocalRun = (job: ExtractionJob) => ExtractionAnswer;

/**
 * Lets the event loop deliver the workers' answers before this thread takes
 * its next batch.
 *
 * @returns a promise that settles on the next turn of the event loop.
 */
function nextTurn(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/**
 * Puts a batch's answers at their jobs' places, keeping only answers that
 * have the shape `extractJob` returns, checked as a cache entry is.
 *
 * @param call - the call the batch belongs to, whose answer list is filled in.
 * @param batch - the jobs the answers are for, and where they start in the list.
 * @param answers - one answer per job, as the worker sent them.
 * @returns false when the answer list doesn't match the batch.
 */
function record(call: Call, batch: Batch, answers: unknown): boolean {
  if (!Array.isArray(answers) || answers.length !== batch.jobs.length) {
    return false;
  }
  answers.forEach((answer: unknown, n: number) => {
    const extraction = isRecord(answer) ? answer["extraction"] : undefined;
    const dynamic = isRecord(answer) ? answer["dynamic"] : undefined;
    if (isExtraction(extraction) && (dynamic === undefined || typeof dynamic === "boolean")) {
      call.answers[batch.start + n] =
        dynamic === undefined ? { extraction } : { extraction, dynamic };
    }
  });
  return true;
}

/**
 * Starts one worker thread and sends it the grammar. A thread that can't be
 * started is left out: the others, and the calling thread, do its share.
 *
 * @param entry - the program the worker runs.
 * @param wasm - the grammars it loads.
 * @returns its slot, idle, or undefined when it couldn't be started.
 */
function startWorker(entry: string, wasm: GrammarBinaries): Slot | undefined {
  try {
    const worker = new Worker(entry);
    worker.unref();
    worker.postMessage({ wasm });
    return { worker, batch: undefined, alive: true };
  } catch {
    return undefined;
  }
}

/** Worker threads, and the calling thread, sharing one queue of batches. */
class WorkerPool implements ExtractionPool {
  private readonly slots: Slot[];
  /** This thread's own parser, for the batches it takes while it waits. */
  private readonly local: Promise<LocalRun | undefined>;
  private call: Call | undefined;
  private nextId = 0;
  /** True while this thread works through batches. */
  private helping = false;

  /**
   * Starts the workers and sends each the grammar, which it loads while the
   * caller reads on. The threads keep the process alive only while an
   * `extract` call waits for them, so a pool never closed can't hold it open.
   *
   * @param entry - the program the workers run.
   * @param wasm - the grammars every worker loads.
   * @param size - how many workers to start.
   */
  constructor(entry: string, wasm: GrammarBinaries, size: number) {
    this.local = createExtractionWorker(wasm).catch(() => undefined);
    this.slots = Array.from({ length: size }, () => startWorker(entry, wasm)).filter(
      (slot: Slot | undefined): slot is Slot => slot !== undefined,
    );
    for (const slot of this.slots) {
      slot.worker.addEventListener("message", (event: MessageEvent) => {
        this.answered(slot, event.data);
      });
      slot.worker.addEventListener("error", () => this.failed(slot));
      slot.worker.addEventListener("messageerror", () => this.failed(slot));
    }
  }

  /**
   * Runs jobs on the workers and on this thread, in batches.
   *
   * @param jobs - the jobs, in the engine's order.
   * @returns one answer per job, in the same order; undefined where no thread could answer.
   */
  extract(jobs: readonly ExtractionJob[]): Promise<readonly (ExtractionAnswer | undefined)[]> {
    return new Promise((resolve) => {
      const queue: Batch[] = [];
      for (let start = 0; start < jobs.length; start += BATCH_SIZE) {
        this.nextId += 1;
        queue.push({ id: this.nextId, start, jobs: jobs.slice(start, start + BATCH_SIZE) });
      }
      const answers: (ExtractionAnswer | undefined)[] = Array.from({ length: jobs.length });
      const current: Call = { answers, queue, pending: 0, done: () => resolve(answers) };
      this.call = current;
      for (const slot of this.slots) {
        slot.worker.ref(); // the process waits for the answers
      }
      for (const slot of this.slots) {
        this.feed(slot);
      }
      this.startHelping(current);
    });
  }

  /** Stops every worker. */
  close(): void {
    for (const slot of this.slots) {
      slot.alive = false;
      slot.worker.unref(); // even a worker that ignores terminate can't keep the process alive
      slot.worker.terminate();
    }
  }

  /** Ends the call once every batch has been answered, or nobody is left to take the rest. */
  private settle(): void {
    const { call } = this;
    if (call === undefined) {
      return;
    }
    if (!(this.helping || this.slots.some((slot) => slot.alive))) {
      call.queue.length = 0; // nobody takes the rest: the engine computes it
    }
    if (call.pending > 0 || call.queue.length > 0) {
      return;
    }
    this.call = undefined;
    for (const slot of this.slots) {
      slot.worker.unref();
    }
    call.done();
  }

  /**
   * Gives an idle worker the next batch, if any.
   *
   * @param slot - the worker that has just become idle.
   */
  private feed(slot: Slot): void {
    slot.batch = undefined;
    const { call } = this;
    const batch = call !== undefined && slot.alive ? call.queue.shift() : undefined;
    if (call !== undefined && batch !== undefined) {
      slot.batch = batch;
      call.pending += 1;
      slot.worker.postMessage({ id: batch.id, jobs: batch.jobs });
    }
    this.settle();
  }

  /**
   * Records a worker's answer to its batch and feeds it the next one. An
   * error answer retires the worker and puts the batch back in the queue.
   *
   * @param slot - the worker that answered.
   * @param data - its message.
   */
  private answered(slot: Slot, data: unknown): void {
    const { call } = this;
    const { batch } = slot;
    if (call === undefined || batch === undefined || !isRecord(data) || data["id"] !== batch.id) {
      return;
    }
    call.pending -= 1;
    if (!record(call, batch, data["answers"])) {
      slot.alive = false;
      this.requeue(call, batch);
    }
    this.feed(slot);
  }

  /**
   * Retires a worker that crashed and puts its batch back in the queue.
   *
   * @param slot - the worker that failed.
   */
  private failed(slot: Slot): void {
    slot.alive = false;
    const { call } = this;
    if (call !== undefined && slot.batch !== undefined) {
      call.pending -= 1;
      this.requeue(call, slot.batch);
    }
    this.feed(slot);
  }

  /**
   * Puts a retired worker's batch back at the front of the queue and makes
   * sure this thread works through it.
   *
   * @param call - the call the batch belongs to.
   * @param batch - the batch nobody answered.
   */
  private requeue(call: Call, batch: Batch): void {
    call.queue.unshift(batch);
    this.startHelping(call);
  }

  /**
   * Starts this thread on the queue unless it is on it already.
   *
   * @param call - the call to work on.
   */
  private startHelping(call: Call): void {
    if (this.helping) {
      return;
    }
    this.helping = true;
    this.help(call)
      .catch(() => undefined)
      .finally(() => {
        this.helping = false;
        this.settle();
      });
  }

  /**
   * Works through queued batches on this thread, from the back of the queue
   * while the workers take from the front, yielding between batches so
   * their answers arrive. A job that throws here is left to the engine.
   *
   * @param call - the call to work on.
   * @returns once the queue is empty or the call has ended.
   */
  private async help(call: Call): Promise<void> {
    const run = await this.local;
    if (run === undefined) {
      return;
    }
    for (let batch = this.takeLast(call); batch !== undefined; batch = this.takeLast(call)) {
      call.pending += 1;
      for (const [n, job] of batch.jobs.entries()) {
        try {
          call.answers[batch.start + n] = run(job);
        } catch {
          // The engine runs the job again, and its error surfaces there.
        }
      }
      call.pending -= 1;
      // biome-ignore lint/performance/noAwaitInLoops: yielding is the point, so the workers' answers come in.
      await nextTurn();
    }
  }

  /**
   * Takes the last queued batch of a call that is still running. With the
   * queue empty, it takes a batch a worker still holds instead, so a worker
   * that is slow to start, or never answers, can't keep the call waiting:
   * the worker's answer to it, if one comes, is ignored.
   *
   * @param call - the call this thread works on, which may have ended meanwhile.
   * @returns the batch, or undefined when the call has ended or nothing is left.
   */
  private takeLast(call: Call): Batch | undefined {
    if (this.call !== call) {
      return undefined;
    }
    const queued = call.queue.pop();
    if (queued !== undefined) {
      return queued;
    }
    const holder = this.slots.find((slot) => slot.batch !== undefined);
    const held = holder?.batch;
    if (holder === undefined || held === undefined) {
      return undefined;
    }
    holder.batch = undefined; // its late answer no longer matches, and it can take new work
    call.pending -= 1;
    return held;
  }
}

/**
 * Starts a pool of worker threads that run this program's `serveExtractions`.
 *
 * @param entry - the program the workers run: `main.ts`, or the compiled binary's own entry.
 * @param wasm - the grammars every worker loads; this thread has loaded them already.
 * @param size - how many workers to start.
 * @returns the pool, its workers loading the grammar.
 */
export function startExtractionPool(
  entry: string,
  wasm: GrammarBinaries,
  size: number,
): ExtractionPool {
  return new WorkerPool(entry, wasm, size);
}
