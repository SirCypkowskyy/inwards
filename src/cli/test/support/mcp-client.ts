/**
 * @file MCP clients for the `inwards mcp` tests, from the SDK's own client
 * package: one connected in process over the SDK's in-memory transport to the
 * server the binary builds (`createMcpServer` with `mcpTools`), with the
 * working directory set to a throwaway project, and one that starts the CLI
 * (`run.ts`'s `CMD`, so the compiled binary in CI) and speaks MCP over its
 * stdio. Plus a reader for a tool result's text and structured content.
 */
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { compose } from "../../src/adapters/compose.ts";
import { createMcpServer } from "../../src/adapters/mcp-connection.ts";
import { mcpTools } from "../../src/commands/mcp.ts";
import { CMD, TEST_ENV } from "./run.ts";

/** What a test reads from a tool call. */
export interface Answer {
  /** The text content, joined. */
  text: string;
  /** The structured content, or an empty object. */
  data: Record<string, unknown>;
  /** Whether the server flagged the call as failed. */
  isError: boolean;
}

/** A tool result as the client hands it over, narrowed to what the tests read. */
interface RawResult {
  content?: unknown;
  structuredContent?: unknown;
  isError?: unknown;
}

/**
 * Tells whether a value is a plain object.
 *
 * @param value - anything.
 * @returns true for a non-null, non-array object.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads a tool result.
 *
 * @param result - what `callTool` returned.
 * @returns its text, structured content and error flag.
 */
function answerOf(result: RawResult): Answer {
  const blocks = Array.isArray(result.content) ? result.content : [];
  const text = blocks
    .map((block: unknown) =>
      isObject(block) && typeof block["text"] === "string" ? block["text"] : "",
    )
    .join("");
  return {
    text,
    data: isObject(result.structuredContent) ? result.structuredContent : {},
    isError: result.isError === true,
  };
}

/**
 * Calls a tool and reads its result.
 *
 * @param client - a connected client.
 * @param name - the tool.
 * @param args - its arguments.
 * @returns the answer.
 */
export async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<Answer> {
  return answerOf(await client.callTool({ name, arguments: args }));
}

/**
 * Connects a client in process to the server `inwards mcp` builds, as if it
 * had started in `cwd`.
 *
 * @param cwd - the project directory the server works in.
 * @returns the connected client.
 */
export async function connectInProcess(cwd: string): Promise<Client> {
  const deps = compose();
  const io = { ...deps.mcp.io, runtime: { ...deps.mcp.io.runtime, cwd } };
  const tools = await mcpTools({ ...deps, mcp: { ...deps.mcp, io } });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(tools).connect(serverSide);
  const client = new Client({ name: "inwards-test", version: "1.0.0" });
  await client.connect(clientSide);
  return client;
}

/** A client talking to `inwards mcp` over stdio, and what went wrong on the wire. */
export interface StdioSession {
  client: Client;
  /** Transport errors, such as a stdout line that isn't JSON-RPC. */
  errors: string[];
  /** What the server wrote to stderr. */
  stderr: () => string;
}

/**
 * Starts `inwards mcp` in a directory and connects a client over its stdio.
 *
 * @param cwd - the project directory.
 * @param pin - a protocol revision for the client to insist on, such as
 *   `2026-07-28`; by default it opens with `initialize`, as 2025 clients do.
 * @returns the session.
 */
export async function connectStdio(cwd: string, pin?: string): Promise<StdioSession> {
  const [command = "", ...args] = CMD;
  const env = Object.fromEntries(
    Object.entries(TEST_ENV).flatMap(([k, v]) => (v === undefined ? [] : [[k, v]])),
  );
  const transport = new StdioClientTransport({
    command,
    args: [...args, "mcp"],
    cwd,
    env,
    stderr: "pipe",
  });
  const errors: string[] = [];
  const chunks: string[] = [];
  transport.stderr?.on("data", (chunk: unknown) => chunks.push(String(chunk)));
  const client = new Client(
    { name: "inwards-test", version: "1.0.0" },
    pin === undefined ? {} : { versionNegotiation: { mode: { pin } } },
  );
  client.onerror = (err: Error): void => {
    errors.push(err.message);
  };
  await client.connect(transport);
  return { client, errors, stderr: (): string => chunks.join("") };
}
