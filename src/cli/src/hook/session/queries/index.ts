/**
 * @file The session's read side: what was already wrong at start (old errors,
 * #134), the findings an agent suppressed (#50), layout changes since the start,
 * the committed config check and the per-invocation lookups they share.
 * Re-exports only; the record and the start copies are `../commands/`.
 */
export { agentSuppressions, rejectedNote } from "./_agent-suppressions.ts";
export { uncommittedConfigs } from "./_committed-config.ts";
export { newLayoutErrors, preexistingShape } from "./_layout-changes.ts";
export { createStartLookups, type StartLookups } from "./_lookups.ts";
export { oldErrors, oldNote } from "./_old-errors.ts";
export { createStartContent } from "./_start-content.ts";
