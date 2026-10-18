/**
 * @file The worker side of the extraction pool (#61): a thread that loads the
 * grammar once and runs the engine's extraction jobs it is sent, answering
 * each batch with one result per job in the same order. `main.ts` calls
 * `serveExtractions` when the binary runs as a worker thread, so the
 * compiled executable needs no second entry point. It reads no file and
 * decides nothing; the engine and `extraction-pool.ts` do.
 */
import { parentPort } from "node:worker_threads";
import {
  createExtractionWorker,
  type ExtractionAnswer,
  type ExtractionJob,
  type GrammarBinaries,
} from "@inwards/core";
import { isRecord } from "./extraction-entry.ts";

/** What a worker answers for one batch. */
export type WorkerAnswer =
  | { id: number; answers: ExtractionAnswer[] }
  | { id: number; error: string };

/** Where a worker gets its messages and sends its answers. */
export interface WorkerPort {
  /**
   * Registers the message listener.
   *
   * @param event - always "message".
   * @param listener - called with each message's data.
   */
  on: (event: "message", listener: (data: unknown) => void) => void;
  /**
   * Sends an answer to the thread that started the worker.
   *
   * @param answer - the batch's answer.
   */
  postMessage: (answer: WorkerAnswer) => void;
}

/**
 * Tells whether a message is the grammar the worker loads first.
 *
 * @param data - a message from the pool.
 * @returns true for `{ wasm: { runtime, python } }` with both blobs as bytes.
 */
function isInit(data: unknown): data is { wasm: GrammarBinaries } {
  return (
    isRecord(data) &&
    isRecord(data["wasm"]) &&
    data["wasm"]["runtime"] instanceof Uint8Array &&
    data["wasm"]["python"] instanceof Uint8Array
  );
}

/**
 * Tells whether a message is a batch of jobs, each a source file and what to
 * extract from it, as the pool sends them.
 *
 * @param data - a message from the pool.
 * @returns true for `{ id, jobs }` with a numeric id and well-formed jobs.
 */
function isBatch(data: unknown): data is { id: number; jobs: ExtractionJob[] } {
  return (
    isRecord(data) &&
    typeof data["id"] === "number" &&
    Array.isArray(data["jobs"]) &&
    data["jobs"].every(isJob)
  );
}

/**
 * Tells whether a value is one extraction job.
 *
 * @param value - an element of a batch's job list.
 * @returns true for `{ file, want }` with a whole source file and a known `want`.
 */
function isJob(value: unknown): value is ExtractionJob {
  if (!(isRecord(value) && (value["want"] === "skeleton" || value["want"] === "full"))) {
    return false;
  }
  const { file } = value;
  return (
    isRecord(file) &&
    typeof file["path"] === "string" &&
    typeof file["module"] === "string" &&
    typeof file["isPackage"] === "boolean" &&
    typeof file["text"] === "string"
  );
}

/**
 * Serves extraction batches on a port until the thread is stopped. The first
 * message carries the grammar; batches that arrive before it has loaded wait
 * for it. A batch that throws, a malformed one, or any batch after the
 * grammar failed to load is answered with an error, and the pool hands
 * those jobs to another thread.
 *
 * @param port - the worker's port; `node:worker_threads`' `parentPort` by default.
 */
export function serveExtractions(port: WorkerPort | null = parentPort): void {
  if (port === null) {
    return; // not a worker thread
  }
  let ready: Promise<(job: ExtractionJob) => ExtractionAnswer> | undefined;
  port.on("message", (data: unknown): void => {
    if (isInit(data)) {
      ready = createExtractionWorker(data.wasm);
      ready.catch(() => undefined); // reported with the first batch
      return;
    }
    if (!isBatch(data)) {
      if (isRecord(data) && typeof data["id"] === "number") {
        port.postMessage({ id: data["id"], error: "malformed batch" }); // the pool must not wait for it
      }
      return;
    }
    const { id, jobs } = data;
    (ready ?? Promise.reject(new Error("extraction worker got a batch before the grammar")))
      .then((run) => port.postMessage({ id, answers: jobs.map(run) }))
      .catch((err: unknown) => {
        port.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
      });
  });
}
