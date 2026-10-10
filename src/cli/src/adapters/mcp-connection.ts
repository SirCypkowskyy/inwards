/**
 * @file The MCP server's connection over stdio (`inwards mcp`, ADR-042), with
 * the MCP TypeScript SDK v2 (`@modelcontextprotocol/server`): it declares the
 * three tools with their input schemas (Zod 4, which the SDK turns into the
 * JSON Schema `tools/list` shows), passes validated arguments to the policy
 * (`mcp/tools.ts`), and turns its answers into tool results. `serveStdio`
 * serves both protocol eras from one factory: a client that opens with
 * `initialize` (the 2025 revisions) and one that opens with the 2026-07-28
 * revision. Stdout is the protocol's channel: nothing else may write there
 * (`compose.ts` hands the checks streams that write to stderr). The server
 * ends when the client closes stdin.
 */
import process from "node:process";
import { VERSION } from "@inwards/core";
import { type CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import type { McpTools, ToolAnswer } from "../mcp/contracts.ts";

/** What the client tells the model about the server, at the handshake. */
const INSTRUCTIONS = [
  "Inwards checks Python imports against the architecture declared in [tool.inwards] in pyproject.toml: layers that may only import inwards, bounded contexts, library rules per layer, and modules that must exist.",
  "Before writing a new module, call where_should_this_go with what it does and what it will import. Before saving Python code, call check_files with its text in contents, or with the paths you changed. For a rule code in a finding (INW001, FAPI003, ...), call explain_rule.",
  "Fix a finding by changing the code. Never edit [tool.inwards] or inwards-baseline.json to make a finding go away; ask the user.",
].join("\n");

/** Every tool only reads: no file is written, and the same call gives the same answer. */
const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;

const CHECK_FILES = z.object({
  paths: z
    .array(z.string())
    .optional()
    .describe(
      "Files or directories to check, relative to the project directory the server runs in, or absolute. Omit paths and contents to check the whole project.",
    ),
  contents: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "Python source to check instead of what is on disk, by .py or .pyi path. The file need not exist yet: check code before writing it.",
    ),
  maxDiagnostics: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Return at most this many diagnostics, errors first; the summary still counts all."),
});

const EXPLAIN_RULE = z.object({
  rule: z
    .string()
    .min(1)
    .describe("A rule code such as INW001 or FAPI003, or its name such as layer-dependency."),
  full: z
    .boolean()
    .optional()
    .describe(
      "Also return the configuration, fix safety and known limitations sections, not only what it does, why, an example and how to fix.",
    ),
});

const WHERE = z.object({
  description: z
    .string()
    .optional()
    .describe('What the new code does, in a few words, e.g. "SQL repository for orders".'),
  module: z
    .string()
    .optional()
    .describe(
      "The dotted module you plan to put it in, e.g. shop.infrastructure.orders, to have it judged.",
    ),
  imports: z
    .array(z.string())
    .optional()
    .describe(
      "What the code will import: modules (shop.domain.order), classes in them (shop.domain.order.Order: a last part starting with a capital is a name, anything else a module) and libraries (sqlalchemy). Each layer is judged by whether these imports pass there.",
    ),
  path: z
    .string()
    .optional()
    .describe(
      "A directory or file in the project, which picks its pyproject.toml; the server's directory by default.",
    ),
});

/**
 * Turns the policy's answer into a tool result.
 *
 * @param answer - the policy's text, data and error flag.
 * @returns the text as content, the data as structured content, and the error flag.
 */
function resultOf(answer: ToolAnswer): CallToolResult {
  return {
    content: [{ type: "text", text: answer.text }],
    ...(answer.data === undefined ? {} : { structuredContent: answer.data }),
    ...(answer.error === true ? { isError: true } : {}),
  };
}

/**
 * Builds the MCP server with the three tools. The stdio entry calls it once
 * per connection; the tests call it to serve over an in-memory transport.
 *
 * @param tools - the policy.
 * @returns the server, not yet connected.
 */
export function createMcpServer(tools: McpTools): McpServer {
  const server = new McpServer(
    { name: "inwards", version: VERSION },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );
  server.registerTool(
    "check_files",
    {
      title: "Check files",
      description:
        "Runs `inwards check` on files, directories, the whole project, or Python source not yet written, and returns the inwards/diagnostics@1 JSON report: a summary and one diagnostic per finding, each with its rule code, position, message, fix steps and docs link.",
      inputSchema: CHECK_FILES,
      annotations: READ_ONLY,
    },
    async (args) => resultOf(await tools.checkFiles(args)),
  );
  server.registerTool(
    "explain_rule",
    {
      title: "Explain a rule",
      description:
        "Returns a rule's docs page: what it reports, why that is a problem, a flagged and a fixed example, and how to fix it.",
      inputSchema: EXPLAIN_RULE,
      annotations: READ_ONLY,
    },
    async (args) => resultOf(await tools.explainRule(args)),
  );
  server.registerTool(
    "where_should_this_go",
    {
      title: "Where should this go",
      description:
        "Says which layer and module new code belongs in according to [tool.inwards], and which of its imports each layer would refuse, by checking a module that holds only those imports in each layer. Lists every layer with what it may import, and the bounded contexts.",
      inputSchema: WHERE,
      annotations: READ_ONLY,
    },
    async (args) => resultOf(await tools.whereShouldThisGo(args)),
  );
  return server;
}

/**
 * Serves MCP on stdin and stdout until the client closes stdin.
 *
 * @param tools - the policy.
 * @returns a promise that settles with exit code 0 once stdin has ended.
 */
export function serveMcp(tools: McpTools): Promise<number> {
  return new Promise<number>((resolve) => {
    const handle = serveStdio(() => createMcpServer(tools), {
      onerror: (err: Error): void => {
        process.stderr.write(`inwards mcp: ${err.message}\n`);
      },
    });
    process.stdin.once("end", () => {
      handle.close().then(
        () => resolve(0),
        () => resolve(0),
      );
    });
  });
}
