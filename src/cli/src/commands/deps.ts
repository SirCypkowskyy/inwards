/**
 * @file What the CLI's commands are given: everything the hook handlers get, plus
 * the storage only some commands write (the baseline, the export), a TOML
 * parser for the uv workspace, the daemon's socket and per-request
 * wiring (ADR-039), the language server's connection and check (ADR-041),
 * and the MCP server's (ADR-042). `main.ts`
 * builds one `AppDeps` per invocation from the adapters; commands never
 * import an adapter themselves.
 */
import type { HookDeps } from "../claude-code/protocol.ts";
import type { DaemonHost, DaemonLink } from "../daemon/contracts.ts";
import type { HookRequest } from "../daemon/protocol.ts";
import type { InitDeps } from "../init/contracts.ts";
import type { ServerCheck } from "../lsp/checks.ts";
import type { Editor, LanguageServer } from "../lsp/contracts.ts";
import type { McpTools } from "../mcp/contracts.ts";
import type { RulePages } from "../mcp/explain-rule.ts";
import type { Platform } from "../platform/contracts.ts";
import type { BaselineWriter } from "../project/contracts.ts";
import type { ExportFiles } from "../runlog/contracts.ts";
import type { CheckRunner } from "../session/contracts.ts";

/** What the hook and `inwards daemon` need for the resident process. */
export interface DaemonDeps {
  /** The hook's side: the record, the socket and starting a daemon. */
  link: DaemonLink;
  /** The daemon's side: the lock, the listening socket and the record. */
  host: DaemonHost;
  /**
   * Builds the dependencies for one hook request the daemon serves: a runtime
   * from the request's working directory and environment, streams that
   * collect the output, and the daemon's content-keyed caches. Called just
   * before the request runs: it starts the request's git budget (#277).
   *
   * @param request - the hook request.
   * @returns the request's dependencies, and what its streams collected.
   */
  invocation: (request: HookRequest) => {
    deps: HookDeps;
    output: () => { stdout: string; stderr: string };
  };
}

/** What `inwards server` needs: the LSP connection and a warm check. */
export interface LspDeps {
  /**
   * Serves LSP over stdio until the editor ends the session.
   *
   * @param build - makes the server's policy, given what it sends to the editor.
   * @returns the exit code, once the editor sends `exit`.
   */
  serve: (build: (editor: Editor) => LanguageServer) => Promise<number>;
  /** Runs a check with the server's in-memory extraction cache, on one thread. */
  check: ServerCheck;
}

/** What `inwards mcp` needs: the MCP connection, the rule pages and a warm check. */
export interface McpDeps {
  /**
   * Serves MCP over stdio until the client closes stdin.
   *
   * @param tools - the tools to serve.
   * @returns the exit code, once the client has gone.
   */
  serve: (tools: McpTools) => Promise<number>;
  /**
   * Loads the rule pages, which only `inwards mcp` carries in memory.
   *
   * @returns the English rule pages' Markdown, by code.
   */
  pages: () => Promise<RulePages>;
  /** The platform, with streams that keep stdout for the protocol. */
  io: Platform;
  /**
   * Runs a check with the server's in-memory extraction cache, on one thread;
   * its `texts` may name Python files that don't exist yet.
   */
  check: CheckRunner;
}

/** One invocation's dependencies. */
export interface AppDeps extends HookDeps {
  /** The resident process for PostToolUse (`inwards daemon`). */
  daemon: DaemonDeps;
  /** The language server (`inwards server`). */
  lsp: LspDeps;
  /** The MCP server (`inwards mcp`). */
  mcp: McpDeps;
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
