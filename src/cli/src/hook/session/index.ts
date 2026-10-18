/**
 * @file The session mini-domain's public face: the record and start record
 * (`commands/`) and the questions about the start (`queries/`). Re-exports
 * only, so the Claude Code handlers and the tests import one path.
 */
export {
  createStartIdentity,
  isSessionId,
  isToolUseId,
  MAX_COPIES_BYTES,
  MAX_COPY_BYTES,
  readSession,
  readSessionStart,
  recordEdit,
  recordPass,
  recordStart,
  recordStop,
  type SessionState,
  type StartCopier,
  startCopier,
  touchWitness,
} from "./commands/index.ts";
export {
  agentSuppressions,
  createStartContent,
  createStartLookups,
  newLayoutErrors,
  oldErrors,
  oldNote,
  preexistingShape,
  rejectedNote,
  type StartLookups,
  uncommittedConfigs,
} from "./queries/index.ts";
