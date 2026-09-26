import { afterAll, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
const HEADER_END = "\r\n\r\n";
const CONTENT_LENGTH = /Content-Length: (?<n>\d+)/iu;

/** What the test client has received: the latest diagnostics per URI. */
const published = new Map<string, { code: string }[]>();
/** Ids of the requests the server has answered. */
const answered = new Set<number>();

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
      if (message.method === "textDocument/publishDiagnostics") {
        published.set(message.params.uri, message.params.diagnostics);
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
 * Waits until a file's latest diagnostics include a code.
 *
 * @param path - the file's absolute path.
 * @param code - e.g. `INW007`.
 * @returns the codes published for the file.
 */
async function codesOnceIncluding(path: string, code: string): Promise<string[]> {
  const uri = pathToFileURL(path).href;
  /**
   * Lists the codes published for the file so far.
   *
   * @returns the codes.
   */
  function codes(): string[] {
    return (published.get(uri) ?? []).map((d) => d.code);
  }
  await until(() => codes().includes(code));
  return codes();
}

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
  const server = Bun.spawn([process.execPath, await bundle(), "--stdio"], {
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
  try {
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
    send({ method: "initialized", params: {} });
    expect(await codesOnceIncluding(join(root, "app/orders/helpers.py"), "INW007")).toEqual([
      "INW007",
    ]);

    rmSync(join(root, "app/orders/service.py"));
    const changes = [{ uri: pathToFileURL(join(root, "app/orders/service.py")).href, type: 3 }];
    send({ method: "workspace/didChangeWatchedFiles", params: { changes } });
    expect(await codesOnceIncluding(join(root, "app/orders/__init__.py"), "INW008")).toEqual([
      "INW008",
    ]);
  } finally {
    server.kill();
  }
}, 30_000);
