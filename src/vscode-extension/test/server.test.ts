import { afterAll, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

// The language server over stdio, bundled the way the extension ships it
// (CommonJS, grammars next to server.js), talking to a minimal LSP client.
const TMP = mkdtempSync(join(tmpdir(), "inwards-lsp-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const PYPROJECT = `[tool.inwards]
layers = [{ name = "app", modules = ["app"] }]

[[tool.inwards.shape]]
packages = ["app.*"]
allow = ["router", "schemas", "utils"]
require = ["__init__", "router", "service"]
`;
const TIMEOUT_MS = 15_000;
/** How long to wait for a refresh that must not happen: well past the server's 100 ms debounce. */
const QUIET_MS = 500;
const HEADER_END = "\r\n\r\n";
const CONTENT_LENGTH = /Content-Length: (?<n>\d+)/iu;

/** What the test client has received: the latest diagnostics per URI. */
const published = new Map<string, { code: string }[]>();
/** How many times diagnostics were published for each URI. */
const publishes = new Map<string, number>();
/** Ids of the requests the server has answered. */
const answered = new Set<number>();
/** A file watcher the server asks the client to register. */
interface Watcher {
  globPattern: string;
  kind?: number;
}
/** Every message the server sent; the watcher test reads its registration requests. */
const received: {
  method?: string;
  params?: { registrations?: { registerOptions: { watchers: Watcher[] } }[] };
}[] = [];

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
    .flatMap((m) => (m.params?.registrations ?? []).flatMap((reg) => reg.registerOptions.watchers))
    .some(
      (w) => new Bun.Glob(w.globPattern).match(rel) && Math.floor((w.kind ?? 7) / bit) % 2 === 1,
    );
}

/**
 * Bundles server.ts into a temporary directory next to both grammars.
 *
 * @returns the path of the bundled server.
 */
async function bundle(): Promise<string> {
  const out = join(TMP, "dist");
  const built = await Bun.build({
    entrypoints: [join(import.meta.dir, "../src/server.ts")],
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
 * Writes the test project's files.
 *
 * @param root - the project directory.
 * @param files - contents by relative path.
 */
function write(root: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
}

/**
 * Reads framed LSP messages from the server and records its diagnostics.
 *
 * @param stdout - the server's stdout.
 */
async function listen(stdout: ReadableStream<Uint8Array>): Promise<void> {
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
 * Waits until a condition holds, or the deadline passes.
 *
 * @param ready - the condition.
 * @param deadline - when to give up, in `Date.now()` milliseconds.
 */
async function until(ready: () => boolean, deadline = Date.now() + TIMEOUT_MS): Promise<void> {
  if (ready() || Date.now() > deadline) {
    return;
  }
  await Bun.sleep(20);
  await until(ready, deadline);
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
  /**
   * Lists the codes published for the file so far.
   *
   * @returns the codes.
   */
  function codes(): string[] {
    return (published.get(uri) ?? []).map((d) => d.code);
  }
  await until(() => published.has(uri) && codes().includes(code) === present);
  return codes();
}

/** A running language server and the way to talk to it. */
interface Server {
  /** Sends one JSON-RPC message, without `jsonrpc`. */
  send: (message: Record<string, unknown>) => void;
  kill: () => void;
}

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
  listen(server.stdout).catch(() => undefined);
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

/** The bundled server, built once for every test in the file. */
const bundled = bundle();

/** A client that registers file watchers for the server, as VS Code does. */
const WATCHING = { workspace: { didChangeWatchedFiles: { dynamicRegistration: true } } };

test("the server shows INW007 on an unopened file, and INW008 once a member is deleted", async () => {
  const root = join(TMP, "project");
  write(root, {
    "pyproject.toml": PYPROJECT,
    "app/__init__.py": "",
    "app/orders/__init__.py": "",
    "app/orders/router.py": "",
    "app/orders/service.py": "",
    "app/orders/helpers.py": "",
  });
  const server = await startServer(root, 1, WATCHING);
  const { send } = server;
  try {
    expect(await codesOnceIncluding(join(root, "app/orders/helpers.py"), "INW007")).toEqual([
      "INW007",
    ]);

    rmSync(join(root, "app/orders/service.py"));
    const changes = [{ uri: pathToFileURL(join(root, "app/orders/service.py")).href, type: 3 }];
    send({ method: "workspace/didChangeWatchedFiles", params: { changes } });
    expect(await codesOnceIncluding(join(root, "app/orders/__init__.py"), "INW008")).toEqual([
      "INW008",
    ]);

    // INW010 on an open document clears once the missing module is created.
    const router = join(root, "app/orders/router.py");
    const uri = pathToFileURL(router).href;
    const textDocument = { uri, languageId: "python", version: 1, text: "import app.pricing\n" };
    send({ method: "textDocument/didOpen", params: { textDocument } });
    expect(await codesOnceIncluding(router, "INW010")).toEqual(["INW010"]);
    write(root, { "app/pricing.py": "" });
    const created = [{ uri: pathToFileURL(join(root, "app/pricing.py")).href, type: 1 }];
    send({ method: "workspace/didChangeWatchedFiles", params: { changes: created } });
    expect(await codesOnceIncluding(router, "INW010", false)).toEqual([]);

    /**
     * Reports file events the way a client would.
     *
     * @param events - paths relative to the root, with 1 for created and 3 for deleted.
     */
    function report(events: [string, number][]): void {
      const reported = events.map(([rel, type]) => ({
        uri: pathToFileURL(join(root, rel)).href,
        type,
      }));
      send({ method: "workspace/didChangeWatchedFiles", params: { changes: reported } });
    }

    /**
     * Replaces the open document's text, then applies a change on disk and
     * reports it the way a client with the server's watchers would.
     *
     * @param text - the document's new text, which imports a missing module.
     * @param change - the change on disk.
     * @param events - the created (1) and deleted (3) paths, relative to the root.
     */
    async function fixedBy(
      text: string,
      change: () => void | Promise<void>,
      events: [string, number][],
    ): Promise<void> {
      const version = Date.now();
      send({
        method: "textDocument/didChange",
        params: { textDocument: { uri, version }, contentChanges: [{ text }] },
      });
      expect(await codesOnceIncluding(router, "INW010")).toEqual(["INW010"]);
      await change();
      for (const [rel, type] of events) {
        // The client reports a path only when a registered watcher covers it.
        expect(watched(rel, type)).toBe(true);
      }
      report(events);
      expect(await codesOnceIncluding(router, "INW010", false)).toEqual([]);
    }

    // A stub file, and a directory renamed into place, are modules too.
    await fixedBy("import app.stubbed\n", () => write(root, { "app/stubbed.pyi": "" }), [
      ["app/stubbed.pyi", 1],
    ]);
    write(root, { "app/payments/invoice.py": "" });
    await fixedBy(
      "import app.billing.invoice\n",
      () => renameSync(join(root, "app/payments"), join(root, "app/billing")),
      [
        ["app/payments", 3],
        ["app/billing", 1],
      ],
    );

    // Events for paths that can't be modules don't rebuild the index: the
    // cached probe still says app.later is missing after it is created.
    const ignored = [".git/index.lock", "app/__pycache__/later.cpython-313.pyc", "README.md"];
    ignored.push("node_modules/pkg/x.py", ".venv/lib/site-packages/x.py", "../outside.py");
    /**
     * Creates the module, then reports only events the server must ignore.
     */
    async function quiet(): Promise<void> {
      write(root, { "app/later.py": "" });
      const before = publishes.get(uri);
      report(ignored.map((rel) => [rel, 1]));
      await Bun.sleep(QUIET_MS);
      expect(publishes.get(uri)).toBe(before);
    }
    await fixedBy("import app.later\n", quiet, [["app/later.py", 1]]);
  } finally {
    server.kill();
  }
}, 30_000);

test("without watched-file support, the server checks against a fresh index each time", async () => {
  const root = join(TMP, "unwatched");
  write(root, {
    "pyproject.toml": PYPROJECT,
    "app/__init__.py": "",
    "app/orders/__init__.py": "",
    "app/orders/router.py": "",
    "app/orders/service.py": "",
  });
  const server = await startServer(root, 2, {});
  try {
    const router = join(root, "app/orders/router.py");
    const uri = pathToFileURL(router).href;
    const textDocument = { uri, languageId: "python", version: 1, text: "import app.pricing\n" };
    server.send({ method: "textDocument/didOpen", params: { textDocument } });
    expect(await codesOnceIncluding(router, "INW010")).toEqual(["INW010"]);
    // No file event will come; the next keystroke must see the new module.
    write(root, { "app/pricing.py": "" });
    const change = {
      textDocument: { uri, version: 2 },
      contentChanges: [{ text: "import app.pricing\n" }],
    };
    server.send({ method: "textDocument/didChange", params: change });
    expect(await codesOnceIncluding(router, "INW010", false)).toEqual([]);
  } finally {
    server.kill();
  }
}, 30_000);
