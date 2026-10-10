/**
 * @file A minimal LSP client for the packaging test: it starts a language
 * server command over stdio, completes the handshake on one workspace folder,
 * and records the diagnostics the server publishes. What the server shows is
 * tested in the CLI (`src/cli/test/lsp/`); this only proves a packaged binary
 * starts and answers as an editor expects.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export const TIMEOUT_MS = 15_000;
const HEADER_END = "\r\n\r\n";
const CONTENT_LENGTH = /Content-Length: (?<n>\d+)/iu;

/** A message from the server, with the fields the test reads. */
interface Received {
  id?: number;
  method?: string;
  params?: { uri?: string; diagnostics?: { code: string }[] };
}

/** One test file's server and what it published. */
export interface Harness {
  /** Starts the server on a project and completes the handshake. */
  startServer: (root: string) => Promise<void>;
  /** Waits until a file's latest diagnostics include a code; returns their codes. */
  codesOnceIncluding: (path: string, code: string) => Promise<string[]>;
  /** Kills the server and waits for it to exit. */
  cleanup: () => Promise<void>;
}

/**
 * Writes the test project's files.
 *
 * @param root - the project directory.
 * @param files - contents by relative path.
 */
export function write(root: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
}

/**
 * Waits until a condition holds, or the deadline passes.
 *
 * @param ready - the condition.
 * @param deadline - when to give up, in `Date.now()` milliseconds.
 */
async function until(
  ready: () => boolean,
  deadline: number = Date.now() + TIMEOUT_MS,
): Promise<void> {
  if (ready() || Date.now() > deadline) {
    return;
  }
  await Bun.sleep(20);
  await until(ready, deadline);
}

/**
 * Reads framed LSP messages from a server and hands each to a callback.
 *
 * @param stdout - the server's stdout.
 * @param receive - called with each parsed message.
 */
async function listen(
  stdout: ReadableStream<Uint8Array>,
  receive: (message: Received) => void,
): Promise<void> {
  let buffer = Buffer.alloc(0);
  for await (const chunk of stdout) {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const end = buffer.indexOf(HEADER_END);
      const length = Number(CONTENT_LENGTH.exec(buffer.subarray(0, end).toString())?.groups?.["n"]);
      if (end === -1 || buffer.length < end + 4 + length) {
        break;
      }
      receive(JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString()));
      buffer = buffer.subarray(end + 4 + length);
    }
  }
}

/**
 * Sets up a client for one server command, the way VS Code's language client
 * starts an executable: the command, then `--stdio`.
 *
 * @param command - the executable and its arguments, e.g. `[binary, "server"]`.
 * @returns the harness; call `cleanup` when done with the server.
 */
export function lspHarness(command: string[]): Harness {
  const published = new Map<string, string[]>();
  const answered = new Set<number>();
  let server: Bun.Subprocess<"pipe", "pipe", "ignore"> | undefined;

  /**
   * Records a server message: an answer's id, or a file's diagnostics.
   *
   * @param message - the parsed message.
   */
  function receive(message: Received): void {
    if (typeof message.id === "number" && message.method === undefined) {
      answered.add(message.id);
    }
    if (message.method === "textDocument/publishDiagnostics" && message.params?.uri) {
      published.set(
        message.params.uri,
        (message.params.diagnostics ?? []).map((d) => d.code),
      );
    }
  }

  /**
   * Sends one JSON-RPC message to the server.
   *
   * @param message - the message without `jsonrpc`.
   */
  function send(message: Record<string, unknown>): void {
    const body = JSON.stringify({ jsonrpc: "2.0", ...message });
    server?.stdin.write(`Content-Length: ${Buffer.byteLength(body)}${HEADER_END}${body}`);
    server?.stdin.flush();
  }

  return {
    startServer: async (root: string): Promise<void> => {
      server = Bun.spawn([...command, "--stdio"], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "ignore",
      });
      listen(server.stdout, receive).catch(() => undefined);
      const folder = pathToFileURL(root).href;
      send({
        id: 1,
        method: "initialize",
        params: {
          processId: null,
          rootUri: folder,
          capabilities: {},
          workspaceFolders: [{ uri: folder, name: "project" }],
        },
      });
      await until(() => answered.has(1));
      if (!answered.has(1)) {
        throw new Error(`the server did not answer initialize within ${TIMEOUT_MS} ms`);
      }
      send({ method: "initialized", params: {} });
    },
    codesOnceIncluding: async (path: string, code: string): Promise<string[]> => {
      const uri = pathToFileURL(path).href;
      await until(() => published.get(uri)?.includes(code) === true);
      return published.get(uri) ?? [];
    },
    cleanup: async (): Promise<void> => {
      // The server is disposable: SIGKILL can't be ignored, so waiting ends.
      server?.kill("SIGKILL");
      await server?.exited;
    },
  };
}
