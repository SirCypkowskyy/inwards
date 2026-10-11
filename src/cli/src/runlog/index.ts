/**
 * @file The `runlog/` slice's public face: the run log other slices write to,
 * and what the tests read back. Re-exports only; the `inwards stats` handler
 * is `cli.ts`, the export storage `adapters/`, which only the wiring imports.
 */
export { createRunLog, type RunLog } from "./commands/index.ts";
export { computeStats, readRunLogs, type Stats } from "./queries/index.ts";
