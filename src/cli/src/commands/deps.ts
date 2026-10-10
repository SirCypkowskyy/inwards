/**
 * @file What the CLI's commands are given: everything the hook handlers get, plus
 * the storage only some commands write (the baseline, the export), a TOML
 * parser for the uv workspace, and the daemon's socket and per-request
 * wiring (ADR-039). `main.ts`
 * builds one `AppDeps` per invocation from the adapters; commands never
 * import an adapter themselves.
 */
import type { HookDeps } from "../claude-code/protocol.ts";
import type { DaemonHost, DaemonLink } from "../daemon/contracts.ts";
import type { HookRequest } from "../daemon/protocol.ts";
import type { InitDeps } from "../init/contracts.ts";
import type { BaselineWriter } from "../project/contracts.ts";
import type { ExportFiles } from "../runlog/contracts.ts";

/** What the hook and `inwards daemon` need for the resident process. */
export interface DaemonDeps {
  /** The hook's side: the record, the socket and starting a daemon. */
  link: DaemonLink;
  /** The daemon's side: the lock, the listening socket and the record. */
  host: DaemonHost;
  /**
   * Builds the dependencies for one hook request the daemon serves: a runtime
   * from the request's working directory and environment, streams that
   * collect the output, and the daemon's content-keyed caches.
   *
   * @param request - the hook request.
   * @returns the request's dependencies, and what its streams collected.
   */
  invocation: (request: HookRequest) => {
    deps: HookDeps;
    output: () => { stdout: string; stderr: string };
  };
}

/** One invocation's dependencies. */
export interface AppDeps extends HookDeps {
  /** The resident process for PostToolUse (`inwards daemon`). */
  daemon: DaemonDeps;
  /** Replaces `inwards-baseline.json`. */
  baselines: BaselineWriter;
  /** Keeps the export key and writes the export. */
  exports: ExportFiles;
  /** What `inwards init` needs besides the platform. */
  init: InitDeps;
  /**
   * Parses TOML, for finding a uv workspace's members (`inwards check`, #57).
   *
   * @param text - a pyproject.toml's contents.
   * @returns the document, or undefined when it doesn't parse.
   */
  toml: (text: string) => unknown;
}
