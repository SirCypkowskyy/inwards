/**
 * @file The extension as it ships: `bun run build` must put `extension.js`,
 * `server.js` and both grammars directly in `dist/`, where `package.json`'s
 * `main` and the client's `asAbsolutePath("dist/server.js")` look. The built
 * server is then started the way VS Code starts it (on Node when it is
 * installed) and must report a violation, which it can only do once both
 * grammars have loaded from beside it. The other LSP tests bundle the server
 * themselves, so they would pass with a broken package.
 */
import { afterAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { lspHarness, PYPROJECT, write } from "./lsp-harness.ts";

const PACKAGE = resolve(import.meta.dir, "..");
const DIST = join(PACKAGE, "dist");
const SHIPPED = ["extension.js", "server.js", "web-tree-sitter.wasm", "tree-sitter-python.wasm"];

const build = Bun.spawnSync([process.execPath, "run", "build"], { cwd: PACKAGE });
const { tmp, startServer, codesOnceIncluding, cleanup } = lspHarness({
  server: join(DIST, "server.js"),
  runtime: Bun.which("node") ?? process.execPath,
});
afterAll(cleanup);

test("the build puts both entries and both grammars directly in dist/", () => {
  expect(build.exitCode).toBe(0);
  expect(SHIPPED.filter((name) => !existsSync(join(DIST, name)))).toEqual([]);
});

test("the shipped server loads its grammars and reports a violation", async () => {
  const root = join(tmp, "project");
  write(root, {
    "pyproject.toml": PYPROJECT,
    "app/__init__.py": "",
    "app/orders/__init__.py": "",
    "app/orders/router.py": "",
    "app/orders/service.py": "",
    "app/orders/helpers.py": "",
  });
  const server = await startServer(root, 1, {});
  try {
    expect(await codesOnceIncluding(join(root, "app/orders/helpers.py"), "INW007")).toEqual([
      "INW007",
    ]);
  } finally {
    server.kill();
  }
});
