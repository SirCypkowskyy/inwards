/**
 * @file The language server end to end: diagnostics on unopened files, INW008 once
 * a member is deleted, INW010 clearing when a module appears, and the watcher
 * fallback. Without watched-file support, every check uses a fresh index.
 */
import { afterAll, expect, test } from "bun:test";
import { renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DOCS_BASE } from "@inwards/core";
import { lspHarness, PYPROJECT, QUIET_MS, WATCHING, write } from "./lsp-harness.ts";

const {
  tmp: TMP,
  publishes,
  startServer,
  watched,
  codesOnceIncluding,
  diagnosticsOnce,
  cleanup,
} = lspHarness();
afterAll(cleanup);

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
    // The code links to the rule's own docs page (#49).
    const [shape] = await diagnosticsOnce(join(root, "app/orders/helpers.py"), (f) => f.length > 0);
    expect(shape?.codeDescription?.href).toBe(`${DOCS_BASE}/rules/INW007/`);

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
