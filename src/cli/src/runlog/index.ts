/**
 * @file The `runlog/` slice's public face: the `inwards stats` handler
 * `main.ts` dispatches to, the run log other slices write to, and what the
 * tests read back. Re-exports only; the export storage in `adapters/` is
 * never re-exported, so only the root wires it in.
 */
export { statsCommand } from "./cli.ts";
export { createRunLog, type RunLog } from "./commands/index.ts";
export { computeStats, readRunLogs, type Stats } from "./queries/index.ts";
