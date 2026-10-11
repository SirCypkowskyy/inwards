/**
 * @file The run log's write side: the per-invocation `RunLog` that notes what
 * the handlers saw and appends one `inwards/run@1` line to `.inwards/runs.jsonl`.
 * Re-exports only; reading the log back is `../queries/`.
 */
export { createRunLog, type RunLog } from "./_record.ts";
