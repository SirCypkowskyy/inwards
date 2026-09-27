import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

// The language server over stdio, bundled the way the extension ships it
// (CommonJS, grammars next to server.js), talking to a minimal LSP client.

export const PYPROJECT = `[tool.inwards]
layers = [{ name = "app", modules = ["app"] }]

[[tool.inwards.shape]]
packages = ["app.*"]
allow = ["router", "schemas", "utils"]
require = ["__init__", "router", "service"]
`;
const TIMEOUT_MS = 15_000;
/** How long to wait for a refresh that must not happen: well past the server's 100 ms debounce. */
export const QUIET_MS = 500;
const HEADER_END = "\r\n\r\n";
const CONTENT_LENGTH = /Content-Length: (?<n>\d+)/iu;
/** A client that registers file watchers for the server, as VS Code does. */
export const WATCHING = { workspace: { didChangeWatchedFiles: { dynamicRegistration: true } } };

/** A diagnostic as the test client reads it. */
export interface Published {
  code: string;
  severity: number;
  message: string;
  range: { start: { line: number } };
  /** The rule's docs page, which the editor links from the code. */
  codeDescription?: { href: string };
}
/** A file watcher the server asks the client to register. */
interface Watcher {
  globPattern: string;
  kind?: number;
}
/** A message from the server, with the fields the tests read. */
interface Received {
  method?: string;
  params?: {
    registrations?: { registerOptions: { watchers: Watcher[] } }[];
    type?: number;
    message?: string;
  };
}

/** What the servers sent, as the tests read it. */
interface Log {
  published: Map<string, Published[]>;
  publishes: Map<string, number>;
  /** Ids of the requests the servers have answered. */
  answered: Set<number>;
  received: Received[];
}

/** A running language server and the way to talk to it. */
export interface Server {
  /** Sends one JSON-RPC message, without `jsonrpc`. */
  send: (message: Record<string, unknown>) => void;
  kill: () => void;
}

/** One test file's server bundle, test projects and view of what its servers sent. */
export interface Harness {
  /** The directory for the test projects, removed by `cleanup`. */
  tmp: string;
  /** The latest diagnostics per URI, and how many times each URI got them. */
  published: Map<string, Published[]>;
  publishes: Map<string, number>;
  startServer: (root: string, id: number, capabilities: Record<string, unknown>) => Promise<Server>;
  watched: (rel: string, type: number) => boolean;
  codesOnceIncluding: (path: string, code: string, present?: boolean) => Promise<string[]>;
  diagnosticsOnce: (path: string, ready: (found: Published[]) => boolean) => Promise<Published[]>;
  popups: () => string[];
  cleanup: () => void;
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
export async function until(
  ready: () => boolean,
  deadline = Date.now() + TIMEOUT_MS,
): Promise<void> {
  if (ready() || Date.now() > deadline) {
    return;
  }
  await Bun.sleep(20);
  await until(ready, deadline);
}

/**
 * Bundles server.ts into a directory next to both grammars.
 *
 * @param tmp - the directory to bundle into.
 * @returns the path of the bundled server.
 */
async function bundle(tmp: string): Promise<string> {
  const out = join(tmp, "dist");
  const built = await Bun.build({
    entrypoints: [join(import.meta.dir, "../src/server/server.ts")],
    naming: { entry: "[name].[ext]" },
    outdir: out,
    target: "node",
    format: "cjs",
  });
  if (!built.success) {
    throw new Error(built.logs.join("\n"));
  }
  for (const spec of [
    "web-tree-sitter/web-tree-sitter.wasm",
    "tree-sitter-python/tree-sitter-python.wasm",
  ]) {
    copyFileSync(Bun.resolveSync(spec, import.meta.dir), join(out, spec.split("/").at(-1) ?? ""));
  }
  return join(out, "server.js");
}

/**
 * Reads framed LSP messages from a server and records its diagnostics.
 *
 * @param stdout - the server's stdout.
 * @param log - where to record them.
 */
async function listen(stdout: ReadableStream<Uint8Array>, log: Log): Promise<void> {
  const { published, publishes, answered, received } = log;
  let buffer = Buffer.alloc(0);
  for await (const chunk of stdout) {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const end = buffer.indexOf(HEADER_END);
      const length = Number(CONTENT_LENGTH.exec(buffer.subarray(0, end).toString())?.groups?.["n"]);
      if (end === -1 || buffer.length < end + 4 + length) {
        break;
      }
      const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString());
      buffer = buffer.subarray(end + 4 + length);
      if (typeof message.id === "number" && message.method === undefined) {
        answered.add(message.id);
      }
      received.push(message);
      if (message.method === "textDocument/publishDiagnostics") {
        published.set(message.params.uri, message.params.diagnostics);
        publishes.set(message.params.uri, (publishes.get(message.params.uri) ?? 0) + 1);
      }
    }
  }
}

/**
 * Sets up a test file's language server client: a temporary directory, the
 * bundled server (built once), and what its servers send. Each test file
 * makes its own, since Bun shares modules between the files it runs.
 *
 * @returns the harness; call `cleanup` in `afterAll`.
 */
export function lspHarness(): Harness {
  const tmp = mkdtempSync(join(tmpdir(), "inwards-lsp-"));
  const bundled = bundle(tmp);
  const log: Log = {
    published: new Map(),
    publishes: new Map(),
    answered: new Set(),
    received: [],
  };
  const { published, publishes, answered, received } = log;

  /**
   * Starts the bundled server on a project and completes the LSP handshake.
   *
   * @param root - the project directory, opened as the only workspace folder.
   * @param id - the initialize request's id, unique across the file's servers.
   * @param capabilities - the client capabilities to announce.
   * @returns the running server.
   */
  async function startServer(
    root: string,
    id: number,
    capabilities: Record<string, unknown>,
  ): Promise<Server> {
    const server = Bun.spawn([process.execPath, await bundled, "--stdio"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
    });
    /**
     * Sends one JSON-RPC message to the server.
     *
     * @param message - the message without `jsonrpc`.
     */
    function send(message: Record<string, unknown>): void {
      const body = JSON.stringify({ jsonrpc: "2.0", ...message });
      server.stdin.write(`Content-Length: ${Buffer.byteLength(body)}${HEADER_END}${body}`);
      server.stdin.flush();
    }
    listen(server.stdout, log).catch(() => undefined);
    const folder = pathToFileURL(root).href;
    send({
      id,
      method: "initialize",
      params: {
        processId: null,
        rootUri: folder,
        capabilities,
        workspaceFolders: [{ uri: folder, name: "project" }],
      },
    });
    await until(() => answered.has(id));
    send({ method: "initialized", params: {} });
    return { send, kill: (): void => server.kill() };
  }

  /**
   * Tells whether a watcher the server registered covers an event, as a client would decide.
   *
   * @param rel - the path, relative to the workspace root.
   * @param type - 1 for created, 3 for deleted.
   * @returns true when some watcher's glob matches and its kind includes the event (Create 1, Delete 4).
   */
  function watched(rel: string, type: number): boolean {
    const bit = type === 1 ? 1 : 4;
    return received
      .filter((m) => m.method === "client/registerCapability")
      .flatMap((m) =>
        (m.params?.registrations ?? []).flatMap((reg) => reg.registerOptions.watchers),
      )
      .some(
        (w) => new Bun.Glob(w.globPattern).match(rel) && Math.floor((w.kind ?? 7) / bit) % 2 === 1,
      );
  }

  /**
   * Waits until a file's latest diagnostics satisfy a condition.
   *
   * @param path - the file's absolute path.
   * @param ready - the condition on its diagnostics.
   * @returns the diagnostics published for the file.
   */
  async function diagnosticsOnce(
    path: string,
    ready: (found: Published[]) => boolean,
  ): Promise<Published[]> {
    const uri = pathToFileURL(path).href;
    await until(() => ready(published.get(uri) ?? []));
    return published.get(uri) ?? [];
  }

  /**
   * Waits until a file's latest diagnostics include a code, or, with
   * `present` false, until they no longer do.
   *
   * @param path - the file's absolute path.
   * @param code - e.g. `INW007`.
   * @param present - whether to wait for the code to show up or to go away.
   * @returns the codes published for the file.
   */
  async function codesOnceIncluding(path: string, code: string, present = true): Promise<string[]> {
    const uri = pathToFileURL(path).href;
    const found = await diagnosticsOnce(
      path,
      (diagnostics) => published.has(uri) && diagnostics.some((d) => d.code === code) === present,
    );
    return found.map((d) => d.code);
  }

  /**
   * Lists the error messages the servers have popped up, oldest first.
   *
   * @returns the texts of the `window/showMessage` errors.
   */
  function popups(): string[] {
    return received
      .filter((m) => m.method === "window/showMessage" && m.params?.type === 1)
      .map((m) => m.params?.message ?? "");
  }

  return {
    tmp,
    published,
    publishes,
    startServer,
    watched,
    codesOnceIncluding,
    diagnosticsOnce,
    popups,
    cleanup: (): void => rmSync(tmp, { recursive: true, force: true }),
  };
}
