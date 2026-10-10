/**
 * @file The `ExtractionPool` contract on Bun worker threads (#61): starts the
 * workers, keeps two batches of extraction jobs queued at each until none
 * are left (#281), works through batches on the calling thread too while it would
 * otherwise wait, and puts every answer back at its job's place, so the
 * order the threads finish in never shows. A worker runs this same program
 * (`main.ts` sends a worker thread to `serveExtractions`), so the compiled
 * binary needs nothing else on disk. Once the queue is empty, the calling
 * thread also takes over batches the workers still hold, so a slow or stuck
 * worker never makes a call wait longer than this thread alone would. A
 * worker that dies or answers with an error is retired and its batches go
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
/**
 * Batches a worker holds at once. With one, a worker that finishes waits
 * idle until this thread, busy with a batch of its own, gets back to the
 * event loop and feeds it; with two, the next one is already in its queue
 * (#281).
 */
const IN_FLIGHT = 2;

/** A run of consecutive jobs sent as one message. */
interface Batch {
  id: number;
  /** Index of its first job in the call's job list. */
  start: number;
  jobs: ExtractionJob[];
}

/** One worker thread and the batches it holds. */
interface Slot {
  worker: Worker;
  /** The batches it was sent and hasn't answered, oldest first; empty while idle. */
  batches: Batch[];
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
    return { worker, batches: [], alive: true };
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
   * Tops a worker up to `IN_FLIGHT` batches from the front of the queue.
   *
   * @param slot - a worker that is idle or has just answered.
   */
  private feed(slot: Slot): void {
    const { call } = this;
    if (call !== undefined && slot.alive) {
      for (const batch of call.queue.splice(0, Math.max(IN_FLIGHT - slot.batches.length, 0))) {
        slot.batches.push(batch);
        call.pending += 1;
        slot.worker.postMessage({ id: batch.id, jobs: batch.jobs });
      }
    }
    this.settle();
  }

  /**
   * Records a worker's answer to one of its batches and tops it up. An
   * error answer retires the worker and puts its batches back in the queue.
   *
   * @param slot - the worker that answered.
   * @param data - its message.
   */
  private answered(slot: Slot, data: unknown): void {
    const { call } = this;
    const at = isRecord(data) ? slot.batches.findIndex((held) => held.id === data["id"]) : -1;
    const batch = slot.batches[at];
    if (call === undefined || batch === undefined || !isRecord(data)) {
      return; // a batch this thread took over meanwhile, or no call at all
    }
    if (!record(call, batch, data["answers"])) {
      this.failed(slot); // puts back every batch it holds, this one included
      return;
    }
    slot.batches.splice(at, 1);
    call.pending -= 1;
    this.feed(slot);
  }

  /**
   * Retires a worker that crashed or answered wrongly, and puts the batches
   * it holds back at the front of the queue, in order.
   *
   * @param slot - the worker that failed.
   */
  private failed(slot: Slot): void {
    slot.alive = false;
    const { call } = this;
    const held = slot.batches.splice(0);
    if (call !== undefined) {
      call.pending -= held.length;
      for (const batch of held.reverse()) {
        this.requeue(call, batch);
      }
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
    // The newest batch of the worker holding the most: the one least likely to have started.
    const holder = this.slots.reduce<Slot | undefined>(
      (most, slot) => (slot.batches.length > (most?.batches.length ?? 0) ? slot : most),
      undefined,
    );
    const held = holder?.batches.pop();
    if (held === undefined) {
      return undefined;
    }
    call.pending -= 1; // the worker's late answer no longer matches any batch it holds
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
