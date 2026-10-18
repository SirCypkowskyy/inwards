/**
 * @file The session's write side: the session record of each hook run, the
 * start record with its witness (#88), the copies of dirty files taken at
 * start and how a path gets its start identity. Re-exports only; what the
 * hook asks about the start is `../queries/`.
 */
export {
  isSessionId,
  isToolUseId,
  readSession,
  readSessionStart,
  recordEdit,
  recordPass,
  recordStart,
  recordStop,
  type SessionState,
} from "./_record.ts";
export {
  MAX_COPIES_BYTES,
  MAX_COPY_BYTES,
  readStartCopies,
  type StartCopier,
  startCopier,
} from "./_start-copies.ts";
export { createStartIdentity, type StartIdentity } from "./_start-identity.ts";
export { touchWitness } from "./_start-record.ts";
