/**
 * @file The language server under layer selectors (#191): it indexes code in a
 * `node_modules` directory inside a layer's top-level package as the CLI
 * does, a file event there rebuilds the index, and a config reload replaces
 * which layer owns what. It runs its own server, since each test file needs
 * its own harness.
 */
import { afterAll, expect, test } from "bun:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { layerPackages, parseConfig } from "@inwards/core";
import { lspHarness, WATCHING, write } from "./lsp-harness.ts";

const { tmp: TMP, startServer, codesOnceIncluding, cleanup } = lspHarness();
afterAll(cleanup);

const SELECTORS = `[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.*.domain"] },
  { name = "infrastructure", modules = ["shop.*.infra"] },
]
`;

test("events inside a layer package and config reloads keep the selectors' view current", async () => {
  const root = join(TMP, "slices");
  write(root, {
    "pyproject.toml": SELECTORS,
    "shop/__init__.py": "",
    "shop/orders/domain/__init__.py": "",
    "shop/orders/domain/order.py": "",
    "shop/orders/infra/db.py": "",
  });
  expect(layerPackages(parseConfig(SELECTORS))).toEqual(["shop"]);
  const server = await startServer(root, 1, WATCHING);
  const { send } = server;
  const order = join(root, "shop/orders/domain/order.py");
  /**
   * Reports one file event the way a client with the server's watchers would.
   *
   * @param rel - the path relative to the project.
   * @param type - 1 created, 2 changed, 3 deleted.
   */
  function report(rel: string, type: number): void {
    const changes = [{ uri: pathToFileURL(join(root, rel)).href, type }];
    send({ method: "workspace/didChangeWatchedFiles", params: { changes } });
  }
  try {
    const text = "import shop.orders.infra.db\nimport shop.orders.domain.node_modules.helper\n";
    const textDocument = { uri: pathToFileURL(order).href, languageId: "python", version: 1, text };
    send({ method: "textDocument/didOpen", params: { textDocument } });
    expect((await codesOnceIncluding(order, "INW010")).sort()).toEqual(["INW001", "INW010"]);

    // Inside the layer's package, node_modules is code like any other directory.
    write(root, { "shop/orders/domain/node_modules/helper.py": "" });
    report("shop/orders/domain/node_modules/helper.py", 1);
    expect(await codesOnceIncluding(order, "INW010", false)).toEqual(["INW001"]);

    // A reload rebuilds the membership: shop.orders.infra now belongs to domain.
    write(root, {
      "pyproject.toml": SELECTORS.replace(
        '["shop.*.domain"]',
        '["shop.*.domain", "shop.*.infra"]',
      ).replace('["shop.*.infra"]', '["shop.*.api"]'),
    });
    report("pyproject.toml", 2);
    expect(await codesOnceIncluding(order, "INW001", false)).toEqual([]);
  } finally {
    server.kill();
  }
}, 30_000);
