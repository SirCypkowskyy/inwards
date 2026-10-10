/**
 * @file What the MCP server (`inwards mcp`, ADR-042) exchanges with its
 * client, as plain data: each tool's arguments, already validated against the
 * schema the client saw, and the answer, as text for the model and as
 * structured data. The connection over stdio (`adapters/mcp-connection.ts`)
 * owns the schemas and the protocol; this folder never sees the SDK or a
 * stream. Types only.
 */
import type { Report } from "@inwards/core";

/** `check_files`' arguments. */
export interface CheckFilesInput {
  /** Files or directories to check, relative to the server's working directory or absolute. */
  paths?: string[] | undefined;
  /** Python source to check instead of what is on disk, by path; the file need not exist. */
  contents?: Record<string, string> | undefined;
  /** At most this many diagnostics in the answer, errors first; the summary counts all. */
  maxDiagnostics?: number | undefined;
}

/** `explain_rule`'s arguments. */
export interface ExplainRuleInput {
  /** A rule code (`INW001`) or name (`layer-dependency`), in any case. */
  rule: string;
  /** True for every section of the page, not only what, why, example and how to fix. */
  full?: boolean | undefined;
}

/** `where_should_this_go`'s arguments. */
export interface WhereInput {
  /** What the code does, in a few words, e.g. "SQL repository for orders". */
  description?: string | undefined;
  /** The dotted module the code would go in, e.g. `shop.infrastructure.orders`. */
  module?: string | undefined;
  /** What the code needs to import: modules, or names in them, and libraries. */
  imports?: string[] | undefined;
  /** A directory or file in the project, which picks its config; the working directory by default. */
  path?: string | undefined;
}

/** A tool's answer: text for the model, and the same as structured data. */
export interface ToolAnswer {
  /** What the client shows the model. */
  text: string;
  /** The answer as a JSON object, for clients that read structured content. */
  data?: Record<string, unknown>;
  /** True when the tool couldn't answer: a bad argument, a broken config. */
  error?: boolean;
}

/** The three tools, as the connection calls them. */
export interface McpTools {
  /**
   * Checks files, or text not yet written, as `inwards check` would.
   *
   * @param input - what to check.
   * @returns the `inwards/diagnostics@1` report.
   */
  checkFiles: (input: CheckFilesInput) => Promise<ToolAnswer>;
  /**
   * Explains a rule from its docs page.
   *
   * @param input - which rule.
   * @returns the page's sections.
   */
  explainRule: (input: ExplainRuleInput) => Promise<ToolAnswer>;
  /**
   * Says which layer new code belongs in, and what it may import there.
   *
   * @param input - what the code does, where it would go, and what it imports.
   * @returns the layers, the candidates and a suggestion.
   */
  whereShouldThisGo: (input: WhereInput) => Promise<ToolAnswer>;
}

/**
 * Runs `inwards check` over some paths from the server's working directory,
 * with Python texts laid over the disk, every config they route to included.
 *
 * @param targets - absolute files or directories; undefined for the whole project.
 * @param texts - Python source to check instead of the disk's, by absolute
 *   path; such a file need not exist.
 * @returns the merged report, with paths relative to the working directory,
 *   and what the run had to say besides its findings (a config that couldn't
 *   be checked in a run over several).
 * @throws {ConfigError} when the only config, or its baseline, is invalid.
 */
export type McpCheck = (
  targets: string[] | undefined,
  texts: ReadonlyMap<string, string>,
) => Promise<{ report: Report; notes: string[] }>;
