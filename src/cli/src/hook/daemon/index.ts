/**
 * @file The `hook/daemon/` mini-domain's public face (ADR-039): the
 * `inwards-daemon/1` wire format, the hook's side (`viaDaemon`, `askDaemon`),
 * the request handler and the caches the daemon keeps between requests.
 * Re-exports only. `cli.ts` (`inwards daemon`) is not re-exported here: it
 * calls `hookClaudeCode` from `hook/cli.ts`, which reads this file, so
 * `hook/index.ts` re-exports it instead and no cycle closes.
 */
export {
  askDaemon,
  BACKOFF_MS,
  backingOff,
  holdsLock,
  viaDaemon,
} from "./_client.ts";
export { commitKeyedGit, daemonExtractionCache } from "./_memory.ts";
export {
  type DaemonAnswer,
  type DaemonPlace,
  type DaemonStatus,
  daemonEnabled,
  daemonPlace,
  type HookRequest,
  MAX_PAYLOAD_BYTES,
  MAX_REQUEST_BYTES,
  PROTOCOL,
  parseAnswer,
  parseFailure,
  parseRecord,
  parseRequest,
  toLine,
} from "./_protocol.ts";
export { createHandler, type HookOutcome } from "./_server.ts";
